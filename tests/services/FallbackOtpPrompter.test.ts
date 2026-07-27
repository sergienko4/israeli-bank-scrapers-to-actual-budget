import { describe, expect, it } from 'vitest';

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
 * Builds a prompter whose retriever always rejects.
 * @returns A prompter that always throws.
 */
function rejecting(): ITwoFactorPrompter {
  return {
    createOtpRetriever: () => async () => {
      throw new Error('primary failed');
    },
  };
}

describe('FallbackOtpPrompter', () => {
  it('returns the primary code when the primary succeeds', async () => {
    const prompter = new FallbackOtpPrompter(resolving('111111'), resolving('222222'));
    await expect(prompter.createOtpRetriever('leumi')()).resolves.toBe('111111');
  });

  it('falls back to the secondary when the primary fails', async () => {
    const prompter = new FallbackOtpPrompter(rejecting(), resolving('222222'));
    await expect(prompter.createOtpRetriever('leumi')()).resolves.toBe('222222');
  });

  it('propagates a fallback failure when both fail', async () => {
    const prompter = new FallbackOtpPrompter(rejecting(), rejecting());
    await expect(prompter.createOtpRetriever('leumi')()).rejects.toThrow();
  });
});
