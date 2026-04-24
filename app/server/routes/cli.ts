import { Router } from "express";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import store from "../db.ts";

const CLI_LIST = [
  { name: 'claude', cmd: 'claude', vFlag: '--version' },
  { name: 'codex', cmd: 'codex', vFlag: '--version' },
  { name: 'gemini', cmd: 'gemini', vFlag: '--version' },
  { name: 'opencode', cmd: 'opencode', vFlag: 'version' },
  { name: 'node', cmd: 'node', vFlag: '--version' },
  { name: 'uvx', cmd: 'uvx', vFlag: '--version' },
  { name: 'gh', cmd: 'gh', vFlag: '--version' },
];

export function createCliRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const locator = process.platform === "win32" ? "where" : "which";
  const getAgentRoot = () => store.getSetting("agent_root") || process.env.AGENT_ROOT || deps.agentRoot;

  function resolveBinary(cmd: string): string | null {
    try {
      const output = execFileSync(locator, [cmd], {
        encoding: "utf8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return output.split(/\r?\n/).find(Boolean) || null;
    } catch {
      return null;
    }
  }

  function readVersion(binaryPath: string, name: string, vFlag: string): string | null {
    try {
      return execFileSync(binaryPath, vFlag ? [vFlag] : [], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim().split("\n")[0] || null;
    } catch {
      try {
        return execFileSync(binaryPath, ["--version"], {
          encoding: "utf8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim().split("\n")[0] || null;
      } catch {
        console.warn(`[CLI] Failed to read version for ${name}`);
        return null;
      }
    }
  }

  // Mounted at /api so paths match original: /api/cli-detect, /api/cli-available, /api/migrate/*
  router.get("/cli-detect", async (_req, res) => {
    const results = CLI_LIST.map(({ name, cmd, vFlag }) => {
      const binaryPath = resolveBinary(cmd);
      return {
        name,
        path: binaryPath,
        version: binaryPath ? readVersion(binaryPath, name, vFlag) : null,
      };
    });
    res.json(results);
  });

  router.get("/cli-available", async (_req, res) => {
    const clis: string[] = ['claude'];
    for (const cli of ['codex', 'gemini', 'opencode']) {
      if (resolveBinary(cli)) clis.push(cli);
    }
    res.json(clis);
  });

  router.get("/migrate/check", (_req, res) => {
    const openclawDir = path.join(process.env.HOME || "", ".openclaw");
    const found = fs.existsSync(openclawDir);
    let summary = "";
    if (found) {
      const parts: string[] = [`Found: ${openclawDir}`];
      const workspace = path.join(openclawDir, "workspace");
      if (fs.existsSync(workspace)) {
        if (fs.existsSync(path.join(workspace, "SOUL.md"))) parts.push("SOUL.md (personality)");
        if (fs.existsSync(path.join(workspace, "MEMORY.md"))) parts.push("MEMORY.md (knowledge)");
        const skillsDir = path.join(workspace, "skills");
        if (fs.existsSync(skillsDir)) {
          const count = fs.readdirSync(skillsDir).filter(d => fs.existsSync(path.join(skillsDir, d, "SKILL.md"))).length;
          parts.push(`${count} skills`);
        }
      }
      const sessionsDir = path.join(openclawDir, "sessions");
      if (fs.existsSync(sessionsDir)) {
        const count = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl")).length;
        parts.push(`${count} sessions`);
      }
      summary = parts.join("\n");
    }
    res.json({ found, summary });
  });

  router.post("/migrate/run", async (_req, res) => {
    const agentRoot = getAgentRoot();
    const scriptPath = path.join(agentRoot, "scripts/migrate-openclaw.cjs");
    if (!fs.existsSync(scriptPath)) return res.status(404).json({ error: "Migration script not found" });
    try {
      const nodeBin = resolveBinary("node") || process.execPath;
      const output = execFileSync(nodeBin, [scriptPath, "--verbose"], {
        encoding: "utf8",
        timeout: 60000,
        cwd: agentRoot,
      });
      const reportPath = path.join(agentRoot, "workspace/migration-report.md");
      const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : output;
      res.json({ success: true, report });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
