/**
 * Runs scripts/check-pii.sh — the commit-stage and CI PII gate — against
 * throwaway source trees. Each pattern family must block, the filters that
 * keep it quiet on harmless lines must hold, and a missing root must fail
 * rather than pass on an empty scan.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/check-pii.sh');

/**
 * Builds a template-literal placeholder without writing one in a plain string.
 * @param expr - Expression inside the placeholder.
 * @returns The text `${expr}`.
 */
const slot = (expr: string): string => `\${${expr}}`;

/** Outcome of one scanner run. */
interface IScanResult {
  readonly status: number | null;
  readonly output: string;
}

let fixtureRoot = '';

/**
 * Writes one file under the fixture root, creating parent folders.
 * @param relPath - Path relative to the fixture root.
 * @param content - File content.
 */
function writeSource(relPath: string, content: string): void {
  const filePath = join(fixtureRoot, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${content}\n`);
}

/**
 * Runs the scanner the way the hook and CI do.
 * @param args - Arguments passed to the script.
 * @param cwd - Working directory for the run.
 * @returns Exit status and combined output.
 */
function scan(args: readonly string[], cwd: string = ROOT): IScanResult {
  const run = spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'pii-scan-'));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('check-pii.sh', () => {
  it('passes a tree with no PII interpolation', () => {
    writeSource('Clean.ts', 'throw new Error("password is missing");');
    const result = scan([fixtureRoot]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('No PII detected');
  });

  it.each(['password', 'token', 'otp', 'secret', 'digits', 'creditCard'])(
    'blocks %s interpolated into a thrown error',
    (field) => {
      writeSource('Auth/Login.ts', `throw new Error(\`login failed ${slot(field)}\`);`);
      const result = scan([fixtureRoot]);
      expect(result.status).toBe(1);
      expect(result.output).toContain('Auth/Login.ts:1:');
    },
  );

  it('ignores a credential interpolated outside an error or fail line', () => {
    writeSource('Auth/Header.ts', `const header = \`Bearer ${slot('token')}\`;`);
    expect(scan([fixtureRoot]).status).toBe(0);
  });

  it('blocks a proxy value interpolated into a log line', () => {
    writeSource('Net/Proxy.ts', `logger.warn(\`using ${slot('proxyUrl')}\`);`);
    const result = scan([fixtureRoot]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Net/Proxy.ts:1:');
  });

  it.each(['txn.merchant', 'txn.amount', 'txn.payee', 'customerName', 'payeeName'])(
    'blocks %s interpolated into an info log',
    (expr) => {
      writeSource('Import/Report.ts', `getLogger().info(\`imported ${slot(expr)}\`);`);
      const result = scan([fixtureRoot]);
      expect(result.status).toBe(1);
      expect(result.output).toContain('Import/Report.ts:1:');
    },
  );

  it('scans only TypeScript files', () => {
    writeSource('Portal/app.js', `throw new Error(\`bad ${slot('password')}\`);`);
    expect(scan([fixtureRoot]).status).toBe(0);
  });

  it('fails when the scan root does not exist', () => {
    const result = scan([join(fixtureRoot, 'missing')]);
    expect(result.status).toBe(2);
    expect(result.output).toContain('PII scan root not found');
  });

  it('defaults to src/ relative to the working directory', () => {
    writeSource('src/Leak.ts', `throw new Error(\`bad ${slot('otp')}\`);`);
    const result = scan([], fixtureRoot);
    expect(result.status).toBe(1);
    expect(result.output).toContain('src/Leak.ts:1:');
  });

  it('leaves files outside src/ alone by default', () => {
    writeSource('src/Clean.ts', 'export const ok = true;');
    writeSource('scripts/Tool.ts', `throw new Error(\`bad ${slot('otp')}\`);`);
    expect(scan([], fixtureRoot).status).toBe(0);
  });
});
