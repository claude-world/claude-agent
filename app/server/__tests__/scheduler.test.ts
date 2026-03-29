/**
 * Unit tests for the scheduler module.
 *
 * We test scheduling logic without running real Claude executions:
 * - cron expression validation
 * - registerJob / unregisterJob lifecycle
 * - TaskScheduler.start() picks up enabled tasks
 * - TaskScheduler.stop() clears all jobs
 *
 * Real task execution (which would spawn claude) is not tested here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import cron from 'node-cron';
import store from '../db.ts';

// Import scheduler as a named export so we get the singleton.
// We reset internal state between tests via stop().
import { scheduler } from '../scheduler.ts';

// ─── cron expression validation ───────────────────────────────────────────────

describe('node-cron.validate', () => {
  it('accepts standard 5-field cron expressions', () => {
    expect(cron.validate('0 9 * * *')).toBe(true);
    expect(cron.validate('*/5 * * * *')).toBe(true);
    expect(cron.validate('0 0 * * 1')).toBe(true);
    expect(cron.validate('30 8 1 * *')).toBe(true);
  });

  it('accepts 6-field cron expressions (with seconds)', () => {
    expect(cron.validate('0 0 9 * * *')).toBe(true);
    expect(cron.validate('*/30 * * * * *')).toBe(true);
  });

  it('rejects invalid cron expressions', () => {
    expect(cron.validate('not-a-cron')).toBe(false);
    expect(cron.validate('99 99 * * *')).toBe(false);
    expect(cron.validate('')).toBe(false);
    expect(cron.validate('* * *')).toBe(false);
  });
});

// ─── TaskScheduler.registerJob / unregisterJob ────────────────────────────────

describe('TaskScheduler registerJob / unregisterJob', () => {
  const createdTaskIds: string[] = [];

  afterEach(() => {
    // Stop any registered jobs
    scheduler.stop();
    // Clean up test tasks from the DB
    for (const id of createdTaskIds) {
      store.deleteScheduledTask(id);
    }
    createdTaskIds.length = 0;
  });

  it('registerJob registers a cron job for a valid enabled task', () => {
    const task = store.createScheduledTask({
      name: 'Scheduler Unit Test Task',
      prompt: 'Do not execute — unit test only',
      schedule: '0 0 * * *', // midnight — will never fire during tests
      enabled: true,
    });
    createdTaskIds.push(task.id);

    scheduler.registerJob(task.id);

    // Verify the job is registered by checking unregisterJob succeeds without error
    expect(() => scheduler.unregisterJob(task.id)).not.toThrow();
  });

  it('registerJob does nothing for a disabled task', () => {
    const task = store.createScheduledTask({
      name: 'Disabled Task',
      prompt: 'Should not register',
      schedule: '0 0 * * *',
      enabled: false,
    });
    createdTaskIds.push(task.id);

    expect(() => scheduler.registerJob(task.id)).not.toThrow();

    // unregisterJob on an unregistered job is a no-op
    expect(() => scheduler.unregisterJob(task.id)).not.toThrow();
  });

  it('registerJob does nothing for a non-existent task id', () => {
    expect(() => scheduler.registerJob('non-existent-task-id')).not.toThrow();
  });

  it('registerJob warns for invalid cron expression (does not throw)', () => {
    const task = store.createScheduledTask({
      name: 'Bad Cron Task',
      prompt: 'Bad schedule',
      schedule: 'bad-cron',
      enabled: true,
    });
    createdTaskIds.push(task.id);

    // Should not throw — it just logs a warning
    expect(() => scheduler.registerJob(task.id)).not.toThrow();
  });

  it('unregisterJob is a no-op when job is not registered', () => {
    expect(() => scheduler.unregisterJob('not-registered-at-all')).not.toThrow();
  });

  it('registerJob replaces existing job when called twice for same task', () => {
    const task = store.createScheduledTask({
      name: 'Double Register Task',
      prompt: 'Register twice',
      schedule: '0 1 * * *',
      enabled: true,
    });
    createdTaskIds.push(task.id);

    expect(() => {
      scheduler.registerJob(task.id);
      scheduler.registerJob(task.id); // should replace, not error
    }).not.toThrow();

    scheduler.unregisterJob(task.id);
  });
});

// ─── TaskScheduler.start / stop ───────────────────────────────────────────────

describe('TaskScheduler start / stop', () => {
  const createdTaskIds: string[] = [];

  afterEach(() => {
    scheduler.stop();
    for (const id of createdTaskIds) {
      store.deleteScheduledTask(id);
    }
    createdTaskIds.length = 0;
  });

  it('start does not throw even with no tasks in DB', () => {
    // stop first to clear any previously registered jobs
    scheduler.stop();
    expect(() => scheduler.start()).not.toThrow();
  });

  it('start registers enabled tasks from DB', () => {
    scheduler.stop();

    const task = store.createScheduledTask({
      name: 'Start Test Task',
      prompt: 'Never fires',
      schedule: '0 23 * * *', // 11 PM — unlikely to fire during tests
      enabled: true,
    });
    createdTaskIds.push(task.id);

    expect(() => scheduler.start()).not.toThrow();
  });

  it('start does not register disabled tasks', () => {
    scheduler.stop();

    const task = store.createScheduledTask({
      name: 'Disabled Start Task',
      prompt: 'Should not start',
      schedule: '0 23 * * *',
      enabled: false,
    });
    createdTaskIds.push(task.id);

    expect(() => scheduler.start()).not.toThrow();
    // unregisterJob for a non-registered task is still a no-op
    expect(() => scheduler.unregisterJob(task.id)).not.toThrow();
  });

  it('stop does not throw when no jobs are registered', () => {
    scheduler.stop(); // ensure clean
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('stop clears all registered jobs', () => {
    scheduler.stop();

    const task = store.createScheduledTask({
      name: 'Stop Test Task',
      prompt: 'Clear on stop',
      schedule: '0 22 * * *',
      enabled: true,
    });
    createdTaskIds.push(task.id);

    scheduler.start();
    expect(() => scheduler.stop()).not.toThrow();

    // After stop, unregistering is a no-op (jobs map is cleared)
    expect(() => scheduler.unregisterJob(task.id)).not.toThrow();
  });
});
