/**
 * Type declarations for the pure, unit-testable predicates exported by
 * scripts/coupling-scanner.cjs. The scanner runs as a standalone Node script
 * (require.main guard); these exports exist solely so tests/coupling-scanner.test.ts
 * can lock the shared-kernel exemption contract without enabling project-wide
 * allowJs. Keep this surface minimal — add an entry only when a function is both
 * exported from the .cjs AND consumed by a test.
 */

/** Resolves the architecture layer code of a source file from its relative path. */
export function layerOf(relPath: string): string;

/** Reports whether a value-import target belongs to the sanctioned shared kernel. */
export function isKernelTarget(targetPath: string, targetLayer: string): boolean;

/** Reports whether a resolved value import is genuine cross-layer coupling. */
export function isCrossLayerCoupling(
  fromLayer: string,
  targetPath: string,
  targetLayer: string,
): boolean;

/** Reports whether a cross-layer dep should be exempt from scoring (composition-root + inward). */
export function isCompositionRootExempt(
  sourcePath: string,
  dep: { to: string; toLayer: string; dynamic: boolean; direction: 'inward' | 'outward' },
): boolean;

/** Classifies a confirmed cross-layer value dep as 'inward' (allowed) or 'outward' (a dependency-rule violation). */
export function classifyDirection(fromLayer: string, toLayer: string): 'inward' | 'outward';

/** A resolved cross-layer value-dependency edge recorded on a scanned file. */
export interface CrossLayerValueDep {
  to: string;
  toLayer: string;
  direction: 'inward' | 'outward';
}

/** A scanned source-file record carrying its classified cross-layer edges. */
export interface ScannedFile {
  path: string;
  layer: string;
  crossLayerValueDeps: CrossLayerValueDep[];
}

/** The parsed coupling-baseline JSON, narrowed to the fields the guard reads. */
export interface CouplingBaseline {
  files?: Array<{
    path: string;
    crossLayerValueDeps?: Array<{ to: string; direction: string }>;
  }>;
}

/**
 * Lists outward (wrong-direction) edges present in the report but absent from
 * the baseline, identified by (path, to) so a count-unchanged swap is still
 * caught. Returns one formatted "  + from (layer) -> to (toLayer)" line each.
 */
export function newWrongDirectionEdges(
  report: ScannedFile[],
  baseline: CouplingBaseline,
): string[];

/** Architectural dependency ranks, outermost (0) to innermost (5); used to classify direction. */
export const LAYER_RANK: Readonly<Record<string, number>>;

/** Composition roots: files that wire dependencies (factories). Inward deps from these are exempt from scoring. */
export const COMPOSITION_ROOTS: ReadonlySet<string>;
