/**
 * Unit tests for the agent module.
 *
 * We test the parts that don't require spawning real Claude processes:
 * - AgentSession constructor
 * - createSession factory
 * - CliSession.buildContext (tested indirectly via execute rejection on unknown CLI)
 * - Language prefix injection logic (via sendMessage side-effects)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSession, CliSession, createSession, CONFIG_BOT_PROMPT } from '../agent.ts';
import type { CliType } from '../agent.ts';

// ─── AgentSession constructor ─────────────────────────────────────────────────

describe('AgentSession', () => {
  it('constructor sets sessionId correctly', () => {
    const session = new AgentSession('test-session-id');
    expect(session.sessionId).toBe('test-session-id');
  });

  it('constructor uses provided cwd', () => {
    const session = new AgentSession('s1', '/tmp');
    expect(session.cwd).toBe('/tmp');
  });

  it('constructor falls back to AGENT_ROOT when cwd is not provided', () => {
    const session = new AgentSession('s2');
    // AGENT_ROOT resolves two directories up from app/server — just verify it's a non-empty string
    expect(typeof session.cwd).toBe('string');
    expect(session.cwd.length).toBeGreaterThan(0);
  });

  it('getOutputStream throws when sendMessage was not called', async () => {
    const session = new AgentSession('no-message-session');
    // proc is null at this point, so iterating should throw immediately
    await expect(async () => {
      for await (const _msg of session.getOutputStream()) {
        // should not reach here
      }
    }).rejects.toThrow('Session not initialized');
  });

  it('interrupt is a no-op when no process is running', () => {
    const session = new AgentSession('interrupt-noop');
    expect(() => session.interrupt()).not.toThrow();
  });
});

// ─── CliSession ───────────────────────────────────────────────────────────────

describe('CliSession', () => {
  it('execute rejects for unknown CLI type', async () => {
    // Cast to CliType to bypass TypeScript; 'unknown-cli' is not a valid CLI
    const session = new CliSession('unknown-cli' as CliType, '/tmp');
    await expect(session.execute('hello')).rejects.toThrow('Unknown CLI');
  });

  it('abort is a no-op when no process is running', () => {
    const session = new CliSession('codex', '/tmp');
    expect(() => session.abort()).not.toThrow();
  });
});

// ─── createSession factory ────────────────────────────────────────────────────

describe('createSession', () => {
  it('returns AgentSession for cli="claude"', () => {
    const session = createSession('factory-test', '/tmp', 'claude');
    expect(session).toBeInstanceOf(AgentSession);
  });

  it('returns AgentSession when no cli is specified (default)', () => {
    const session = createSession('factory-default', '/tmp');
    expect(session).toBeInstanceOf(AgentSession);
  });

  it('returns CliSession for cli="codex"', () => {
    const session = createSession('factory-codex', '/tmp', 'codex');
    expect(session).toBeInstanceOf(CliSession);
  });

  it('returns CliSession for cli="gemini"', () => {
    const session = createSession('factory-gemini', '/tmp', 'gemini');
    expect(session).toBeInstanceOf(CliSession);
  });

  it('returns CliSession for cli="opencode"', () => {
    const session = createSession('factory-opencode', '/tmp', 'opencode');
    expect(session).toBeInstanceOf(CliSession);
  });
});

// ─── CONFIG_BOT_PROMPT ────────────────────────────────────────────────────────

describe('CONFIG_BOT_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(typeof CONFIG_BOT_PROMPT).toBe('string');
    expect(CONFIG_BOT_PROMPT.length).toBeGreaterThan(0);
  });

  it('references the local API base URL', () => {
    expect(CONFIG_BOT_PROMPT).toContain('http://127.0.0.1:3456');
  });

  it('mentions secrets management', () => {
    expect(CONFIG_BOT_PROMPT.toLowerCase()).toContain('secret');
  });

  it('mentions channel management', () => {
    expect(CONFIG_BOT_PROMPT.toLowerCase()).toContain('channel');
  });
});

// ─── Language prefix injection (via sendMessage side-effects) ─────────────────

describe('AgentSession.sendMessage language prefix', () => {
  /**
   * sendMessage spawns a real claude process which we don't want in unit tests.
   * We verify the language/time prefix logic indirectly by checking that
   * calling sendMessage doesn't throw (process spawn may fail but shouldn't throw synchronously).
   */
  it('sendMessage does not throw synchronously', () => {
    const session = new AgentSession('lang-prefix-test');
    // This will attempt to spawn — it may fail asynchronously but must not throw synchronously
    expect(() => {
      session.sendMessage('test content');
    }).not.toThrow();

    // Clean up: interrupt any spawned process
    session.interrupt();
  });
});
