import { Router } from "express";
import fs from "fs";
import store from "../db.ts";
import { parseTelegramExport, importHistoryToRole } from "../import-history.ts";
import type { TelegramBridge } from "../telegram.ts";
import type { DiscordBridge } from "../discord.ts";

export function createRolesRouter(deps: {
  bridges: { telegram: TelegramBridge | null; discord: DiscordBridge | null };
}): Router {
  const router = Router();

  // IMPORTANT: specific routes must come BEFORE generic /:id route

  router.get("/assignments", (_req, res) => {
    try { res.json(store.listRoleAssignments()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/by-chat/:chatId", (req, res) => {
    try {
      const role = store.getRoleByChatId(req.params.chatId);
      if (!role) return res.json({ role: null });
      res.json(role);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/memory/:chatId", (req, res) => {
    try { res.json(store.listRoleMemories(req.params.chatId)); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.put("/memory/:chatId/:key", (req, res) => {
    try {
      const { value } = req.body ?? {};
      if (typeof value !== "string") return res.status(400).json({ error: "value required" });
      store.setRoleMemory(req.params.chatId, req.params.key, value);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/memory/:chatId/:key", (req, res) => {
    try {
      store.deleteRoleMemory(req.params.chatId, req.params.key);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/memory/:chatId", (req, res) => {
    try {
      store.clearRoleMemories(req.params.chatId);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/import-history", (req, res) => {
    try {
      const { file_path, role_id, chat_id } = req.body ?? {};
      if (!file_path) return res.status(400).json({ error: "file_path required (path to Telegram HTML export)" });
      if (!role_id && !chat_id) return res.status(400).json({ error: "role_id or chat_id required" });
      if (!fs.existsSync(file_path)) return res.status(404).json({ error: `File not found: ${file_path}` });
      const result = importHistoryToRole(file_path, role_id, chat_id);
      res.json({
        success: true,
        chat_name: result.chatName,
        message_count: result.messageCount,
        summary_length: result.summary.length,
        preview: result.summary.slice(0, 500),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/parse-history", (req, res) => {
    try {
      const { file_path } = req.body ?? {};
      if (!file_path) return res.status(400).json({ error: "file_path required" });
      if (!fs.existsSync(file_path)) return res.status(404).json({ error: `File not found: ${file_path}` });
      const result = parseTelegramExport(file_path);
      res.json({
        chat_name: result.chatName,
        message_count: result.messageCount,
        participants: result.participants,
        date_range: result.dateRange,
        sample_messages: result.messages.slice(0, 10).map(m => ({
          sender: m.sender, date: m.date, time: m.time, text: m.text.slice(0, 100),
        })),
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Generic CRUD — must come after specific routes
  router.get("/", (_req, res) => {
    try { res.json(store.listRoles()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/", (req, res) => {
    try {
      const { name, personality, allowed_skills, language, reply_style, knowledge_context, reply_mode, reply_keywords } = req.body ?? {};
      if (!name) return res.status(400).json({ error: "name required" });
      const role = store.createRole({ name, personality, allowed_skills, language, reply_style, knowledge_context, reply_mode, reply_keywords });
      res.status(201).json(role);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/:id", (req, res) => {
    try {
      const role = store.getRole(req.params.id);
      if (!role) return res.status(404).json({ error: "Role not found" });
      res.json(role);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.put("/:id", (req, res) => {
    try {
      const role = store.updateRole(req.params.id, req.body ?? {});
      if (!role) return res.status(404).json({ error: "Role not found" });
      res.json(role);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:id", (req, res) => {
    try {
      const ok = store.deleteRole(req.params.id);
      if (!ok) return res.status(404).json({ error: "Role not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/assign", (req, res) => {
    try {
      const { chat_id, platform } = req.body ?? {};
      if (!chat_id) return res.status(400).json({ error: "chat_id required" });
      const role = store.getRole(req.params.id);
      if (!role) return res.status(404).json({ error: "Role not found" });
      store.assignRole(chat_id, req.params.id, platform || 'telegram');
      if (deps.bridges.telegram) (deps.bridges.telegram as any).invalidateSession?.(chat_id);
      if (deps.bridges.discord) (deps.bridges.discord as any).invalidateSession?.(chat_id);
      res.json({ success: true, chat_id, role_id: req.params.id });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:id/assign/:chatId", (req, res) => {
    try {
      store.unassignRole(req.params.chatId);
      if (deps.bridges.telegram) (deps.bridges.telegram as any).invalidateSession?.(req.params.chatId);
      if (deps.bridges.discord) (deps.bridges.discord as any).invalidateSession?.(req.params.chatId);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
