/**
 * Canary test for composition-root exemption (T5).
 *
 * Proves that the `isCompositionRootExempt` predicate is NARROW:
 *   - Files ON the COMPOSITION_ROOTS allowlist with inward deps → exempt (score 0)
 *   - Files NOT on the allowlist with inward deps → NOT exempt (score ≥ 2)
 *
 * This prevents gaming: if all inward deps were blanket-exempt, the scoring
 * system would be meaningless. The exemption is surgical, applying ONLY to
 * designated composition roots (factories).
 */

import { describe, it, expect } from 'vitest';
import {
  isCompositionRootExempt,
  COMPOSITION_ROOTS,
} from '../scripts/coupling-scanner.cjs';

describe('Composition-root exemption canary', () => {
  it('ReceiptHandlerFactory is on the allowlist', () => {
    expect(COMPOSITION_ROOTS.has('src/Scheduler/Telegram/ReceiptHandlerFactory.ts')).toBe(true);
  });

  it('HandlerFactory is on the allowlist', () => {
    expect(COMPOSITION_ROOTS.has('src/Scheduler/Telegram/HandlerFactory.ts')).toBe(true);
  });

  it('A factory file with an inward dep is exempt', () => {
    const dep = {
      to: 'src/Services/ReceiptApiAdapter.ts',
      toLayer: 'IS',
      dynamic: false,
      direction: 'inward' as const,
    };
    expect(isCompositionRootExempt('src/Scheduler/Telegram/ReceiptHandlerFactory.ts', dep)).toBe(
      true,
    );
  });

  it('A factory file with an OUTWARD dep is NOT exempt (wrong-direction guard intact)', () => {
    const dep = {
      to: 'src/Bootstrap/BootstrapOrchestrator.ts',
      toLayer: 'EP',
      dynamic: false,
      direction: 'outward' as const,
    };
    expect(isCompositionRootExempt('src/Scheduler/Telegram/ReceiptHandlerFactory.ts', dep)).toBe(
      false,
    );
  });

  it('A NON-FACTORY file with an inward dep is NOT exempt (canary proves narrowness)', () => {
    const dep = {
      to: 'src/Services/ReceiptImportHandler.ts',
      toLayer: 'IS',
      dynamic: false,
      direction: 'inward' as const,
    };
    // This is a non-factory SC file importing from IS — inward, but NOT exempt
    expect(isCompositionRootExempt('src/Scheduler/Telegram/NotAFactory.ts', dep)).toBe(false);
  });

  it('The allowlist is small (2 files) — proves this is surgical, not blanket', () => {
    expect(COMPOSITION_ROOTS.size).toBe(2);
  });
});
