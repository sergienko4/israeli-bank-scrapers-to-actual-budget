/**
 * OtpPrompterWiring — selects the two-factor OTP prompter from the importer
 * config and the app-only delivery channel.
 *
 * When the channel is `app`, OTP is collected through the mobile app
 * ({@link AppOtpPrompter}); if Telegram is also configured it wraps both in a
 * {@link FallbackOtpPrompter} so a timed-out app OTP falls back to Telegram.
 * Otherwise the Telegram prompter is used. Isolating this keeps the OTP- and
 * Telegram-specific construction out of the core wiring module.
 */
import type { ITwoFactorPrompter } from '../Services/ITwoFactorPrompter.js';
import ExpoPushNotifier from '../Services/Notifications/ExpoPushNotifier.js';
import TelegramNotifier from '../Services/Notifications/TelegramNotifier.js';
import AppOtpPrompter from '../Services/TwoFactor/AppOtpPrompter.js';
import FallbackOtpPrompter from '../Services/TwoFactor/FallbackOtpPrompter.js';
import OtpRequestStore from '../Services/TwoFactor/OtpRequestStore.js';
import type { OtpChannel } from '../Services/TwoFactor/OtpSettingsStore.js';
import OtpSettingsStore from '../Services/TwoFactor/OtpSettingsStore.js';
import TwoFactorService from '../Services/TwoFactorService.js';
import type { IImporterConfig } from '../Types/Index.js';

/** Selects the OTP prompter for the configured delivery channel. */
export default class OtpPrompterWiring {
  /**
   * Creates the wiring over the OTP settings store.
   * @param settingsStore - The store of the app-only OTP channel setting.
   */
  constructor(private readonly settingsStore: OtpSettingsStore = new OtpSettingsStore()) {}

  /**
   * Resolves the OTP prompter from config and the app-only channel setting.
   * @param config - The importer config (for the Telegram credentials).
   * @returns The selected prompter, or null when none is configured.
   */
  public resolve(config: IImporterConfig): ITwoFactorPrompter | null {
    const telegramCfg = config.notifications?.telegram;
    const telegramNotifier = telegramCfg ? new TelegramNotifier(telegramCfg) : null;
    const telegramPrompter = telegramNotifier ? new TwoFactorService(telegramNotifier) : null;
    if (this.readChannel() !== 'app') {
      return telegramPrompter;
    }
    const requestStore = new OtpRequestStore();
    const pushNotifier = new ExpoPushNotifier();
    const appPrompter = new AppOtpPrompter(requestStore, pushNotifier);
    return telegramPrompter ? new FallbackOtpPrompter(appPrompter, telegramPrompter) : appPrompter;
  }

  /**
   * Reads the configured OTP delivery channel.
   * @returns The channel, defaulting to telegram.
   */
  private readChannel(): OtpChannel {
    const settings = this.settingsStore.get();
    return settings.channel;
  }
}
