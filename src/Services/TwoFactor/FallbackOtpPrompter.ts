/**
 * FallbackOtpPrompter — tries a primary {@link ITwoFactorPrompter} and falls
 * back to a secondary one when the primary fails (e.g. the app OTP times out),
 * so a 2FA login can still complete via Telegram.
 */
import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { ITwoFactorPrompter } from '../ITwoFactorPrompter.js';

/** Runs a primary OTP prompter and falls back to a secondary on failure. */
export default class FallbackOtpPrompter implements ITwoFactorPrompter {
  /**
   * Creates a fallback prompter.
   * @param primary - The preferred prompter (tried first).
   * @param fallback - The prompter used when the primary fails.
   */
  constructor(
    private readonly primary: ITwoFactorPrompter,
    private readonly fallback: ITwoFactorPrompter,
  ) {}

  /**
   * Returns an OTP retriever that tries the primary then the fallback.
   * @param bankName - Bank id shown to the user in the prompt.
   * @param timeoutSeconds - Optional per-bank timeout override in seconds.
   * @returns Async function that resolves an OTP from either prompter.
   */
  public createOtpRetriever(bankName: string, timeoutSeconds?: number): () => Promise<string> {
    return async () => {
      const retrievePrimary = this.primary.createOtpRetriever(bankName, timeoutSeconds);
      try {
        return await retrievePrimary();
      } catch (error: unknown) {
        const detail = errorMessage(error);
        getLogger().warn(`App OTP failed for ${bankName}; falling back: ${detail}`);
        const retrieveFallback = this.fallback.createOtpRetriever(bankName, timeoutSeconds);
        return await retrieveFallback();
      }
    };
  }
}
