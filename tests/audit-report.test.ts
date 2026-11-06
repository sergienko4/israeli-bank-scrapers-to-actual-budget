/**
 * Unit tests for config/audit-report.mjs, the committed-tree audit shared by
 * the audit gate and the override-floor planner.
 *
 * The runner is injected, so no test spawns npm. The cases pin what the
 * planner depends on: every audit reads the lockfile only, the vulnerable
 * range survives flattening, and an npm error object is never mistaken for a
 * clean report.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auditCommittedTree, collectAdvisories, readLockPackages, runAudit } from '../config/audit-report.mjs';
import type { IAuditReport, NpmExec } from '../config/audit-report.mjs';

const RE2JS_URL = 'https://github.com/advisories/GHSA-gg6h-894w-4m9c';

/** One finding as npm reports it inside a vulnerability's `via` list. */
const RE2JS_VIA = {
  name: 're2js',
  url: RE2JS_URL,
  severity: 'high',
  title: 'Quadratic-time denial of service',
  range: '>=2.2.0 <2.8.7',
};

/**
 * Builds an audit report holding the given vulnerabilities.
 *
 * @param vulnerabilities The `vulnerabilities` map npm would print.
 * @returns The report serialised the way npm writes it to stdout.
 */
function reportJson(vulnerabilities: IAuditReport['vulnerabilities']): string {
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities });
}

/**
 * Builds a runner that records every argument list and answers with a report.
 *
 * @param answer Maps the npm arguments to the stdout to return.
 * @returns The runner and the argument lists it saw.
 */
function recordingExec(answer: (args: string[]) => string): { exec: NpmExec; calls: string[][] } {
  const calls: string[][] = [];
  /**
   * Records the call and answers it.
   *
   * @param _command The command, ignored.
   * @param args The arguments npm would receive.
   * @returns The canned stdout.
   */
  const exec: NpmExec = (_command, args) => {
    calls.push(args);
    return answer(args);
  };
  return { exec, calls };
}

describe('collectAdvisories', () => {
  it('keeps the vulnerable range and records null when npm omits it', () => {
    const report = {
      vulnerabilities: {
        re2js: { via: [RE2JS_VIA] },
        markdownlint: { via: ['re2js', { name: 'other', url: 'https://x/GHSA-aaaa-bbbb-cccc' }] },
      },
    };

    expect(collectAdvisories(report)).toEqual([
      { ghsa: 'GHSA-gg6h-894w-4m9c', package: 're2js', severity: 'high', title: RE2JS_VIA.title, range: RE2JS_VIA.range },
      { ghsa: 'GHSA-aaaa-bbbb-cccc', package: 'other', severity: 'unknown', title: 'no title reported', range: null },
    ]);
  });
});

describe('runAudit', () => {
  it('always audits the lockfile rather than node_modules', () => {
    const { exec, calls } = recordingExec(() => reportJson({}));

    runAudit(['--omit=dev'], exec);

    expect(calls).toHaveLength(1);
    expect(calls[0].slice(-4)).toEqual(['audit', '--json', '--package-lock-only', '--omit=dev']);
  });

  it('reads the report from a non-zero exit, which npm uses for findings', () => {
    const exec: NpmExec = () => {
      throw Object.assign(new Error('exit 1'), { stdout: reportJson({ re2js: { via: [RE2JS_VIA] } }) });
    };

    expect(Object.keys(runAudit([], exec).vulnerabilities)).toEqual(['re2js']);
  });

  it('rethrows the process error when npm printed an error object instead of a report', () => {
    const failure = Object.assign(new Error('ENOLOCK'), { stdout: JSON.stringify({ error: { code: 'ENOLOCK' } }) });
    const exec: NpmExec = () => {
      throw failure;
    };

    expect(() => runAudit([], exec)).toThrow(failure);
  });

  it('refuses an error object even beside an empty vulnerabilities map', () => {
    const { exec } = recordingExec(() => JSON.stringify({ error: { code: 'EAUDITNOLOCK' }, vulnerabilities: {} }));

    expect(() => runAudit([], exec)).toThrow('npm audit did not return a vulnerability report');
  });
});

describe('auditCommittedTree', () => {
  it('derives production packages from the --omit=dev audit only', () => {
    const { exec, calls } = recordingExec(args =>
      args.includes('--omit=dev')
        ? reportJson({ sax: { via: [{ name: 'sax', url: 'https://x/GHSA-prod-0000-0000' }] } })
        : reportJson({ re2js: { via: [RE2JS_VIA] }, sax: { via: [{ name: 'sax', url: 'https://x/GHSA-prod-0000-0000' }] } }),
    );

    const audit = auditCommittedTree(exec);

    expect(calls).toHaveLength(2);
    expect(audit.advisories.map(advisory => advisory.package)).toEqual(['re2js', 'sax']);
    expect([...audit.productionPackages]).toEqual(['sax']);
  });
});

describe('readLockPackages', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'read-lock-packages-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Writes the test directory's package-lock.json verbatim.
   *
   * @param text The file content.
   */
  function writeLock(text: string): void {
    writeFileSync(join(dir, 'package-lock.json'), text);
  }

  it('returns the packages map of a well-formed lockfile', () => {
    const packages = {
      '': { version: '1.0.0', dependencies: { holder: '^1.0.0' } },
      'node_modules/holder': { version: '1.0.0', dependencies: { 'demo-pkg': '^1.0.0' } },
    };
    writeLock(JSON.stringify({ lockfileVersion: 3, packages }));

    expect(readLockPackages(dir)).toEqual(packages);
  });

  it('returns an empty map when the lockfile is missing', () => {
    expect(readLockPackages(dir)).toEqual({});
  });

  // An empty map has no blockers, so an expired auto-extending acceptance
  // expires instead of extending on a lockfile that could not be read.
  it.each([
    ['the file is not JSON', '{ "packages": '],
    ['the packages key is missing', JSON.stringify({ lockfileVersion: 3 })],
    ['packages is null', JSON.stringify({ packages: null })],
    ['packages is an array', JSON.stringify({ packages: [{ version: '1.0.0' }] })],
    ['packages is a string', JSON.stringify({ packages: 'node_modules/holder' })],
    ['the document is null', 'null'],
  ])('returns an empty map when %s', (_case, text) => {
    writeLock(text);

    expect(readLockPackages(dir)).toEqual({});
  });

  it('reads the lockfile in the working directory by default', () => {
    const packages = { 'node_modules/holder': { version: '1.0.0' } };
    writeLock(JSON.stringify({ packages }));
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    expect(readLockPackages()).toEqual(packages);
  });
});
