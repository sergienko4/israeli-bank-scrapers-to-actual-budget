/**
 * Expo push notification channel. Broadcasts a redacted import summary to the
 * mobile app's registered devices via the Expo Push API. Self-noops when no
 * device is registered, and logs (never throws) on failure so a stale token
 * cannot fail an import run.
 */
import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IImportSummary } from '../MetricsService.js';
import DeviceTokenStore from './DeviceTokenStore.js';
import type { INotifier } from './INotifier.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** A single Expo push message. */
interface IExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data?: Record<string, string>;
}

/** Sends import notifications to the mobile app via Expo Push. */
export default class ExpoPushNotifier implements INotifier {
  /**
   * Creates an ExpoPushNotifier over the given token store.
   * @param store - Registry of Expo push tokens (defaults to the shared file).
   */
  constructor(private readonly store: DeviceTokenStore = new DeviceTokenStore()) {}

  /**
   * Sends a redacted import summary to every registered device.
   * @param summary - The import summary.
   */
  public async sendSummary(summary: IImportSummary): Promise<void> {
    const hasFailures = summary.failedBanks > 0;
    const title = hasFailures ? 'Bank import finished with issues' : 'Bank import complete';
    const counts = `${String(summary.successfulBanks)}/${String(summary.totalBanks)} banks`;
    const body = `${counts} · ${String(summary.totalTransactions)} new transactions`;
    await this.send(title, body);
  }

  /**
   * Sends an error notification to every registered device.
   * @param error - The error message.
   */
  public async sendError(error: string): Promise<void> {
    await this.send('Bank import error', error);
  }

  /**
   * Sends a plain message to every registered device.
   * @param text - The message text.
   */
  public async sendMessage(text: string): Promise<void> {
    await this.send('Bank importer', text);
  }

  /**
   * Sends an OTP prompt to every registered device, carrying the request id in
   * the data payload so the app can deep-link straight to the OTP entry screen.
   * @param bankId - The bank the OTP is for.
   * @param requestId - The pending OTP request id.
   */
  public async sendOtpRequest(bankId: string, requestId: string): Promise<void> {
    const body = `Enter the SMS code for ${bankId}`;
    await this.send('OTP required', body, { type: 'otp', requestId, bankId });
  }

  /**
   * Reads the registered tokens and posts one message to each via Expo Push.
   * @param title - Notification title.
   * @param body - Notification body.
   * @param data - Optional data payload delivered with the notification.
   */
  private async send(title: string, body: string, data?: Record<string, string>): Promise<void> {
    const tokens = this.store.list();
    if (tokens.length === 0) return;
    const content = { title, body, data };
    const messages = tokens.map(
      (token): IExpoMessage => ExpoPushNotifier.buildMessage(token, content),
    );
    await ExpoPushNotifier.post(messages);
  }

  /**
   * Builds one Expo push message, attaching the data payload only when present.
   * @param token - The device push token.
   * @param content - The message content.
   * @param content.title - Notification title.
   * @param content.body - Notification body.
   * @param content.data - Optional data payload.
   * @returns The Expo push message.
   */
  private static buildMessage(
    token: string, content: { title: string; body: string; data?: Record<string, string> },
  ): IExpoMessage {
    const base: IExpoMessage = { to: token, title: content.title, body: content.body, sound: 'default' };
    return content.data ? { ...base, data: content.data } : base;
  }

  /**
   * Posts the messages to the Expo Push API, logging (not throwing) on failure.
   * @param messages - The Expo push messages to deliver.
   */
  private static async post(messages: IExpoMessage[]): Promise<void> {
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!response.ok) {
        getLogger().warn(`Expo push failed with status ${String(response.status)}`);
      }
    } catch (error: unknown) {
      getLogger().warn(`Expo push error: ${errorMessage(error)}`);
    }
  }
}
