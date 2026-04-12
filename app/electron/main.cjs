const { app, BrowserWindow, shell, Menu, Tray, nativeImage, Notification, dialog } = require("electron");
const { spawn, execSync } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(process.env.HOME || "/tmp", ".claude-agent");
const PID_FILE = path.join(DATA_DIR, "server.pid");
const WINDOW_STATE_FILE = path.join(DATA_DIR, "window-state.json");

let serverProcess = null;
let mainWindow = null;
let tray = null;
let updateInfo = null; // cached update check result

// ── Single instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[Electron] Another instance is already running. Quitting.");
  app.exit(0);
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── Orphan process management ───────────────────────────────────────────────

function isOurServer(pid) {
  try {
    const cmd = execSync(`ps -p ${pid} -o command=`, { encoding: "utf-8", timeout: 3000 }).trim();
    return cmd.includes("server/index") || cmd.includes("tsx");
  } catch {
    return false;
  }
}

function cleanupOrphans() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        try {
          process.kill(oldPid, 0);
          if (isOurServer(oldPid)) {
            console.log(`[Electron] Killing orphan server (PID: ${oldPid})`);
            process.kill(oldPid, "SIGTERM");
          }
        } catch {}
      }
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  } catch {}

  try {
    const lsofOut = execSync(`lsof -ti tcp:${PORT}`, { encoding: "utf-8", timeout: 5000 }).trim();
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
      if (killed) {
        try { execSync("sleep 0.5", { timeout: 2000 }); } catch {}
      }
    }
  } catch {}
}

// ── Server lifecycle ────────────────────────────────────────────────────────

function startServer() {
  let shellPath;
  try {
    shellPath = execSync("/bin/zsh -lc 'echo $PATH'", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    shellPath = process.env.PATH || "";
  }
  const mergedPath = shellPath || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  let systemNode;
  try {
    systemNode = execSync("/bin/zsh -lc 'which node'", {
      encoding: "utf-8", timeout: 5000, env: { ...process.env, PATH: mergedPath }
    }).trim();
  } catch {
    systemNode = "/usr/local/bin/node";
  }

  const appPath = app.getAppPath();
  let projectDir;

  if (!app.isPackaged) {
    projectDir = path.join(__dirname, "..");
  } else {
    projectDir = appPath;
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
      } catch (err) {
        console.error("[Electron] npm install failed:", err.message);
      }
    }
  }

  if (!app.isPackaged) {
    const distDir = path.join(projectDir, "dist", "client");
    if (!fs.existsSync(distDir)) {
      console.log("[Electron] Building client assets...");
      execSync("npx vite build", { cwd: projectDir, stdio: "inherit" });
    }
  }

  let agentRoot = projectDir;
  if (app.isPackaged) {
    const configFile = path.join(process.env.HOME || "", ".claude-agent", "project.path");
    if (fs.existsSync(configFile)) {
      const savedPath = fs.readFileSync(configFile, "utf8").trim();
      if (fs.existsSync(path.join(savedPath, "CLAUDE.md"))) agentRoot = savedPath;
    }
    if (agentRoot === projectDir) {
      const guesses = [
        path.join(process.env.HOME || "", "claude-agent"),
        path.join(process.env.HOME || "", "github", "claude-agent"),
        path.join(process.env.HOME || "", "Projects", "claude-agent"),
      ];
      for (const g of guesses) {
        if (fs.existsSync(path.join(g, "CLAUDE.md"))) { agentRoot = g; break; }
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

  const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");
  const serverFile = path.join(projectDir, "server", "index.ts");

  console.log(`[Electron] Starting server: ${systemNode} ${tsxCli} ${serverFile}`);
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
    // Update tray to reflect server down state
    buildTrayMenu(false);
  });
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    function check(n) {
      if (n <= 0) return reject(new Error("Server failed to start within 30 seconds"));
      http.get(`${SERVER_URL}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(() => check(n - 1), 500);
      }).on("error", () => setTimeout(() => check(n - 1), 500));
    }
    check(retries);
  });
}

function killServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  const pid = proc.pid;
  serverProcess = null;

  console.log(`[Electron] Stopping server (PID: ${pid})...`);
  try { proc.kill("SIGTERM"); } catch {}
  try { execSync(`pkill -TERM -P ${pid} 2>/dev/null || true`, { timeout: 3000 }); } catch {}

  const forceKill = setTimeout(() => {
    try { process.kill(pid, 0); } catch { return; }
    try { process.kill(pid, "SIGKILL"); } catch {}
    try { execSync(`pkill -KILL -P ${pid} 2>/dev/null || true`, { timeout: 3000 }); } catch {}
    try {
      const out = execSync(`lsof -ti tcp:${PORT}`, { encoding: "utf-8", timeout: 3000 }).trim();
      for (const s of (out || "").split("\n").filter(Boolean)) {
        const p = parseInt(s, 10);
        if (p && !isNaN(p) && isOurServer(p)) { try { process.kill(p, "SIGKILL"); } catch {} }
      }
    } catch {}
  }, 3000);
  forceKill.unref();
}

// ── Window state persistence ────────────────────────────────────────────────

function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE, "utf8"));
      if (state.width >= 800 && state.height >= 600) return state;
    }
  } catch {}
  return { width: 1440, height: 900 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(mainWindow.getBounds()), "utf8");
  } catch {}
}

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    ...state,
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

  // Persist bounds on resize/move
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("move", saveWindowState);

  // macOS: hide to tray instead of closing
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin" && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else if (serverProcess) {
    createWindow();
  }
}

// ── System tray ─────────────────────────────────────────────────────────────

function buildTrayMenu(serverRunning = true) {
  if (!tray) return;

  const items = [
    {
      label: mainWindow?.isVisible() ? "Hide Window" : "Show Window",
      click: () => {
        if (!mainWindow || !mainWindow.isVisible()) showWindow();
        else mainWindow.hide();
      },
    },
    { type: "separator" },
    {
      label: "Open in Browser",
      enabled: serverRunning,
      click: () => shell.openExternal(SERVER_URL),
    },
    { type: "separator" },
  ];

  if (updateInfo?.hasUpdate && updateInfo.latestVersion) {
    items.push({
      label: `Update Available: v${updateInfo.latestVersion}`,
      click: () => { if (updateInfo.releaseUrl) shell.openExternal(updateInfo.releaseUrl); },
    });
    items.push({ type: "separator" });
  }

  items.push(
    { label: "Check for Updates", click: () => checkUpdatesInApp() },
    { type: "separator" },
    {
      label: serverRunning ? "Restart Server" : "Start Server",
      click: () => {
        if (serverRunning) killServer();
        setTimeout(startServer, serverRunning ? 1500 : 0);
      },
    },
    { type: "separator" },
    { label: "Quit Claude Agent", role: "quit" }
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  // Use empty image + text title for macOS menu bar (no icon file required)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle(" CA");
  tray.setToolTip("Claude Agent — click to show");

  buildTrayMenu();

  // Single click: show/hide window
  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
    else showWindow();
  });
}

// ── Update checking ─────────────────────────────────────────────────────────

async function checkUpdatesInApp(silent = false) {
  try {
    const res = await fetch(`${SERVER_URL}/api/check-update`, { method: "POST" });
    if (!res.ok) return;
    updateInfo = await res.json();
    buildTrayMenu(!!serverProcess);

    if (updateInfo.hasUpdate) {
      tray?.setTitle(" CA ●"); // dot indicator in menu bar
      if (Notification.isSupported()) {
        const n = new Notification({
          title: "Claude Agent Update Available",
          body: `v${updateInfo.latestVersion} is ready. Open Settings → Updates to learn more.`,
        });
        n.on("click", showWindow);
        n.show();
      }
    } else if (!silent) {
      tray?.setTitle(" CA");
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "No Updates",
          message: `Claude Agent is up to date (v${updateInfo.currentVersion}).`,
          buttons: ["OK"],
        });
      }
    } else {
      tray?.setTitle(" CA");
    }
  } catch {
    // Server may not be running yet — silently ignore
  }
}

// ── App menu ────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "Check for Updates…", click: () => checkUpdatesInApp(false) },
              { label: "Open in Browser", click: () => shell.openExternal(SERVER_URL) },
              { label: "Restart Server", click: () => { killServer(); setTimeout(startServer, 1500); } },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
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
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── macOS dock menu ─────────────────────────────────────────────────────────

function buildDockMenu() {
  if (process.platform !== "darwin") return;
  app.dock.setMenu(Menu.buildFromTemplate([
    { label: "Show Window", click: showWindow },
    { label: "Open in Browser", click: () => shell.openExternal(SERVER_URL) },
    { type: "separator" },
    { label: "Restart Server", click: () => { killServer(); setTimeout(startServer, 1500); } },
  ]));
}

// ── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu();
  buildDockMenu();
  cleanupOrphans();
  startServer();

  try {
    await waitForServer();
    createWindow();
    createTray();
    // Check for updates 8 seconds after UI is ready (silent — no dialog if up-to-date)
    setTimeout(() => checkUpdatesInApp(true), 8000);
  } catch (err) {
    dialog.showErrorBox(
      "Claude Agent — Failed to Start",
      `The server could not start. Please check the logs for details.\n\n${err.message}`
    );
    app.quit();
  }
});

// macOS: clicking dock icon re-shows window
app.on("activate", () => {
  if (!mainWindow || !mainWindow.isVisible()) showWindow();
});

// macOS: hide to tray rather than quit; other platforms: quit
app.isQuitting = false;
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    killServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  saveWindowState();
  killServer();
});
