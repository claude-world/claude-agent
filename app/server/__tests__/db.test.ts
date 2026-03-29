/**
 * Unit tests for the db store layer.
 *
 * We use the real store (which writes to ~/.claude-agent/data/claude-agent.db)
 * and clean up every record created during the test run.
 */
import { describe, it, expect, afterEach } from 'vitest';
import store from '../db.ts';

// ─── Sessions ────────────────────────────────────────────────────────────────

describe('store.sessions', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds) {
      store.deleteSession(id);
    }
    createdIds.length = 0;
  });

  it('createSession with default title', () => {
    const session = store.createSession();
    createdIds.push(session.id);

    expect(session.id).toBeTruthy();
    expect(session.title).toBe('New Session');
    expect(session.status).toBe('active');
    expect(session.created_at).toBeTruthy();
    expect(session.updated_at).toBeTruthy();
  });

  it('createSession with custom title', () => {
    const session = store.createSession('My Test Session');
    createdIds.push(session.id);

    expect(session.title).toBe('My Test Session');
  });

  it('getSession returns the created session', () => {
    const session = store.createSession('Fetch Me');
    createdIds.push(session.id);

    const fetched = store.getSession(session.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(session.id);
    expect(fetched!.title).toBe('Fetch Me');
  });

  it('getSession returns undefined for non-existent id', () => {
    const result = store.getSession('non-existent-id-xyz');
    expect(result).toBeUndefined();
  });

  it('listSessions includes created session', () => {
    const session = store.createSession('Listed Session');
    createdIds.push(session.id);

    const sessions = store.listSessions();
    const found = sessions.find((s) => s.id === session.id);
    expect(found).toBeDefined();
  });

  it('deleteSession soft-deletes the session', () => {
    const session = store.createSession('To Delete');
    createdIds.push(session.id);

    const deleted = store.deleteSession(session.id);
    expect(deleted).toBe(true);

    // getSession filters out deleted sessions
    const fetched = store.getSession(session.id);
    expect(fetched).toBeUndefined();
  });

  it('deleteSession returns false for non-existent session', () => {
    const result = store.deleteSession('does-not-exist');
    expect(result).toBe(false);
  });

  it('listSessions does not include deleted sessions', () => {
    const session = store.createSession('Delete From List');
    createdIds.push(session.id);
    store.deleteSession(session.id);

    const sessions = store.listSessions();
    const found = sessions.find((s) => s.id === session.id);
    expect(found).toBeUndefined();
  });

  it('findSessionByTitle returns existing session', () => {
    const title = `Find By Title ${Date.now()}`;
    const session = store.createSession(title);
    createdIds.push(session.id);

    const found = store.findSessionByTitle(title);
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
    expect(found!.title).toBe(title);
  });

  it('findSessionByTitle returns undefined for non-existent title', () => {
    const result = store.findSessionByTitle('title-that-does-not-exist-xyz-9999');
    expect(result).toBeUndefined();
  });

  it('findSessionByTitle does not return deleted sessions', () => {
    const title = `Deleted Title ${Date.now()}`;
    const session = store.createSession(title);
    createdIds.push(session.id);
    store.deleteSession(session.id);

    const result = store.findSessionByTitle(title);
    expect(result).toBeUndefined();
  });

  it('countSessions reflects created and deleted sessions', () => {
    const before = store.countSessions();

    const s1 = store.createSession('Count Session A');
    const s2 = store.createSession('Count Session B');
    createdIds.push(s1.id, s2.id);

    expect(store.countSessions()).toBe(before + 2);

    store.deleteSession(s1.id);
    expect(store.countSessions()).toBe(before + 1);

    store.deleteSession(s2.id);
    expect(store.countSessions()).toBe(before);
  });

  it('listSessions respects limit and offset', () => {
    // Create 4 uniquely-named sessions to ensure ordering is deterministic
    const titles = [
      `Paginate A ${Date.now()}`,
      `Paginate B ${Date.now() + 1}`,
      `Paginate C ${Date.now() + 2}`,
      `Paginate D ${Date.now() + 3}`,
    ];
    const ids: string[] = [];
    for (const title of titles) {
      const s = store.createSession(title);
      ids.push(s.id);
      createdIds.push(s.id);
    }

    // With limit=2 we should get exactly 2 results
    const page1 = store.listSessions(2, 0);
    expect(page1.length).toBeLessThanOrEqual(2);
    expect(page1.length).toBeGreaterThanOrEqual(1);

    // With offset=2 the results should differ from offset=0
    const page2 = store.listSessions(2, 2);
    const page1Ids = page1.map((s) => s.id);
    const page2Ids = page2.map((s) => s.id);
    // No session should appear in both pages
    expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
  });
});

// ─── Messages ─────────────────────────────────────────────────────────────────

describe('store.messages', () => {
  let sessionId: string;

  afterEach(() => {
    if (sessionId) {
      store.deleteSession(sessionId);
    }
  });

  it('addMessage and getMessages round-trip', () => {
    const session = store.createSession('Message Test');
    sessionId = session.id;

    const msg = store.addMessage(sessionId, {
      role: 'user',
      content: 'Hello from test',
    });

    expect(msg.id).toBeGreaterThan(0);
    expect(msg.session_id).toBe(sessionId);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello from test');

    const messages = store.getMessages(sessionId);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => m.content === 'Hello from test')).toBe(true);
  });

  it('addMessage auto-generates session title from first user message', () => {
    const session = store.createSession(); // default 'New Session'
    sessionId = session.id;

    store.addMessage(sessionId, {
      role: 'user',
      content: 'Auto title content here',
    });

    const updated = store.getSession(sessionId);
    expect(updated).toBeDefined();
    expect(updated!.title).toContain('Auto title content');
  });

  it('addMessage stores tool_name and tool_input', () => {
    const session = store.createSession('Tool Message Test');
    sessionId = session.id;

    store.addMessage(sessionId, {
      role: 'tool_use',
      content: null,
      tool_name: 'bash',
      tool_input: JSON.stringify({ command: 'ls' }),
    });

    const messages = store.getMessages(sessionId);
    const toolMsg = messages.find((m) => m.tool_name === 'bash');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.tool_input).toBe(JSON.stringify({ command: 'ls' }));
  });

  it('getMessages returns empty array for session with no messages', () => {
    const session = store.createSession('Empty Messages');
    sessionId = session.id;

    const messages = store.getMessages(sessionId);
    expect(messages).toEqual([]);
  });

  it('countMessages returns 0 for session with no messages', () => {
    const session = store.createSession('Count Messages Empty');
    sessionId = session.id;

    expect(store.countMessages(sessionId)).toBe(0);
  });

  it('countMessages returns correct count as messages are added', () => {
    const session = store.createSession('Count Messages Session');
    sessionId = session.id;

    store.addMessage(sessionId, { role: 'user', content: 'msg 1' });
    expect(store.countMessages(sessionId)).toBe(1);

    store.addMessage(sessionId, { role: 'assistant', content: 'msg 2' });
    expect(store.countMessages(sessionId)).toBe(2);

    store.addMessage(sessionId, { role: 'user', content: 'msg 3' });
    expect(store.countMessages(sessionId)).toBe(3);
  });

  it('getMessages with limit and offset returns correct subset', () => {
    const session = store.createSession('Pagination Messages');
    sessionId = session.id;

    // Insert 5 messages with distinct content
    for (let i = 1; i <= 5; i++) {
      store.addMessage(sessionId, { role: 'user', content: `message-${i}` });
    }

    // All 5 messages should be present without pagination
    const all = store.getMessages(sessionId);
    expect(all).toHaveLength(5);

    // limit=2, offset=1 → messages at positions 2 and 3 (1-indexed)
    const page = store.getMessages(sessionId, 2, 1);
    expect(page).toHaveLength(2);
    expect(page[0].content).toBe('message-2');
    expect(page[1].content).toBe('message-3');
  });

  it('getMessages with offset beyond message count returns empty array', () => {
    const session = store.createSession('Offset Beyond Messages');
    sessionId = session.id;

    store.addMessage(sessionId, { role: 'user', content: 'only message' });

    const result = store.getMessages(sessionId, 10, 100);
    expect(result).toEqual([]);
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

describe('store.settings', () => {
  const testKeys: string[] = [];

  afterEach(() => {
    // SQLite has no delete for settings; overwrite with empty string to clean up
    for (const key of testKeys) {
      store.setSetting(key, '');
    }
    testKeys.length = 0;
  });

  it('setSetting and getSetting round-trip', () => {
    const key = `test_setting_${Date.now()}`;
    testKeys.push(key);

    store.setSetting(key, 'my-value');
    const value = store.getSetting(key);
    expect(value).toBe('my-value');
  });

  it('getSetting returns undefined for unknown key', () => {
    const value = store.getSetting('totally_unknown_key_xyz_123');
    expect(value).toBeUndefined();
  });

  it('setSetting overwrites existing value', () => {
    const key = `test_overwrite_${Date.now()}`;
    testKeys.push(key);

    store.setSetting(key, 'first');
    store.setSetting(key, 'second');
    expect(store.getSetting(key)).toBe('second');
  });

  it('getAllSettings returns a record of string values', () => {
    const key = `test_all_${Date.now()}`;
    testKeys.push(key);
    store.setSetting(key, 'all-test-value');

    const all = store.getAllSettings();
    expect(typeof all).toBe('object');
    expect(all[key]).toBe('all-test-value');
  });
});

// ─── Secrets ──────────────────────────────────────────────────────────────────

describe('store.secrets', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds) {
      store.deleteSecret(id);
    }
    createdIds.length = 0;
  });

  it('createSecret and getSecret (value masked)', () => {
    const secret = store.createSecret({
      name: `TEST_API_KEY_${Date.now()}`,
      value: 'super-secret-value',
      description: 'Test key',
      category: 'api',
    });
    createdIds.push(secret.id);

    expect(secret.id).toBeTruthy();
    expect(secret.value).toBe('***');
    expect(secret.description).toBe('Test key');
    expect(secret.category).toBe('api');
  });

  it('listSecrets masks values', () => {
    const secret = store.createSecret({
      name: `TEST_LIST_KEY_${Date.now()}`,
      value: 'dont-show-this',
    });
    createdIds.push(secret.id);

    const list = store.listSecrets();
    const found = list.find((s) => s.id === secret.id);
    expect(found).toBeDefined();
    expect(found!.value).toBe('***');
  });

  it('listSecretsRaw returns actual values', () => {
    const name = `TEST_RAW_KEY_${Date.now()}`;
    const secret = store.createSecret({ name, value: 'raw-value' });
    createdIds.push(secret.id);

    const rawList = store.listSecretsRaw();
    const found = rawList.find((s) => s.id === secret.id);
    expect(found).toBeDefined();
    expect(found!.value).toBe('raw-value');
  });

  it('getSecretByName returns raw value', () => {
    const name = `TEST_BY_NAME_${Date.now()}`;
    const secret = store.createSecret({ name, value: 'by-name-value' });
    createdIds.push(secret.id);

    const value = store.getSecretByName(name);
    expect(value).toBe('by-name-value');
  });

  it('updateSecret changes description and category', () => {
    const secret = store.createSecret({
      name: `TEST_UPDATE_KEY_${Date.now()}`,
      value: 'original',
      description: 'Original desc',
      category: 'general',
    });
    createdIds.push(secret.id);

    const updated = store.updateSecret(secret.id, {
      description: 'Updated desc',
      category: 'mcp',
    });

    expect(updated).toBeDefined();
    expect(updated!.description).toBe('Updated desc');
    expect(updated!.category).toBe('mcp');
    expect(updated!.value).toBe('***');
  });

  it('deleteSecret removes it from list', () => {
    const secret = store.createSecret({
      name: `TEST_DELETE_KEY_${Date.now()}`,
      value: 'to-delete',
    });
    createdIds.push(secret.id);

    const deleted = store.deleteSecret(secret.id);
    expect(deleted).toBe(true);

    const list = store.listSecrets();
    const found = list.find((s) => s.id === secret.id);
    expect(found).toBeUndefined();

    // Remove from cleanup list since it's already deleted
    const idx = createdIds.indexOf(secret.id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });
});

// ─── Channel Accounts ─────────────────────────────────────────────────────────

describe('store.channelAccounts', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds) {
      store.deleteChannelAccount(id);
    }
    createdIds.length = 0;
  });

  it('setChannelAccount creates a new account', () => {
    const account = store.setChannelAccount({
      platform: 'telegram',
      bot_token: 'test-bot-token-123',
      allowed_users: ['user1', 'user2'],
      enabled: true,
    });
    createdIds.push(account.id);

    expect(account.id).toBeTruthy();
    expect(account.platform).toBe('telegram');
    expect(account.bot_token).toBe('test-bot-token-123');
    expect(account.allowed_users).toEqual(['user1', 'user2']);
    expect(account.enabled).toBe(true);
  });

  it('getChannelAccount retrieves by id', () => {
    const account = store.setChannelAccount({
      platform: 'discord',
      bot_token: 'discord-token',
    });
    createdIds.push(account.id);

    const fetched = store.getChannelAccount(account.id);
    expect(fetched).toBeDefined();
    expect(fetched!.platform).toBe('discord');
  });

  it('getChannelAccount returns undefined for unknown id', () => {
    const result = store.getChannelAccount('no-such-id');
    expect(result).toBeUndefined();
  });

  it('listChannelAccounts includes created account', () => {
    const account = store.setChannelAccount({
      platform: 'telegram',
      bot_token: 'list-test-token',
    });
    createdIds.push(account.id);

    const list = store.listChannelAccounts();
    expect(list.some((a) => a.id === account.id)).toBe(true);
  });

  it('listChannelAccountsByPlatform filters correctly', () => {
    const tg = store.setChannelAccount({
      platform: 'telegram',
      bot_token: 'platform-filter-tg',
    });
    const dc = store.setChannelAccount({
      platform: 'discord',
      bot_token: 'platform-filter-dc',
    });
    createdIds.push(tg.id, dc.id);

    const telegramOnly = store.listChannelAccountsByPlatform('telegram');
    expect(telegramOnly.some((a) => a.id === tg.id)).toBe(true);
    expect(telegramOnly.every((a) => a.platform === 'telegram')).toBe(true);
  });

  it('deleteChannelAccount removes the account', () => {
    const account = store.setChannelAccount({
      platform: 'telegram',
      bot_token: 'delete-me-token',
    });
    createdIds.push(account.id);

    const deleted = store.deleteChannelAccount(account.id);
    expect(deleted).toBe(true);

    const fetched = store.getChannelAccount(account.id);
    expect(fetched).toBeUndefined();

    const idx = createdIds.indexOf(account.id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });

  it('allowed_users is parsed as an array (not a string)', () => {
    const account = store.setChannelAccount({
      platform: 'telegram',
      bot_token: 'parse-test',
      allowed_users: ['alice', 'bob'],
    });
    createdIds.push(account.id);

    const fetched = store.getChannelAccount(account.id);
    expect(Array.isArray(fetched!.allowed_users)).toBe(true);
    expect(fetched!.allowed_users).toContain('alice');
  });
});

// ─── Scheduled Tasks ──────────────────────────────────────────────────────────

describe('store.scheduledTasks', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds) {
      store.deleteScheduledTask(id);
    }
    createdIds.length = 0;
  });

  it('createScheduledTask with required fields', () => {
    const task = store.createScheduledTask({
      name: 'Test Task',
      prompt: 'Say hello',
      schedule: '0 9 * * *',
    });
    createdIds.push(task.id);

    expect(task.id).toBeTruthy();
    expect(task.name).toBe('Test Task');
    expect(task.prompt).toBe('Say hello');
    expect(task.schedule).toBe('0 9 * * *');
    expect(task.enabled).toBe(true);
    expect(task.timezone).toBe('Asia/Taipei');
  });

  it('createScheduledTask with all optional fields', () => {
    const task = store.createScheduledTask({
      name: 'Full Task',
      prompt: 'Do something',
      schedule: '*/5 * * * *',
      agent: 'claude',
      timezone: 'UTC',
      enabled: false,
    });
    createdIds.push(task.id);

    expect(task.timezone).toBe('UTC');
    expect(task.enabled).toBe(false);
    expect(task.agent).toBe('claude');
  });

  it('getScheduledTask retrieves by id', () => {
    const task = store.createScheduledTask({
      name: 'Get Test',
      prompt: 'Fetch prompt',
      schedule: '0 * * * *',
    });
    createdIds.push(task.id);

    const fetched = store.getScheduledTask(task.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Get Test');
  });

  it('getScheduledTask returns undefined for unknown id', () => {
    expect(store.getScheduledTask('no-such-task')).toBeUndefined();
  });

  it('listScheduledTasks includes created task', () => {
    const task = store.createScheduledTask({
      name: 'List Test',
      prompt: 'List prompt',
      schedule: '0 0 * * *',
    });
    createdIds.push(task.id);

    const list = store.listScheduledTasks();
    expect(list.some((t) => t.id === task.id)).toBe(true);
  });

  it('updateScheduledTask changes name and prompt', () => {
    const task = store.createScheduledTask({
      name: 'Original Name',
      prompt: 'Original prompt',
      schedule: '0 1 * * *',
    });
    createdIds.push(task.id);

    const updated = store.updateScheduledTask(task.id, {
      name: 'Updated Name',
      prompt: 'Updated prompt',
    });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.prompt).toBe('Updated prompt');
    expect(updated!.schedule).toBe('0 1 * * *'); // unchanged
  });

  it('toggleScheduledTask enables and disables', () => {
    const task = store.createScheduledTask({
      name: 'Toggle Test',
      prompt: 'Toggle prompt',
      schedule: '0 2 * * *',
      enabled: true,
    });
    createdIds.push(task.id);

    const disabled = store.toggleScheduledTask(task.id, false);
    expect(disabled!.enabled).toBe(false);

    const enabled = store.toggleScheduledTask(task.id, true);
    expect(enabled!.enabled).toBe(true);
  });

  it('deleteScheduledTask removes the task', () => {
    const task = store.createScheduledTask({
      name: 'Delete Test',
      prompt: 'Delete prompt',
      schedule: '0 3 * * *',
    });
    createdIds.push(task.id);

    const deleted = store.deleteScheduledTask(task.id);
    expect(deleted).toBe(true);
    expect(store.getScheduledTask(task.id)).toBeUndefined();

    const idx = createdIds.indexOf(task.id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });
});

// ─── Projects & Discussion Messages ───────────────────────────────────────────

describe('store.projects', () => {
  const createdIds: string[] = [];

  afterEach(() => {
    for (const id of createdIds) {
      store.deleteProject(id);
    }
    createdIds.length = 0;
  });

  it('createProject with required fields', () => {
    const project = store.createProject({
      name: 'Test Project',
      topic: 'AI Testing',
    });
    createdIds.push(project.id);

    expect(project.id).toBeTruthy();
    expect(project.name).toBe('Test Project');
    expect(project.topic).toBe('AI Testing');
    expect(project.status).toBe('setup');
    expect(project.experts).toEqual([]);
    expect(project.discussion_mode).toBe('auto');
  });

  it('getProject retrieves by id', () => {
    const project = store.createProject({ name: 'Fetch Project', topic: 'Fetch Topic' });
    createdIds.push(project.id);

    const fetched = store.getProject(project.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Fetch Project');
  });

  it('getProject returns undefined for unknown id', () => {
    expect(store.getProject('no-such-project')).toBeUndefined();
  });

  it('listProjects includes created project', () => {
    const project = store.createProject({ name: 'List Project', topic: 'List Topic' });
    createdIds.push(project.id);

    const list = store.listProjects();
    expect(list.some((p) => p.id === project.id)).toBe(true);
  });

  it('updateProject sets experts array', () => {
    const project = store.createProject({ name: 'Expert Project', topic: 'Expert Topic' });
    createdIds.push(project.id);

    const experts = [
      { name: 'Alice', role: 'Analyst', cli: 'claude', systemPrompt: 'You are an analyst.' },
    ];

    const updated = store.updateProject(project.id, { experts, status: 'running' });
    expect(updated).toBeDefined();
    expect(updated!.experts).toHaveLength(1);
    expect(updated!.experts[0].name).toBe('Alice');
    expect(updated!.status).toBe('running');
  });

  it('deleteProject removes the project', () => {
    const project = store.createProject({ name: 'Delete Project', topic: 'Delete Topic' });
    createdIds.push(project.id);

    const deleted = store.deleteProject(project.id);
    expect(deleted).toBe(true);
    expect(store.getProject(project.id)).toBeUndefined();

    const idx = createdIds.indexOf(project.id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });
});

describe('store.discussionMessages', () => {
  let projectId: string;

  afterEach(() => {
    if (projectId) {
      store.clearDiscussionMessages(projectId);
      store.deleteProject(projectId);
    }
  });

  it('addDiscussionMessage and getDiscussionMessages', () => {
    const project = store.createProject({ name: 'Disc Project', topic: 'Disc Topic' });
    projectId = project.id;

    const msg = store.addDiscussionMessage({
      project_id: projectId,
      expert_name: 'Bob',
      cli: 'claude',
      content: 'Round 1 contribution',
      round: 1,
    });

    expect(msg.id).toBeTruthy();
    expect(msg.expert_name).toBe('Bob');
    expect(msg.round).toBe(1);
    expect(msg.content).toBe('Round 1 contribution');

    const messages = store.getDiscussionMessages(projectId);
    expect(messages).toHaveLength(1);
    expect(messages[0].expert_name).toBe('Bob');
  });

  it('clearDiscussionMessages removes all messages for project', () => {
    const project = store.createProject({ name: 'Clear Project', topic: 'Clear Topic' });
    projectId = project.id;

    store.addDiscussionMessage({
      project_id: projectId,
      expert_name: 'Alice',
      cli: 'claude',
      content: 'Message 1',
      round: 1,
    });
    store.addDiscussionMessage({
      project_id: projectId,
      expert_name: 'Bob',
      cli: 'claude',
      content: 'Message 2',
      round: 1,
    });

    store.clearDiscussionMessages(projectId);
    const messages = store.getDiscussionMessages(projectId);
    expect(messages).toHaveLength(0);
  });
});

// ─── Task Executions ───────────────────────────────────────────────────────────

describe('store.taskExecutions', () => {
  let taskId: string;

  afterEach(() => {
    if (taskId) {
      store.deleteScheduledTask(taskId);
    }
  });

  it('createTaskExecution and updateTaskExecution lifecycle', () => {
    const task = store.createScheduledTask({
      name: 'Exec Test Task',
      prompt: 'Run something',
      schedule: '0 4 * * *',
    });
    taskId = task.id;

    const execution = store.createTaskExecution({
      task_id: task.id,
      triggered_by: 'manual',
    });

    expect(execution.id).toBeTruthy();
    expect(execution.task_id).toBe(task.id);
    expect(execution.status).toBe('running');
    expect(execution.triggered_by).toBe('manual');

    store.updateTaskExecution(execution.id, {
      status: 'success',
      output: 'Done!',
      cost_usd: 0.01,
      duration_ms: 500,
    });

    const executions = store.listTaskExecutions(task.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].status).toBe('success');
    expect(executions[0].output).toBe('Done!');
    expect(executions[0].cost_usd).toBe(0.01);
    expect(executions[0].duration_ms).toBe(500);
  });

  it('listTaskExecutions without taskId returns all executions', () => {
    const task = store.createScheduledTask({
      name: 'All Exec Test',
      prompt: 'All executions',
      schedule: '0 5 * * *',
    });
    taskId = task.id;

    store.createTaskExecution({ task_id: task.id, triggered_by: 'schedule' });

    const all = store.listTaskExecutions(undefined, 100);
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── queryHistory ──────────────────────────────────────────────────────────────

describe('store.queryHistory', () => {
  let sessionId: string;

  afterEach(() => {
    if (sessionId) {
      store.deleteSession(sessionId);
    }
  });

  it('queryHistory returns messages matching search term', () => {
    const session = store.createSession('History Test');
    sessionId = session.id;

    store.addMessage(sessionId, {
      role: 'user',
      content: 'unique-search-term-xyz-history-test',
    });

    const results = store.queryHistory({ search: 'unique-search-term-xyz-history-test' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('unique-search-term-xyz-history-test');
  });

  it('queryHistory filters by session_id', () => {
    const session = store.createSession('History Filter Test');
    sessionId = session.id;

    store.addMessage(sessionId, {
      role: 'user',
      content: 'session-specific-message-abc',
    });

    const results = store.queryHistory({ session_id: sessionId });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.session_id === sessionId)).toBe(true);
  });
});
