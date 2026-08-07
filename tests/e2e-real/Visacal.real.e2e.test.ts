/**
 * Real-bank E2E for VisaCal — reproduces and diagnoses the production failure:
 *   "Hard-model scrape resolved zero accounts — the post-login session is
 *    invalid or the accounts response was rejected"
 *
 * Login reaches the accounts call and the bank then returns no cards, so the
 * failure is a rejected session rather than bad credentials. The provider can
 * say why (login trace plus a screenshot at the point of failure) but only
 * when asked, so run this with LOG_LEVEL=debug to capture that evidence.
 *
 * SKIP-BY-DEFAULT. Requires RUN_REAL_BANK_TESTS=true plus VISACAL_USERNAME
 * and VISACAL_PASSWORD in .env.e2e. Never runs in CI, where credentials come
 * from GitHub Secrets rather than a local file.
 */

import { describe, it, expect } from 'vitest';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import {
  buildStdinOtpRetriever, loadVisacalCreds, realBankTestsEnabled,
} from './Helpers/RealBankEnv.js';
import { runRealScrape } from './Helpers/RunRealScrape.js';

const enabled = realBankTestsEnabled();
const credsResult = enabled ? loadVisacalCreds() : null;
const shouldRun = enabled && credsResult !== null && credsResult.success;

if (enabled && credsResult !== null && !credsResult.success) {
  console.warn(`[visacal real] skip: ${credsResult.message}`);
}

describe.skipIf(!shouldRun)('VisaCal real-creds E2E', () => {
  it('TC-E2E-REAL-VISACAL-001 — resolves at least one account', async () => {
    if (credsResult === null || !credsResult.success) return;
    const otpRetriever = buildStdinOtpRetriever('visacal');
    const result = await runRealScrape(CompanyTypes.VisaCal, credsResult.data, otpRetriever);
    if (!result.success) {
      console.warn(`[visacal real] errorType=${result.errorType}`);
      console.warn(`[visacal real] errorMessage=${result.errorMessage}`);
    }
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.accounts).toBeInstanceOf(Array);
    expect(result.accounts?.length ?? 0).toBeGreaterThan(0);
  }, 600_000);
});
