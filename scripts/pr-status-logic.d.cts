/**
 * Type declarations for the pure verdict predicates exported by
 * scripts/pr-status-logic.cjs. These exist solely so
 * tests/pr-status-logic.test.ts can lock the CI + CodeRabbit status contract
 * without enabling project-wide allowJs. Keep this surface minimal — add an
 * entry only when a function is both exported from the .cjs AND consumed by a
 * test. Mirrors scripts/coupling-scanner.d.cts.
 */

/** A statusCheckRollup context node (a CheckRun or a legacy StatusContext). */
export interface RollupContext {
  __typename?: 'CheckRun' | 'StatusContext';
  name?: string;
  status?: string;
  conclusion?: string | null;
  context?: string;
  state?: string;
}

/** A pull-request review node as returned by the GraphQL reviews connection. */
export interface ReviewNode {
  author?: { login?: string } | null;
  state?: string;
  submittedAt?: string;
}

/** Reports whether a check/review name or author login denotes CodeRabbit. */
export function isCodeRabbit(name: string | null | undefined): boolean;

/** Resolves the CI verdict from rollup contexts, excluding CodeRabbit's own check. */
export function ciVerdict(contexts: RollupContext[]): 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NONE';

/** Resolves the latest CodeRabbit review state, or 'NONE' when it has not reviewed. */
export function crVerdict(reviews: ReviewNode[]): string;

/** Resolves the single maintainer-facing verdict from the CI and CodeRabbit verdicts. */
export function overallVerdict(ci: string, cr: string): string;
