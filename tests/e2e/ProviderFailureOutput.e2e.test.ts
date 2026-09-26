/**
 * E2E: what the operator reads after a bank rejects a login.
 *
 * <p>A failed scrape's message travels from the provider through the scrape
 * stage, the run's metrics and the import history into the log file, the
 * `/logs`, `/scan`, `/retry` and `/status` replies and the Telegram and webhook
 * summaries. Each output that reports the error must show the failure code and
 * the bank's own words, and no output may show a credential the bank's reply
 * quoted, with a key or with none. This suite drives the
 * shipped assembly — the config read by the real `ConfigLoader`, which hands
 * its credentials to the value masker, `buildScrapeStrategy`, `BankScraper`, the real
 * `ProcessAllBanksStep`, `MetricsService`, `AuditLogService` on a temp file,
 * the file logger on a temp directory and the real `TelegramCommandHandler`
 * with a real `ImportMediator` — and reads each output back.
 *
 * <p>Only the boundaries are substituted: `createScraper`, because no real bank
 * can be called from a test; the notifier, which collects the replies instead
 * of calling Telegram; and the mediator's child process, which runs the import
 * in this process and exits non-zero as a failed import does.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigLoader } from '../../src/Config/ConfigLoader.js';
import type { IScrapeStrategyInputs } from '../../src/Importer/PipelineComposition.js';
import { buildScrapeStrategy } from '../../src/Importer/PipelineComposition.js';
import type { ILogger } from '../../src/Logger/ILogger.js';
import { createLogger } from '../../src/Logger/Index.js';
import { BankScraper } from '../../src/Scraper/BankScraper.js';
import { createBankRegistry, DEFAULT_BANK_REGISTRY } from '../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { createDateRangePolicy } from '../../src/Scraper/Policies/DateRangePolicy.js';
import createProcessAllBanksStep from '../../src/Scrapers/Pipeline/Steps/ProcessAllBanksStep.js';
import type { IPipelineContext } from '../../src/Scrapers/Pipeline/Types/PipelineContext.js';
import { ExponentialBackoffRetry } from '../../src/Resilience/RetryStrategy.js';
import { TimeoutWrapper } from '../../src/Resilience/TimeoutWrapper.js';
import { AuditLogService } from '../../src/Services/AuditLogService.js';
import { ImportMediator } from '../../src/Services/ImportMediator.js';
import { MetricsService } from '../../src/Services/MetricsService.js';
import type { INotifier } from '../../src/Services/Notifications/INotifier.js';
import { formatSummaryMessage } from '../../src/Services/Notifications/TelegramFormatter.js';
import { formatWebhookSummary } from '../../src/Services/Notifications/Webhook/Index.js';
import { TelegramCommandHandler } from '../../src/Services/TelegramCommandHandler.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeImporterConfig, fakePipelineConfig } from '../helpers/factories.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** The config entry every run scrapes. */
const ENTRY = 'oneZero';

/** A part of the credential that no output may show, even cut short. */
const SECRET_PART = TEST_CREDENTIAL.slice(TEST_CREDENTIAL.indexOf('-') + 1);

/** The address the config holds for the bank. */
const EMAIL = 'operator@example.com';

/** The phone number the config holds for the bank, in local form. */
const PHONE = '0501234567';

/** Parts of the held credentials that no output may show, in any letter case. */
const HELD_PARTS = [SECRET_PART, EMAIL, PHONE.slice(1)];

/** Env vars the suite rewrites, restored afterwards. */
const TOUCHED_ENV = ['BANK_TOKENS_PATH', 'E2E_MOCK_SCRAPER_DIR', 'E2E_MOCK_SCRAPER_FILE'] as const;

/** A login the bank rejected, as the provider reports it. */
interface IProviderFailure {
  /** The provider's failure code. */
  readonly errorType: string;
  /** The provider's own words, which may quote the bank's reply. */
  readonly errorMessage: string;
  /** What the operator must still read of the provider's words, whole. */
  readonly words: string;
}

/** Everything one failed import wrote or sent, by the output's name. */
type Outputs = Readonly<Record<string, string>>;

/** The provider's 8.7.3 wording for a failed login, one case per shape. */
const FAILURES: readonly [string, IProviderFailure][] = [
  ['a login form error', {
    errorType: 'INVALID_PASSWORD',
    errorMessage: 'Form: Invalid username or code',
    words: 'Form: Invalid username or code',
  }],
  ['an auth API reply that quotes the token', {
    errorType: 'INVALID_PASSWORD',
    errorMessage: `Auth API HTTP 4xx (401): {"idToken":"${TEST_CREDENTIAL}"}`,
    words: 'Auth API HTTP 4xx (401)',
  }],
  ['a login that bounced back with the credential in the address', {
    errorType: 'INVALID_PASSWORD',
    errorMessage: `LOGIN POST: bounced back to login path /login?password=${TEST_CREDENTIAL}`,
    words: 'LOGIN POST: bounced back to login path',
  }],
  ['a login form error that opens with the credential, with no key', {
    errorType: 'INVALID_PASSWORD',
    errorMessage: `${TEST_CREDENTIAL} is not a valid login`,
    words: '[REDACTED] is not a valid login',
  }],
  ['a login form error that quotes the address, with no key', {
    errorType: 'INVALID_PASSWORD',
    errorMessage: `Form: no account for ${EMAIL.toUpperCase()} at this branch`,
    words: 'Form: no account for [REDACTED] at this branch',
  }],
  ['a phone rejection that quotes the number in its wire form', {
    errorType: 'INVALID_PHONE_NUMBER',
    errorMessage: `Unknown phone +972${PHONE.slice(1)} at this bank`,
    words: 'Unknown phone +[REDACTED] at this bank',
  }],
  ['an unusable phone number, whose label hides the reason\'s first word', {
    errorType: 'INVALID_PHONE_NUMBER',
    errorMessage: 'phoneNumber: expected ≥10 digits, got 9 (cannot be normalised to the international-plus wire format)',
    words: 'phoneNumber=[REDACTED] ≥10 digits, got 9',
  }],
];

/** The outputs that report the bank's error, each of which must carry its code and words. */
const ERROR_OUTPUTS = [
  'the log file', 'the /logs reply', 'the import history on disk', 'the /scan reply',
  'the /retry reply', 'the Telegram summary', 'the webhook summary',
] as const;

/** Every output a run writes or sends; `/status` lists runs, not their errors. */
const OUTPUT_NAMES = [...ERROR_OUTPUTS, 'the /status reply'] as const;

/**
 * Makes the fake provider reject the login with the given failure.
 * @param failure - The code and words the provider reports.
 * @returns Nothing.
 */
function providerRejects(failure: IProviderFailure): void {
  provider.createScraper.mockImplementation(() => ({
    /**
     * Reports the rejected login the way the provider does: a resolved result.
     * @returns The failed scrape.
     */
    scrape: (): Promise<IScraperScrapingResult> => Promise.resolve({
      success: false, errorType: failure.errorType, errorMessage: failure.errorMessage,
    } as unknown as IScraperScrapingResult),
  }));
}

/**
 * Builds the shipped scraper with single-attempt resilience.
 * @param logger - Logger the run reports through.
 * @returns The scraper the pipeline calls.
 */
function shippedScraper(logger: ILogger): BankScraper {
  const singleAttempt = new ExponentialBackoffRetry({ maxAttempts: 1, initialBackoffMs: 0 });
  const inputs = {
    config: fakeImporterConfig(),
    resilience: { retryStrategy: singleAttempt, noRetryStrategy: singleAttempt, timeoutWrapper: new TimeoutWrapper() },
    services: { twoFactorPrompter: null, notificationService: { sendMessage: vi.fn() } },
    logger,
  } as unknown as IScrapeStrategyInputs;
  return new BankScraper({
    registry: createBankRegistry(), strategy: buildScrapeStrategy(inputs),
    mapper: createScrapeResultMapper(), datePolicy: createDateRangePolicy(), logger,
  });
}

/**
 * Reads the bank's config the way a run does: from config.json, through the
 * real loader, which hands every credential to the value masker.
 * @param directory - The run's directory, where config.json is written.
 * @returns The bank's config as loaded.
 */
function loadedBankConfig(directory: string): IBankConfig {
  const bankConfig = {
    email: EMAIL, password: TEST_CREDENTIAL, phoneNumber: PHONE, twoFactorAuth: false, daysBack: 7,
  } as IBankConfig;
  const configPath = join(directory, 'config.json');
  writeFileSync(configPath, JSON.stringify(fakeImporterConfig({ banks: { [ENTRY]: bankConfig } })));
  const loaded = new ConfigLoader(configPath).loadRaw();
  if (!loaded.success) throw new Error(`the config did not load: ${loaded.message}`);
  return loaded.data.banks[ENTRY];
}

/** What one import child process runs with. */
interface IImportParts {
  readonly logger: ILogger;
  readonly metrics: MetricsService;
  readonly auditLog: AuditLogService;
  readonly bankConfig: IBankConfig;
}

/**
 * Builds the pipeline context one import child process runs with.
 * @param parts - The run's logger, metrics, import history and bank config.
 * @returns A context for the shipped process-all-banks step.
 */
function importContext(parts: IImportParts): IPipelineContext {
  const { logger, metrics, auditLog, bankConfig } = parts;
  return {
    config: fakePipelineConfig({ banks: { [ENTRY]: bankConfig } }),
    logger,
    shutdownHandler: { isShuttingDown: () => false, onShutdown: vi.fn() },
    services: {
      metricsService: metrics, auditLogService: auditLog, bankScraper: shippedScraper(logger),
      bankRegistry: DEFAULT_BANK_REGISTRY, scrapeResultMapper: createScrapeResultMapper(),
      accountImporter: { processAllAccounts: vi.fn() },
    },
    state: { isDryRun: false, apiInitialized: true, banksProcessed: 0 },
  } as unknown as IPipelineContext;
}

/**
 * Reads every log file the run's file logger wrote.
 * @param logDir - The run's log directory.
 * @returns The files' text, joined.
 */
function logFileText(logDir: string): string {
  return readdirSync(logDir).map(name => readFileSync(join(logDir, name), 'utf8')).join('');
}

/**
 * Runs one failed import through the shipped assembly and collects every
 * output the operator reads.
 * @param directory - A fresh directory for the run's files.
 * @param failureCode - The provider's failure code, which the run logs.
 * @returns Each output's text, by name.
 */
async function runFailedImport(directory: string, failureCode: string): Promise<Outputs> {
  const logDir = join(directory, 'logs');
  const logger = createLogger({ logDir });
  const auditPath = join(directory, 'audit-log.json');
  const auditLog = new AuditLogService(auditPath, 10);
  const metrics = new MetricsService();
  const bankConfig = loadedBankConfig(directory);
  const sent: string[] = [];
  const notifier: INotifier = {
    /**
     * Unused: a command reply never sends a summary.
     * @returns Nothing.
     */
    sendSummary: () => Promise.resolve(),
    /**
     * Unused: a command reply never sends an error alert.
     * @returns Nothing.
     */
    sendError: () => Promise.resolve(),
    /**
     * Collects a reply instead of sending it to Telegram.
     * @param text - The reply.
     * @returns Nothing.
     */
    sendMessage: (text: string): Promise<void> => { sent.push(text); return Promise.resolve(); },
  };
  const mediator = new ImportMediator({
    /**
     * Runs the import child process in this process; it exits 1 on failure.
     * @returns The child's exit code.
     */
    spawnImport: async (): Promise<number> => {
      const outcome = await createProcessAllBanksStep()(importContext({ logger, metrics, auditLog, bankConfig }));
      return outcome.success ? 0 : 1;
    },
    getBankNames: () => [ENTRY], notifier: null,
  });
  const handler = new TelegramCommandHandler({ mediator, notifier, auditLog, logDir, getBankNames: () => [ENTRY] });
  return await collectOutputs({ handler, sent, logDir, auditPath, metrics, failureCode });
}

/** What {@link collectOutputs} reads each output from. */
interface IRunHandles {
  readonly handler: TelegramCommandHandler;
  readonly sent: string[];
  readonly logDir: string;
  readonly auditPath: string;
  readonly metrics: MetricsService;
  /** The provider's failure code, which only the run's failure line holds. */
  readonly failureCode: string;
}

/**
 * Formats the run's summary the way the Telegram and webhook notifiers send it.
 * @param metrics - The run's metrics.
 * @returns Each summary's text, by output name.
 */
function summaries(metrics: MetricsService): Outputs {
  const result = metrics.getSummary();
  if (!result.success) throw new Error(`the run kept no summary: ${result.message}`);
  const opts = { showTransactions: 'none', maxTransactions: 0 } as const;
  return {
    'the Telegram summary': formatSummaryMessage(result.data, 'summary', opts),
    'the webhook summary': formatWebhookSummary('plain', result.data),
  };
}

/**
 * Sends each command in turn and reads every output back.
 *
 * <p>The file logger writes through a stream, so the log file is read once
 * the failure code has reached it. The run logs other warnings first, so any
 * warn-level line is not enough. The summaries are formatted before `/retry`
 * runs the import again.
 * @param run - The run's handler, replies, files, metrics and failure code.
 * @returns Each output's text, by name.
 */
async function collectOutputs(run: IRunHandles): Promise<Outputs> {
  /**
   * Sends one command and collects the replies it sent.
   * @param command - The command text, as the operator types it.
   * @returns The replies, joined.
   */
  const replyTo = async (command: string): Promise<string> => {
    const before = run.sent.length;
    await run.handler.handle(command);
    return run.sent.slice(before).join('\n');
  };
  const scanReply = await replyTo(`/scan ${ENTRY}`);
  await vi.waitFor(() => { expect(logFileText(run.logDir)).toContain(run.failureCode); });
  const summaryOutputs = summaries(run.metrics);
  return {
    'the log file': logFileText(run.logDir),
    'the /logs reply': await replyTo('/logs'),
    'the import history on disk': readFileSync(run.auditPath, 'utf8'),
    'the /scan reply': scanReply,
    ...summaryOutputs,
    'the /retry reply': await replyTo('/retry'),
    'the /status reply': await replyTo('/status'),
  };
}

describe.each(FAILURES)('after %s, every output', (_case, failure) => {
  const originalEnv = new Map(TOUCHED_ENV.map((name) => [name, process.env[name]]));
  let directory = '';
  let outputs: Outputs = {};

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'provider-failure-'));
    process.env.BANK_TOKENS_PATH = join(directory, 'bank-tokens.json');
    delete process.env.E2E_MOCK_SCRAPER_DIR;
    delete process.env.E2E_MOCK_SCRAPER_FILE;
    providerRejects(failure);
    outputs = await runFailedImport(directory, failure.errorType);
  });

  afterAll(() => {
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    createLogger();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(ERROR_OUTPUTS)('%s shows the failure code', (name) => {
    expect(outputs[name]).toContain(failure.errorType);
  });

  it.each(ERROR_OUTPUTS)('%s shows the bank\'s words whole', (name) => {
    expect(outputs[name]).toContain(failure.words);
  });

  it.each(OUTPUT_NAMES)('%s never shows a held credential', (name) => {
    const folded = outputs[name].toLowerCase();
    expect(HELD_PARTS.filter(part => folded.includes(part.toLowerCase()))).toEqual([]);
  });
});
