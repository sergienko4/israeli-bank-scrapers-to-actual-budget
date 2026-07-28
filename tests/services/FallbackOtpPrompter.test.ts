import { describe, expect, it, vi } from 'vitest';

import TimeoutError from '../../src/Errors/TimeoutError.js';
import type { ITwoFactorPrompter } from '../../src/Services/ITwoFactorPrompter.js';
import FallbackOtpPrompter from '../../src/Services/TwoFactor/FallbackOtpPrompter.js';

/**
 * Builds a prompter whose retriever resolves the given code.
 * @param code - The code to resolve.
 * @returns A prompter that always resolves the code.
 */
function resolving(code: string): ITwoFactorPrompter {
  return { createOtpRetriever: () => async () => code };
}

/**
 * Builds a prompter whose retriever rejects with the given error.
 * @param error - The error to throw.
 * @returns A prompter that always throws the error.
 */
function rejectingWith(error: Error): ITwoFactorPrompter {
  return {
    createOtpRetriever: () => async () => {
      throw error;
    },
  };
}

/**
 * Builds a prompter that records whether its retriever was created.
 * @param code - The code to resolve when invoked.
 * @returns The prompter plus a spy on retriever creation.
 */
function spying(code: string): { prompter: ITwoFactorPrompter; created: ReturnType<typeof vi.fn> } {
  const created = vi.fn(() => async () => code);
  return { prompter: { createOtpRetriever: created }, created };
}

const timeout = new TimeoutError('App OTP wait', 300_000);

describe('FallbackOtpPrompter', () => {
  it('returns the primary code when the primary succeeds', async () => {
    const prompter = new FallbackOtpPrompter(resolving('111111'), resolving('222222'));
    await expect(prompter.createOtpRetriever('leumi')()).resolves.toBe('111111');
  });

  it('falls back to the secondary when the primary times out', async () => {
    const prompter = new FallbackOtpPrompter(rejectingWith(timeout), resolving('222222'));
    await expect(prompter.createOtpRetriever('leumi')()).resolves.toBe('222222');
  });

  it('propagates a non-timeout primary failure without invoking the fallback', async () => {
    const failure = new Error('store read failed');
    const fallback = spying('222222');
    const prompter = new FallbackOtpPrompter(rejectingWith(failure), fallback.prompter);
    await expect(prompter.createOtpRetriever('leumi')()).rejects.toThrow('store read failed');
    expect(fallback.created).not.toHaveBeenCalled();
  });

  it('propagates a fallback failure when the primary times out and the fallback fails', async () => {
    const prompter = new FallbackOtpPrompter(rejectingWith(timeout), rejectingWith(new Error('telegram failed')));
    await expect(prompter.createOtpRetriever('leumi')()).rejects.toThrow('telegram failed');
  });
});
