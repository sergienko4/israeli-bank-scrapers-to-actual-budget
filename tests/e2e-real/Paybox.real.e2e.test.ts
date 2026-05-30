/**
 * Real-bank E2E for PayBox — verifies the fix for the production failure:
 *   POST https://apipin.payboxapp.com/api/2.0/phoneValidate 400:
 *     {"errors":"Validation Error"}
 *
 * This test exercises the production CredentialsBuilder → upstream
 * scraper → live PayBox API path, proving the phoneNumber normalisation
 * fix (RC1) sends `972XXXXXXXXX` instead of `+972XXXXXXXXX`.
 *
 * SKIP-BY-DEFAULT. Requires RUN_REAL_BANK_TESTS=true and
 * PAYBOX_PHONE_NUMBER in .env.e2e (or .env). Never runs in CI.
 */

import { describe, it, expect } from 'vitest';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import {
  buildStdinOtpRetriever, loadPayboxCreds, realBankTestsEnabled,
} from './Helpers/RealBankEnv.js';
import { runRealScrape } from './Helpers/RunRealScrape.js';

const enabled = realBankTestsEnabled();
const credsResult = enabled ? loadPayboxCreds() : null;
const shouldRun = enabled && credsResult !== null && credsResult.success;

if (enabled && credsResult !== null && !credsResult.success) {
  console.warn(`[paybox real] skip: ${credsResult.message}`);
}

describe.skipIf(!shouldRun)('PayBox real-creds E2E', () => {
  it('TC-E2E-REAL-PAYBOX-001 — phoneValidate succeeds (no HTTP 400)', async () => {
    if (credsResult === null || !credsResult.success) return;
    const otpRetriever = buildStdinOtpRetriever('paybox');
    const result = await runRealScrape(CompanyTypes.PayBox, credsResult.data, otpRetriever);
    if (!result.success) {
      const message = String(result.errorMessage ?? '');
      expect(message).not.toMatch(/phoneValidate.*400/i);
      expect(message).not.toMatch(/Validation Error/i);
    }
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.accounts).toBeInstanceOf(Array);
  });
});
