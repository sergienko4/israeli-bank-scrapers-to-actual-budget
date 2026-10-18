/**
 * Runs the Trivy composite's gates as written.
 *
 * One scan writes a JSON report; the SARIF upload and both gates read it.
 * The behavioural cases lift each gate's `run:` script and run it the way
 * Actions runs a bash step, against a report written in the scratch folder
 * and with `trivy` replaced by a fake that logs its calls. The structural
 * cases pin what the scripts cannot see: one scan, and gates that still run
 * after an earlier step failed.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const COMPOSITE = '.github/actions/security/trivy-scan/action.yml';
const REPORT = 'trivy-results.json';
const UNREADABLE = '::error::Trivy report unreadable';
const MATCHED_TEXT = 'MATCHED-TEXT-MUST-NOT-BE-LOGGED';

/** Both gates need bash and jq; CI must have them, a laptop may lack them. */
const CAN_RUN =
  (spawnSync('bash', ['--version']).status === 0 && spawnSync('jq', ['--version']).status === 0) ||
  process.env.CI === 'true';

const FAKE_TRIVY = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DIR}/trivy-calls.log"
echo "FAKE TRIVY TABLE"
`;

/** Fields of a composite step this suite reads. */
interface IStep {
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, string | boolean>>;
}

/** Fields of the composite action this suite reads. */
interface IComposite {
  readonly runs: { readonly steps: readonly IStep[] };
}

/** What a gate run left behind. */
interface IGateRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly trivyCalls: readonly string[];
}

/** One finding of a report, as Trivy writes it. */
type Finding = Readonly<Record<string, string | number>>;

let bin = '';
let work = '';

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'trivy-gates-bin-'));
  writeFileSync(join(bin, 'trivy'), FAKE_TRIVY);
  chmodSync(join(bin, 'trivy'), 0o755);
});

afterAll(() => {
  rmSync(bin, { recursive: true, force: true });
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'trivy-gates-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Reads the composite's steps.
 * @returns The steps in order.
 */
function steps(): readonly IStep[] {
  const composite = parse(readFileSync(join(ROOT, COMPOSITE), 'utf8')) as IComposite;
  return composite.runs.steps;
}

/**
 * Finds a step by its id; a missing id fails the calling test.
 * @param stepId - Step id.
 * @returns The step.
 */
function step(stepId: string): IStep {
  const found = steps().find((candidate) => candidate.id === stepId);
  if (found === undefined) throw new Error(`${COMPOSITE} has no step with id ${stepId}`);
  return found;
}

/**
 * Builds a vulnerability finding.
 * @param severity - Trivy severity.
 * @returns The finding.
 */
function vuln(severity: string): Finding {
  return {
    VulnerabilityID: `CVE-2026-${severity}`,
    PkgName: 'zlib1g',
    InstalledVersion: '1:1.2.13',
    FixedVersion: '1:1.3.1',
    Severity: severity,
  };
}

/**
 * Builds a secret finding.
 * @param severity - Trivy severity.
 * @returns The finding.
 */
function secret(severity: string): Finding {
  return {
    RuleID: 'jwt-token',
    Category: 'JWT',
    Severity: severity,
    Title: 'JWT token',
    StartLine: 3,
    EndLine: 3,
    Match: MATCHED_TEXT,
  };
}

/**
 * Builds a report with one OS target and one file target.
 * @param vulns - Vulnerabilities of the OS target.
 * @param secrets - Secrets of the file target.
 * @returns The report object.
 */
function report(vulns: readonly Finding[], secrets: readonly Finding[] = []): object {
  return {
    SchemaVersion: 2,
    ArtifactName: 'israeli-bank-importer:e2e',
    Results: [
      { Target: 'israeli-bank-importer:e2e (debian 13.4)', Class: 'os-pkgs', Vulnerabilities: vulns },
      { Target: 'app/dist/settings.js', Class: 'secret', Secrets: secrets },
    ],
  };
}

/**
 * Runs a gate's script the way Actions runs a bash step.
 * @param stepId - The gate's step id.
 * @param contents - Report file contents; no file when omitted.
 * @returns Exit status, output and the fake trivy calls.
 */
function runGate(stepId: string, contents?: string): IGateRun {
  if (contents !== undefined) writeFileSync(join(work, REPORT), contents);
  const script = step(stepId).run ?? 'exit 99';
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_DIR: work },
    timeout: 20_000,
  });
  const callLog = join(work, 'trivy-calls.log');
  return {
    status: result.status,
    stdout: result.stdout,
    trivyCalls: existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n') : [],
  };
}

/**
 * Runs both gates against one report.
 * @param contents - Report file contents; no file when omitted.
 * @returns The vulnerability and secret gate runs.
 */
function runGates(contents?: string): { vulns: IGateRun; secrets: IGateRun } {
  return { vulns: runGate('vulns', contents), secrets: runGate('secrets', contents) };
}

describe.skipIf(!CAN_RUN)('Trivy gates decide on the one report', () => {
  const EXIT = { pass: 0, fail: 1 } as const;
  type Verdict = keyof typeof EXIT;
  const decisions: readonly (readonly [string, string, Verdict, Verdict])[] = [
    ['no findings', JSON.stringify(report([])), 'pass', 'pass'],
    ['one HIGH vulnerability with a fix', JSON.stringify(report([vuln('HIGH')])), 'fail', 'pass'],
    ['one CRITICAL vulnerability', JSON.stringify(report([vuln('CRITICAL')])), 'fail', 'pass'],
    ['only MEDIUM and LOW vulnerabilities', JSON.stringify(report([vuln('MEDIUM'), vuln('LOW')])), 'pass', 'pass'],
    ['one MEDIUM secret', JSON.stringify(report([], [secret('MEDIUM')])), 'pass', 'fail'],
    ['a HIGH vulnerability and a LOW secret', JSON.stringify(report([vuln('HIGH')], [secret('LOW')])), 'fail', 'fail'],
    ['no Results key', JSON.stringify({ SchemaVersion: 2 }), 'pass', 'pass'],
    ['null Results', JSON.stringify({ SchemaVersion: 2, Results: null }), 'pass', 'pass'],
  ];

  it.each(decisions)('%s: vulnerability gate %s, secret gate %s', (_name, contents, vulnVerdict, secretVerdict) => {
    const runs = runGates(contents);
    expect(runs.vulns.status).toBe(EXIT[vulnVerdict]);
    expect(runs.secrets.status).toBe(EXIT[secretVerdict]);
  });

  const unreadable: readonly (readonly [string, string | undefined])[] = [
    ['a missing file', undefined],
    ['an empty file', ''],
    ['invalid JSON', '{"Results": ['],
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
  ];

  it.each(unreadable)('fails both gates on %s', (_name, contents) => {
    const runs = runGates(contents);
    expect(runs.vulns.status).toBe(EXIT.fail);
    expect(runs.vulns.stdout).toContain(UNREADABLE);
    expect(runs.secrets.status).toBe(EXIT.fail);
    expect(runs.secrets.stdout).toContain(UNREADABLE);
  });

  it('prints the CRITICAL/HIGH table only when the vulnerability gate fails', () => {
    expect(runGate('vulns', JSON.stringify(report([vuln('MEDIUM')]))).trivyCalls).toEqual([]);

    const failed = runGate('vulns', JSON.stringify(report([vuln('CRITICAL'), vuln('HIGH'), vuln('LOW')])));
    expect(failed.trivyCalls).toEqual([`convert --format table --severity CRITICAL,HIGH ${REPORT}`]);
    expect(failed.stdout).toContain('::error::2 fixable CRITICAL or HIGH vulnerabilities');
  });

  it('names each secret by rule, file and line without its matched text', () => {
    const failed = runGate('secrets', JSON.stringify(report([], [secret('MEDIUM'), secret('LOW')])));
    expect(failed.stdout).toContain('secret: jwt-token (MEDIUM) in "app/dist/settings.js" line 3');
    expect(failed.stdout).toContain('::error::2 secret(s) detected');
    expect(failed.stdout).not.toContain(MATCHED_TEXT);
  });

  it('keeps a crafted image path from starting a workflow command', () => {
    const crafted = { Results: [{ Target: 'x\n::error::forged', Class: 'secret', Secrets: [secret('LOW')] }] };
    const failed = runGate('secrets', JSON.stringify(crafted));
    const lines = failed.stdout.split('\n');
    expect(lines.filter((line) => line.startsWith('::'))).toEqual(['::error::1 secret(s) detected (listed above).']);
  });
});

describe('Trivy composite scans once', () => {
  it('runs one trivy-action scan that keeps every severity for SARIF', () => {
    const scans = steps().filter((candidate) => candidate.uses?.startsWith('aquasecurity/trivy-action@'));
    expect(scans.map((candidate) => candidate.id)).toEqual(['scan']);
    expect(step('scan').with).toMatchObject({
      format: 'json',
      output: REPORT,
      'exit-code': '0',
      severity: 'CRITICAL,HIGH,MEDIUM,LOW,UNKNOWN',
      scanners: 'vuln,secret',
    });
  });

  it('feeds the secret allow-rules through TRIVY_SECRET_CONFIG', () => {
    expect(step('scan').env).toEqual({ TRIVY_SECRET_CONFIG: 'config/trivy/secret.yaml' });
    expect(step('scan').with).not.toHaveProperty('trivy-config');
  });

  it('uploads SARIF and checks secrets even after an earlier step failed', () => {
    expect(['sarif', 'upload', 'secrets'].map((id) => step(id).if)).toEqual(['always()', 'always()', 'always()']);
    expect(step('sarif').run).toContain(`trivy convert --format sarif --output trivy-results.sarif ${REPORT}`);
    expect(step('upload').with).toEqual({ sarif_file: 'trivy-results.sarif' });
  });
});
