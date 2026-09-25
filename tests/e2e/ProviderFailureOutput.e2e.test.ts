/**
 * E2E: what the operator reads after a bank rejects a login.
 *
 * <p>A failed scrape's message travels from the provider through the scrape
 * stage, the run's metrics and the import history into the log file, the
 * `/logs`, `/scan`, `/retry` and `/status` replies and the Telegram and webhook
 * summaries. Each output that reports the error must show the failure code and
 * the bank's own words, and no output may show a credential the bank's reply
 * quoted. This suite drives the
 * shipped assembly — `buildScrapeStrategy`, `BankScraper`, the real
 * `ProcessAllBanksStep`, `MetricsService`, `AuditLogService` on a temp file,
 * the file logger on a temp directory and the real `TelegramCommandHandler`
 * with a real `ImportMediator` — and reads each output back.
 *
 * <p>Only the boundaries are substituted: `createScraper`, because no real bank
 * can be called from a test; the notifier, which collects the replies instead
 * of calling Telegram; and the mediator's child process, which runs the import
 * in this process and exits non-zero as a failed import does.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

/** Env vars the suite rewrites, restored afterwards. */
const TOUCHED_ENV = ['BANK_TOKENS_PATH', 'E2E_MOCK_SCRAPER_DIR', 'E2E_MOCK_SCRAPER_FILE'] as const;

/** A login the bank rejected, as the provider reports it. */
interface IProviderFailure {
  /** The provider's failure code. */
  readonly errorType: string;
  /** The provider's own words, which may quote the bank's reply. */
  readonly errorMessage: string;
  /** The bank's words the operator must still read, whole. */
  readonly words: string;
}

/** Everything one failed import wrote or sent, by the output's name. */
type Outputs = Readonly<Record<string, string>>;

/** The provider's 8.7 wording for a rejected login, one case per shape. */
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
 * Builds the pipeline context one import child process runs with.
 * @param logger - The run's logger, which writes the log file.
 * @param metrics - The run's metrics.
 * @param auditLog - The import history the run records into.
 * @returns A context for the shipped process-all-banks step.
 */
function importContext(logger: ILogger, metrics: MetricsService, auditLog: AuditLogService): IPipelineContext {
  const bankConfig = {
    email: 'operator@example.com', password: TEST_CREDENTIAL,
    phoneNumber: '0501234567', twoFactorAuth: false, daysBack: 7,
  } as IBankConfig;
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
 * @returns Each output's text, by name.
 */
async function runFailedImport(directory: string): Promise<Outputs> {
  const logDir = join(directory, 'logs');
  const logger = createLogger({ logDir });
  const auditPath = join(directory, 'audit-log.json');
  const auditLog = new AuditLogService(auditPath, 10);
  const metrics = new MetricsService();
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
      const outcome = await createProcessAllBanksStep()(importContext(logger, metrics, auditLog));
      return outcome.success ? 0 : 1;
    },
    getBankNames: () => [ENTRY], notifier: null,
  });
  const handler = new TelegramCommandHandler({ mediator, notifier, auditLog, logDir, getBankNames: () => [ENTRY] });
  return await collectOutputs({ handler, sent, logDir, auditPath, metrics });
}

/** What {@link collectOutputs} reads each output from. */
interface IRunHandles {
  readonly handler: TelegramCommandHandler;
  readonly sent: string[];
  readonly logDir: string;
  readonly auditPath: string;
  readonly metrics: MetricsService;
}

/** A line the run logs at warn or error level, which it writes once the bank has failed. */
const FAILURE_LINE = /"level":[45]0/u;

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
 * the run's failure line has reached it. The summaries are formatted before
 * `/retry` runs the import again.
 * @param run - The run's handler, replies, files and metrics.
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
  await vi.waitFor(() => { expect(logFileText(run.logDir)).toMatch(FAILURE_LINE); });
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
    outputs = await runFailedImport(directory);
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

  it.each(OUTPUT_NAMES)('%s never shows the credential', (name) => {
    expect(outputs[name]).not.toContain(SECRET_PART);
  });
});
