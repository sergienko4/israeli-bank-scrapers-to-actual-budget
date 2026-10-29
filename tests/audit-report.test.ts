/**
 * Unit tests for config/audit-report.mjs, the committed-tree audit shared by
 * the audit gate and the override-floor planner.
 *
 * The runner is injected, so no test spawns npm. The cases pin what the
 * planner depends on: every audit reads the lockfile only, the vulnerable
 * range survives flattening, and an npm error object is never mistaken for a
 * clean report.
 */

import { describe, expect, it } from 'vitest';

import { auditCommittedTree, collectAdvisories, runAudit } from '../config/audit-report.mjs';
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
