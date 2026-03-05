/**
 * TwoFactorService - Handles 2FA OTP via Telegram
 * Creates otpCodeRetriever callbacks for banks requiring SMS verification
 */

import type { TelegramNotifier } from './Notifications/TelegramNotifier.js';
import { getLogger } from '../Logger/Index.js';

/** Handles 2FA OTP collection via Telegram for bank scraping. */
export class TwoFactorService {
  private timeoutMs: number;

  /**
   * Creates a TwoFactorService using the given Telegram notifier.
   * @param notifier - TelegramNotifier instance used to prompt and wait for OTP replies.
   * @param timeoutSeconds - OTP wait timeout in seconds (default 300).
   */
  constructor(
    private notifier: TelegramNotifier,
    timeoutSeconds?: number
  ) {
    this.timeoutMs = (timeoutSeconds ?? 300) * 1000;
  }

  /**
   * Returns an async function that prompts the user for an OTP code via Telegram.
   * @param bankName - Name of the bank displayed in the Telegram prompt.
   * @returns Async function that blocks until an OTP is received and returns the code.
   */
  createOtpRetriever(bankName: string): () => Promise<string> {
    return async () => {
      getLogger().info(`  🔐 Waiting for OTP code for ${bankName}...`);
      const reply = await this.notifier.waitForReply(
        `🔐 Enter OTP code for <b>${bankName}</b> (check SMS):`,
        this.timeoutMs
      );
      getLogger().info(`  ✅ OTP received for ${bankName}`);
      const code = this.extractCode(reply);
      getLogger().info(`  🔐 Code for ${bankName}: ${this.maskCode(code)} (${code.length} digits)`);
      await this.notifier.sendMessage(
        `✅ Code received (<code>${this.maskCode(code)}</code>) — ` +
        `authenticating with <b>${bankName}</b>...`
      );
      return code;
    };
  }

  /**
   * Returns a masked version of the OTP code showing only first and last digit.
   * @param code - The OTP code string to mask.
   * @returns Masked code like "6****5".
   */
  private maskCode(code: string): string {
    return code[0] + '*'.repeat(code.length - 2) + code[code.length - 1];
  }

  /**
   * Strips non-digit characters from a Telegram reply and validates the OTP length.
   * @param message - The raw Telegram reply message to parse.
   * @returns The extracted digit-only OTP code string.
   */
  private extractCode(message: string): string {
    const digits = message.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 8) {
      const got = digits.length > 0 ? digits : message;
      throw new Error(`Invalid OTP code: expected 4-8 digits, got "${got}"`);
    }
    return digits;
  }
}
