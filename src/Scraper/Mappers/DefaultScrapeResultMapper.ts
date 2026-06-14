/**
 * DefaultScrapeResultMapper — composition root that wires the canonical
 * mapper interface to its 4 module implementations under ./Mappers/:
 * Sign, ToCanonical, FromLegacy, ToLegacy.
 *
 * Sign normalization is delegated to TransactionNormalizer through Sign.ts;
 * this composition root only assembles the IScrapeResultMapper surface.
 */

import {
  canonicalToLegacy, legacyToCanonical, mapToCanonical,
} from './Index.js';
import type { IScrapeResultMapper } from './IScrapeResultMapper.js';

/**
 * Constructs the default mapper used at the composition root.
 * @returns Singleton-safe IScrapeResultMapper with no external state.
 */
export default function createScrapeResultMapper(): IScrapeResultMapper {
  return { mapToCanonical, canonicalToLegacy, legacyToCanonical };
}