/**
 * Ambient type declaration for the audit report module so TypeScript tests can
 * import it without `any` leaks. Mirrors the config/audit-policy.d.mts
 * precedent.
 */

import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';

import type { IAdvisory } from './audit-policy.mjs';

/** An advisory flattened from `npm audit --json`, with its vulnerable range. */
export interface IAuditAdvisory extends IAdvisory {
  /** The vulnerable range npm reports, or null when it omits one. */
  range: string | null;
}

/** The two views of one committed-tree audit. */
export interface ICommittedTreeAudit {
  advisories: IAuditAdvisory[];
  productionPackages: Set<string>;
}

/** Synchronous process runner with `execFileSync`'s string-encoding contract. */
export type NpmExec = (command: string, args: string[], options: ExecFileSyncOptionsWithStringEncoding) => string;

/** A parsed `npm audit --json` report; only the fields this module reads. */
export interface IAuditReport {
  vulnerabilities: Record<string, { via?: Array<string | Record<string, string | undefined>> }>;
}

/** Resolves how to invoke the npm CLI without going through a shell. */
export function npmInvocation(args: string[], env?: NodeJS.ProcessEnv): { command: string; args: string[] };

/** Parses an npm audit report and rejects anything that is not one. */
export function parseAuditReport(stdout: string, cause?: Error): IAuditReport;

/** Runs `npm audit --json --package-lock-only` and returns the parsed report. */
export function runAudit(extraArgs: string[], exec?: NpmExec): IAuditReport;

/** Extracts the GitHub advisory identifier from an advisory URL. */
export function toGhsaId(url: string | undefined): string;

/** Flattens an npm audit report into one record per distinct advisory. */
export function collectAdvisories(report: IAuditReport): IAuditAdvisory[];

/** Audits the committed tree, including the production-only view. */
export function auditCommittedTree(exec?: NpmExec): ICommittedTreeAudit;
