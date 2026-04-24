/**
 * WebSocket handler for real-time session management.
 * Extracted from index.ts following Claude Code's service layer pattern.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import store from "../db.ts";
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT } from "../agent.ts";
import type { CliType } from "../agent.ts";
import { checkRateLimit } from "../middleware/rate-limiter.ts";

export interface WSClient extends WebSocket {
  isAlive: boolean;
  sessionId?: string;
  projectId?: string;
  executionId?: string;
}

export interface ActiveSession {
  agent: AgentSession | CliSession;
  subscribers: Set<WSClient>;
  isListening: boolean;
  cli: CliType;
}

export interface WSHandlerResult {
  wss: WebSocketServer;
  activeSessions: Map<string, ActiveSession>;
  getOrCreateActive: (sessionId: string, cli?: CliType) => ActiveSession | null;
  removeActive: (sessionId: string) => void;
  broadcastProject: (projectId: string, payload: any) => void;
  broadcastExecution: (executionId: string, payload: any) => void;
}

export function createWSHandler(
  server: Server,
  agentRoot: string,
  allowedOrigins: string[],
): WSHandlerResult {
  const activeSessions = new Map<string, ActiveSession>();
  const getAgentRoot = () => process.env.AGENT_ROOT || agentRoot;

  function getOrCreateActive(sessionId: string, cli: CliType = 'claude'): ActiveSession | null {
    if (activeSessions.has(sessionId)) {
      const existing = activeSessions.get(sessionId)!;
      if (existing.cli !== cli) {
        const oldSubscribers = existing.subscribers;
        existing.agent instanceof AgentSession
          ? (existing.agent as AgentSession).interrupt()
          : (existing.agent as CliSession).abort();
        activeSessions.delete(sessionId);
        const agent = createSession(sessionId, getAgentRoot(), cli);
        const active: ActiveSession = { agent, subscribers: oldSubscribers, isListening: false, cli };
        activeSessions.set(sessionId, active);
        return active;
      }
      return existing;
    }
    const dbSession = store.getSession(sessionId);
    if (!dbSession) return null;
    const agent = createSession(sessionId, getAgentRoot(), cli);
    const active: ActiveSession = { agent, subscribers: new Set(), isListening: false, cli };
    activeSessions.set(sessionId, active);
    return active;
  }

  function broadcast(active: ActiveSession, payload: any) {
    const str = JSON.stringify(payload);
    for (const client of active.subscribers) {
      try {
        if (client.readyState === WebSocket.OPEN) client.send(str);
      } catch { active.subscribers.delete(client); }
    }
  }

  function removeActive(sessionId: string) {
    const active = activeSessions.get(sessionId);
    if (active) {
      if (active.agent instanceof AgentSession) (active.agent as AgentSession).interrupt();
      else (active.agent as CliSession).abort();
      activeSessions.delete(sessionId);
    }
  }

  function handleSDKMessage(sessionId: string, active: ActiveSession, message: any) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (!content) return;
      if (typeof content === "string") {
        store.addMessage(sessionId, { role: "assistant", content });
        broadcast(active, { type: "assistant_message", content });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            store.addMessage(sessionId, { role: "assistant", content: block.text });
            broadcast(active, { type: "assistant_message", content: block.text });
          } else if (block.type === "tool_use" && block.name) {
            store.addMessage(sessionId, { role: "tool_use", tool_name: block.name, tool_input: JSON.stringify(block.input) });
            broadcast(active, { type: "tool_use", toolName: block.name, toolInput: block.input });
          } else if (block.type === "tool_result") {
            const resultContent = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            store.addMessage(sessionId, { role: "tool_result", content: resultContent });
            broadcast(active, { type: "tool_result", content: resultContent });
          }
        }
      }
    } else if (message.type === "result") {
      broadcast(active, { type: "result", success: message.subtype === "success", cost: message.total_cost_usd, duration: message.duration_ms });
    }
  }

  async function startListening(sessionId: string, active: ActiveSession, pendingContent?: string) {
    if (active.isListening) return;
    active.isListening = true;

    if (active.agent instanceof CliSession) {
      if (!pendingContent) { active.isListening = false; return; }
      try {
        console.log(`[CliSession] Executing via ${active.cli}: "${pendingContent.slice(0, 80)}..."`);
        const output = await (active.agent as CliSession).execute(pendingContent);
        const taggedOutput = `[${active.cli}] ${output}`;
        store.addMessage(sessionId, { role: "assistant", content: taggedOutput });
        broadcast(active, { type: "assistant_message", content: taggedOutput });
        broadcast(active, { type: "result", success: true, cost: null, duration: null });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[Session ${sessionId}] CliSession error:`, errorMsg);
        broadcast(active, { type: "error", error: errorMsg });
      } finally { active.isListening = false; }
      return;
    }

    try {
      for await (const message of (active.agent as AgentSession).getOutputStream()) {
        handleSDKMessage(sessionId, active, message);
      }
      // Track turns for session lifecycle management (same as stream-handler)
      (active.agent as AgentSession).incrementTurn();
      // Auto-rotate if context is getting full (inspired by Claude Code's autoCompact)
      if ((active.agent as AgentSession).shouldRotate) {
        const turns = (active.agent as AgentSession).turnCount;
        await (active.agent as AgentSession).rotate();
        broadcast(active, { type: "assistant_message", content: `[Session refreshed after ${turns} turns — context preserved via summary]` });
      } else if ((active.agent as AgentSession).shouldWarnRotation) {
        broadcast(active, { type: "system", content: `[Context at ${(active.agent as AgentSession).turnCount}/${50} turns — will auto-refresh at limit]` });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Session ${sessionId}] Error:`, errorMsg);
      broadcast(active, { type: "error", error: errorMsg });
    } finally { active.isListening = false; }
  }

  // --- WebSocket Server ---
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin }: { origin?: string }) => {
      if (!origin) return true;
      return allowedOrigins.includes(origin);
    },
  });

  const broadcastProject = (projectId: string, payload: any) => {
    const str = JSON.stringify({ ...payload, projectId });
    wss.clients.forEach((ws) => {
      const client = ws as WSClient;
      if (client.projectId === projectId && client.readyState === WebSocket.OPEN) {
        try { client.send(str); } catch { /* client disconnected */ }
      }
    });
  };

  const broadcastExecution = (executionId: string, payload: any) => {
    const str = JSON.stringify({ ...payload, executionId });
    wss.clients.forEach((ws) => {
      const client = ws as WSClient;
      if (client.executionId === executionId && client.readyState === WebSocket.OPEN) {
        try { client.send(str); } catch { /* client disconnected */ }
      }
    });
  };

  wss.on("connection", (ws: WSClient) => {
    ws.isAlive = true;
    ws.send(JSON.stringify({ type: "connected" }));

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "subscribe": {
            if (ws.sessionId) {
              const prev = activeSessions.get(ws.sessionId);
              if (prev) prev.subscribers.delete(ws);
            }
            const existingCli = activeSessions.get(msg.sessionId)?.cli;
            const active = getOrCreateActive(msg.sessionId, existingCli);
            if (!active) { ws.send(JSON.stringify({ type: "error", error: "Session not found" })); break; }
            ws.sessionId = msg.sessionId;
            active.subscribers.add(ws);
            const messages = store.getMessages(msg.sessionId, 100, 0);
            const total = store.countMessages(msg.sessionId);
            ws.send(JSON.stringify({ type: "history", messages, total, running: active.isListening }));
            break;
          }
          case "chat": {
            if (!msg.content?.trim()) { ws.send(JSON.stringify({ type: "error", error: "Empty message" })); break; }
            if (!checkRateLimit(ws.sessionId || "anon")) {
              ws.send(JSON.stringify({ type: "error", error: "Rate limit exceeded. Please wait before sending more messages." }));
              break;
            }
            if (ws.sessionId && ws.sessionId !== msg.sessionId) {
              const prev = activeSessions.get(ws.sessionId);
              if (prev) prev.subscribers.delete(ws);
            }
            const chatCli: CliType = (msg.cli as CliType) || 'claude';
            const active = getOrCreateActive(msg.sessionId, chatCli);
            if (!active) { ws.send(JSON.stringify({ type: "error", error: "Session not found" })); break; }
            ws.sessionId = msg.sessionId;
            active.subscribers.add(ws);
            if (active.isListening) {
              ws.send(JSON.stringify({ type: "error", error: "Session is busy processing a previous message" }));
              break;
            }
            const chatContent = msg.configBot ? `${CONFIG_BOT_PROMPT}\n\nUser request: ${msg.content}` : msg.content;
            store.addMessage(msg.sessionId, { role: "user", content: msg.content });
            broadcast(active, { type: "user_message", content: msg.content });
            console.log(`[Chat] session=${msg.sessionId.slice(0,8)} cli=${active.cli} configBot=${!!msg.configBot} type=${active.agent instanceof AgentSession ? 'AgentSession' : 'CliSession'}`);
            if (active.agent instanceof AgentSession) {
              (active.agent as AgentSession).sendMessage(chatContent);
              if (!active.isListening) startListening(msg.sessionId, active);
            } else {
              if (!active.isListening) startListening(msg.sessionId, active, chatContent);
            }
            break;
          }
          case "interrupt": {
            removeActive(msg.sessionId);
            const interruptStr = JSON.stringify({ type: "interrupted", sessionId: msg.sessionId });
            wss.clients.forEach((client) => {
              const c = client as WSClient;
              if (c.sessionId === msg.sessionId && c.readyState === WebSocket.OPEN) c.send(interruptStr);
            });
            break;
          }
          case "subscribe_project": {
            if (!msg.projectId) { ws.send(JSON.stringify({ type: "error", error: "projectId required" })); break; }
            ws.projectId = msg.projectId;
            ws.send(JSON.stringify({ type: "project_history", projectId: msg.projectId, messages: store.getDiscussionMessages(msg.projectId) }));
            break;
          }
          case "subscribe_execution": {
            if (!msg.executionId) { ws.send(JSON.stringify({ type: "error", error: "executionId required" })); break; }
            ws.executionId = msg.executionId;
            const exec = store.getAgentExecution(msg.executionId);
            if (exec) {
              const steps = store.getExecutionSteps(msg.executionId);
              ws.send(JSON.stringify({ type: "execution_history", executionId: msg.executionId, execution: exec, steps }));
            }
            break;
          }
          default:
            ws.send(JSON.stringify({ type: "error", error: "Unknown message type" }));
        }
      } catch (err) {
        console.error("[WS] Error handling message:", err);
        try { ws.send(JSON.stringify({ type: "error", error: "Invalid message format" })); } catch {}
      }
    });

    ws.on("close", () => {
      for (const active of activeSessions.values()) active.subscribers.delete(ws);
    });
  });

  // Session TTL: clean up stale sessions every 10 minutes
  setInterval(() => {
    for (const [id, active] of activeSessions) {
      if (active.subscribers.size === 0 && !active.isListening) {
        try { removeActive(id); } catch {}
        console.log(`[SessionTTL] Cleaned up idle session ${id.slice(0, 8)}`);
      }
    }
  }, 600_000).unref();

  // Heartbeat: detect dead connections
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as WSClient;
      if (client.isAlive === false) { client.terminate(); return; }
      client.isAlive = false;
      client.ping();
    });
  }, 30_000).unref();

  wss.on("close", () => { clearInterval(heartbeat); });

  return { wss, activeSessions, getOrCreateActive, removeActive, broadcastProject, broadcastExecution };
}
