import { describe, expect, it } from 'vitest';

import type { AuthCodeInput } from '../../src/Portal/AppAuthCodes.js';
import { AppAuthCodes, CODE_TTL_MS, DEFAULT_DEVICE_NAME, MAX_DEVICE_NAME, sanitizeDeviceName } from '../../src/Portal/AppAuthCodes.js';
import { isFail, isSuccess } from '../../src/Types/Index.js';

const NOW = 1_700_000_000_000;

/**
 * Builds a mint payload with every field populated, so a test can override
 * only the field it is about.
 * @param over - Fields to replace on the default input.
 * @returns A complete {@link AuthCodeInput}.
 */
function input(over: Partial<AuthCodeInput> = {}): AuthCodeInput {
  return {
    challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    redirectUri: 'bankimporter://auth',
    factors: { google: true, password: true },
    email: 'operator@example.com',
    fingerprint: 'fp',
    deviceName: 'Pixel 8',
    ...over,
  };
}

describe('AppAuthCodes', () => {
  describe('sanitizeDeviceName', () => {
    it('keeps a plain label unchanged', () => {
      expect(sanitizeDeviceName('Pixel 8')).toBe('Pixel 8');
    });

    it('falls back to the default for missing, empty or blank labels', () => {
      expect(sanitizeDeviceName(undefined)).toBe(DEFAULT_DEVICE_NAME);
      expect(sanitizeDeviceName('')).toBe(DEFAULT_DEVICE_NAME);
      expect(sanitizeDeviceName('   ')).toBe(DEFAULT_DEVICE_NAME);
    });

    it('strips control characters that could forge a log line', () => {
      expect(sanitizeDeviceName('Pixel\n8\u0000')).toBe('Pixel8');
      expect(sanitizeDeviceName('\u007Fghost')).toBe('ghost');
    });

    it('falls back to the default when only control characters are sent', () => {
      expect(sanitizeDeviceName('\u0000\u0001\u001F')).toBe(DEFAULT_DEVICE_NAME);
    });

    it('truncates an oversized label', () => {
      expect(sanitizeDeviceName('x'.repeat(200))).toHaveLength(MAX_DEVICE_NAME);
    });
  });

  describe('mint', () => {
    it('returns a base64url code bound to the supplied authorization', () => {
      const record = new AppAuthCodes().mint(input(), NOW);
      expect(record.code).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      expect(record.redirectUri).toBe('bankimporter://auth');
      expect(record.factors).toEqual({ google: true, password: true });
      expect(record.used).toBe(false);
    });

    it('expires the code 60 seconds after minting', () => {
      const record = new AppAuthCodes().mint(input(), NOW);
      expect(record.expiresAt).toBe(NOW + CODE_TTL_MS);
      expect(CODE_TTL_MS).toBe(60_000);
    });

    it('never repeats a code', () => {
      const codes = new AppAuthCodes();
      const first = codes.mint(input(), NOW);
      const second = codes.mint(input(), NOW);
      expect(first.code).not.toBe(second.code);
      expect(codes.size).toBe(2);
    });
  });

  describe('redeem', () => {
    it('returns the record bound at mint time', () => {
      const codes = new AppAuthCodes();
      const minted = codes.mint(input(), NOW);
      const result = codes.redeem(minted.code, NOW + 1);
      expect(isSuccess(result)).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.challenge).toBe(minted.challenge);
      expect(result.data.email).toBe('operator@example.com');
    });

    it('rejects an unknown code', () => {
      const result = new AppAuthCodes().redeem('nope', NOW);
      expect(isFail(result)).toBe(true);
    });

    it('rejects a second redemption and flags it as reuse', () => {
      const codes = new AppAuthCodes();
      const minted = codes.mint(input(), NOW);
      expect(isSuccess(codes.redeem(minted.code, NOW))).toBe(true);
      const second = codes.redeem(minted.code, NOW + 1);
      expect(isFail(second)).toBe(true);
      if (!isFail(second)) return;
      expect(second.status).toBe('reused');
    });

    it('rejects a code presented exactly at its expiry', () => {
      const codes = new AppAuthCodes();
      const minted = codes.mint(input(), NOW);
      expect(isFail(codes.redeem(minted.code, NOW + CODE_TTL_MS))).toBe(true);
    });

    it('rejects a code presented after its expiry', () => {
      const codes = new AppAuthCodes();
      const minted = codes.mint(input(), NOW);
      expect(isFail(codes.redeem(minted.code, NOW + CODE_TTL_MS + 1))).toBe(true);
    });

    it('keeps a redeemed code detectable for the rest of its window', () => {
      const codes = new AppAuthCodes();
      const minted = codes.mint(input(), NOW);
      codes.redeem(minted.code, NOW);
      expect(codes.size).toBe(1);
    });
  });

  describe('sweep', () => {
    it('drops expired codes', () => {
      const codes = new AppAuthCodes();
      codes.mint(input(), NOW);
      codes.sweep(NOW + CODE_TTL_MS);
      expect(codes.size).toBe(0);
    });

    it('keeps codes that are still redeemable', () => {
      const codes = new AppAuthCodes();
      codes.mint(input(), NOW);
      codes.sweep(NOW + CODE_TTL_MS - 1);
      expect(codes.size).toBe(1);
    });

    it('runs on every mint so an idle window cannot accumulate codes', () => {
      const codes = new AppAuthCodes();
      codes.mint(input(), NOW);
      codes.mint(input(), NOW + CODE_TTL_MS);
      expect(codes.size).toBe(1);
    });
  });
});
