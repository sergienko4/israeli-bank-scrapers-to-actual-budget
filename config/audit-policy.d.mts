/**
 * Ambient type declaration for the audit policy module so TypeScript tests can
 * import it without `any` leaks. Mirrors the config/license-policy.d.mts
 * precedent.
 */

/** An advisory as flattened from `npm audit --json` by config/check-audit.mjs. */
export interface IAdvisory {
  ghsa: string;
  package: string;
  severity: string;
  title: string;
}

/**
 * An entry in {@link ACCEPTED_ADVISORIES}.
 *
 * The optional fields are jointly required for any package that reaches the
 * production tree; see the module doc-comment for why.
 */
export interface IAcceptedAdvisory {
  ghsa: string;
  package: string;
  expires: string;
  reason: string;
  added?: string;
  productionReachable?: boolean;
  noUpstreamFix?: boolean;
  upstream?: string;
}

/** An advisory annotated with the outcome of classification. */
export interface IClassifiedAdvisory extends IAdvisory {
  why?: string;
  expires?: string;
  reason?: string;
}

/** The split of advisories into blocking and accepted. */
export interface IAdvisoryClassification {
  violations: IClassifiedAdvisory[];
  accepted: IClassifiedAdvisory[];
}

/** Severity floor the gate enforces, matching `npm audit --audit-level`. */
export const AUDIT_LEVEL: string;

/** Severity ordering used to compare an advisory against AUDIT_LEVEL. */
export const SEVERITY_RANK: readonly string[];

/** Longest window a production-reachable acceptance may cover, in days. */
export const MAX_PRODUCTION_ACCEPTANCE_DAYS: number;

/** Advisories the gate does not block on. */
export const ACCEPTED_ADVISORIES: readonly IAcceptedAdvisory[];

/** Reports whether a severity meets or exceeds the enforced floor. */
export function isInScope(severity: string): boolean;

/** Finds the accepted-advisory entry covering a given advisory, if any. */
export function findAcceptedEntry(
  advisory: Pick<IAdvisory, 'ghsa' | 'package'>,
  entries?: readonly IAcceptedAdvisory[],
): IAcceptedAdvisory | undefined;

/** Classifies advisories into blocking violations and accepted suppressions. */
export function classifyAdvisories(
  advisories: readonly IAdvisory[],
  productionPackages: ReadonlySet<string>,
  entries?: readonly IAcceptedAdvisory[],
): IAdvisoryClassification;
