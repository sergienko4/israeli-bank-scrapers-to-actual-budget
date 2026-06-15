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
