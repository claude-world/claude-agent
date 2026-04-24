/**
 * Auto-start on boot — platform-aware service management.
 *
 * macOS:   ~/Library/LaunchAgents/com.claude-world.agent.plist  (launchd)
 * Linux:   ~/.config/systemd/user/claude-agent.service           (systemd --user)
 * Windows: HKCU\...\Run\ClaudeAgent                             (registry)
 *
 * Usage:
 *   GET  /api/system/autostart          → getAutostartStatus()
 *   POST /api/system/autostart          → { enabled: true } → enableAutostart()
 *                                         { enabled: false } → disableAutostart()
 */

import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = os.homedir();
const PLATFORM = process.platform;
const APP_DIR = path.resolve(__dirname, ".."); // app/ directory
const LOG_DIR = path.join(HOME, ".claude-agent");

// ── Path constants ───────────────────────────────────────────────────────────

const MAC_PLIST_PATH = path.join(
  HOME, "Library", "LaunchAgents", "com.claude-world.agent.plist"
);

const SYSTEMD_PATH = path.join(
  HOME, ".config", "systemd", "user", "claude-agent.service"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Locate the tsx entry script: project-local → PATH lookup → fallback. */
function findTsxScript(): string {
  const local = path.join(APP_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  if (fs.existsSync(local)) return local;
  const locator = PLATFORM === "win32" ? "where" : "which";
  try {
    return execFileSync(locator, ["tsx"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0];
  } catch {
    return "tsx";
  }
}

function findNodeLauncher(): { launcher: string; electronRunAsNode: boolean } {
  if (process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === "1") {
    return { launcher: process.execPath, electronRunAsNode: true };
  }

  const locator = PLATFORM === "win32" ? "where" : "which";
  try {
    const nodePath = execFileSync(locator, ["node"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split(/\r?\n/)[0];
    if (nodePath) {
      return { launcher: nodePath, electronRunAsNode: false };
    }
  } catch {}

  return { launcher: process.execPath, electronRunAsNode: true };
}

// ── Service file generators ───────────────────────────────────────────────────

function macPlistContent(): string {
  const { launcher, electronRunAsNode } = findNodeLauncher();
  const tsx = findTsxScript();
  const serverEntry = path.join(APP_DIR, "server", "index.ts");
  const agentRoot = process.env.AGENT_ROOT || path.resolve(APP_DIR, "..");
  // Cover Homebrew + npm global installs
  const envPath = "/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claude-world.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>${launcher}</string>
    <string>${tsx}</string>
    <string>${serverEntry}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(LOG_DIR, "server.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(LOG_DIR, "server-error.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_ROOT</key>
    <string>${agentRoot}</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>${envPath}</string>
    ${electronRunAsNode ? "<key>ELECTRON_RUN_AS_NODE</key>\n    <string>1</string>" : ""}
  </dict>
</dict>
</plist>`;
}

function systemdContent(): string {
  const { launcher, electronRunAsNode } = findNodeLauncher();
  const tsx = findTsxScript();
  const serverEntry = path.join(APP_DIR, "server", "index.ts");
  const agentRoot = process.env.AGENT_ROOT || path.resolve(APP_DIR, "..");

  return `[Unit]
Description=Claude Agent Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${launcher} ${tsx} ${serverEntry}
Restart=on-failure
RestartSec=5
Environment=AGENT_ROOT=${agentRoot}
Environment=HOME=${HOME}
${electronRunAsNode ? "Environment=ELECTRON_RUN_AS_NODE=1\n" : ""}StandardOutput=append:${path.join(LOG_DIR, "server.log")}
StandardError=append:${path.join(LOG_DIR, "server-error.log")}

[Install]
WantedBy=default.target`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AutostartStatus {
  enabled: boolean;
  platform: string;
  servicePath: string;
  error?: string;
}

/** Return the current auto-start status without making changes. */
export function getAutostartStatus(): AutostartStatus {
  if (PLATFORM === "darwin") {
    return {
      enabled: fs.existsSync(MAC_PLIST_PATH),
      platform: "macOS (launchd)",
      servicePath: MAC_PLIST_PATH,
    };
  }

  if (PLATFORM === "linux") {
    return {
      enabled: fs.existsSync(SYSTEMD_PATH),
      platform: "Linux (systemd --user)",
      servicePath: SYSTEMD_PATH,
    };
  }

  if (PLATFORM === "win32") {
    try {
      execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ClaudeAgent"',
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      return { enabled: true, platform: "Windows (registry)", servicePath: "HKCU\\...\\Run\\ClaudeAgent" };
    } catch {
      return { enabled: false, platform: "Windows (registry)", servicePath: "HKCU\\...\\Run\\ClaudeAgent" };
    }
  }

  return { enabled: false, platform: PLATFORM, servicePath: "", error: "Unsupported platform" };
}

/** Install the auto-start service for the current platform. */
export function enableAutostart(): AutostartStatus {
  // Ensure log directory exists so service can write logs from first boot
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}

  if (PLATFORM === "darwin") {
    try {
      fs.mkdirSync(path.dirname(MAC_PLIST_PATH), { recursive: true });
      fs.writeFileSync(MAC_PLIST_PATH, macPlistContent(), "utf8");
      // Load into current launchd session (starts immediately + on next login)
      try { execSync(`launchctl load -w "${MAC_PLIST_PATH}"`, { stdio: "pipe" }); } catch {}
      console.log(`[Autostart] macOS: installed plist at ${MAC_PLIST_PATH}`);
      return { enabled: true, platform: "macOS (launchd)", servicePath: MAC_PLIST_PATH };
    } catch (err) {
      return { enabled: false, platform: "macOS (launchd)", servicePath: MAC_PLIST_PATH, error: String(err) };
    }
  }

  if (PLATFORM === "linux") {
    try {
      fs.mkdirSync(path.dirname(SYSTEMD_PATH), { recursive: true });
      fs.writeFileSync(SYSTEMD_PATH, systemdContent(), "utf8");
      try {
        execSync("systemctl --user daemon-reload", { stdio: "pipe" });
        execSync("systemctl --user enable --now claude-agent.service", { stdio: "pipe" });
      } catch {}
      console.log(`[Autostart] Linux: installed systemd unit at ${SYSTEMD_PATH}`);
      return { enabled: true, platform: "Linux (systemd --user)", servicePath: SYSTEMD_PATH };
    } catch (err) {
      return { enabled: false, platform: "Linux (systemd --user)", servicePath: SYSTEMD_PATH, error: String(err) };
    }
  }

  if (PLATFORM === "win32") {
    try {
      const { launcher, electronRunAsNode } = findNodeLauncher();
      const tsx = findTsxScript();
      const serverEntry = path.join(APP_DIR, "server", "index.ts");
      // Quote the full command string for the registry value
      const prefix = electronRunAsNode ? "set ELECTRON_RUN_AS_NODE=1 && " : "";
      const cmd = `cmd /c "${prefix}\\"${launcher}\\" \\"${tsx}\\" \\"${serverEntry}\\""`;
      execSync(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ClaudeAgent" /t REG_SZ /d "${cmd}" /f`,
        { stdio: "pipe" }
      );
      console.log("[Autostart] Windows: added registry Run key");
      return { enabled: true, platform: "Windows (registry)", servicePath: "HKCU\\...\\Run\\ClaudeAgent" };
    } catch (err) {
      return { enabled: false, platform: "Windows (registry)", servicePath: "", error: String(err) };
    }
  }

  return { enabled: false, platform: PLATFORM, servicePath: "", error: "Unsupported platform" };
}

/** Remove the auto-start service for the current platform. */
export function disableAutostart(): AutostartStatus {
  if (PLATFORM === "darwin") {
    try {
      if (fs.existsSync(MAC_PLIST_PATH)) {
        try { execSync(`launchctl unload -w "${MAC_PLIST_PATH}"`, { stdio: "pipe" }); } catch {}
        fs.unlinkSync(MAC_PLIST_PATH);
      }
      console.log("[Autostart] macOS: removed launchd plist");
      return { enabled: false, platform: "macOS (launchd)", servicePath: MAC_PLIST_PATH };
    } catch (err) {
      return { enabled: true, platform: "macOS (launchd)", servicePath: MAC_PLIST_PATH, error: String(err) };
    }
  }

  if (PLATFORM === "linux") {
    try {
      try {
        execSync("systemctl --user disable --now claude-agent.service", { stdio: "pipe" });
        execSync("systemctl --user daemon-reload", { stdio: "pipe" });
      } catch {}
      if (fs.existsSync(SYSTEMD_PATH)) fs.unlinkSync(SYSTEMD_PATH);
      console.log("[Autostart] Linux: removed systemd unit");
      return { enabled: false, platform: "Linux (systemd --user)", servicePath: SYSTEMD_PATH };
    } catch (err) {
      return { enabled: true, platform: "Linux (systemd --user)", servicePath: SYSTEMD_PATH, error: String(err) };
    }
  }

  if (PLATFORM === "win32") {
    try {
      execSync(
        'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "ClaudeAgent" /f',
        { stdio: "pipe" }
      );
      console.log("[Autostart] Windows: removed registry Run key");
      return { enabled: false, platform: "Windows (registry)", servicePath: "" };
    } catch (err) {
      return { enabled: true, platform: "Windows (registry)", servicePath: "", error: String(err) };
    }
  }

  return { enabled: false, platform: PLATFORM, servicePath: "", error: "Unsupported platform" };
}
