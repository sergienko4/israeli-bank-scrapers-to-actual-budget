/**
 * The provider caps the importer must honour before it sends a saved value.
 *
 * <p>Scraper 10.1.0 validates options and credentials at its public boundary
 * and fails before any bank request when `otpLongTermToken` or
 * `persistentAuthState` is too long. The importer stores both values and
 * re-sends them unchanged, so its caps have to move with the provider's. These
 * drift checks read the installed bundle, exactly as the failure-wording
 * checks do: a future bump that changes a cap fails here instead of silently
 * sending a value the provider will reject on every run.
 */

import { describe, expect, it } from 'vitest';

import {
  isOversizedDeviceState,
  isOversizedOtpToken,
  MAX_OTP_LONG_TERM_TOKEN_CHARS,
  MAX_PERSISTENT_AUTH_STATE_CHARS,
} from '../../src/Scraper/ProviderLimits.js';
import { anchored, providerBundle } from '../helpers/UpstreamBundle.js';

/**
 * Reads the provider's token cap from its installed bundle.
 * @returns The cap in characters.
 */
function providerTokenCap(): number {
  const value = anchored(providerBundle(), /var MAX_TOKEN_LENGTH = (?<value>\d+);/u);
  return Number(value);
}

/**
 * Reads the provider's device-state cap from its installed bundle.
 * @returns The cap in characters.
 */
function providerDeviceStateCap(): number {
  const factors = anchored(providerBundle(), /var MAX_ENCODED_CHARS = (?<value>\d+ \* \d+);/u)
    .split(' * ')
    .map(Number);
  return factors.reduce((product, factor) => product * factor, 1);
}

describe('ProviderLimits', () => {
  it('matches the provider token cap', () => {
    expect(MAX_OTP_LONG_TERM_TOKEN_CHARS).toBe(providerTokenCap());
  });

  it('matches the provider device-state cap', () => {
    expect(MAX_PERSISTENT_AUTH_STATE_CHARS).toBe(providerDeviceStateCap());
  });

  describe('isOversizedOtpToken', () => {
    it('accepts a token exactly at the cap', () => {
      expect(isOversizedOtpToken('x'.repeat(MAX_OTP_LONG_TERM_TOKEN_CHARS))).toBe(false);
    });

    it('rejects one character over the cap', () => {
      expect(isOversizedOtpToken('x'.repeat(MAX_OTP_LONG_TERM_TOKEN_CHARS + 1))).toBe(true);
    });

    it('accepts an ordinary token', () => {
      expect(isOversizedOtpToken('v1.carry-bundle')).toBe(false);
    });
  });

  describe('isOversizedDeviceState', () => {
    it('accepts a state exactly at the cap', () => {
      expect(isOversizedDeviceState('x'.repeat(MAX_PERSISTENT_AUTH_STATE_CHARS))).toBe(false);
    });

    it('rejects one character over the cap', () => {
      expect(isOversizedDeviceState('x'.repeat(MAX_PERSISTENT_AUTH_STATE_CHARS + 1))).toBe(true);
    });

    it('accepts an ordinary state', () => {
      expect(isOversizedDeviceState('v1.device-state')).toBe(false);
    });
  });
});
