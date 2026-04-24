import { Router } from "express";
import path from "path";
import fs from "fs";
import { safeName } from "../middleware/security.ts";
import store from "../db.ts";

export function createMcpRouter(deps: { agentRoot: string }): Router {
  const router = Router();
  const getMcpJsonPath = () =>
    path.join(store.getSetting("agent_root") || process.env.AGENT_ROOT || deps.agentRoot, ".mcp.json");

  router.get("/", (_req, res) => {
    try {
      const MCP_JSON_PATH = getMcpJsonPath();
      if (!fs.existsSync(MCP_JSON_PATH)) return res.json({ mcpServers: {} });
      res.json(JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8")));
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.put("/", (req, res) => {
    try {
      const MCP_JSON_PATH = getMcpJsonPath();
      const { mcpServers } = req.body ?? {};
      if (!mcpServers || typeof mcpServers !== "object") return res.status(400).json({ error: "mcpServers object required" });
      fs.writeFileSync(MCP_JSON_PATH, JSON.stringify({ mcpServers }, null, 2) + "\n", "utf8");
      res.json({ success: true, mcpServers });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:name", (req, res) => {
    try {
      const MCP_JSON_PATH = getMcpJsonPath();
      const config = fs.existsSync(MCP_JSON_PATH) ? JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8")) : { mcpServers: {} };
      config.mcpServers[safeName(req.params.name)] = req.body;
      fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
      res.json({ success: true, name: req.params.name });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:name", (req, res) => {
    try {
      const MCP_JSON_PATH = getMcpJsonPath();
      if (!fs.existsSync(MCP_JSON_PATH)) return res.status(404).json({ error: "No MCP config" });
      const config = JSON.parse(fs.readFileSync(MCP_JSON_PATH, "utf8"));
      delete config.mcpServers[safeName(req.params.name)];
      fs.writeFileSync(MCP_JSON_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
      res.json({ success: true, deleted: req.params.name });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
