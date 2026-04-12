/**
 * Security utilities for path validation and sanitization.
 * Extracted from index.ts to follow Claude Code's separation of concerns.
 */

import path from "path";
import fs from "fs";
import os from "os";

/**
 * Validate that a path is within the user's home directory.
 * Prevents path traversal, symlink escape, and prefix attacks.
 */
export function validatePath(targetPath: string): string {
  const home = process.env.HOME || os.homedir();
  if (!home || !path.isAbsolute(home)) {
    throw new Error("Cannot determine home directory.");
  }
  if (targetPath.includes("..")) {
    throw new Error("Path traversal (..) is not allowed.");
  }
  const expanded = targetPath.replace(/^~/, home);
  if (!path.isAbsolute(expanded)) {
    throw new Error("Path must be absolute (or start with ~).");
  }
  const resolved = path.resolve(expanded);
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    throw new Error(`Path must be within home directory. Got: ${resolved}`);
  }
  let checkPath = resolved;
  while (checkPath !== path.dirname(checkPath)) {
    try {
      const real = fs.realpathSync(checkPath);
      if (!real.startsWith(home + path.sep) && real !== home) {
        throw new Error("Symlink traversal detected.");
      }
      break;
    } catch (e: any) {
      if (e.code === "ENOENT") {
        checkPath = path.dirname(checkPath);
        continue;
      }
      throw e;
    }
  }
  return resolved;
}

/** Sanitize directory/file name (strip traversal chars). */
export function safeName(name: string): string {
  return path.basename(name).replace(/[^a-z0-9._-]/gi, "-");
}
