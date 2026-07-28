/**
 * FallbackOtpPrompter — tries a primary {@link ITwoFactorPrompter} and falls
 * back to a secondary one only when the primary times out (e.g. the user never
 * answers the app OTP), so a 2FA login can still complete via Telegram. Any
 * other primary failure (storage, programming defects) propagates unchanged so
 * a bank OTP is never silently rerouted to a different channel.
 */
import TimeoutError from '../../Errors/TimeoutError.js';
import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { ITwoFactorPrompter } from '../ITwoFactorPrompter.js';

/** Runs a primary OTP prompter and falls back to a secondary on timeout. */
export default class FallbackOtpPrompter implements ITwoFactorPrompter {
  /**
   * Creates a fallback prompter.
   * @param primary - The preferred prompter (tried first).
   * @param fallback - The prompter used when the primary times out.
   */
  constructor(
    private readonly primary: ITwoFactorPrompter,
    private readonly fallback: ITwoFactorPrompter,
  ) {}

  /**
   * Returns an OTP retriever that tries the primary then, on timeout only, the
   * fallback. Non-timeout primary errors are rethrown.
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
        if (!(error instanceof TimeoutError)) {
          throw error;
        }
        const detail = errorMessage(error);
        getLogger().warn(`App OTP timed out for ${bankName}; falling back: ${detail}`);
        const retrieveFallback = this.fallback.createOtpRetriever(bankName, timeoutSeconds);
        return await retrieveFallback();
      }
    };
  }
}
