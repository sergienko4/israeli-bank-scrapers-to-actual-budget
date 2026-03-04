/**
 * TwoFactorService - Handles 2FA OTP via Telegram
 * Creates otpCodeRetriever callbacks for banks requiring SMS verification
 */

import { TelegramNotifier } from './Notifications/TelegramNotifier.js';
import { getLogger } from '../Logger/Index.js';

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

  private maskCode(code: string): string {
    return code[0] + '*'.repeat(code.length - 2) + code[code.length - 1];
  }

  private extractCode(message: string): string {
    const digits = message.replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 8) {
      const got = digits.length > 0 ? digits : message;
      throw new Error(`Invalid OTP code: expected 4-8 digits, got "${got}"`);
    }
    return digits;
  }
}
