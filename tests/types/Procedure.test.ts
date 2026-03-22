import { describe, it, expect } from 'vitest';
import {
  succeed, fail, fromPromise, isSuccess, isFail,
} from '../../src/Types/ProcedureHelpers.js';
import type { Procedure } from '../../src/Types/Procedure.js';

describe('Procedure Result Pattern', () => {
  describe('succeed', () => {
    it('creates a success result with default status', () => {
      const result = succeed(42);
      expect(result.success).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.data).toBe(42);
    });

    it('creates a success result with custom status', () => {
      const result = succeed({ id: 'abc' }, 'created');
      expect(result.success).toBe(true);
      expect(result.status).toBe('created');
      expect(result.data).toEqual({ id: 'abc' });
    });

    it('returns a frozen object', () => {
      const result = succeed('test');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('fail', () => {
    it('creates a failure result with default status', () => {
      const result = fail('something went wrong');
      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
      expect(result.message).toBe('something went wrong');
      expect(result.error).toBeUndefined();
    });

    it('creates a failure result with custom status and error', () => {
      const original = new Error('root cause');
      const result = fail('operation failed', { status: 'timeout', error: original });
      expect(result.success).toBe(false);
      expect(result.status).toBe('timeout');
      expect(result.message).toBe('operation failed');
      expect(result.error).toBe(original);
    });

    it('returns a frozen object', () => {
      const result = fail('frozen');
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  describe('fromPromise', () => {
    it('wraps a resolved promise as success', async () => {
      const result = await fromPromise(Promise.resolve('data'), 'should not fail');
      expect(result.success).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toBe('data');
      }
    });

    it('wraps a rejected promise as failure with Error', async () => {
      const err = new Error('boom');
      const result = await fromPromise(Promise.reject(err), 'operation failed');
      expect(result.success).toBe(false);
      if (isFail(result)) {
        expect(result.message).toBe('operation failed');
        expect(result.error).toBe(err);
      }
    });

    it('wraps a rejected string as failure with wrapped Error', async () => {
      const result = await fromPromise(Promise.reject('string error'), 'caught');
      expect(result.success).toBe(false);
      if (isFail(result)) {
        expect(result.message).toBe('caught');
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error?.message).toBe('string error');
      }
    });
  });

  describe('type guards', () => {
    it('isSuccess narrows to IProcedureSuccess', () => {
      const result: Procedure<number> = succeed(10);
      expect(isSuccess(result)).toBe(true);
      expect(isFail(result)).toBe(false);
      if (isSuccess(result)) {
        // TypeScript narrows: result.data is accessible
        expect(result.data).toBe(10);
      }
    });

    it('isFail narrows to IProcedureFailure', () => {
      const result: Procedure<number> = fail('bad');
      expect(isFail(result)).toBe(true);
      expect(isSuccess(result)).toBe(false);
      if (isFail(result)) {
        // TypeScript narrows: result.message is accessible
        expect(result.message).toBe('bad');
      }
    });

    it('discriminates in a conditional chain', () => {
      const results: Procedure<string>[] = [
        succeed('a'),
        fail('b'),
        succeed('c'),
      ];
      const successes = results.filter(isSuccess);
      const failures = results.filter(isFail);
      expect(successes).toHaveLength(2);
      expect(failures).toHaveLength(1);
      expect(successes[0].data).toBe('a');
      expect(failures[0].message).toBe('b');
    });
  });
});
