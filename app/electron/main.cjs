const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const PID_FILE = path.join(process.env.HOME || "/tmp", ".claude-agent", "server.pid");

let serverProcess = null;
let mainWindow = null;

// Prevent multiple Electron instances from racing
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[Electron] Another instance is already running. Quitting.");
  app.exit(0);
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Check if a PID belongs to our server (not a recycled unrelated process)
function isOurServer(pid) {
  try {
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8", timeout: 3000 }).trim();
    return cmd.includes("server/index") || cmd.includes("tsx");
  } catch {
    return false;
  }
}

// Kill any orphan server processes from previous runs
function cleanupOrphans() {
  // 1. Check PID file
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        try {
          process.kill(oldPid, 0); // check if alive
          if (isOurServer(oldPid)) {
            console.log(`[Electron] Killing orphan server process (PID: ${oldPid})`);
            process.kill(oldPid, "SIGTERM");
          }
        } catch {
          // process doesn't exist
        }
      }
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  } catch {}

  // 2. Kill any remaining processes listening on our port
  try {
    const lsofOut = execSync(`lsof -ti tcp:${PORT}`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (lsofOut) {
      const pids = lsofOut.split("\n").map((p) => p.trim()).filter(Boolean);
      let killed = false;
      for (const pidStr of pids) {
        const pid = parseInt(pidStr, 10);
        if (!pid || isNaN(pid)) continue;
        if (isOurServer(pid)) {
          console.log(`[Electron] Killing process on port ${PORT} (PID: ${pid})`);
          try { process.kill(pid, "SIGTERM"); killed = true; } catch {}
        }
      }
      // Brief wait for processes to release the port
      if (killed) {
        try { execSync("sleep 0.5", { timeout: 2000 }); } catch {}
      }
    }
  } catch {
    // lsof returns exit code 1 when no matches — that's fine
  }
}

function startServer() {
  // Get login-shell PATH
  let shellPath;
  try {
    shellPath = execSync("/bin/zsh -lc 'echo $PATH'", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    shellPath = process.env.PATH || "";
  }
  const mergedPath = shellPath || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  // Find system node
  let systemNode;
  try {
    systemNode = execSync("/bin/zsh -lc 'which node'", {
      encoding: "utf-8", timeout: 5000, env: { ...process.env, PATH: mergedPath }
    }).trim();
  } catch {
    systemNode = "/usr/local/bin/node";
  }
  console.log(`[Electron] System node: ${systemNode}`);

  // Determine project directory
  // Priority: source repo (dev) > packaged app
  const appPath = app.getAppPath();
  let projectDir;

  if (!app.isPackaged) {
    // Dev mode: run from source
    projectDir = path.join(__dirname, "..");
  } else {
    // Packaged mode: use the bundled app directory
    projectDir = appPath;

    // Ensure all dependencies are installed (electron-builder may prune some)
    const marker = path.join(projectDir, ".deps-installed");
    if (!fs.existsSync(marker)) {
      console.log("[Electron] Installing server dependencies (first launch)...");
      try {
        execSync("npm install --production", {
          cwd: projectDir,
          env: { ...process.env, PATH: mergedPath },
          timeout: 120000,
          stdio: "inherit",
        });
        fs.writeFileSync(marker, new Date().toISOString(), "utf8");
        console.log("[Electron] Dependencies installed successfully.");
      } catch (err) {
        console.error("[Electron] npm install failed:", err.message);
      }
    }
  }

  // Build client if needed (dev mode only)
  if (!app.isPackaged) {
    const distDir = path.join(projectDir, "dist", "client");
    if (!fs.existsSync(distDir)) {
      console.log("[Electron] Building client assets...");
      execSync("npx vite build", { cwd: projectDir, stdio: "inherit" });
    }
  }

  // For packaged app: find the actual git clone directory
  // Check ~/.claude-agent/project.path or use env var
  let agentRoot = projectDir; // default: app bundle (dev mode)
  if (app.isPackaged) {
    const configFile = path.join(process.env.HOME || "", ".claude-agent", "project.path");
    if (fs.existsSync(configFile)) {
      const savedPath = fs.readFileSync(configFile, "utf8").trim();
      if (fs.existsSync(path.join(savedPath, "CLAUDE.md"))) {
        agentRoot = savedPath;
      }
    }
    // If no config, try common locations
    if (agentRoot === projectDir) {
      const guesses = [
        path.join(process.env.HOME || "", "claude-agent"),
        path.join(process.env.HOME || "", "github", "claude-agent"),
        path.join(process.env.HOME || "", "Projects", "claude-agent"),
      ];
      for (const g of guesses) {
        if (fs.existsSync(path.join(g, "CLAUDE.md"))) {
          agentRoot = g;
          break;
        }
      }
    }
    console.log(`[Electron] AGENT_ROOT: ${agentRoot}`);
  }

  const spawnEnv = {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    PATH: mergedPath,
    AGENT_ROOT: agentRoot,
  };

  // Always use system Node + tsx
  const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");
  const serverFile = path.join(projectDir, "server", "index.ts");

  console.log(`[Electron] Starting server: ${systemNode} ${tsxCli} ${serverFile}`);
  console.log(`[Electron] CWD: ${projectDir}`);

  serverProcess = spawn(systemNode, [tsxCli, serverFile], {
    cwd: projectDir,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[Server] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[Server] ${d}`));
  serverProcess.on("exit", (code) => {
    console.log(`[Server] Exited with code ${code}`);
    serverProcess = null;
  });
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    function check(n) {
      if (n <= 0) return reject(new Error("Server failed to start"));
      http.get(`${SERVER_URL}/api/sessions`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(() => check(n - 1), 500);
      }).on("error", () => setTimeout(() => check(n - 1), 500));
    }
    check(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Claude Agent",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function killServer() {
  if (!serverProcess) return;

  const proc = serverProcess;
  const pid = proc.pid;
  serverProcess = null; // prevent double-kill from before-quit + window-all-closed

  console.log(`[Electron] Stopping server (PID: ${pid})...`);

  // Send SIGTERM to the process
  try { proc.kill("SIGTERM"); } catch {}

  // Also kill the entire process tree (tsx spawns a child node process)
  // pkill -P kills direct children; lsof fallback catches anything still on the port
  try {
    execSync(`pkill -TERM -P ${pid} 2>/dev/null || true`, { timeout: 3000 });
  } catch {}

  // Force kill after timeout if still alive
  const forceKillTimer = setTimeout(() => {
    try { process.kill(pid, 0); } catch { return; } // already dead
    console.log(`[Electron] Force-killing server process tree...`);
    try { process.kill(pid, "SIGKILL"); } catch {}
    try { execSync(`pkill -KILL -P ${pid} 2>/dev/null || true`, { timeout: 3000 }); } catch {}
    // Fallback: kill anything still on our port, but only if it's our server
    try {
      const out = execSync(`lsof -ti tcp:${PORT}`, { encoding: "utf-8", timeout: 3000 }).trim();
      if (out) {
        for (const s of out.split("\n").map((p) => p.trim()).filter(Boolean)) {
          const p = parseInt(s, 10);
          if (p && !isNaN(p) && isOurServer(p)) {
            try { process.kill(p, "SIGKILL"); } catch {}
          }
        }
      }
    } catch {}
  }, 3000);
  forceKillTimer.unref();
}

app.whenReady().then(async () => {
  buildMenu();
  cleanupOrphans();
  startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error("[Electron] Failed to start:", err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => { killServer(); app.quit(); });
app.on("before-quit", () => { killServer(); });
app.on("activate", () => { if (!mainWindow && serverProcess) createWindow(); });
