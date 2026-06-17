/**
 * Canary: high-coupling gate (T7 — spec.md S5.T7.4).
 *
 * This file intentionally triggers a score >= 5 (high-bucket) to prove the
 * tightened `npm run coupling:check` gate rejects high-coupling regressions.
 *
 * How it fires:
 *   - 3 cross-layer value imports (BP -> CC, outward forbidden direction) => +6
 *   - Lines ~70 => +0 (under 200)
 *   - Value imports = 3 => +0 (under 7)
 *   - Total score = 6 (high-bucket: 5-7)
 *
 * Verification:
 *   - `npm run coupling:scan` includes this file with score = 6
 *   - `npm run coupling:check` exits 1 citing this file as a high regressor
 *
 * Removal protocol:
 *   - Excluded from baseline tests/coupling-baseline.json
 *   - Not tracked in production code coverage
 */

// Intentional cross-layer value imports (BP -> CC, outward forbidden direction)
import { ConfigLoader } from '../../../Config/ConfigLoader.js';
import { validateActualConfig, validateServerUrl } from '../../../Config/ConfigLoaderValidator.js';
import { ConfigValidator } from '../../../Config/ConfigValidator.js';

/**
 * Fake class to accumulate coupling score via cross-layer value deps.
 * Never instantiated — exists solely to trigger the scanner's coupling metrics.
 */
export class HighCouplingCanary {
  constructor() {
    // Reference imported symbols to ensure they count as value imports
    // Void expression satisfies tsc noUnusedLocals + preserves reference
    void ConfigLoader;
    void validateActualConfig;
    void validateServerUrl;
    void ConfigValidator;

    // Padding to reach ~70 lines (avoids trivial-file heuristics)
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
    void (() => {});
  }
}
