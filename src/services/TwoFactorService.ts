/**
 * TwoFactorService - Handles 2FA OTP via Telegram
 * Creates otpCodeRetriever callbacks for banks requiring SMS verification
 */

import { TelegramNotifier } from './notifications/TelegramNotifier.js';

export class TwoFactorService {
  private timeoutMs: number;

  constructor(
    private notifier: TelegramNotifier,
    timeoutSeconds?: number
  ) {
    this.timeoutMs = (timeoutSeconds ?? 300) * 1000;
  }

  createOtpRetriever(bankName: string): () => Promise<string> {
    return async () => {
      const reply = await this.notifier.waitForReply(
        `🔐 Enter OTP code for <b>${bankName}</b> (check SMS):`,
        this.timeoutMs
      );
      return this.extractCode(reply);
    };
  }

  private extractCode(message: string): string {
    const digits = message.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 8) {
      throw new Error(`Invalid OTP code: expected 4-8 digits, got "${digits.length > 0 ? digits : message}"`);
    }
    return digits;
  }
}
