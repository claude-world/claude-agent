const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;
let mainWindow = null;

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

  const spawnEnv = {
    ...process.env,
    PORT: String(PORT),
    HOST: "127.0.0.1",
    PATH: mergedPath,
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
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    setTimeout(() => { if (serverProcess) serverProcess.kill("SIGKILL"); }, 3000);
  }
}

app.whenReady().then(async () => {
  buildMenu();
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
