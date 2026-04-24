const { app, BrowserWindow, shell, Menu, Tray, nativeImage, Notification, dialog, ipcMain } = require("electron");
const { spawn, execSync, execFileSync } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {}

const PORT = 3456;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(process.env.HOME || "/tmp", ".claude-agent");
const PID_FILE = path.join(DATA_DIR, "server.pid");
const WINDOW_STATE_FILE = path.join(DATA_DIR, "window-state.json");
const APP_REPOSITORY_URL = "https://github.com/claude-world/claude-agent";
const UPDATE_RELEASES_URL = `${APP_REPOSITORY_URL}/releases`;

let serverProcess = null;
let mainWindow = null;
let tray = null;
let updateInfo = {
  supported: Boolean(autoUpdater) && app.isPackaged,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  currentVersion: app.getVersion(),
  latestVersion: null,
  progressPercent: null,
  error: null,
  releaseUrl: `${UPDATE_RELEASES_URL}/latest`,
};
let updateCheckSilent = true;
let autoUpdaterConfigured = false;

function getReleaseUrl(version) {
  return version
    ? `${UPDATE_RELEASES_URL}/tag/v${String(version).replace(/^v/, "")}`
    : `${UPDATE_RELEASES_URL}/latest`;
}

function emitUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("updater:state", updateInfo);
}

function syncUpdateChrome() {
  buildTrayMenu(!!serverProcess);
  buildMenu();
  if (tray && process.platform === "darwin") {
    tray.setTitle(updateInfo.available || updateInfo.downloaded ? " CA ●" : " CA");
  }
  emitUpdateState();
}

function setUpdateInfo(patch = {}) {
  updateInfo = {
    ...updateInfo,
    ...patch,
    supported: Boolean(autoUpdater) && app.isPackaged,
  };
  if (!updateInfo.releaseUrl) {
    updateInfo.releaseUrl = getReleaseUrl(updateInfo.latestVersion);
  }
  syncUpdateChrome();
}

function openReleasePage() {
  shell.openExternal(updateInfo.releaseUrl || getReleaseUrl(updateInfo.latestVersion));
}

function installDownloadedUpdate() {
  if (!autoUpdater || !updateInfo.downloaded) return false;
  app.isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function promptInstallUpdate(version) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "Update Ready",
    message: `Claude Agent v${version} has been downloaded.`,
    detail: "Install now to restart the app and complete the update.",
    buttons: ["Install & Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) installDownloadedUpdate();
  }).catch(() => {});
}

function isMissingUpdateMetadataError(error) {
  const message = String(error?.message || error || "");
  return message.includes("latest-mac.yml") && message.includes("404");
}

async function fallbackToReleaseInfo(silent = true) {
  const res = await fetch(`${SERVER_URL}/api/check-update`, { method: "POST" });
  if (!res.ok) return updateInfo;

  const releaseInfo = await res.json();
  setUpdateInfo({
    checking: false,
    available: Boolean(releaseInfo.hasUpdate),
    downloading: false,
    downloaded: false,
    currentVersion: releaseInfo.currentVersion || updateInfo.currentVersion,
    latestVersion: releaseInfo.latestVersion,
    progressPercent: null,
    error: null,
    releaseUrl: releaseInfo.releaseUrl || getReleaseUrl(releaseInfo.latestVersion),
  });

  if (releaseInfo.hasUpdate) {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: "Claude Agent Update Available",
        body: `v${releaseInfo.latestVersion} is available. Open Settings → Updates to learn more.`,
      });
      n.on("click", showWindow);
      n.show();
    }
  } else if (!silent && mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "No Updates",
      message: `Claude Agent is up to date (v${releaseInfo.currentVersion}).`,
      buttons: ["OK"],
    }).catch(() => {});
  }

  return updateInfo;
}

function configureAutoUpdater() {
  if (autoUpdaterConfigured || !autoUpdater || !app.isPackaged) return;

  autoUpdaterConfigured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (...args) => console.log("[Updater]", ...args),
    warn: (...args) => console.warn("[Updater]", ...args),
    error: (...args) => {
      const first = args.find((arg) => arg != null);
      const message = typeof first === "string"
        ? first
        : first?.message || "Update check failed";
      console.warn("[Updater]", String(message).split("\n")[0]);
    },
    debug: (...args) => console.debug("[Updater]", ...args),
  };

  autoUpdater.on("checking-for-update", () => {
    setUpdateInfo({
      checking: true,
      error: null,
      progressPercent: null,
    });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info?.version || null;
    setUpdateInfo({
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      latestVersion: version,
      progressPercent: 0,
      error: null,
      releaseUrl: getReleaseUrl(version),
    });

    if (Notification.isSupported()) {
      const n = new Notification({
        title: "Claude Agent Update Available",
        body: `Downloading v${version || "latest"} in the background.`,
      });
      n.on("click", showWindow);
      n.show();
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateInfo({
      checking: false,
      available: true,
      downloading: true,
      downloaded: false,
      progressPercent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))),
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const version = info?.version || updateInfo.latestVersion;
    setUpdateInfo({
      checking: false,
      available: true,
      downloading: false,
      downloaded: true,
      latestVersion: version,
      progressPercent: 100,
      error: null,
      releaseUrl: getReleaseUrl(version),
    });

    if (Notification.isSupported()) {
      const n = new Notification({
        title: "Claude Agent Update Ready",
        body: `v${version || "latest"} is ready. Install and restart when convenient.`,
      });
      n.on("click", showWindow);
      n.show();
    }

    promptInstallUpdate(version || "latest");
  });

  autoUpdater.on("update-not-available", (info) => {
    const version = info?.version || updateInfo.currentVersion;
    setUpdateInfo({
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      latestVersion: version,
      progressPercent: null,
      error: null,
      releaseUrl: getReleaseUrl(version),
    });

    if (!updateCheckSilent && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "No Updates",
        message: `Claude Agent is up to date (v${updateInfo.currentVersion}).`,
        buttons: ["OK"],
      }).catch(() => {});
    }
  });

  autoUpdater.on("error", (err) => {
    if (isMissingUpdateMetadataError(err)) {
      fallbackToReleaseInfo(updateCheckSilent).catch(() => {});
      return;
    }

    setUpdateInfo({
      checking: false,
      downloading: false,
      error: err?.message || String(err),
    });

    if (!updateCheckSilent && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Check Failed",
        message: err?.message || String(err),
        buttons: ["OK"],
      }).catch(() => {});
    }
  });
}

ipcMain.handle("updater:get-state", async () => updateInfo);
ipcMain.handle("updater:check", async () => {
  await checkUpdatesInApp(false);
  return updateInfo;
});
ipcMain.handle("updater:install", async () => ({ ok: installDownloadedUpdate() }));
ipcMain.handle("updater:open-release-page", async () => {
  openReleasePage();
  return { ok: true };
});

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

function resolveLoginPath() {
  if (process.platform === "win32") return process.env.PATH || "";
  const shellPath = process.env.SHELL || (fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/bash");
  try {
    return execFileSync(shellPath, ["-lc", "printf %s \"$PATH\""], {
      encoding: "utf-8",
      timeout: 5000,
      env: process.env,
    }).trim();
  } catch {
    return process.env.PATH || "";
  }
}

function resolveBinary(command, searchPath) {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    return execFileSync(locator, [command], {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, PATH: searchPath },
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function startServer() {
  const mergedPath = resolveLoginPath() || process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin";
  const systemNode = resolveBinary("node", mergedPath);

  const appPath = app.getAppPath();
  let projectDir;

  if (!app.isPackaged) {
    projectDir = path.join(__dirname, "..");
  } else {
    projectDir = appPath;
  }

  if (!app.isPackaged) {
    const distDir = path.join(projectDir, "dist", "client");
    if (!fs.existsSync(distDir)) {
      console.log("[Electron] Building client assets...");
      execSync("npx vite build", { cwd: projectDir, stdio: "inherit" });
    }
  }

  let agentRoot = app.isPackaged ? projectDir : path.resolve(projectDir, "..");
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
  const launcher = app.isPackaged ? process.execPath : (systemNode || process.execPath);
  if (app.isPackaged || !systemNode) {
    spawnEnv.ELECTRON_RUN_AS_NODE = "1";
  }

  console.log(`[Electron] Starting server: ${launcher} ${tsxCli} ${serverFile}`);
  serverProcess = spawn(launcher, [tsxCli, serverFile], {
    cwd: projectDir,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[Server] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[Server] ${d}`));
  serverProcess.on("error", (err) => {
    console.error("[Server] Failed to spawn:", err);
    serverProcess = null;
    buildTrayMenu(false);
  });
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
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const health = JSON.parse(body);
            if (res.statusCode === 200 && health?.status === "ok" && health?.app === "claude-agent") return resolve();
          } catch {}
          setTimeout(() => check(n - 1), 500);
        });
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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(SERVER_URL);
  mainWindow.webContents.on("did-finish-load", emitUpdateState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin === new URL(SERVER_URL).origin) return;
    } catch {}
    event.preventDefault();
    shell.openExternal(url);
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

  if (updateInfo.downloaded && updateInfo.latestVersion) {
    items.push({
      label: `Install Update v${updateInfo.latestVersion} and Restart`,
      click: () => installDownloadedUpdate(),
    });
    items.push({ type: "separator" });
  } else if (updateInfo.downloading && updateInfo.latestVersion) {
    items.push({
      label: `Downloading Update v${updateInfo.latestVersion}… ${updateInfo.progressPercent ?? 0}%`,
      enabled: false,
    });
    items.push({ type: "separator" });
  } else if (updateInfo.checking) {
    items.push({ label: "Checking for Updates…", enabled: false });
    items.push({ type: "separator" });
  } else if (updateInfo.available && updateInfo.latestVersion) {
    items.push({
      label: `Update Available: v${updateInfo.latestVersion}`,
      click: () => openReleasePage(),
    });
    items.push({ type: "separator" });
  }

  items.push(
    { label: "Check for Updates", enabled: !updateInfo.checking && !updateInfo.downloading, click: () => checkUpdatesInApp() },
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

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="2" width="12" height="12" rx="3" fill="#111827"/>
      <path d="M5 6.5h6M5 9.5h4" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
  `.trim();
  const img = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 16, height: 16 });
  if (process.platform === "darwin") img.setTemplateImage(true);
  return img;
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  if (process.platform === "darwin") tray.setTitle(" CA");
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
  updateCheckSilent = silent;

  if (updateInfo.downloaded) {
    if (!silent) promptInstallUpdate(updateInfo.latestVersion || "latest");
    return updateInfo;
  }

  if (autoUpdater && app.isPackaged) {
    configureAutoUpdater();
    if (updateInfo.checking || updateInfo.downloading) return updateInfo;

    setUpdateInfo({
      checking: true,
      error: null,
      progressPercent: null,
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      if (isMissingUpdateMetadataError(err)) {
        await fallbackToReleaseInfo(silent);
        return updateInfo;
      }

      setUpdateInfo({
        checking: false,
        downloading: false,
        error: err?.message || String(err),
      });
      if (!silent && mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: "error",
          title: "Update Check Failed",
          message: err?.message || String(err),
          buttons: ["OK"],
        }).catch(() => {});
      }
    }

    return updateInfo;
  }
  try {
    return await fallbackToReleaseInfo(silent);
  } catch {
    return updateInfo;
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
              ...(updateInfo.downloaded && updateInfo.latestVersion
                ? [{ label: `Install Update v${updateInfo.latestVersion} and Restart`, click: () => installDownloadedUpdate() }, { type: "separator" }]
                : updateInfo.downloading && updateInfo.latestVersion
                  ? [{ label: `Downloading Update v${updateInfo.latestVersion}… ${updateInfo.progressPercent ?? 0}%`, enabled: false }, { type: "separator" }]
                  : updateInfo.available && updateInfo.latestVersion
                    ? [{ label: `Update Available: v${updateInfo.latestVersion}`, click: () => openReleasePage() }, { type: "separator" }]
                    : []),
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
  configureAutoUpdater();
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
