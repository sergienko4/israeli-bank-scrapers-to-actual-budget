/**
 * Ambient type declaration for the release-signal policy module so TypeScript
 * tests can import it without `any` leaks. Mirrors the
 * scripts/render-readme-meta.d.mts precedent.
 */

/** A single dependency change that reaches the published Docker image. */
export interface IShippedDependencyChange {
  field: string;
  name: string;
  from: string | undefined;
  to: string | undefined;
}

/** The parsed conventional-commit header of a pull request title. */
export interface ICommitHeader {
  type: string;
  scope: string | undefined;
  breaking: boolean;
}

/** Inputs required to evaluate the release-signal policy. */
export interface IReleaseSignalInput {
  title?: string;
  basePackage?: Record<string, unknown>;
  headPackage?: Record<string, unknown>;
}

/** The guard verdict and the evidence behind it. */
export interface IReleaseSignalVerdict {
  ok: boolean;
  releaseTriggering: boolean;
  shippedChanges: IShippedDependencyChange[];
}

/** Conventional-commit types that make release-please cut a release. */
export const RELEASE_TRIGGERING_TYPES: readonly string[];

/** `package.json` fields whose contents ship inside the published image. */
export const SHIPPED_MANIFEST_FIELDS: readonly string[];

/** Parses the conventional-commit header of a pull request title. */
export function parseCommitHeader(title?: string): ICommitHeader | undefined;

/** Reports whether a pull request title makes release-please cut a release. */
export function isReleaseTriggering(title?: string): boolean;

/** Lists every dependency change that reaches the published image. */
export function findShippedDependencyChanges(
  basePackage?: Record<string, unknown>,
  headPackage?: Record<string, unknown>,
): IShippedDependencyChange[];

/** Decides whether a pull request may merge under the release-signal policy. */
export function evaluateReleaseSignal(input: IReleaseSignalInput): IReleaseSignalVerdict;

/** Renders the guard verdict as operator-facing console output. */
export function formatReleaseSignalReport(
  verdict: IReleaseSignalVerdict,
  title?: string,
): string;
