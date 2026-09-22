/**
 * E2E: the long-term token round trip through the real live-strategy assembly.
 *
 * Provider 8.7.2 redacts the durable token from its own logs, so the only way
 * an operator ever benefits from it is if this importer captures it, writes it
 * to disk, and replays it on the next run. This suite drives the real
 * production wiring — `runLiveScrape` → `initScrape` → `BankTokenStore` on a
 * real temp directory — and asserts the outcome the operator actually cares
 * about: the second run sends the token and never asks for an SMS.
 *
 * Only the provider itself is substituted, because no real bank can be called
 * from a test. Everything between that boundary and the file system is the
 * shipped code.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockScraper = { scrape: vi.fn() };
const createScraperSpy = vi.fn((options: unknown) => {
  void options;
  return mockScraper;
});
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: (options: unknown) => createScraperSpy(options) };
});

const { LiveScrapeStrategy } = await import(
  '../../src/Scraper/Strategies/LiveScrapeStrategy.js'
);
const { default: BankTokenStore } = await import(
  '../../src/Scraper/Tokens/BankTokenStore.js'
);
const { fakeImporterConfig } = await import('../helpers/factories.js');

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.ten-year-onezero-id-token.sig';
const REMINTED = 'eyJhbGciOiJSUzI1NiJ9.re-minted-after-cold-login.sig';

let tokensDir = '';
let tokensPath = '';

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const passthrough = {
  execute: async (fn: () => Promise<unknown>): Promise<unknown> => await fn(),
};
const timeoutWrapper = {
  wrap: async (p: Promise<unknown>): Promise<unknown> => await p,
};

/**
 * Builds a strategy sharing one on-disk token store across runs.
 * @returns LiveScrapeStrategy wired to the temp-directory store.
 */
function makeStrategy(): InstanceType<typeof LiveScrapeStrategy> {
  return new LiveScrapeStrategy({
    config: fakeImporterConfig(),
    retryStrategy: passthrough as never,
    noRetryStrategy: passthrough as never,
    timeoutWrapper: timeoutWrapper as never,
    twoFactorPrompter: null,
    notificationService: { sendMessage: vi.fn() } as never,
    bankTokens: new BankTokenStore(),
  });
}

/**
 * Returns the auth-flow callback the importer attached on the latest run.
 *
 * <p>This is the provider's primary delivery route for the durable token and
 * the only one that fires when a warm session is repaired mid-run, so it
 * needs driving directly — the scrape result alone does not exercise it.
 * @returns The attached `onAuthFlowComplete` callback.
 */
function lastAuthFlowHook(): (info: { longTermToken: string; bearer: string }) => Promise<void> {
  const calls = createScraperSpy.mock.calls;
  const last = calls[calls.length - 1];
  const options = (last?.[0] ?? {}) as {
    onAuthFlowComplete?: (info: { longTermToken: string; bearer: string }) => Promise<void>;
  };
  const hook = options.onAuthFlowComplete;
  if (!hook) throw new Error('the importer attached no auth-flow callback');
  return hook;
}

/**
 * Builds scrape options for a OneZero run.
 * @param seed - Optional bootstrap token an operator pasted into config.
 * @param accountKey - Optional `banks` entry name identifying the account.
 * @returns Scrape options accepted by the live strategy.
 */
function oneZeroOpts(seed?: string, accountKey?: string) {
  return {
    bankId: 'oneZero',
    companyType: CompanyTypes.OneZero,
    ...(accountKey === undefined ? {} : { accountKey }),
    bankConfig: {
      id: 'oneZero', email: 'operator@example.com', password: 'pw',
      ...(seed === undefined ? {} : { otpLongTermToken: seed }),
    },
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    logger,
  } as never;
}

/**
 * Reads the credentials the provider was handed on the most recent scrape.
 * @returns The credentials object passed to `scraper.scrape()`.
 */
function lastCredentials(): { otpLongTermToken?: string } {
  const calls = mockScraper.scrape.mock.calls;
  const last = calls[calls.length - 1];
  return (last?.[0] ?? {}) as { otpLongTermToken?: string };
}

describe('long-term token round trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokensDir = mkdtempSync(join(tmpdir(), 'bank-tokens-e2e-'));
    tokensPath = join(tokensDir, 'nested', 'bank-tokens.json');
    process.env.BANK_TOKENS_PATH = tokensPath;
  });

  afterEach(() => {
    delete process.env.BANK_TOKENS_PATH;
    rmSync(tokensDir, { recursive: true, force: true });
  });

  it('captures the token the provider hands back on the first run', async () => {
    mockScraper.scrape.mockImplementation(
      async (_creds: unknown, ...rest: unknown[]) => {
        void rest;
        return { success: true, accounts: [], persistentOtpToken: ID_TOKEN };
      },
    );

    await makeStrategy().scrape(oneZeroOpts());

    const saved = readFileSync(tokensPath, 'utf8');
    expect(saved).toContain(ID_TOKEN);
  });

  it('replays the captured token on the next run, so no SMS is needed', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });
    await makeStrategy().scrape(oneZeroOpts());

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());

    expect(lastCredentials().otpLongTermToken).toBe(ID_TOKEN);
  });

  it('prefers the captured token over a stale seed left in config', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });
    await makeStrategy().scrape(oneZeroOpts('stale-operator-seed'));

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts('stale-operator-seed'));

    expect(lastCredentials().otpLongTermToken).toBe(ID_TOKEN);
  });

  it('never sends a blank stored token in place of a working config seed', async () => {
    mkdirSync(dirname(tokensPath), { recursive: true });
    writeFileSync(tokensPath, JSON.stringify({ banks: { oneZero: { token: '   ' } } }));
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });

    await makeStrategy().scrape(oneZeroOpts('operator-seed'));

    expect(lastCredentials().otpLongTermToken).toBe('operator-seed');
  });

  it('replaces the stored token when a cold login re-mints one', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });
    await makeStrategy().scrape(oneZeroOpts());

    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: REMINTED,
    });
    await makeStrategy().scrape(oneZeroOpts());

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());

    expect(lastCredentials().otpLongTermToken).toBe(REMINTED);
  });

  it('keeps the token file readable only by its owner', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });

    await makeStrategy().scrape(oneZeroOpts());

    expect(statSync(tokensPath).mode % 0o1000).toBe(0o600);
  });

  it('never writes the token into the operator-facing log', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });

    await makeStrategy().scrape(oneZeroOpts());

    const emitted = JSON.stringify([
      ...logger.info.mock.calls, ...logger.warn.mock.calls,
      ...logger.debug.mock.calls, ...logger.error.mock.calls,
    ]);
    expect(emitted).not.toContain(ID_TOKEN);
  });

  it('survives a run that failed, leaving the previous token usable', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });
    await makeStrategy().scrape(oneZeroOpts());

    mockScraper.scrape.mockResolvedValue({
      success: false, errorType: 'GENERIC', errorMessage: 'bank down', accounts: [],
    });
    await makeStrategy().scrape(oneZeroOpts());

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());

    expect(lastCredentials().otpLongTermToken).toBe(ID_TOKEN);
  });

  it('captures the token the provider delivers through the completion callback', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());

    await lastAuthFlowHook()({ longTermToken: ID_TOKEN, bearer: 'session-bearer' });

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());
    expect(lastCredentials().otpLongTermToken).toBe(ID_TOKEN);
  });

  it('never leaks the session bearer the callback carries alongside the token', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts());

    await lastAuthFlowHook()({ longTermToken: ID_TOKEN, bearer: 'session-bearer' });

    const emitted = JSON.stringify([
      ...logger.info.mock.calls, ...logger.warn.mock.calls,
      ...logger.debug.mock.calls, ...logger.error.mock.calls,
    ]);
    expect(emitted).not.toContain('session-bearer');
  });

  it('still returns the transactions when the token store cannot be written', async () => {
    process.env.BANK_TOKENS_PATH = join(tokensDir, 'blocker', 'bank-tokens.json');
    writeFileSync(join(tokensDir, 'blocker'), 'a file where a directory must be');
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });

    const result = await makeStrategy().scrape(oneZeroOpts());

    expect(result.success).toBe(true);
  });

  it('tells the operator why a token could not be stored', async () => {
    process.env.BANK_TOKENS_PATH = join(tokensDir, 'blocker', 'bank-tokens.json');
    writeFileSync(join(tokensDir, 'blocker'), 'a file where a directory must be');
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });

    await makeStrategy().scrape(oneZeroOpts());

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('another SMS'));
  });

  it('keeps two accounts of one bank in separate slots', async () => {
    mockScraper.scrape.mockResolvedValue({
      success: true, accounts: [], persistentOtpToken: ID_TOKEN,
    });
    await makeStrategy().scrape(oneZeroOpts(undefined, 'oneZero'));

    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(oneZeroOpts(undefined, 'onezero'));

    expect(lastCredentials().otpLongTermToken).toBeUndefined();
  });
});