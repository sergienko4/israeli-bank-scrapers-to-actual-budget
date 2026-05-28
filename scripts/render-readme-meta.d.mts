/**
 * Ambient type declaration for the JS renderer module so TypeScript
 * tests can import it without `any` leaks. The renderer accepts arbitrary
 * config/pkg objects (it dispatches dynamically based on marker name),
 * so we expose a permissive structural type with an index signature.
 */

export type RendererConfig = Record<string, unknown>;
export type RendererPackage = Record<string, unknown>;

/**
 * Rewrite the content between `<!-- meta:<name>:start -->` /
 * `<!-- meta:<name>:end -->` markers. Throws on malformed or
 * unknown markers. Returns the fully rendered text (idempotent).
 */
export function renderFile(
  originalText: string,
  allowedMarkers: string[],
  config: RendererConfig,
  pkg: RendererPackage,
  filePath: string,
): string;

