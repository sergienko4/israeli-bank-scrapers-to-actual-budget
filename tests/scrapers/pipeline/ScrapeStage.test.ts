/**
 * ScrapeStage — provider failure adaptation.
 *
 * The provider reports a failed scrape as a RESOLVED result carrying both an
 * errorType (the machine-readable bucket) and an errorMessage (free prose).
 * Only the message survived into the quarantine entry, and
 * TelegramCommandFormatters looks up operator advice from that entry's message
 * alone — so every code-keyed advice entry was unreachable in production.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it } from 'vitest';

import { isFail } from '../../../src/Scrapers/Pipeline/Index.js';
import scrapeStage from '../../../src/Scrapers/Pipeline/Steps/Bank/ScrapeStage.js';
import type { IBankOpts } from '../../../src/Scrapers/Pipeline/Steps/Bank/Shared.js';

/**
 * Builds the minimal IBankOpts scrapeStage actually reads.
 * @param result - Provider result the stubbed scraper resolves with.
 * @returns Opts object shaped for scrapeStage.
 */
function buildOpts(result: IScraperScrapingResult): IBankOpts {
  const bankScraper = {
    scrapeBankWithResilience: (): Promise<IScraperScrapingResult> => Promise.resolve(result),
  };
  const opts = {
    entry: { bankName: 'discount', bankConfig: {} },
    ctx: { services: { bankScraper } },
    start: 0,
  };
  return opts as unknown as IBankOpts;
}

/**
 * Runs scrapeStage and returns the quarantine message for a failed scrape.
 * @param result - Provider result the stubbed scraper resolves with.
 * @returns The failure message carried on the Procedure.
 */
async function failureMessageFor(result: IScraperScrapingResult): Promise<string> {
  const outcome = await scrapeStage(buildOpts(result));
  if (!isFail(outcome)) throw new Error('expected scrapeStage to fail');
  return outcome.message;
}

describe('scrapeStage provider failure adaptation', () => {
  it('keeps the provider error type reachable for advice lookup', async () => {
    const message = await failureMessageFor({
      success: false, errorType: 'GENERIC',
      errorMessage: 'navigation timed out', accounts: [],
    } as unknown as IScraperScrapingResult);

    expect(message).toContain('GENERIC');
    expect(message).toContain('navigation timed out');
  });

  it('preserves the error carried on the failure so quarantine advice sees the type', async () => {
    const outcome = await scrapeStage(buildOpts({
      success: false, errorType: 'ACCOUNT_BLOCKED',
      errorMessage: 'user is locked', accounts: [],
    } as unknown as IScraperScrapingResult));

    if (!isFail(outcome)) throw new Error('expected scrapeStage to fail');
    expect(outcome.error?.message).toContain('ACCOUNT_BLOCKED');
  });

  it('does not repeat a type the provider already spelled out in its message', async () => {
    const message = await failureMessageFor({
      success: false, errorType: 'GENERIC',
      errorMessage: 'GENERIC: bank edge served an error document', accounts: [],
    } as unknown as IScraperScrapingResult);

    expect(message).toBe('GENERIC: bank edge served an error document');
  });

  it('falls back to the bare message when the provider reports no type', async () => {
    const message = await failureMessageFor({
      success: false, errorType: undefined,
      errorMessage: 'Unknown bank: nope', accounts: [],
    } as unknown as IScraperScrapingResult);

    expect(message).toBe('Unknown bank: nope');
  });
});
