#!/usr/bin/env node
/**
 * Build Claude Agent as an Electron .dmg (macOS) or .exe (Windows)
 *
 * Usage: node scripts/electron-build.cjs [--mac] [--win] [--linux]
 */
const { execSync } = require("child_process");
const path = require("path");

const cwd = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

// Default to current platform
let targets = [];
if (args.includes("--mac")) targets.push("--mac");
if (args.includes("--win")) targets.push("--win");
if (args.includes("--linux")) targets.push("--linux");
if (targets.length === 0) targets.push("--mac"); // default macOS

console.log("Building Claude Agent desktop app...");
console.log(`Platform: ${targets.join(", ")}`);

try {
  // Step 1: Build client
  console.log("\n[1/3] Building client assets...");
  execSync("npx vite build", { cwd, stdio: "inherit" });

  // Step 2: Rebuild native modules for Electron
  console.log("\n[2/3] Rebuilding native modules for Electron...");
  execSync("npx electron-rebuild", { cwd, stdio: "inherit" });

  // Step 3: Package with electron-builder
  console.log("\n[3/3] Packaging with electron-builder...");
  execSync(`npx electron-builder ${targets.join(" ")}`, { cwd, stdio: "inherit" });

  console.log("\nBuild complete! Check the release/ directory.");
} catch (err) {
  console.error("Build failed:", err.message);
  process.exit(1);
}
