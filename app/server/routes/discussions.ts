import { Router } from "express";
import store from "../db.ts";
import { generateExperts, runDiscussion, generateConclusion } from "../discussion.ts";

export function createDiscussionsRouter(deps: {
  broadcastProject: (projectId: string, payload: any) => void;
}): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try { res.json(store.listProjects()); }
    catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/", (req, res) => {
    try {
      const { name, topic, discussion_mode } = req.body ?? {};
      if (!name || !topic) return res.status(400).json({ error: "name and topic required" });
      res.status(201).json(store.createProject({ name, topic, discussion_mode }));
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/:id", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.put("/:id", (req, res) => {
    try {
      const { experts, status, discussion_mode } = req.body ?? {};
      const project = store.updateProject(req.params.id, { experts, status, discussion_mode });
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(project);
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.delete("/:id", (req, res) => {
    try {
      const ok = store.deleteProject(req.params.id);
      if (!ok) return res.status(404).json({ error: "Project not found" });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/setup-experts", async (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const experts = await generateExperts(project.topic);
      res.json(store.updateProject(req.params.id, { experts, status: "ready" }));
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/start", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.status === "discussing") return res.status(409).json({ error: "Discussion already running" });

      const pid = req.params.id;
      store.updateProject(pid, { status: "discussing" });

      runDiscussion(pid, (event) => {
        switch (event.type) {
          case 'expert_message':
            deps.broadcastProject(pid, {
              type: "project_expert_message",
              message: {
                id: `dm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                project_id: pid, expert_name: event.expert || '', cli: event.cli || 'claude',
                content: event.content || '', round: event.round || 1, created_at: new Date().toISOString(),
              },
            });
            break;
          case 'round_start': deps.broadcastProject(pid, { type: "project_round_start", round: event.round }); break;
          case 'round_end': deps.broadcastProject(pid, { type: "project_round_end", round: event.round }); break;
          case 'conclusion': deps.broadcastProject(pid, { type: "project_conclusion", content: event.content }); break;
          case 'error': deps.broadcastProject(pid, { type: "project_error", content: event.content }); break;
        }
      }).catch((err) => {
        console.error(`[Discussion] Error for project ${pid}:`, err);
        deps.broadcastProject(pid, { type: "project_error", content: String(err) });
      });

      res.json({ started: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/guide", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const { message } = req.body ?? {};
      if (!message) return res.status(400).json({ error: "message required" });

      store.addDiscussionMessage({ project_id: req.params.id, expert_name: "User", cli: "user", content: message, round: 0 });
      deps.broadcastProject(req.params.id, {
        type: "project_expert_message",
        message: { id: `guide-${Date.now()}`, project_id: req.params.id, expert_name: "User", cli: "user", content: message, round: 0, created_at: new Date().toISOString() },
      });
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/conclude", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const cid = req.params.id;
      generateConclusion(cid, (event) => {
        if (event.type === 'conclusion') deps.broadcastProject(cid, { type: "project_conclusion", content: event.content });
      }).catch((err) => {
        console.error(`[Discussion] Conclude error for project ${cid}:`, err);
        deps.broadcastProject(cid, { type: "project_error", content: String(err) });
      });
      res.json({ started: true });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/abort", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      store.updateProject(req.params.id, { status: "discussed" });
      deps.broadcastProject(req.params.id, { type: "project_round_end", round: 99 });
      res.json({ success: true, status: "discussed" });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.post("/:id/reset", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      store.clearDiscussionMessages(req.params.id);
      store.updateProject(req.params.id, { status: "ready" });
      res.json({ success: true, status: "ready" });
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  router.get("/:id/messages", (req, res) => {
    try {
      const project = store.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      res.json(store.getDiscussionMessages(req.params.id));
    } catch (err) { res.status(500).json({ error: String(err) }); }
  });

  return router;
}
