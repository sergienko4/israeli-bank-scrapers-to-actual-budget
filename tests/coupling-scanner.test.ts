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
  newWrongDirectionEdges,
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

describe('coupling-scanner new wrong-direction edge guard (canary)', () => {
  // Minimal fixture builders mirroring the scanner's record + baseline shapes.
  const dep = (to: string, direction: 'inward' | 'outward', toLayer = 'BP') => ({
    to,
    toLayer,
    direction,
  });
  const file = (path: string, layer: string, deps: ReturnType<typeof dep>[]) => ({
    path,
    layer,
    crossLayerValueDeps: deps,
  });
  const baselineEdge = (path: string, to: string, direction = 'outward') => ({
    path,
    crossLayerValueDeps: [{ to, direction }],
  });

  it('flags a newly-introduced outward edge absent from the baseline', () => {
    const report = [
      file('src/Config/Reach.ts', 'CC', [dep('src/Scrapers/SomeBank.ts', 'outward')]),
    ];
    const result = newWrongDirectionEdges(report, { files: [] });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('src/Config/Reach.ts');
    expect(result[0]).toContain('src/Scrapers/SomeBank.ts');
  });

  it('suppresses an outward edge that already exists in the baseline', () => {
    const target = 'src/Scrapers/SomeBank.ts';
    const baseline = { files: [baselineEdge('src/Config/Reach.ts', target)] };
    const report = [file('src/Config/Reach.ts', 'CC', [dep(target, 'outward')])];
    expect(newWrongDirectionEdges(report, baseline)).toEqual([]);
  });

  it('never flags inward edges, even brand-new ones', () => {
    // Scheduler (outer) reading Config (inner) is an allowed inward dep — it must
    // never raise a wrong-direction smell regardless of the baseline.
    const report = [
      file('src/Scheduler/Wire.ts', 'SC', [dep('src/Config/ConfigLoader.ts', 'inward', 'CC')]),
    ];
    expect(newWrongDirectionEdges(report, { files: [] })).toEqual([]);
  });

  it('CANARY: catches an edge-identity SWAP even when the count is unchanged', () => {
    // The baseline knows exactly one outward edge (ReachA -> target). The report
    // retires it and introduces a DIFFERENT outward edge (ReachB -> target), so
    // wrongDirectionDeps stays 1 == baseline 1. A count-only guard passes here;
    // the identity diff must still flag ReachB and must NOT resurface ReachA.
    const target = 'src/Scrapers/SomeBank.ts';
    const baseline = { files: [baselineEdge('src/Resilience/ReachA.ts', target)] };
    const report = [file('src/Config/ReachB.ts', 'CC', [dep(target, 'outward')])];
    const result = newWrongDirectionEdges(report, baseline);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('src/Config/ReachB.ts');
    expect(result.join('\n')).not.toContain('src/Resilience/ReachA.ts');
  });

  it('treats the same source with a different target as a distinct new edge', () => {
    // Identity is (path, to): the SAME offender file adding a NEW downward target
    // is a fresh violation, while its pre-existing target stays suppressed.
    const baseline = { files: [baselineEdge('src/Config/Reach.ts', 'src/Scrapers/BankA.ts')] };
    const report = [
      file('src/Config/Reach.ts', 'CC', [
        dep('src/Scrapers/BankA.ts', 'outward'),
        dep('src/Scrapers/BankB.ts', 'outward'),
      ]),
    ];
    const result = newWrongDirectionEdges(report, baseline);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('src/Scrapers/BankB.ts');
    expect(result[0]).not.toContain('BankA');
  });

  it('tolerates a baseline with no files array (??-guarded)', () => {
    const report = [
      file('src/Config/Reach.ts', 'CC', [dep('src/Scrapers/SomeBank.ts', 'outward')]),
    ];
    expect(newWrongDirectionEdges(report, {})).toHaveLength(1);
  });
});
