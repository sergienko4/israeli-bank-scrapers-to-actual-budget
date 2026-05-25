/**
 * MockScrapeStrategy tests — covers fixture path resolution and JSON
 * parsing failure modes previously embedded in BankScraper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

import { MockScrapeStrategy } from '../../../src/Scraper/Strategies/MockScrapeStrategy.js';
import type { IBankScrapeStrategyOpts } from '../../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import { fakeBankConfig } from '../../helpers/factories.js';

vi.mock('node:fs');

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Builds a minimal IBankScrapeStrategyOpts for MockScrapeStrategy tests.
 * @param bankId - Canonical bankId to embed.
 * @returns Opts object suitable for strategy.scrape().
 */
function makeOpts(bankId: string): IBankScrapeStrategyOpts {
  return {
    bankId, companyType: 'discount' as never,
    bankConfig: fakeBankConfig(),
    startDate: new Date(), logger,
  };
}

describe('MockScrapeStrategy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns failure when no mockDir / mockFile is configured', async () => {
    const strategy = new MockScrapeStrategy({ logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain('Mock mode is not active');
  });

  it('reads single mockFile when configured', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      success: true, accounts: [{ accountNumber: '1', balance: 0, txns: [] }],
    }));
    const strategy = new MockScrapeStrategy({ mockFile: '/m/x.json', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.raw.success).toBe(true);
  });

  it('uses per-bank file from mockDir when it exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      success: true, accounts: [],
    }));
    const strategy = new MockScrapeStrategy({ mockDir: '/m', logger });
    await strategy.scrape(makeOpts('discount'));
    expect(fs.readFileSync).toHaveBeenCalledWith('/m/discount.json', 'utf8');
  });

  it('falls back to default.json when per-bank file is missing', async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (p: fs.PathLike) => String(p).endsWith('default.json'),
    );
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      success: true, accounts: [],
    }));
    const strategy = new MockScrapeStrategy({ mockDir: '/m', logger });
    await strategy.scrape(makeOpts('discount'));
    expect(fs.readFileSync).toHaveBeenCalledWith('/m/default.json', 'utf8');
  });

  it('returns failure when both per-bank and default.json are missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const strategy = new MockScrapeStrategy({ mockDir: '/m', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain('Mock mode is not active');
  });

  it('returns failure (no throw) when fixture JSON cannot be parsed', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{not valid json');
    const strategy = new MockScrapeStrategy({ mockFile: '/m/x.json', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe('invalid-mock');
  });

  it('returns failure (no throw) when readFileSync raises', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    const strategy = new MockScrapeStrategy({ mockFile: '/m/x.json', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe('invalid-mock');
  });

  it('returns failure for invalid mock file structure (no throw)', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bad: true }));
    const strategy = new MockScrapeStrategy({ mockFile: '/m/bad.json', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain('Invalid mock scraper file');
      expect(result.status).toBe('invalid-mock');
    }
  });

  it('attaches strategy=mock and attemptCount=1 to IRawScrape', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      success: true, accounts: [],
    }));
    const strategy = new MockScrapeStrategy({ mockFile: '/m/x.json', logger });
    const result = await strategy.scrape(makeOpts('discount'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.strategy).toBe('mock');
    expect(result.data.attemptCount).toBe(1);
  });
});
