/**
 * Automatic update detection.
 * Periodically checks GitHub releases for newer versions.
 * Stores results in DB settings for the UI to read.
 *
 * Does NOT auto-apply updates — only notifies. The user decides when to update.
 */

import https from "https";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import store from "./db.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version + repo from package.json at startup
let CURRENT_VERSION = "1.3.0";
let REPO = "claude-world/claude-agent";

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  if (pkg.version) CURRENT_VERSION = pkg.version;
  const repoUrl: string = pkg.repository?.url || "";
  const m = repoUrl.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (m) REPO = m[1];
} catch {}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  lastChecked: string | null;
  releaseUrl: string | null;
}

/** Compare semver strings — returns true if `latest` is strictly newer than `current`. */
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

/** Fetch the latest GitHub release without blocking the event loop. */
async function fetchLatestRelease(): Promise<{
  tag_name: string;
  html_url: string;
  published_at: string;
} | null> {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: {
          "User-Agent": `claude-agent/${CURRENT_VERSION}`,
          Accept: "application/vnd.github.v3+json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json?.tag_name ? json : null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(10_000, () => { req.destroy(); resolve(null); });
  });
}

/**
 * Check GitHub for a newer version and persist results to DB.
 * Returns the update info (cached if network unavailable).
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const now = new Date().toISOString();
  const info: UpdateInfo = {
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    hasUpdate: false,
    lastChecked: now,
    releaseUrl: null,
  };

  const release = await fetchLatestRelease();
  if (release?.tag_name) {
    const latest = release.tag_name.replace(/^v/, "");
    info.latestVersion = latest;
    info.hasUpdate = isNewer(latest, CURRENT_VERSION);
    info.releaseUrl = release.html_url;
  }

  try {
    store.setSetting("update_current_version", CURRENT_VERSION);
    store.setSetting("update_latest_version", info.latestVersion ?? "");
    store.setSetting("update_has_update", info.hasUpdate ? "true" : "false");
    store.setSetting("update_last_checked", now);
    store.setSetting("update_release_url", info.releaseUrl ?? "");
  } catch {}

  return info;
}

/** Return cached update info from DB without a network request. */
export function getCachedUpdateInfo(): UpdateInfo {
  try {
    return {
      currentVersion: store.getSetting("update_current_version") || CURRENT_VERSION,
      latestVersion: store.getSetting("update_latest_version") || null,
      hasUpdate: store.getSetting("update_has_update") === "true",
      lastChecked: store.getSetting("update_last_checked") || null,
      releaseUrl: store.getSetting("update_release_url") || null,
    };
  } catch {
    return {
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      hasUpdate: false,
      lastChecked: null,
      releaseUrl: null,
    };
  }
}

/**
 * Start the background update checker.
 * First check runs 60 seconds after server start to avoid blocking startup.
 * Subsequent checks run every 24 hours.
 */
export function startUpdateChecker(): void {
  // Delayed initial check
  setTimeout(async () => {
    try {
      console.log(`[UpdateChecker] Checking for updates (current: v${CURRENT_VERSION})...`);
      const result = await checkForUpdates();
      if (result.hasUpdate) {
        console.log(`[UpdateChecker] Update available: v${result.latestVersion} → ${result.releaseUrl}`);
      } else {
        console.log(`[UpdateChecker] Up to date (v${CURRENT_VERSION})`);
      }
    } catch (err) {
      console.error("[UpdateChecker] Check failed:", err instanceof Error ? err.message : err);
    }
  }, 60_000);

  // Periodic check every 24 hours
  setInterval(async () => {
    try { await checkForUpdates(); } catch {}
  }, CHECK_INTERVAL_MS).unref();
}
