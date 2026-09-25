import { describe, expect, it } from 'vitest';

import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeBankConfig } from '../helpers/factories.js';

const EMAIL = 'operator@example.com';
const PHONE = '+972527654321';

/**
 * Builds a login config that differs from the base only by `overrides`.
 * @param overrides - Config fields to change.
 * @returns The config entry.
 */
function configWith(overrides: Partial<IBankConfig> = {}): IBankConfig {
  return fakeBankConfig({ email: EMAIL, phoneNumber: PHONE, password: 'first-pass', ...overrides });
}

/**
 * Fingerprints a login, failing the case when no fingerprint is derived.
 * @param companyType - Provider company id of the bank.
 * @param overrides - Config fields to change.
 * @returns The login fingerprint.
 */
function fingerprintOf(companyType: string, overrides: Partial<IBankConfig> = {}): string {
  const result = loginFingerprint(companyType, configWith(overrides));
  if (!result.success) throw new Error(`expected a fingerprint, got: ${result.message}`);
  return result.data;
}

describe('loginFingerprint', () => {
  it('is 64 lowercase hex characters and never the identity itself', () => {
    const fingerprint = fingerprintOf('oneZero');

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain('operator');
  });

  it('is SHA-256 of the bank and the provider-facing phone, so stored bindings stay valid', () => {
    const expected = '6e0cb6edf451789bb87e6c4efa2eb891ba4eca94adb9be4a75d241165e5a0240';

    expect(fingerprintOf('pepper', { phoneNumber: '052-765-4321' })).toBe(expected);
  });

  it('hashes the oneZero email exactly as it is sent', () => {
    const expected = 'f373cd3ecf6909541a858b622daa85318159b063ecab0c854492b0dcb9068ebd';

    expect(fingerprintOf('oneZero', { email: 'Operator.Name+tag@example.com ' })).toBe(expected);
  });

  it('differs per bank for the same phone', () => {
    expect(fingerprintOf('pepper')).not.toBe(fingerprintOf('payBox'));
  });

  it.each(['pepper', 'payBox'])('keys %s by the phone as the provider receives it', (bank) => {
    const formatted = fingerprintOf(bank, { phoneNumber: '052-765-4321' });

    expect(formatted).toBe(fingerprintOf(bank));
    expect(fingerprintOf(bank, { phoneNumber: '+972527654322' })).not.toBe(formatted);
  });

  it.each(['pepper', 'payBox'])('ignores the email for %s, which logs in by phone', (bank) => {
    expect(fingerprintOf(bank, { email: 'other@example.com' })).toBe(fingerprintOf(bank));
  });

  it('keys oneZero by its email', () => {
    expect(fingerprintOf('oneZero', { email: 'other@example.com' })).not.toBe(fingerprintOf('oneZero'));
    expect(fingerprintOf('oneZero', { email: 'Operator@example.com' })).not.toBe(fingerprintOf('oneZero'));
  });

  it('ignores the phone for oneZero, which logs in by email', () => {
    expect(fingerprintOf('oneZero', { phoneNumber: '+972527654322' })).toBe(fingerprintOf('oneZero'));
  });

  it.each(['oneZero', 'pepper', 'payBox'])('never depends on the password for %s', (bank) => {
    expect(fingerprintOf(bank, { password: 'second-pass' })).toBe(fingerprintOf(bank));
  });

  it.each([
    ['oneZero', { email: undefined }],
    ['oneZero', { email: '' }],
    ['pepper', { phoneNumber: undefined }],
    ['payBox', { phoneNumber: '+-' }],
  ])('refuses %s with no login identity (%o)', (bank, overrides) => {
    const result = loginFingerprint(bank, configWith(overrides as Partial<IBankConfig>));

    expect(result.success).toBe(false);
  });

  it('refuses a bank the scraper does not know', () => {
    expect(loginFingerprint('noSuchBank', configWith()).success).toBe(false);
  });
});
