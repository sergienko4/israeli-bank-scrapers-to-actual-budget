/**
 * ITwoFactorPrompter — abstracts 2FA OTP collection from the scrape strategy.
 *
 * The Scraper layer depends on this interface only; the concrete
 * `TwoFactorService` (which couples to `TelegramNotifier`) is wired by the
 * composition root in `src/Index.ts`. This removes the only cross-layer
 * concrete `new` in the codebase (Pattern D — Surgical Win).
 */
export interface ITwoFactorPrompter {
  /**
   * Returns an async function that resolves an OTP code for the given bank.
   * @param bankName - Bank name displayed to the user in the prompt.
   * @param timeoutSeconds - Optional per-bank timeout override; falls back to
   *                        the prompter's configured default when omitted.
   * @returns Async function that blocks until an OTP code is received.
   */
  createOtpRetriever(
    bankName: string,
    timeoutSeconds?: number,
  ): () => Promise<string>;
}
