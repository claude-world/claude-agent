#!/usr/bin/env node
/**
 * Build Claude Agent as an Electron .dmg (macOS) or .exe (Windows)
 *
 * Usage: node scripts/electron-build.cjs [--mac] [--win] [--linux]
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const cwd = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cwd, "..");
const args = process.argv.slice(2);

// Default to current platform
let targets = [];
if (args.includes("--mac")) targets.push("--mac");
if (args.includes("--win")) targets.push("--win");
if (args.includes("--linux")) targets.push("--linux");
if (targets.length === 0) {
  if (process.platform === "darwin") targets.push("--mac");
  else if (process.platform === "win32") targets.push("--win");
  else targets.push("--linux");
}

console.log("Building Claude Agent desktop app...");
console.log(`Platform: ${targets.join(", ")}`);

const stagedPaths = [];

function stageDesktopTemplates() {
  const entries = [
    { src: path.join(repoRoot, ".claude"), dest: path.join(cwd, ".claude"), recursive: true },
    { src: path.join(repoRoot, "CLAUDE.md"), dest: path.join(cwd, "CLAUDE.md"), recursive: false },
    { src: path.join(repoRoot, ".mcp.json"), dest: path.join(cwd, ".mcp.json"), recursive: false },
  ];

  for (const entry of entries) {
    if (!fs.existsSync(entry.src) || fs.existsSync(entry.dest)) continue;
    if (entry.recursive) fs.cpSync(entry.src, entry.dest, { recursive: true });
    else fs.copyFileSync(entry.src, entry.dest);
    stagedPaths.push(entry.dest);
  }
}

function cleanupDesktopTemplates() {
  for (const stagedPath of stagedPaths.reverse()) {
    try {
      fs.rmSync(stagedPath, { recursive: true, force: true });
    } catch {}
  }
}

try {
  // Step 1: Build client
  console.log("\n[1/3] Building client assets...");
  execSync("npm run build", { cwd, stdio: "inherit" });

  // Step 2: Rebuild runtime native modules against Electron's embedded Node ABI
  console.log("\n[2/3] Rebuilding native modules...");
  execSync("npx @electron/rebuild -f -w better-sqlite3", { cwd, stdio: "inherit" });

  stageDesktopTemplates();

  // Step 3: Package with electron-builder
  console.log("\n[3/3] Packaging with electron-builder...");
  execSync(`npx electron-builder ${targets.join(" ")}`, { cwd, stdio: "inherit" });

  console.log("\nBuild complete! Check the release/ directory.");
} catch (err) {
  console.error("Build failed:", err.message);
  process.exit(1);
} finally {
  cleanupDesktopTemplates();
  try {
    console.log("\n[post] Restoring native modules for local Node.js development...");
    execSync("npm rebuild better-sqlite3", { cwd, stdio: "inherit" });
  } catch (restoreErr) {
    console.error("Failed to restore local native modules:", restoreErr.message);
  }
}
