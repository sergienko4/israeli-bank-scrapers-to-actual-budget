import { describe, expect, it, vi } from 'vitest';

import {
  apply, EMPTY, reduce,
} from '../../../../src/Scrapers/Pipeline/Reducers/MetricsReducer.js';
import { succeed } from '../../../../src/Types/Index.js';
import type { IBankMetricsDelta } from '../../../../src/Types/Pipeline/Index.js';

function makeStubService() {
  return {
    startBank: vi.fn().mockReturnValue(succeed({ status: 'tracking' as const })),
    recordBankSuccess: vi.fn().mockReturnValue(succeed({ status: 'recorded' as const })),
    recordBankFailure: vi.fn().mockReturnValue(succeed({ status: 'recorded' as const })),
  };
}

describe('MetricsReducer', () => {
  describe('reduce', () => {
    it('appends without mutating the original accumulator', () => {
      const delta: IBankMetricsDelta = { kind: 'start', bankName: 'a' };
      const next = reduce(EMPTY, delta);

      expect(EMPTY.deltas).toHaveLength(0);
      expect(next.deltas).toEqual([delta]);
    });

    it('preserves insertion order across multiple reductions', () => {
      const d1: IBankMetricsDelta = { kind: 'start', bankName: 'a' };
      const d2: IBankMetricsDelta = { kind: 'success', bankName: 'a', imported: 1, skipped: 0 };
      const d3: IBankMetricsDelta = { kind: 'failure', bankName: 'b', error: new Error('x') };
      const acc = reduce(reduce(reduce(EMPTY, d1), d2), d3);

      expect(acc.deltas).toEqual([d1, d2, d3]);
    });
  });

  describe('apply', () => {
    it('flushes starts, then successes, then failures in spec-locked order', () => {
      const service = makeStubService();
      const err = new Error('boom');
      const acc = {
        deltas: [
          { kind: 'failure', bankName: 'b', error: err },
          { kind: 'start', bankName: 'a' },
          { kind: 'success', bankName: 'a', imported: 3, skipped: 1 },
          { kind: 'start', bankName: 'b' },
        ] satisfies IBankMetricsDelta[],
      };

      const result = apply(acc, service);

      expect(result.success).toBe(true);
      expect(service.startBank).toHaveBeenNthCalledWith(1, 'a');
      expect(service.startBank).toHaveBeenNthCalledWith(2, 'b');
      expect(service.recordBankSuccess).toHaveBeenCalledWith('a', 3, 1);
      expect(service.recordBankFailure).toHaveBeenCalledWith('b', err);
    });

    it('returns success on empty accumulator without side effects', () => {
      const service = makeStubService();
      const result = apply(EMPTY, service);

      expect(result.success).toBe(true);
      expect(service.startBank).not.toHaveBeenCalled();
      expect(service.recordBankSuccess).not.toHaveBeenCalled();
      expect(service.recordBankFailure).not.toHaveBeenCalled();
    });

    it('short-circuits when startBank fails', () => {
      const service = makeStubService();
      service.startBank.mockReturnValueOnce({ success: false, message: 'init err' });
      const acc = {
        deltas: [
          { kind: 'start', bankName: 'a' },
          { kind: 'success', bankName: 'a', imported: 1, skipped: 0 },
        ] satisfies IBankMetricsDelta[],
      };

      const result = apply(acc, service);

      expect(result.success).toBe(false);
      expect(service.recordBankSuccess).not.toHaveBeenCalled();
    });

    it('short-circuits when recordBankSuccess fails (failure deltas not flushed)', () => {
      const service = makeStubService();
      service.recordBankSuccess.mockReturnValueOnce({ success: false, message: 'rec err' });
      const err = new Error('boom');
      const acc = {
        deltas: [
          { kind: 'start', bankName: 'a' },
          { kind: 'success', bankName: 'a', imported: 1, skipped: 0 },
          { kind: 'failure', bankName: 'b', error: err },
        ] satisfies IBankMetricsDelta[],
      };

      const result = apply(acc, service);

      expect(result.success).toBe(false);
      expect(service.recordBankFailure).not.toHaveBeenCalled();
    });

    it('parity: produces same final-state observable set as legacy interleaved order', () => {
      const reducerService = makeStubService();
      const legacyService = makeStubService();
      const err = new Error('x');
      const acc = {
        deltas: [
          { kind: 'start', bankName: 'a' },
          { kind: 'failure', bankName: 'a', error: err },
          { kind: 'start', bankName: 'b' },
          { kind: 'success', bankName: 'b', imported: 2, skipped: 1 },
        ] satisfies IBankMetricsDelta[],
      };

      apply(acc, reducerService);

      legacyService.startBank('a');
      legacyService.recordBankFailure('a', err);
      legacyService.startBank('b');
      legacyService.recordBankSuccess('b', 2, 1);

      const reducerCalls = new Set([
        ...reducerService.startBank.mock.calls.map(c => `start:${String(c[0])}`),
        ...reducerService.recordBankSuccess.mock.calls.map(
          c => `success:${String(c[0])}:${String(c[1])}:${String(c[2])}`),
        ...reducerService.recordBankFailure.mock.calls.map(
          c => `failure:${String(c[0])}:${(c[1] as Error).message}`),
      ]);
      const legacyCalls = new Set([
        ...legacyService.startBank.mock.calls.map(c => `start:${String(c[0])}`),
        ...legacyService.recordBankSuccess.mock.calls.map(
          c => `success:${String(c[0])}:${String(c[1])}:${String(c[2])}`),
        ...legacyService.recordBankFailure.mock.calls.map(
          c => `failure:${String(c[0])}:${(c[1] as Error).message}`),
      ]);

      expect(reducerCalls).toEqual(legacyCalls);
    });
  });
});
