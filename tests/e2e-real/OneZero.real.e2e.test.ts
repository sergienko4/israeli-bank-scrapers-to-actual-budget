/**
 * Real-bank E2E for OneZero — regression guard. OneZero accepts the
 * `+972...` form natively upstream, but the new normalisation in
 * CredentialsBuilder applies to every bank with a phoneNumber. This
 * test proves the normalisation does NOT break OneZero.
 *
 * SKIP-BY-DEFAULT. Requires RUN_REAL_BANK_TESTS=true and
 * ONEZERO_EMAIL + ONEZERO_PASSWORD + ONEZERO_PHONE_NUMBER in .env.e2e
 * (or .env). Never runs in CI.
 */

import { describe, it, expect } from 'vitest';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import {
  buildStdinOtpRetriever, loadOnezeroCreds, realBankTestsEnabled,
} from './Helpers/RealBankEnv.js';
import { runRealScrape } from './Helpers/RunRealScrape.js';

const enabled = realBankTestsEnabled();
const credsResult = enabled ? loadOnezeroCreds() : null;
const shouldRun = enabled && credsResult !== null && credsResult.success;

if (enabled && credsResult !== null && !credsResult.success) {
  console.warn(`[onezero real] skip: ${credsResult.message}`);
}

describe.skipIf(!shouldRun)('OneZero real-creds E2E (regression)', () => {
  it('TC-E2E-REAL-ONEZERO-001 — login still completes after phone normalisation', async () => {
    if (credsResult === null || !credsResult.success) return;
    const otpRetriever = buildStdinOtpRetriever('onezero');
    const result = await runRealScrape(CompanyTypes.OneZero, credsResult.data, otpRetriever);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.accounts).toBeInstanceOf(Array);
  });
});
