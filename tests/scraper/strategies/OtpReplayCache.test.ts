/**
 * OtpReplayCache — regression tests for the PayBox double-OTP prompt.
 *
 * PayBox's upstream login runs `identity.pinValidation` and
 * `identity.loginBySms`, and BOTH carry a `preHook` that awaits
 * `creds.otpCodeRetriever()`. Each hook scrubs the plaintext digits from the
 * flow carry after encrypting them, so upstream calls our retriever twice for
 * the single SMS the bank sent. These tests lock the memoisation that keeps the
 * user prompt to once per scrape attempt.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../../src/Logger/ILogger.js';
import {
  applyOtpReplayCache,
  memoizeOtpRetriever,
  needsOtpReplayCache,
} from '../../../src/Scraper/Strategies/Live/OtpReplayCache.js';
import { resolveOtpRetriever } from '../../../src/Scraper/Strategies/Live/OtpRetriever.js';
import type {
  ILiveScrapeDependencies,
  IOtpRetriever,
  IResolvedLiveOpts,
} from '../../../src/Scraper/Strategies/Live/Types.js';
import { fakeBankConfig } from '../../helpers/factories.js';

/** Deps with no Telegram prompter — the caller-supplied retriever is used as-is. */
const NO_PROMPTER_DEPS = { twoFactorPrompter: null } as unknown as ILiveScrapeDependencies;

/**
 * Builds a minimal ILogger spy for cache tests.
 * @returns Fresh ILogger with vi.fn spies on info/debug/warn/error.
 */
function makeLogger(): ILogger {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Builds resolved live scrape options carrying a caller-supplied retriever.
 * @param companyType - CompanyTypes value for the bank under test.
 * @param otpRetriever - Retriever the caller injected into the scrape.
 * @returns Resolved options accepted by resolveOtpRetriever.
 */
function makeOpts(companyType: string, otpRetriever: IOtpRetriever): IResolvedLiveOpts {
  return {
    bankId: 'paybox', companyType, bankConfig: fakeBankConfig({ twoFactorAuth: true }),
    startDate: new Date(), logger: makeLogger(), otpRetriever,
  } as unknown as IResolvedLiveOpts;
}

describe('OtpReplayCache', () => {
  describe('needsOtpReplayCache', () => {
    it('is enabled for PayBox only', () => {
      expect(needsOtpReplayCache(CompanyTypes.PayBox)).toBe(true);
    });

    it.each([CompanyTypes.OneZero, CompanyTypes.Pepper, 'hapoalim', 'PayBox', ''])(
      'is disabled for %s', (companyId: string) => {
        expect(needsOtpReplayCache(companyId)).toBe(false);
      },
    );
  });

  describe('memoizeOtpRetriever', () => {
    it('prompts once when the provider asks twice in sequence', async () => {
      const inner = vi.fn().mockResolvedValue('123456');
      const memoized = memoizeOtpRetriever(inner, makeLogger());
      const first = await memoized();
      const second = await memoized();
      expect(inner).toHaveBeenCalledTimes(1);
      expect([first, second]).toEqual(['123456', '123456']);
    });

    it('prompts once when both provider steps race', async () => {
      const inner = vi.fn().mockResolvedValue('654321');
      const memoized = memoizeOtpRetriever(inner, makeLogger());
      const codes = await Promise.all([memoized(), memoized()]);
      expect(inner).toHaveBeenCalledTimes(1);
      expect(codes).toEqual(['654321', '654321']);
    });

    it('logs a replay notice instead of re-prompting', async () => {
      const logger = makeLogger();
      const memoized = memoizeOtpRetriever(vi.fn().mockResolvedValue('111111'), logger);
      await memoized();
      await memoized();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Reusing the OTP code'));
    });

    it('re-prompts after a failed retrieval so a timeout is recoverable', async () => {
      const inner = vi.fn()
        .mockRejectedValueOnce(new Error('otp timeout'))
        .mockResolvedValueOnce('222222');
      const memoized = memoizeOtpRetriever(inner, makeLogger());
      await expect(memoized()).rejects.toThrow('otp timeout');
      await expect(memoized()).resolves.toBe('222222');
      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('keeps caches independent across attempts', async () => {
      const inner = vi.fn().mockResolvedValueOnce('333333').mockResolvedValueOnce('444444');
      const logger = makeLogger();
      const firstAttempt = memoizeOtpRetriever(inner, logger);
      const secondAttempt = memoizeOtpRetriever(inner, logger);
      await firstAttempt();
      await expect(secondAttempt()).resolves.toBe('444444');
    });
  });

  describe('applyOtpReplayCache', () => {
    it('returns the retriever untouched for banks that ask once', async () => {
      const inner = vi.fn().mockResolvedValue('555555');
      const wrapped = applyOtpReplayCache(inner, CompanyTypes.OneZero, makeLogger());
      expect(wrapped).toBe(inner);
      await wrapped?.();
      await wrapped?.();
      expect(inner).toHaveBeenCalledTimes(2);
    });

    it('memoizes the retriever for PayBox', async () => {
      const inner = vi.fn().mockResolvedValue('666666');
      const wrapped = applyOtpReplayCache(inner, CompanyTypes.PayBox, makeLogger());
      expect(wrapped).not.toBe(inner);
      await wrapped?.();
      await wrapped?.();
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('passes through when 2FA is disabled and no retriever exists', () => {
      expect(applyOtpReplayCache(undefined, CompanyTypes.PayBox, makeLogger())).toBeUndefined();
    });
  });

  describe('resolveOtpRetriever wiring', () => {
    it('memoizes a caller-supplied retriever for PayBox', async () => {
      const inner = vi.fn().mockResolvedValue('777777');
      const resolved = resolveOtpRetriever(NO_PROMPTER_DEPS, makeOpts(CompanyTypes.PayBox, inner));
      await resolved?.();
      await resolved?.();
      expect(inner).toHaveBeenCalledTimes(1);
    });

    it('leaves a caller-supplied retriever alone for other banks', async () => {
      const inner = vi.fn().mockResolvedValue('888888');
      const resolved = resolveOtpRetriever(NO_PROMPTER_DEPS, makeOpts(CompanyTypes.OneZero, inner));
      await resolved?.();
      await resolved?.();
      expect(inner).toHaveBeenCalledTimes(2);
    });
  });
});
