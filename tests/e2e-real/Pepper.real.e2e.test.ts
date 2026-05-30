/**
 * Real-bank E2E for Pepper — verifies the fix for the production failure:
 *   envelope selector miss: smsAssertionId at
 *     /data/control_flow/0/methods/*channels/?type=sms/assertion_id
 *
 * This test exercises the production CredentialsBuilder → upstream
 * scraper → live Pepper API path, proving the phoneNumber normalisation
 * fix (RC1+RC2) sends `972XXXXXXXXX` instead of `+972XXXXXXXXX` so the
 * Pepper auth response includes the SMS channel in its method list.
 *
 * SKIP-BY-DEFAULT. Requires RUN_REAL_BANK_TESTS=true and
 * PEPPER_PHONE_NUMBER + PEPPER_PASSWORD in .env.e2e (or .env). Never
 * runs in CI.
 */

import { describe, it, expect } from 'vitest';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig } from '../../src/Types/Index.js';
import {
  buildStdinOtpRetriever, loadPepperCreds, realBankTestsEnabled,
} from './Helpers/RealBankEnv.js';
import { runRealScrape } from './Helpers/RunRealScrape.js';

const enabled = realBankTestsEnabled();
const credsResult = enabled ? loadPepperCreds() : null;
const shouldRun = enabled && credsResult !== null && credsResult.success;

if (enabled && credsResult !== null && !credsResult.success) {
  console.warn(`[pepper real] skip: ${credsResult.message}`);
}

describe.skipIf(!shouldRun)('Pepper real-creds E2E', () => {
  it('TC-E2E-REAL-PEPPER-001 — ASSERT_PWD returns smsAssertionId', async () => {
    if (credsResult === null || !credsResult.success) return;
    const otpRetriever = buildStdinOtpRetriever('pepper');
    const result = await runRealScrape(CompanyTypes.Pepper, credsResult.data, otpRetriever);
    if (!result.success) {
      const message = String(result.errorMessage ?? '');
      expect(message).not.toMatch(/smsAssertionId/i);
      expect(message).not.toMatch(/envelope selector miss/i);
    }
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.accounts).toBeInstanceOf(Array);
  });

  it('TC-E2E-REAL-PEPPER-002 — works with placeholder otpLongTermToken', async () => {
    if (credsResult === null || !credsResult.success) return;
    const otpRetriever = buildStdinOtpRetriever('pepper-placeholder');
    const withPlaceholder: IBankConfig = {
      ...credsResult.data, otpLongTermToken: 'placeholder-not-a-jwt',
    };
    const result = await runRealScrape(CompanyTypes.Pepper, withPlaceholder, otpRetriever);
    if (!result.success) {
      const message = String(result.errorMessage ?? '');
      expect(message).not.toMatch(/otpCodeRetriever/i);
    }
    expect(result.success).toBe(true);
  });
});
