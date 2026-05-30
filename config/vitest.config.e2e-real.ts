/**
 * Vitest config for the opt-in real-bank E2E suite.
 *
 * This project runs the REAL upstream scraper against LIVE bank APIs
 * using credentials from .env.e2e (preferred) or .env (fallback for
 * backward compat with the user's existing local setup). It is OPT-IN:
 *  - Gate variable: RUN_REAL_BANK_TESTS=true
 *  - Suite skips cleanly when the gate is off or per-bank creds are absent
 *  - NEVER runs in CI (no GitHub Actions workflow references this config)
 *
 * Long testTimeout (10 min) accommodates SMS OTP roundtrips that require
 * a human-in-the-loop. Serial execution avoids contention on the shared
 * Camoufox browser process pool.
 */

import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'fs';

/**
 * Loads env vars from a dotenv-style file without overriding existing keys.
 * @param path - Filesystem path to the env file (e.g. '.env.e2e' or '.env').
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnvFile('.env.e2e');
loadEnvFile('.env');

export default defineConfig({
  test: {
    root: process.cwd(),
    globals: true,
    environment: 'node',
    include: ['tests/e2e-real/**/*.real.e2e.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
    fileParallelism: false,
    reporters: ['verbose'],
    coverage: { enabled: false },
  },
});
