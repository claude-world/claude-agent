import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Use isolated temp directory for test database
const testHome = path.join(os.tmpdir(), 'claude-agent-test-' + process.pid);
fs.mkdirSync(path.join(testHome, '.claude-agent', 'data'), { recursive: true });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'release'],
    testTimeout: 10000,
    // Single thread: all test files share one SQLite DB via HOME, so parallel workers cause "database is locked"
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      HOME: testHome,
    },
  },
});
