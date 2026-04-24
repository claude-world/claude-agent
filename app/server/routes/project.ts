import { Router } from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import store from "../db.ts";
import { validatePath } from "../middleware/security.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createProjectRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const AGENT_ROOT = deps.agentRoot;

  router.get("/", (_req, res) => {
    const agentRoot = store.getSetting("agent_root") || AGENT_ROOT;
    res.json({
      agent_root: agentRoot,
      has_claude_md: fs.existsSync(path.join(agentRoot, "CLAUDE.md")),
      has_skills: fs.existsSync(path.join(agentRoot, ".claude/skills")),
      has_memory: fs.existsSync(path.join(agentRoot, "memory")),
    });
  });

  router.get("/browse", async (_req, res) => {
    try {
      const { execSync } = await import("child_process");
      const platform = process.platform;
      let selected = "";
      if (platform === "darwin") {
        selected = execSync(
          `osascript -e 'POSIX path of (choose folder with prompt "Select project directory")'`,
          { encoding: "utf8", timeout: 60000 }
        ).trim().replace(/\/$/, "");
      } else if (platform === "win32") {
        selected = execSync(
          `powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }"`,
          { encoding: "utf8", timeout: 60000 }
        ).trim().replace(/[\\\/]$/, "");
      } else if (platform === "linux") {
        selected = execSync(
          `zenity --file-selection --directory --title="Select project directory" 2>/dev/null`,
          { encoding: "utf8", timeout: 60000 }
        ).trim();
      } else {
        return res.status(400).json({ error: "Directory picker not supported on this platform." });
      }
      res.json(selected ? { path: selected } : { path: null, cancelled: true });
    } catch {
      res.json({ path: null, cancelled: true });
    }
  });

  router.post("/init", async (req, res) => {
    try {
      const { project_path } = req.body ?? {};
      if (!project_path) return res.status(400).json({ error: "project_path required" });
      const targetDir = validatePath(project_path);
      fs.mkdirSync(targetDir, { recursive: true });

      const srcClaude = path.join(AGENT_ROOT, ".claude");
      const destClaude = path.join(targetDir, ".claude");
      if (fs.existsSync(srcClaude) && !fs.existsSync(destClaude)) {
        fs.cpSync(srcClaude, destClaude, { recursive: true });
      }
      const srcClaudeMd = path.join(AGENT_ROOT, "CLAUDE.md");
      const destClaudeMd = path.join(targetDir, "CLAUDE.md");
      if (fs.existsSync(srcClaudeMd) && !fs.existsSync(destClaudeMd)) {
        fs.copyFileSync(srcClaudeMd, destClaudeMd);
      }
      const srcMcp = path.join(AGENT_ROOT, ".mcp.json");
      const destMcp = path.join(targetDir, ".mcp.json");
      if (fs.existsSync(srcMcp) && !fs.existsSync(destMcp)) {
        fs.copyFileSync(srcMcp, destMcp);
      }
      const destMemory = path.join(targetDir, "memory");
      if (!fs.existsSync(destMemory)) {
        const srcMemory = path.join(AGENT_ROOT, "memory");
        if (fs.existsSync(srcMemory)) fs.cpSync(srcMemory, destMemory, { recursive: true });
        else fs.mkdirSync(destMemory, { recursive: true });
      }
      fs.mkdirSync(path.join(targetDir, "workspace"), { recursive: true });

      store.setSetting("agent_root", targetDir);
      process.env.AGENT_ROOT = targetDir;
      const configDir = path.join(process.env.HOME || "", ".claude-agent");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, "project.path"), targetDir, "utf8");

      res.json({ success: true, path: targetDir });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/reset", async (req, res) => {
    try {
      const agentRoot = store.getSetting("agent_root") || AGENT_ROOT;
      validatePath(agentRoot);
      process.env.AGENT_ROOT = agentRoot;
      const bundledClaude = path.resolve(__dirname, "../../../.claude");
      const destClaude = path.join(agentRoot, ".claude");
      if (fs.existsSync(bundledClaude)) {
        if (fs.existsSync(destClaude)) fs.rmSync(destClaude, { recursive: true, force: true });
        fs.cpSync(bundledClaude, destClaude, { recursive: true });
      }
      const bundledMd = path.resolve(__dirname, "../../../CLAUDE.md");
      if (fs.existsSync(bundledMd)) {
        fs.copyFileSync(bundledMd, path.join(agentRoot, "CLAUDE.md"));
      }
      const bundledMcp = path.resolve(__dirname, "../../../.mcp.json");
      if (fs.existsSync(bundledMcp)) {
        fs.copyFileSync(bundledMcp, path.join(agentRoot, ".mcp.json"));
      }
      res.json({ success: true, message: "Reset to default configuration" });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
