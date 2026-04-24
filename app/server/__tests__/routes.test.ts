import { Readable, Writable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import store from '../db.ts';
import { createAgenticRouter } from '../routes/agentic.ts';
import { createScheduledTasksRouter } from '../routes/scheduled-tasks.ts';
import { createSettingsRouter } from '../routes/settings.ts';
import { createSystemRouter } from '../routes/system.ts';

async function callRouter(router: any, method: string, url: string, body?: unknown) {
  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve, reject) => {
    let status = 200;
    let settled = false;
    const headers: Record<string, string> = {};

    const req = new Readable({ read() { this.push(null); } }) as any;
    req.method = method;
    req.url = url;
    req.originalUrl = url;
    req.headers = { host: '127.0.0.1' };
    req.body = body;
    req.query = {};

    const res = new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as any;
    const finish = (payload: any) => {
      if (!settled) {
        settled = true;
        resolve({ status, body: payload, headers });
      }
      return res;
    };
    res.status = (code: number) => { status = code; return res; };
    res.setHeader = (key: string, value: string) => { headers[key.toLowerCase()] = value; return res; };
    res.getHeader = (key: string) => headers[key.toLowerCase()];
    res.json = finish;
    res.send = finish;
    res.end = (payload?: any) => finish(payload);

    router.handle(req, res, (err: unknown) => {
      if (err) reject(err);
      else finish({ error: 'Not found' });
    });
  });
}

describe('settings/system route safety', () => {
  afterEach(() => {
    store.setSetting('webhook_secret', '');
  });

  it('redacts sensitive settings from settings responses and preserves blank API key updates', async () => {
    store.setSetting('executor_openai_api_key', 'sk-test-secret');

    const router = createSettingsRouter({ restartBridge: vi.fn() });
    const getRes = await callRouter(router, 'GET', '/');
    expect(getRes.status).toBe(200);
    expect(getRes.body.executor_openai_api_key).toBeUndefined();
    expect(getRes.body.executor_openai_api_key_set).toBe('true');

    const putRes = await callRouter(router, 'PUT', '/', { executor_openai_api_key: '' });
    expect(putRes.status).toBe(200);
    expect(store.getSetting('executor_openai_api_key')).toBe('sk-test-secret');
  });

  it('rejects unsafe agent_root updates through settings', async () => {
    const before = store.getSetting('agent_root');

    const res = await callRouter(
      createSettingsRouter({ restartBridge: vi.fn() }),
      'PUT',
      '/',
      { agent_root: '/tmp/claude-agent-outside-home' }
    );
    expect(res.status).toBe(400);
    expect(store.getSetting('agent_root')).toBe(before);
  });

  it('redacts sensitive settings from system export', async () => {
    store.setSetting('executor_gemini_api_key', 'gemini-secret');

    const res = await callRouter(createSystemRouter({
      activeSessions: new Map(),
      bridges: { telegram: null, discord: null },
      getOrCreateActive: vi.fn() as any,
    }), 'GET', '/export');
    expect(res.status).toBe(200);
    expect(res.body.settings.executor_gemini_api_key).toBeUndefined();
    expect(res.body.settings.executor_gemini_api_key_set).toBe('true');
  });

  it('rejects webhook execution when no webhook secret is configured', async () => {
    store.setSetting('webhook_secret', '');
    const getOrCreateActive = vi.fn(() => {
      throw new Error('should not be called');
    });

    const res = await callRouter(createSystemRouter({
      activeSessions: new Map(),
      bridges: { telegram: null, discord: null },
      getOrCreateActive: getOrCreateActive as any,
    }), 'POST', '/webhook', { message: 'run this' });
    expect(res.status).toBe(403);
    expect(getOrCreateActive).not.toHaveBeenCalled();
  });
});

describe('scheduled task route validation', () => {
  const createdTaskIds: string[] = [];

  afterEach(() => {
    for (const id of createdTaskIds) store.deleteScheduledTask(id);
    createdTaskIds.length = 0;
  });

  it('rejects invalid timezone before persisting a scheduled task', async () => {
    const res = await callRouter(createScheduledTasksRouter(), 'POST', '/', {
      name: 'Invalid Timezone Route Test',
      prompt: 'test',
      schedule: '0 9 * * *',
      timezone: 'Mars/Olympus',
    });
    expect(res.status).toBe(400);
    expect(store.listScheduledTasks().some((t) => t.name === 'Invalid Timezone Route Test')).toBe(false);
  });

  it('lists all task executions through the collection route', async () => {
    const task = store.createScheduledTask({
      name: 'Executions Route Test',
      prompt: 'test',
      schedule: '0 9 * * *',
      enabled: false,
    });
    createdTaskIds.push(task.id);
    store.createTaskExecution({ task_id: task.id, triggered_by: 'manual' });

    const res = await callRouter(createScheduledTasksRouter(), 'GET', '/executions');
    expect(res.status).toBe(200);
    expect(res.body.some((e: any) => e.task_id === task.id)).toBe(true);
  });
});

describe('agentic lineage routes', () => {
  it('deletes a lineage subtree', async () => {
    const root = store.createLineage({ name: 'Route Delete Root' });
    const child = store.createLineage({ name: 'Route Delete Child', parent_id: root.id });

    const res = await callRouter(
      createAgenticRouter({ broadcastExecution: vi.fn() }),
      'DELETE',
      `/lineages/${root.id}`
    );
    expect(res.status).toBe(200);
    expect(store.getLineage(root.id)).toBeUndefined();
    expect(store.getLineage(child.id)).toBeUndefined();
  });
});
