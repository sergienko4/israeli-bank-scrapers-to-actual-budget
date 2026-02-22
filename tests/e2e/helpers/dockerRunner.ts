/**
 * Shared helper to run the importer Docker container and capture output.
 * Used by E2E tests that need to verify Docker exit codes and log output.
 */

import { execFileSync, execFile } from 'child_process';
import { existsSync, readdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const DOCKER_IMAGE = 'israeli-bank-importer:e2e';

export interface DockerRunResult {
  exitCode: number;
  output: string;
}

export interface DockerRunOptions {
  configPath: string;
  budgetId?: string;
  mockScraperDir?: string;
  mockScraperFile?: string;
  env?: Record<string, string>;
  volumes?: string[];
  networkHost?: boolean;
}

export function runImporterDocker(options: DockerRunOptions): DockerRunResult {
  const args = ['run', '--rm', ...buildArgs(options), DOCKER_IMAGE, 'node', 'dist/index.js'];

  try {
    const output = execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000, stdio: 'pipe' });
    return { exitCode: 0, output };
  } catch (error: unknown) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.status ?? 1,
      output: (err.stdout ?? '') + (err.stderr ?? ''),
    };
  }
}

/** Async version — doesn't block event loop (needed for webhook tests). */
export function runImporterDockerAsync(options: DockerRunOptions): Promise<DockerRunResult> {
  const args = ['run', '--rm', ...buildArgs(options), DOCKER_IMAGE, 'node', 'dist/index.js'];
  return new Promise((resolve) => {
    execFile('docker', args, { encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as { code?: number }).code;
        resolve({ exitCode: code ?? 1, output: (stdout ?? '') + (stderr ?? '') });
      } else {
        resolve({ exitCode: 0, output: stdout });
      }
    });
  });
}

function buildArgs(options: DockerRunOptions): string[] {
  const args: string[] = [];

  if (options.networkHost) args.push('--network', 'host');

  args.push('-v', `${options.configPath}:/app/config.json:ro`);
  if (options.mockScraperDir) args.push('-v', `${options.mockScraperDir}:/app/mock-scraper-dir:ro`);
  if (options.mockScraperFile) args.push('-v', `${options.mockScraperFile}:/app/mock-scraper.json:ro`);
  if (options.budgetId) args.push('-v', `${join(FIXTURES_DIR, 'e2e-data')}:/app/data`);
  for (const vol of options.volumes ?? []) args.push('-v', vol);

  if (options.mockScraperDir) args.push('-e', 'E2E_MOCK_SCRAPER_DIR=/app/mock-scraper-dir');
  if (options.mockScraperFile) args.push('-e', 'E2E_MOCK_SCRAPER_FILE=/app/mock-scraper.json');
  if (options.budgetId) args.push('-e', `E2E_LOCAL_BUDGET_ID=${options.budgetId}`);
  for (const [key, value] of Object.entries(options.env ?? {})) args.push('-e', `${key}=${value}`);

  return args;
}

export function getFixturesDir(): string {
  return FIXTURES_DIR;
}

export function hasDockerImage(): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', DOCKER_IMAGE], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

export function findBudgetId(): string | null {
  const dataDir = join(FIXTURES_DIR, 'e2e-data');
  if (!existsSync(dataDir)) return null;
  return readdirSync(dataDir).find(e => e.startsWith('e2e-test-budget-')) ?? null;
}

export function writeTempConfig(name: string, config: object): string {
  const path = join(FIXTURES_DIR, `config-${name}.json`);
  writeFileSync(path, JSON.stringify(config, null, 2));
  return path;
}

export function createTempFileTracker() {
  const paths: string[] = [];
  return {
    track(path: string): void { paths.push(path); },
    cleanup(): void {
      for (const p of paths) { if (existsSync(p)) unlinkSync(p); }
      paths.length = 0;
    },
  };
}
