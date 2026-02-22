import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'fs';

// Load .env.e2e if present (Telegram bot token, chat ID, etc.)
if (existsSync('.env.e2e')) {
  for (const line of readFileSync('.env.e2e', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key && value) process.env[key] = value;
    }
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  }
});
