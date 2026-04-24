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
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Single thread: all test files share one SQLite DB via HOME, so parallel workers cause "database is locked"
    pool: 'forks',
    forkOptions: { singleFork: true },
    env: {
      HOME: testHome,
    },
    coverage: {
      provider: 'custom',
      customProviderModule: './scripts/vitest-coverage-lite.mjs',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json'],
    },
  },
});
