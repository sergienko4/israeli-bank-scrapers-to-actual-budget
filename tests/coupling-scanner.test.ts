/**
 * Canary tests for scripts/coupling-scanner.cjs shared-kernel exemption.
 *
 * These tests lock the metric-correction contract (see
 * plans/decoupling-2026-06/metric-correction-proposal.md): value imports of the
 * sanctioned shared kernel (the ST layer + the Logger module) MUST NOT count as
 * cross-layer coupling, while genuine peer-layer value imports MUST still count.
 * They fail if the exemption is removed (kernel cases flip) or over-broadened
 * (Config/Resilience/peer cases flip).
 */

import { describe, it, expect } from 'vitest';
import {
  layerOf,
  isKernelTarget,
  isCrossLayerCoupling,
  classifyDirection,
} from '../scripts/coupling-scanner.cjs';

describe('coupling-scanner layer mapping', () => {
  it('maps the shared-toolbox directories to the ST layer', () => {
    expect(layerOf('src/Types/Index.ts')).toBe('ST');
    expect(layerOf('src/Utils/Index.ts')).toBe('ST');
    expect(layerOf('src/Errors/ConfigurationError.ts')).toBe('ST');
    expect(layerOf('src/Helpers/Foo.ts')).toBe('ST');
  });

  it('maps Logger and Config both to CC (so Logger needs a prefix exemption)', () => {
    expect(layerOf('src/Logger/Index.ts')).toBe('CC');
    expect(layerOf('src/Config/ConfigLoader.ts')).toBe('CC');
  });
});

describe('coupling-scanner shared-kernel exemption', () => {
  it('treats the entire ST layer as kernel', () => {
    expect(isKernelTarget('src/Types/Index.ts', 'ST')).toBe(true);
    expect(isKernelTarget('src/Utils/Index.ts', 'ST')).toBe(true);
    expect(isKernelTarget('src/Errors/NetworkError.ts', 'ST')).toBe(true);
  });

  it('treats the Logger module as sanctioned cross-cutting kernel', () => {
    expect(isKernelTarget('src/Logger/Index.ts', 'CC')).toBe(true);
    expect(isKernelTarget('src/Logger/MaskPhone.ts', 'CC')).toBe(true);
  });

  it('does NOT exempt Config or Resilience (real subsystems, also CC)', () => {
    expect(isKernelTarget('src/Config/ConfigLoader.ts', 'CC')).toBe(false);
    expect(isKernelTarget('src/Resilience/RetryPolicy.ts', 'CC')).toBe(false);
  });
});

describe('coupling-scanner cross-layer decision (canary)', () => {
  it('CANARY: kernel imports are NOT counted as cross-layer coupling', () => {
    // Service importing the Result helpers / a util / the logger is sanctioned.
    expect(isCrossLayerCoupling('IS', 'src/Types/Index.ts', 'ST')).toBe(false);
    expect(isCrossLayerCoupling('SC', 'src/Utils/Index.ts', 'ST')).toBe(false);
    expect(isCrossLayerCoupling('BP', 'src/Logger/Index.ts', 'CC')).toBe(false);
  });

  it('CANARY: genuine peer-layer imports are STILL counted', () => {
    // Wiring/service reaching into Config internals, services, or scrapers.
    expect(isCrossLayerCoupling('SC', 'src/Config/ConfigLoader.ts', 'CC')).toBe(true);
    expect(isCrossLayerCoupling('IS', 'src/Scraper/BankScraper.ts', 'BP')).toBe(true);
    // A cross-cutting concern (CC) importing any domain (BP) module is counted
    // as a wrong-direction edge — the scanner's core CC->BP entanglement guard.
    expect(isCrossLayerCoupling('CC', 'src/Scraper/CredentialsBuilder.ts', 'BP')).toBe(true);
  });

  it('never counts same-layer or unmapped imports', () => {
    expect(isCrossLayerCoupling('IS', 'src/Services/Other.ts', 'IS')).toBe(false);
    expect(isCrossLayerCoupling('(none)', 'src/Config/ConfigLoader.ts', 'CC')).toBe(false);
    expect(isCrossLayerCoupling('IS', 'src/Whatever.ts', '(none)')).toBe(false);
  });
});

describe('coupling-scanner direction classification (canary)', () => {
  it('CANARY: inward deps (outer -> inner) are allowed', () => {
    // The real composition-root / config-read edges in the live baseline.
    expect(classifyDirection('SC', 'IS')).toBe('inward'); // Scheduler -> Services
    expect(classifyDirection('SC', 'CC')).toBe('inward'); // Scheduler -> Config
    expect(classifyDirection('IS', 'CC')).toBe('inward'); // Services  -> Config
    expect(classifyDirection('IS', 'BP')).toBe('inward'); // Services  -> Scrapers
  });

  it('CANARY: outward deps (inner -> outer) are wrong-direction smells', () => {
    // The exact #459 edge: Logger (CC) reaching down into a Scraper (BP).
    expect(classifyDirection('CC', 'BP')).toBe('outward');
    // A domain scraper depending up on a service inverts the dependency rule.
    expect(classifyDirection('BP', 'IS')).toBe('outward');
    expect(classifyDirection('CC', 'SC')).toBe('outward');
    // A shared-kernel module (ST, innermost) must not reach up into Config (CC).
    expect(classifyDirection('ST', 'CC')).toBe('outward');
  });

  it('defaults unmapped layers to inward so it never invents a smell', () => {
    expect(classifyDirection('(none)', 'CC')).toBe('inward');
    expect(classifyDirection('IS', '(none)')).toBe('inward');
  });
});
