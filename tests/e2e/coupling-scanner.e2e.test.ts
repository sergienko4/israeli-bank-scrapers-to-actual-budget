/**
 * E2E tests for the coupling-scanner CLI shared-kernel exemption.
 *
 * Drives the real `scripts/coupling-scanner.cjs` as a child process against a
 * disposable on-disk source fixture, exercising the full report/check pipeline
 * end-to-end (walk → parse → resolve → score → baseline JSON). The scanner roots
 * itself at `process.cwd()`, so pointing a subprocess `cwd` at a temp fixture
 * verifies the kernel exemption without touching the repo's own `src/` tree or
 * committed `tests/coupling-baseline.json`.
 *
 * Companion to the unit canary `tests/coupling-scanner.test.ts` (which asserts
 * the exemption predicates in isolation); this suite proves the behaviour
 * survives through the actual CLI a maintainer/CI runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCANNER = fileURLToPath(new URL('../../scripts/coupling-scanner.cjs', import.meta.url));
const BASELINE_REL = join('tests', 'coupling-baseline.json');

interface CrossLayerDep {
  to: string;
  toLayer: string;
  dynamic: boolean;
  direction: 'inward' | 'outward';
}

interface FileRecord {
  path: string;
  layer: string;
  valueImports: number;
  crossLayerValueDeps: CrossLayerDep[];
  score: number;
}

interface Baseline {
  totalFiles: number;
  scoreDistribution: { critical8plus: number; high5to7: number; medium3to4: number; low1to2: number; clean0: number };
  wrongDirectionDeps: number;
  files: FileRecord[];
}

let root: string;

/** Writes a fixture source file (creating parent dirs) under the temp root. */
function fixtureFile(relPath: string, body: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${body}\n`);
}

/**
 * Runs the scanner as a subprocess rooted at the fixture dir.
 * A hard timeout and maxBuffer guard against a blocked scanner hanging CI;
 * `res.error` (timeout/spawn failure) is surfaced immediately rather than
 * masked by a null status.
 */
function runScanner(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [SCANNER, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Parses the baseline JSON the scanner wrote into the fixture. */
function readBaseline(): Baseline {
  return JSON.parse(readFileSync(join(root, BASELINE_REL), 'utf8')) as Baseline;
}

/** Finds the scored record for a given repo-relative source path. */
function recordFor(baseline: Baseline, relPath: string): FileRecord {
  const found = baseline.files.find((f) => f.path === relPath);
  if (!found) throw new Error(`no record for ${relPath}`);
  return found;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'coupling-scanner-e2e-'));

  // Sanctioned shared-kernel targets (value imports of these must NOT count).
  fixtureFile('src/Types/Result.ts', 'export function succeed<T>(v: T) {\n  return { ok: true as const, value: v };\n}');
  fixtureFile('src/Logger/Index.ts', 'export function getLogger() {\n  return { info: (_m: string) => undefined };\n}');
  // Genuine peer-layer target in CC (Config is deliberately NOT kernel).
  fixtureFile('src/Config/ConfigLoader.ts', 'export function loadConfig() {\n  return {};\n}');

  // Scheduler (SC) wiring that imports ONLY kernel targets → fully exempted.
  fixtureFile(
    'src/Scheduler/KernelOnlyWiring.ts',
    "import { succeed } from '../Types/Result.js';\nimport { getLogger } from '../Logger/Index.js';\n\nexport function wireKernelOnly(): void {\n  getLogger().info('wire');\n  succeed(undefined);\n}",
  );
  // Scheduler (SC) wiring that mixes a kernel import with a genuine Config peer
  // import → only the Config dep is counted (proves the filter, not "no deps").
  fixtureFile(
    'src/Scheduler/PeerCoupledWiring.ts',
    "import { succeed } from '../Types/Result.js';\nimport { loadConfig } from '../Config/ConfigLoader.js';\n\nexport function wirePeerCoupled(): void {\n  loadConfig();\n  succeed(undefined);\n}",
  );

  // A genuine wrong-direction (inner -> outer) edge: a Resilience (CC) module
  // reaching DOWN into a Scrapers (BP) domain file — the #459 smell shape.
  // BP is not kernel, so the dep is counted AND classified 'outward'.
  fixtureFile('src/Scrapers/SomeBank.ts', 'export function scrape(): unknown[] {\n  return [];\n}');
  fixtureFile(
    'src/Resilience/ReachIntoScraper.ts',
    "import { scrape } from '../Scrapers/SomeBank.js';\n\nexport function reachDown(): void {\n  scrape();\n}",
  );

  const report = runScanner();
  expect(report.status, report.stderr).toBe(0);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('coupling-scanner CLI shared-kernel exemption (E2E)', () => {
  it('report mode exempts kernel value imports from the cross-layer score', () => {
    const kernelOnly = recordFor(readBaseline(), 'src/Scheduler/KernelOnlyWiring.ts');

    expect(kernelOnly.layer).toBe('SC');
    expect(kernelOnly.valueImports).toBe(2); // it DID import two modules…
    expect(kernelOnly.crossLayerValueDeps).toHaveLength(0); // …both exempted as kernel
    expect(kernelOnly.score).toBe(0);
  });

  it('report mode still counts genuine peer-layer value imports', () => {
    const peer = recordFor(readBaseline(), 'src/Scheduler/PeerCoupledWiring.ts');

    expect(peer.layer).toBe('SC');
    expect(peer.valueImports).toBe(2); // kernel (Result) + peer (Config)
    expect(peer.crossLayerValueDeps).toHaveLength(1); // only the Config dep survives the filter
    expect(peer.crossLayerValueDeps[0]?.toLayer).toBe('CC');
    expect(peer.crossLayerValueDeps[0]?.to).toBe('src/Config/ConfigLoader.ts');
    expect(peer.crossLayerValueDeps[0]?.direction).toBe('inward'); // SC(1) -> CC(4) is allowed
    expect(peer.score).toBe(2); // 1 counted cross-layer dep × 2
  });

  it('report mode classifies an inner->outer dep as a wrong-direction smell', () => {
    const baseline = readBaseline();
    const reach = recordFor(baseline, 'src/Resilience/ReachIntoScraper.ts');

    expect(reach.layer).toBe('CC');
    expect(reach.crossLayerValueDeps).toHaveLength(1);
    expect(reach.crossLayerValueDeps[0]?.toLayer).toBe('BP');
    expect(reach.crossLayerValueDeps[0]?.direction).toBe('outward'); // CC(4) -> BP(3) inverts the rule
    expect(baseline.wrongDirectionDeps).toBe(1); // exactly this edge across the whole fixture
  });

  it('report mode keeps the fixture critical-free under the corrected metric', () => {
    expect(readBaseline().scoreDistribution.critical8plus).toBe(0);
  });

  it('check mode passes (exit 0) against the freshly generated baseline', () => {
    const check = runScanner('--check');

    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain('critical=0');
  });

  it('check mode fails (exit 1) and names a newly introduced critical file', () => {
    const regressor = 'src/Scheduler/RegressionWiring.ts';
    // Four genuine Config (CC) peer imports → score 8 → critical bucket regresses.
    fixtureFile(
      regressor,
      "import { a } from '../Config/PartA.js';\nimport { b } from '../Config/PartB.js';\nimport { c } from '../Config/PartC.js';\nimport { d } from '../Config/PartD.js';\n\nexport function wireRegression(): void {\n  a(); b(); c(); d();\n}",
    );

    try {
      const check = runScanner('--check');
      expect(check.status).toBe(1);
      expect(check.stderr).toContain('REGRESSION');
      expect(check.stderr).toContain(regressor);
    } finally {
      rmSync(join(root, regressor), { force: true });
    }
  });
});
