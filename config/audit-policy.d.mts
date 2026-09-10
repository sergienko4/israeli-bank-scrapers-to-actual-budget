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
 * A policy entry as handed to the classifier, before it has been validated.
 *
 * `classifyAdvisories` treats entries as untrusted input: a missing or
 * malformed expiry has to surface as a violation at runtime, which means a
 * test must be able to hand it an entry that omits one. Every field beyond the
 * identity pair is therefore optional here, while the data this repository
 * actually ships is held to the stricter {@link IAcceptedAdvisory} shape.
 */
export interface IRawAcceptedAdvisory {
  ghsa: string;
  package: string;
  expires?: string;
  reason?: string;
  added?: string;
  productionReachable?: boolean;
  noUpstreamFix?: boolean;
  upstream?: string;
}

/**
 * An entry in {@link ACCEPTED_ADVISORIES}.
 *
 * Shipped entries always carry an expiry and a rationale. The fields that stay
 * optional are jointly required for any package that reaches the production
 * tree; see the module doc-comment for why.
 */
export interface IAcceptedAdvisory extends IRawAcceptedAdvisory {
  expires: string;
  reason: string;
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
  entries?: readonly IRawAcceptedAdvisory[],
): IRawAcceptedAdvisory | undefined;

/** Classifies advisories into blocking violations and accepted suppressions. */
export function classifyAdvisories(
  advisories: readonly IAdvisory[],
  productionPackages: ReadonlySet<string>,
  entries?: readonly IRawAcceptedAdvisory[],
): IAdvisoryClassification;
