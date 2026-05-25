/**
 * MockScrapeStrategy — loads a scrape result from a fixture JSON file.
 *
 * Used by E2E + local mocked test runs. The composition root supplies
 * the directory/file paths via constructor opts — this class does NOT
 * read process.env, isolating env coupling at the wiring layer.
 */

import { existsSync, readFileSync } from 'node:fs';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../Logger/ILogger.js';
import type { IRawScrape, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type {
  IBankScrapeStrategy, IBankScrapeStrategyOpts,
} from './IBankScrapeStrategy.js';

/** Constructor options for MockScrapeStrategy. */
export interface IMockScrapeStrategyOpts {
  /** Directory containing per-bank `<bankId>.json` + `default.json` fixtures. */
  readonly mockDir?: string;
  /** Single mock fixture path used as a global fallback. */
  readonly mockFile?: string;
  /** Logger injected at composition time. */
  readonly logger: ILogger;
}

/** Strategy reading scrape results from JSON fixtures on disk. */
export class MockScrapeStrategy implements IBankScrapeStrategy {
  /**
   * Creates a MockScrapeStrategy with the given fixture sources.
   * @param opts - Directory/file paths and the injected logger.
   */
  constructor(private readonly opts: IMockScrapeStrategyOpts) {}

  /**
   * Resolves the appropriate fixture file and parses it as a scrape result.
   * @param scrapeOpts - Per-scrape inputs including bankId and companyType.
   * @returns Procedure success with an IRawScrape, or failure on missing/invalid mock.
   */
  public scrape(
    scrapeOpts: IBankScrapeStrategyOpts,
  ): Promise<Procedure<IRawScrape>> {
    const file = this.resolveFile(scrapeOpts.bankId);
    if (!file) {
      const inactiveFailure = fail('Mock mode is not active', { status: 'mock-inactive' });
      return Promise.resolve(inactiveFailure);
    }
    this.opts.logger.info(`  🧪 Using mock scraper data from ${file}`);
    const parsed = MockScrapeStrategy.parseMockFile(file);
    if (!parsed.success) {
      const parseFailure = fail(parsed.message, { status: parsed.status });
      return Promise.resolve(parseFailure);
    }
    const envelope = MockScrapeStrategy.envelope(scrapeOpts, parsed.data);
    const ok = succeed(envelope);
    return Promise.resolve(ok);
  }

  /**
   * Builds the IRawScrape envelope around a parsed fixture payload.
   * @param scrapeOpts - Per-scrape inputs supplying bankId + companyType.
   * @param raw - Parsed provider scrape result loaded from disk.
   * @returns IRawScrape envelope with strategy='mock' and attemptCount=1.
   */
  private static envelope(
    scrapeOpts: IBankScrapeStrategyOpts, raw: IScraperScrapingResult,
  ): IRawScrape {
    return {
      bankId: scrapeOpts.bankId, companyType: scrapeOpts.companyType,
      attemptCount: 1, strategy: 'mock', raw,
    };
  }

  /**
   * Resolves which fixture path to use for the given bankId.
   * @param bankId - Canonical bank identifier used for per-bank lookups.
   * @returns Absolute path or empty string when no fixture is configured.
   */
  private resolveFile(bankId: string): string {
    if (this.opts.mockDir) {
      const bankSpecific = `${this.opts.mockDir}/${bankId}.json`;
      if (existsSync(bankSpecific)) return bankSpecific;
      const fallback = `${this.opts.mockDir}/default.json`;
      return existsSync(fallback) ? fallback : '';
    }
    return this.opts.mockFile ?? '';
  }

  /**
   * Reads + validates a mock fixture JSON file.
   * @param filePath - Absolute path to the fixture JSON file.
   * @returns Procedure success with the parsed result, or failure on shape mismatch.
   */
  private static parseMockFile(filePath: string): Procedure<IScraperScrapingResult> {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return MockScrapeStrategy.validateShape(parsed, filePath);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      return fail(
        `Invalid mock scraper file (${filePath}): ${msg}`,
        { status: 'invalid-mock' },
      );
    }
  }

  /**
   * Validates the parsed JSON has the IScraperScrapingResult shape.
   * @param parsed - Result of JSON.parse on the fixture file.
   * @param filePath - Path used to enrich the failure message.
   * @returns Procedure success when the shape matches, failure otherwise.
   */
  private static validateShape(
    parsed: unknown, filePath: string,
  ): Procedure<IScraperScrapingResult> {
    const data = parsed as { success?: boolean; accounts?: unknown[] };
    const hasSuccessFlag = typeof data.success === 'boolean';
    const hasValidAccounts = data.accounts === undefined || Array.isArray(data.accounts);
    if (!hasSuccessFlag || !hasValidAccounts) {
      return fail(
        `Invalid mock scraper file: missing success or accounts (${filePath})`,
        { status: 'invalid-mock' },
      );
    }
    return succeed(data as IScraperScrapingResult);
  }
}
