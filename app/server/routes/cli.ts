import { Router } from "express";
import path from "path";
import fs from "fs";

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

  // Mounted at /api so paths match original: /api/cli-detect, /api/cli-available, /api/migrate/*
  router.get("/cli-detect", async (_req, res) => {
    const { execSync } = await import("child_process");
    const shellExec = (cmd: string, timeout = 5000) =>
      execSync(`/bin/zsh -lc '${cmd}'`, { encoding: "utf8", timeout }).trim();
    const results = CLI_LIST.map(({ name, cmd, vFlag }) => {
      try {
        const p = shellExec(`which ${cmd}`, 3000);
        let version: string | null = null;
        try { version = shellExec(`${cmd} ${vFlag}`).split("\n")[0]; } catch {}
        return { name, path: p, version };
      } catch { return { name, path: null, version: null }; }
    });
    res.json(results);
  });

  router.get("/cli-available", async (_req, res) => {
    const { execSync } = await import("child_process");
    const clis: string[] = ['claude'];
    for (const cli of ['codex', 'gemini', 'opencode']) {
      try { execSync(`/bin/zsh -lc 'which ${cli}'`, { timeout: 3000 }); clis.push(cli); } catch {}
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
    const { execSync } = await import("child_process");
    const scriptPath = path.join(deps.agentRoot, "scripts/migrate-openclaw.cjs");
    if (!fs.existsSync(scriptPath)) return res.status(404).json({ error: "Migration script not found" });
    try {
      const output = execSync(`node "${scriptPath}" --verbose`, { encoding: "utf8", timeout: 60000, cwd: deps.agentRoot });
      const reportPath = path.join(deps.agentRoot, "workspace/migration-report.md");
      const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : output;
      res.json({ success: true, report });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
