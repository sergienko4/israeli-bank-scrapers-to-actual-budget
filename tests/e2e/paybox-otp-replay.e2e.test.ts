/**
 * E2E: PayBox OTP replay through the real live-strategy assembly.
 *
 * PayBox's login consumes the delivered SMS digits twice — once for the PIN
 * validation step and once for the SMS sign-in step — so the provider invokes
 * `credentials.otpCodeRetriever` twice per attempt. This suite drives the real
 * production wiring (`initScrape` → `resolveOtpRetriever` → `buildCredentials`)
 * and asserts on the exact callback the provider receives, rather than on an
 * internal helper. It is the end-to-end proof that one login prompts once.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import { initScrape } from '../../src/Scraper/Strategies/Live/ScraperSetup.js';
import type {
  ILiveScrapeDependencies,
  IResolvedLiveOpts,
} from '../../src/Scraper/Strategies/Live/Types.js';
import type { ITwoFactorPrompter } from '../../src/Services/ITwoFactorPrompter.js';
import type { IBankConfig, IImporterConfig } from '../../src/Types/Index.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const SMS_CODE = '482913';

/**
 * Builds a silent logger capturing nothing, so E2E output stays readable.
 * @returns Logger stub satisfying the strategy logger contract.
 */
function silentLogger(): IResolvedLiveOpts['logger'] {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Builds a prompter that records how many times the operator was asked.
 * @param code - Digits the operator supplies when prompted.
 * @returns Prompter plus the spy that counts operator prompts.
 */
function countingPrompter(code = SMS_CODE) {
  const prompt = vi.fn().mockResolvedValue(code);
  /**
   * Mirrors TelegramTwoFactorPrompter.createOtpRetriever.
   * @returns Retriever that prompts the operator on every call.
   */
  const createOtpRetriever = (): (() => Promise<string>) => prompt as () => Promise<string>;
  return { prompter: { createOtpRetriever } as unknown as ITwoFactorPrompter, prompt };
}

/**
 * Builds the strategy dependency bundle around a supplied prompter.
 * @param prompter - Two-factor prompter injected into the strategy.
 * @returns Dependency bundle accepted by initScrape.
 */
function buildDeps(prompter: ITwoFactorPrompter): ILiveScrapeDependencies {
  return {
    config: { banks: {} } as unknown as IImporterConfig,
    retryStrategy: { execute: vi.fn() } as unknown as ILiveScrapeDependencies['retryStrategy'],
    noRetryStrategy: { execute: vi.fn() } as unknown as ILiveScrapeDependencies['noRetryStrategy'],
    timeoutWrapper: { wrap: vi.fn() } as unknown as ILiveScrapeDependencies['timeoutWrapper'],
    twoFactorPrompter: prompter,
    notificationService: {} as unknown as ILiveScrapeDependencies['notificationService'],
  };
}

/**
 * Builds resolved scrape options for a 2FA bank.
 * @param companyType - Provider CompanyTypes value under test.
 * @returns Scrape options accepted by initScrape.
 */
function buildOpts(companyType: CompanyTypes): IResolvedLiveOpts {
  const bankConfig: IBankConfig = {
    phoneNumber: '972501234567', password: TEST_CREDENTIAL,
    twoFactorAuth: true, twoFactorTimeout: 300,
  } as IBankConfig;
  return {
    bankId: String(companyType).toLowerCase(), companyType, bankConfig,
    startDate: new Date('2026-07-01T00:00:00.000Z'), logger: silentLogger(),
  };
}

/**
 * Reads the provider-facing OTP callback out of the built credentials.
 * @param companyType - Provider CompanyTypes value under test.
 * @param prompter - Two-factor prompter injected into the strategy.
 * @returns The callback the provider would invoke during login.
 */
function providerOtpCallback(
  companyType: CompanyTypes, prompter: ITwoFactorPrompter,
): () => Promise<string> {
  const { credentials } = initScrape(buildDeps(prompter), buildOpts(companyType));
  const retriever = (credentials as { otpCodeRetriever?: () => Promise<string> }).otpCodeRetriever;
  if (!retriever) throw new Error('provider credentials carried no otpCodeRetriever');
  return retriever;
}

describe('E2E: PayBox OTP replay', () => {
  it('prompts once even though the login asks for the code twice', async () => {
    const { prompter, prompt } = countingPrompter();

    const retrieve = providerOtpCallback(CompanyTypes.PayBox, prompter);
    const pinStep = await retrieve();
    const smsStep = await retrieve();

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(pinStep).toBe(SMS_CODE);
    expect(smsStep).toBe(SMS_CODE);
  });

  it('serves both concurrent login steps from one prompt', async () => {
    const { prompter, prompt } = countingPrompter();

    const retrieve = providerOtpCallback(CompanyTypes.PayBox, prompter);
    const [pinStep, smsStep] = await Promise.all([retrieve(), retrieve()]);

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(pinStep).toBe(smsStep);
  });

  it('prompts again on the next attempt after the bank rejects the code', async () => {
    const { prompter, prompt } = countingPrompter();

    const firstAttempt = providerOtpCallback(CompanyTypes.PayBox, prompter);
    await firstAttempt();
    await firstAttempt();
    const retryAttempt = providerOtpCallback(CompanyTypes.PayBox, prompter);
    await retryAttempt();

    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('re-prompts within an attempt when the operator never answered', async () => {
    const prompt = vi.fn()
      .mockRejectedValueOnce(new Error('OTP prompt timed out'))
      .mockResolvedValueOnce(SMS_CODE);
    /**
     * Mirrors TelegramTwoFactorPrompter.createOtpRetriever.
     * @returns Retriever that prompts the operator on every call.
     */
    const createOtpRetriever = (): (() => Promise<string>) => prompt as () => Promise<string>;
    const prompter = { createOtpRetriever } as unknown as ITwoFactorPrompter;

    const retrieve = providerOtpCallback(CompanyTypes.PayBox, prompter);

    await expect(retrieve()).rejects.toThrow('OTP prompt timed out');
    await expect(retrieve()).resolves.toBe(SMS_CODE);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it('leaves single-prompt banks prompting per provider request', async () => {
    const { prompter, prompt } = countingPrompter();

    const retrieve = providerOtpCallback(CompanyTypes.OneZero, prompter);
    await retrieve();
    await retrieve();

    expect(prompt).toHaveBeenCalledTimes(2);
  });
});
