/**
 * TwoFactorService - Handles 2FA OTP via Telegram
 * Creates otpCodeRetriever callbacks for banks requiring SMS verification
 */

import { TwoFactorAuthError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type { ITwoFactorPrompter } from './ITwoFactorPrompter.js';
import type TelegramNotifier from './Notifications/TelegramNotifier.js';

/** Handles 2FA OTP collection via Telegram for bank scraping. */
export default class TwoFactorService implements ITwoFactorPrompter {
  private readonly _defaultTimeoutMs: number;

  /**
   * Creates a TwoFactorService using the given Telegram notifier.
   * @param notifier - TelegramNotifier instance used to prompt and wait for OTP replies.
   * @param timeoutSeconds - Default OTP wait timeout in seconds (default 300).
   *                        Per-call timeout via createOtpRetriever overrides this.
   */
  constructor(
    private readonly notifier: TelegramNotifier,
    timeoutSeconds?: number
  ) {
    this._defaultTimeoutMs = (timeoutSeconds ?? 300) * 1000;
  }

  /**
   * Returns an async function that prompts the user for an OTP code via Telegram.
   * @param bankName - Name of the bank displayed in the Telegram prompt.
   * @param timeoutSeconds - Optional per-bank timeout override in seconds.
   * @returns Async function that blocks until an OTP is received and returns the code.
   */
  public createOtpRetriever(
    bankName: string,
    timeoutSeconds?: number,
  ): () => Promise<string> {
    const timeoutMs = timeoutSeconds === undefined
      ? this._defaultTimeoutMs
      : timeoutSeconds * 1000;
    return async () => {
      const reply = await this.waitForOtpReply(bankName, timeoutMs);
      const code = TwoFactorService.extractCode(reply);
      await this.confirmCodeReceived(bankName, code);
      return code;
    };
  }

  /**
   * Prompts the user via Telegram and waits for an OTP reply.
   * @param bankName - Name of the bank displayed in the prompt.
   * @param timeoutMs - Maximum wait time in milliseconds.
   * @returns The raw reply text from the user.
   */
  private async waitForOtpReply(
    bankName: string,
    timeoutMs: number,
  ): Promise<string> {
    getLogger().info(`  🔐 Waiting for OTP code for ${bankName}...`);
    const reply = await this.notifier.waitForReply(
      `🔐 Enter OTP code for <b>${bankName}</b> (check SMS):`,
      timeoutMs
    );
    getLogger().info(`  ✅ OTP received for ${bankName}`);
    return reply;
  }

  /**
   * Logs the code receipt and notifies the user via Telegram.
   * @param bankName - Bank name for the confirmation message.
   * @param code - The extracted OTP code.
   * @returns The OTP code string.
   */
  private async confirmCodeReceived(bankName: string, code: string): Promise<string> {
    const masked = TwoFactorService.maskCode(code);
    getLogger().info(
      `  🔐 Code for ${bankName}: ${masked} (${String(code.length)} digits)`
    );
    await this.notifier.sendMessage(
      `✅ Code received (<code>${masked}</code>) — ` +
      `authenticating with <b>${bankName}</b>...`
    );
    return code;
  }

  /**
   * Returns a masked version of the OTP code showing only first and last digit.
   * @param code - The OTP code string to mask.
   * @returns Masked code like "6****5".
   */
  private static maskCode(code: string): string {
    return code[0] + '*'.repeat(code.length - 2) + (code.at(-1) ?? '');
  }

  /**
   * Strips non-digit characters from a Telegram reply and validates the OTP length.
   * @param message - The raw Telegram reply message to parse.
   * @returns The extracted digit-only OTP code string.
   */
  private static extractCode(message: string): string {
    const digits = message.replaceAll(/\D/g, '');
    if (digits.length < 4 || digits.length > 8) {
      const len = String(digits.length);
      throw new TwoFactorAuthError(
        `Invalid OTP code: expected 4-8 digits, got ${len} digits`
      );
    }
    return digits;
  }
}
