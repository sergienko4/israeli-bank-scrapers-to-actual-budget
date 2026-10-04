/**
 * AppOtpPrompter — an {@link ITwoFactorPrompter} that collects a 2FA OTP through
 * the mobile app instead of Telegram.
 *
 * When a bank login needs an OTP, it records a pending request in the shared
 * {@link OtpRequestStore}, pushes a prompt to the registered device(s), then
 * polls the store until the app submits the code (via the portal) or the
 * deadline passes. The store settles the request either way: a code is
 * returned to the scraper, and an expiry refuses any code that comes later.
 * Runs in the import child process; the portal writes the code from another
 * process, so coordination is via the shared file store, never in-memory state.
 */
import TimeoutError from '../../Errors/TimeoutError.js';
import { getLogger } from '../../Logger/Index.js';
import { repeatWhile } from '../../Utils/Index.js';
import type { ITwoFactorPrompter } from '../ITwoFactorPrompter.js';
import type OtpRequestStore from './OtpRequestStore.js';
import type { IOtpRequest, OtpPoll } from './OtpRequestStore.js';

/** Pushes an OTP prompt to the registered devices. Best-effort (never throws). */
export interface IOtpPushSender {
  /**
   * Sends an OTP prompt for a pending request.
   * @param bankId - The bank the OTP is for.
   * @param requestId - The pending OTP request id.
   */
  sendOtpRequest(bankId: string, requestId: string): Promise<void>;
}

/** Tuning options for {@link AppOtpPrompter}. */
export interface IAppOtpOptions {
  /** Default wait timeout when a bank omits one, in seconds. */
  defaultTimeoutSeconds?: number;
  /** How often to poll the store for a submitted code, in milliseconds. */
  pollIntervalMs?: number;
}

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** Collects a 2FA OTP through the mobile app via the shared request store. */
export default class AppOtpPrompter implements ITwoFactorPrompter {
  private readonly _defaultTimeoutSeconds: number;

  private readonly _pollIntervalMs: number;

  /**
   * Creates an app-based OTP prompter.
   * @param store - Shared store of pending OTP requests.
   * @param push - Sends the OTP push prompt to registered devices.
   * @param options - Optional timeout and poll-interval overrides.
   */
  constructor(
    private readonly store: OtpRequestStore,
    private readonly push: IOtpPushSender,
    options: IAppOtpOptions = {},
  ) {
    this._defaultTimeoutSeconds = options.defaultTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Returns an async function that prompts the app for an OTP and waits for it.
   * @param bankName - Bank id shown to the user in the prompt.
   * @param timeoutSeconds - Optional per-bank timeout override in seconds.
   * @returns Async function that blocks until an OTP is received.
   */
  public createOtpRetriever(bankName: string, timeoutSeconds?: number): () => Promise<string> {
    const ttlMs = (timeoutSeconds ?? this._defaultTimeoutSeconds) * 1000;
    return async () => {
      const request = this.store.create(bankName, ttlMs);
      getLogger().info(`  🔐 Waiting for app OTP for ${bankName}...`);
      await this.push.sendOtpRequest(bankName, request.id);
      return await this.waitForCode(bankName, request, ttlMs);
    };
  }

  /**
   * Polls the store until the request is answered or expires.
   * @param bankName - Bank id, for logging.
   * @param request - The pending request (id + deadline).
   * @param ttlMs - Configured timeout, for the TimeoutError message.
   * @returns The submitted OTP code.
   * @throws TimeoutError when the deadline passes without a submitted code.
   * @throws StorageError when the store cannot record the expiry and no code
   *   has arrived.
   */
  private async waitForCode(
    bankName: string, request: IOtpRequest, ttlMs: number,
  ): Promise<string> {
    let polled = this.store.poll(request);
    const repolls = repeatWhile(
      () => polled.kind === 'waiting', () => this.pollAfterInterval(request),
    );
    for await (const next of repolls) polled = next;
    if (polled.kind !== 'code') throw new TimeoutError('App OTP wait', ttlMs);
    getLogger().info(`  ✅ App OTP received for ${bankName}`);
    return polled.code;
  }

  /**
   * Waits one poll interval, then asks the store about the request again.
   * @param request - The pending request (id + deadline).
   * @returns The store's answer: still waiting, the code, or expired.
   */
  private async pollAfterInterval(request: IOtpRequest): Promise<OtpPoll> {
    await AppOtpPrompter.sleep(this._pollIntervalMs);
    return this.store.poll(request);
  }

  /**
   * Resolves after the given delay.
   * @param ms - Delay in milliseconds.
   */
  private static async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, ms);
    });
  }
}
