/**
 * Ambient type declaration for the Dependabot auto-merge policy module so
 * TypeScript tests can import it without `any` leaks. Mirrors the
 * scripts/release-signal-logic.d.mts precedent.
 */

/** One dependency update parsed from Dependabot's `updated-dependencies` metadata. */
export interface IDependencyUpdate {
  name: string;
  version?: string;
  dependencyType?: string;
  updateType?: string;
  group?: string;
}

/** How the policy classified a single update. */
export type DependencyUpdateClassification = 'safe' | 'digest' | 'major' | 'restricted' | 'unknown';

/** A parsed update together with the policy's classification of it. */
export interface IClassifiedDependencyUpdate extends IDependencyUpdate {
  classification: DependencyUpdateClassification;
}

/** Inputs required to evaluate the auto-merge policy. */
export interface IAutoMergeInput {
  commitMessage?: string;
  repinned?: boolean;
  ecosystem?: string;
}

/** Every verdict the policy can return. */
export type AutoMergeAction = 'merge' | 'label' | 'skip';

/** The policy verdict and the classified updates behind it. */
export interface IAutoMergeVerdict {
  action: AutoMergeAction;
  reason: string;
  entries: IClassifiedDependencyUpdate[];
}

/** Every verdict the policy can return, keyed by name. */
export const AUTO_MERGE_ACTIONS: Readonly<Record<AutoMergeAction, AutoMergeAction>>;

/** The update type that always needs a human. */
export const MAJOR_UPDATE_TYPE: string;

/** Update types each ecosystem may merge without review. */
export const SAFE_UPDATE_TYPES_BY_ECOSYSTEM: Readonly<Record<string, readonly string[]>>;

/** Ecosystems the maintainer has opted into auto-merge. */
export const SUPPORTED_ECOSYSTEMS: readonly string[];

/** Extracts the dependency updates Dependabot recorded in its commit message. */
export function parseUpdatedDependencies(commitMessage?: string): IDependencyUpdate[];

/** Decides whether a Dependabot pull request may auto-merge. */
export function decide(input?: IAutoMergeInput | null): IAutoMergeVerdict;

/** Renders a verdict as `GITHUB_OUTPUT` step outputs. */
export function toGithubOutput(result: Pick<IAutoMergeVerdict, 'action' | 'reason'>): string;
