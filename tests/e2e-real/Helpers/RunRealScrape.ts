/**
 * Drives a real-bank scrape through the production CredentialsBuilder so
 * the phoneNumber normalisation fix is exercised end-to-end against the
 * live bank API. Used by every *.real.e2e.test.ts file.
 */

import type { CompanyTypes, IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { createScraper } from '@sergienko4/israeli-bank-scrapers';

import buildCredentials from '../../../src/Scraper/CredentialsBuilder.js';
import type { IBankConfig } from '../../../src/Types/Index.js';

const DAYS_BACK = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Runs a real bank scrape using the production CredentialsBuilder and the
 * given OTP retriever. Returns the raw provider result so callers can
 * inspect success/errorType for fix-validation assertions.
 * @param companyType - CompanyTypes value (PayBox / Pepper / OneZero).
 * @param bankConfig - Loaded bank config including phoneNumber.
 * @param otpRetriever - Async OTP retriever (typically readline-based).
 * @returns Provider scrape result for assertion.
 */
export async function runRealScrape(
  companyType: CompanyTypes,
  bankConfig: IBankConfig,
  otpRetriever: () => Promise<string>,
): Promise<IScraperScrapingResult> {
  const startDate = new Date(Date.now() - DAYS_BACK * MS_PER_DAY);
  const scraper = createScraper({
    companyId: companyType,
    startDate,
    args: [],
    defaultTimeout: 120_000,
  });
  const credentials = buildCredentials(bankConfig, otpRetriever);
  return await scraper.scrape(credentials);
}
