#!/usr/bin/env node

import fs from "fs/promises";
import os from "os";
import path from "path";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3456";
const SMOKE_PROJECT =
  process.env.SMOKE_PROJECT || path.join(os.tmpdir(), "claude-agent-smoke-project");
const TEST_AUTOSTART = process.env.TEST_AUTOSTART === "1";
const TEST_EXECUTION = process.argv.includes("--execution");

function log(step, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[smoke] ${step}${suffix}`);
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return res.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Server did not become healthy in time");
}

async function requestJson(method, apiPath, body, expectedStatuses = [200]) {
  const res = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;

  if (!expectedStatuses.includes(res.status)) {
    throw new Error(`${method} ${apiPath} failed (${res.status}): ${text}`);
  }

  return payload;
}

async function main() {
  const ids = {};

  log("wait", "health");
  const health = await waitForHealth();
  expect(health.status === "ok", "Health endpoint did not return ok");

  log("system", "health/stats/update");
  const stats = await requestJson("GET", "/api/stats");
  const updateInfo = await requestJson("GET", "/api/update-info");
  const updateCheck = await requestJson("POST", "/api/check-update");
  expect(typeof stats.sessions?.total === "number", "Missing stats.sessions.total");
  expect(updateInfo.currentVersion === "2.0.0", "Unexpected update-info version");
  expect(updateCheck.currentVersion === "2.0.0", "Unexpected check-update version");

  log("cli", "detect/available/migrate-check");
  const cliDetect = await requestJson("GET", "/api/cli-detect");
  const cliAvailable = await requestJson("GET", "/api/cli-available");
  const migrateCheck = await requestJson("GET", "/api/migrate/check");
  expect(Array.isArray(cliDetect) && cliDetect.length > 0, "cli-detect returned no entries");
  expect(Array.isArray(cliAvailable) && cliAvailable.includes("claude"), "cli-available missing claude");
  expect(typeof migrateCheck.found === "boolean", "migrate/check missing found");

  log("project", "init");
  await fs.rm(SMOKE_PROJECT, { recursive: true, force: true });
  await fs.mkdir(SMOKE_PROJECT, { recursive: true });
  const init = await requestJson("POST", "/api/project/init", { project_path: SMOKE_PROJECT });
  expect(init.success === true, "project/init did not return success");
  for (const rel of [".claude", "CLAUDE.md", ".mcp.json", "memory", "workspace"]) {
    await fs.access(path.join(SMOKE_PROJECT, rel));
  }

  const project = await requestJson("GET", "/api/project");
  expect(project.agent_root === SMOKE_PROJECT, "project root did not switch");
  expect(project.has_claude_md === true, "project missing CLAUDE.md");
  expect(project.has_skills === true, "project missing skills");
  expect(project.has_memory === true, "project missing memory");

  log("settings", "read/write");
  await requestJson("PUT", "/api/settings", {
    language: "en",
    model_default: "sonnet",
    default_cli: "claude",
    executor_default: "openai",
    executor_openai_model: "gpt-5.4-mini",
  });
  const settings = await requestJson("GET", "/api/settings");
  expect(settings.language === "en", "language setting not saved");
  expect(settings.model_default === "sonnet", "model_default not saved");
  expect(settings.default_cli === "claude", "default_cli not saved");
  expect(settings.executor_default === "openai", "executor_default not saved");

  log("memory", "put/get/list");
  await requestJson("PUT", "/api/memory/smoke.md", { content: "# Smoke\nhello\n" });
  const memoryFile = await requestJson("GET", "/api/memory/smoke.md");
  const memoryList = await requestJson("GET", "/api/memory");
  expect(memoryFile.content.includes("hello"), "memory file content mismatch");
  expect(memoryList.some((file) => file.filename === "smoke.md"), "memory file missing from list");

  log("skills", "list/export/import/raw/delete");
  const skills = await requestJson("GET", "/api/skills");
  const skillsExport = await requestJson("GET", "/api/skills/export");
  expect(Array.isArray(skills), "skills list is not an array");
  expect(Array.isArray(skillsExport.skills), "skills export missing skills");
  await requestJson("POST", "/api/skills/import", {
    name: "smoke-skill",
    content: "# Smoke Skill\n\nTest skill.\n",
  });
  const skillRaw = await requestJson("GET", "/api/skills/smoke-skill/raw");
  expect(skillRaw.content.includes("Smoke Skill"), "skill raw content mismatch");
  await requestJson("DELETE", "/api/skills/smoke-skill");

  log("agents", "list/export/import/raw/delete");
  const agents = await requestJson("GET", "/api/agents");
  const agentsExport = await requestJson("GET", "/api/agents/export");
  expect(Array.isArray(agents), "agents list is not an array");
  expect(Array.isArray(agentsExport.agents), "agents export missing agents");
  await requestJson("POST", "/api/agents/import", {
    name: "smoke-agent",
    content: "---\nname: Smoke Agent\ndescription: test\n---\nBody\n",
  });
  const agentRaw = await requestJson("GET", "/api/agents/smoke-agent/raw");
  expect(agentRaw.content.includes("Smoke Agent"), "agent raw content mismatch");
  await requestJson("DELETE", "/api/agents/smoke-agent");

  log("mcp", "get/post/delete/put");
  const initialMcp = await requestJson("GET", "/api/mcp");
  expect(initialMcp.mcpServers && typeof initialMcp.mcpServers === "object", "mcp missing mcpServers");
  await requestJson("POST", "/api/mcp/smoke-server", { command: "node", args: ["-v"] });
  const withSmokeServer = await requestJson("GET", "/api/mcp");
  expect(withSmokeServer.mcpServers["smoke-server"], "mcp POST did not persist");
  await requestJson("DELETE", "/api/mcp/smoke-server");
  await requestJson("PUT", "/api/mcp", { mcpServers: { smokePut: { command: "echo", args: ["ok"] } } });
  const replacedMcp = await requestJson("GET", "/api/mcp");
  expect(replacedMcp.mcpServers.smokePut, "mcp PUT did not replace config");

  log("sessions", "create/list/messages/delete/history");
  const session = await requestJson("POST", "/api/sessions", { title: "Smoke Session" }, [201]);
  ids.sessionId = session.id;
  const sessionList = await requestJson("GET", "/api/sessions");
  const sessionMessages = await requestJson("GET", `/api/sessions/${ids.sessionId}/messages`);
  const history = await requestJson("GET", "/api/history");
  expect(sessionList.some((row) => row.id === ids.sessionId), "session missing from list");
  expect(Array.isArray(sessionMessages.messages), "session messages missing");
  expect(Array.isArray(history), "history endpoint did not return array");
  await requestJson("DELETE", `/api/sessions/${ids.sessionId}`);

  log("tasks", "create/update/toggle/executions/delete");
  const task = await requestJson("POST", "/api/scheduled-tasks", {
    name: "Smoke Task",
    prompt: "Reply OK",
    agent: "claude",
    schedule: "0 9 * * *",
    timezone: "Asia/Taipei",
  }, [201]);
  ids.taskId = task.id;
  const taskList = await requestJson("GET", "/api/scheduled-tasks");
  expect(taskList.some((row) => row.id === ids.taskId), "scheduled task missing from list");
  const updatedTask = await requestJson("PUT", `/api/scheduled-tasks/${ids.taskId}`, {
    name: "Smoke Task 2",
    schedule: "0 10 * * *",
  });
  expect(updatedTask.name === "Smoke Task 2", "task update failed");
  const toggledTask = await requestJson("PATCH", `/api/scheduled-tasks/${ids.taskId}/toggle`, {
    enabled: false,
  });
  expect(toggledTask.enabled === false, "task toggle failed");
  const executions = await requestJson("GET", `/api/scheduled-tasks/${ids.taskId}/executions`);
  expect(Array.isArray(executions), "task executions missing");
  await requestJson("DELETE", `/api/scheduled-tasks/${ids.taskId}`);

  log("secrets", "create/update/delete");
  const secret = await requestJson("POST", "/api/secrets", {
    name: "SMOKE_SECRET",
    value: "secret-value",
    description: "smoke",
    category: "test",
  }, [201]);
  ids.secretId = secret.id;
  const secrets = await requestJson("GET", "/api/secrets");
  expect(secrets.some((row) => row.id === ids.secretId), "secret missing from list");
  const updatedSecret = await requestJson("PUT", `/api/secrets/${ids.secretId}`, {
    description: "updated",
  });
  expect(updatedSecret.description === "updated", "secret update failed");
  await requestJson("DELETE", `/api/secrets/${ids.secretId}`);

  log("channels", "status/list/create/patch/delete");
  const channelStatus = await requestJson("GET", "/api/channels/status");
  const channelsBefore = await requestJson("GET", "/api/channels");
  expect(typeof channelStatus.telegram?.running === "boolean", "channel status missing telegram flag");
  expect(Array.isArray(channelsBefore), "channels list is not an array");
  const channel = await requestJson("POST", "/api/channels", {
    platform: "telegram",
    bot_token: "test-token",
    allowed_users: ["smoke"],
    enabled: false,
  }, [201]);
  ids.channelId = channel.id;
  const patchedChannel = await requestJson("PATCH", `/api/channels/${ids.channelId}`, {
    allowed_users: ["smoke", "extra"],
    enabled: false,
  });
  expect(Array.isArray(patchedChannel.allowed_users), "channel patch failed");
  await requestJson("DELETE", `/api/channels/${ids.channelId}`);

  log("roles", "crud/assign/memory");
  const role = await requestJson("POST", "/api/roles", {
    name: "Smoke Role",
    personality: "helpful",
    allowed_skills: ["summarize"],
    language: "en",
    reply_style: "short",
  }, [201]);
  ids.roleId = role.id;
  const roleFetched = await requestJson("GET", `/api/roles/${ids.roleId}`);
  expect(roleFetched.name === "Smoke Role", "role get mismatch");
  const roleUpdated = await requestJson("PUT", `/api/roles/${ids.roleId}`, {
    reply_style: "detailed",
  });
  expect(roleUpdated.reply_style === "detailed", "role update failed");
  await requestJson("POST", `/api/roles/${ids.roleId}/assign`, {
    chat_id: "smoke-chat",
    platform: "telegram",
  });
  await requestJson("PUT", "/api/roles/memory/smoke-chat/favorite_topic", { value: "desktop smoke test" });
  const roleMemories = await requestJson("GET", "/api/roles/memory/smoke-chat");
  expect(roleMemories.some((row) => row.key === "favorite_topic"), "role memory missing");
  const byChat = await requestJson("GET", "/api/roles/by-chat/smoke-chat");
  expect(byChat.id === ids.roleId, "role assignment missing");
  await requestJson("DELETE", `/api/roles/${ids.roleId}/assign/smoke-chat`);
  await requestJson("DELETE", "/api/roles/memory/smoke-chat/favorite_topic");
  await requestJson("DELETE", `/api/roles/${ids.roleId}`);

  log("projects", "crud/guide/messages/reset/delete");
  const projectRow = await requestJson("POST", "/api/projects", {
    name: "Smoke Project",
    topic: "Verify desktop smoke flows",
    discussion_mode: "roundtable",
  }, [201]);
  ids.projectId = projectRow.id;
  const projectFetched = await requestJson("GET", `/api/projects/${ids.projectId}`);
  expect(projectFetched.name === "Smoke Project", "project get mismatch");
  await requestJson("PUT", `/api/projects/${ids.projectId}`, { status: "ready" });
  await requestJson("POST", `/api/projects/${ids.projectId}/guide`, { message: "Please focus on desktop flows." });
  const projectMessages = await requestJson("GET", `/api/projects/${ids.projectId}/messages`);
  expect(projectMessages.length >= 1, "project guide message missing");
  const resetProject = await requestJson("POST", `/api/projects/${ids.projectId}/reset`);
  expect(resetProject.status === "ready", "project reset failed");
  await requestJson("DELETE", `/api/projects/${ids.projectId}`);

  log("executions", "crud/lineages");
  const execution = await requestJson("POST", "/api/executions", {
    title: "Smoke Execution",
    goal: "Verify execution CRUD",
    mode: "auto",
  }, [201]);
  ids.executionId = execution.id;
  const executionList = await requestJson("GET", "/api/executions");
  expect(executionList.some((row) => row.id === ids.executionId), "execution missing from list");
  const executionFetched = await requestJson("GET", `/api/executions/${ids.executionId}`);
  expect(executionFetched.id === ids.executionId, "execution get mismatch");
  const lineage = await requestJson("POST", "/api/executions/lineages", {
    name: "Smoke Lineage",
    memory_scope: "summary",
  }, [201]);
  const childLineage = await requestJson("POST", `/api/executions/lineages/${lineage.id}/spawn`, {
    name: "Smoke Child",
    memoryScope: "none",
  }, [201]);
  const lineageTree = await requestJson("GET", `/api/executions/lineages/${lineage.id}/tree`);
  expect(lineageTree.id === lineage.id, "lineage tree mismatch");
  expect(childLineage.parent_id === lineage.id, "child lineage parent mismatch");
  await requestJson("DELETE", `/api/executions/${ids.executionId}`);

  log("goals", "crud/loop");
  const goal = await requestJson("POST", "/api/goals", {
    title: "Smoke Goal",
    description: "Verify goal CRUD",
    priority: 2,
    milestones: [{ title: "step 1", done: false }],
    tags: ["smoke"],
  }, [201]);
  ids.goalId = goal.id;
  const goals = await requestJson("GET", "/api/goals");
  const goalFetched = await requestJson("GET", `/api/goals/${ids.goalId}`);
  expect(goals.some((row) => row.id === ids.goalId), "goal missing from list");
  expect(goalFetched.id === ids.goalId, "goal get mismatch");
  await requestJson("PUT", `/api/goals/${ids.goalId}/milestones/0`);
  const goalUpdated = await requestJson("PUT", `/api/goals/${ids.goalId}`, {
    status: "paused",
    priority: 3,
  });
  expect(goalUpdated.status === "paused", "goal update failed");
  const goalLoopStatus = await requestJson("GET", "/api/goals/loop/status");
  const goalLogs = await requestJson("GET", "/api/goals/logs/all");
  expect(typeof goalLoopStatus.status === "string", "goal loop status missing");
  expect(Array.isArray(goalLogs), "goal logs missing");
  await requestJson("PUT", "/api/goals/loop/config", {
    schedule: "0 8 * * *",
    timezone: "Asia/Taipei",
    delivery_chat_id: "smoke-chat",
    delivery_platform: "telegram",
  });
  await requestJson("DELETE", `/api/goals/${ids.goalId}`);

  log("vector", "stats");
  const vectorStats = await requestJson("GET", "/api/memory/stats");
  expect(vectorStats.useLanceDB === true, "vector store is not using LanceDB");

  log("system", "export/autostart");
  const systemExport = await requestJson("GET", "/api/export");
  expect(Array.isArray(systemExport.sessions), "system export missing sessions");
  const autostartBefore = await requestJson("GET", "/api/autostart");
  expect(typeof autostartBefore.enabled === "boolean", "autostart status missing");
  if (TEST_AUTOSTART) {
    const enabled = await requestJson("POST", "/api/autostart", { enabled: true });
    expect(enabled.enabled === true, "autostart enable failed");
    const disabled = await requestJson("POST", "/api/autostart", { enabled: false });
    expect(disabled.enabled === false, "autostart disable failed");
  }

  if (TEST_EXECUTION) {
    log("execution", "webhook");
    const sender = `smoke-webhook-${Date.now()}`;
    const webhook = await requestJson("POST", "/api/webhook", {
      sender,
      channel: "smoke",
      message: "Reply with exactly OK.",
    });
    expect(typeof webhook.response === "string" && webhook.response.length > 0, "webhook returned empty response");
    const sessionsAfterWebhook = await requestJson("GET", "/api/sessions");
    const webhookSession = sessionsAfterWebhook.find((row) => row.title === `Webhook:${sender}`);
    if (webhookSession) {
      await requestJson("DELETE", `/api/sessions/${webhookSession.id}`);
    }
  }

  log("project", "reset");
  const reset = await requestJson("POST", "/api/project/reset");
  expect(reset.success === true, "project reset failed");
  for (const rel of [".claude", "CLAUDE.md", ".mcp.json"]) {
    await fs.access(path.join(SMOKE_PROJECT, rel));
  }

  log("done", "all checks passed");
}

main().catch((err) => {
  console.error(`[smoke] FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
