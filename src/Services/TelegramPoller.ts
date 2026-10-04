/**
 * TelegramPoller — long-poll lifecycle shell.
 *
 * Thin shell around {@link TelegramPollHttp} (HTTP),
 * {@link TelegramUpdateDispatcher} (update routing), and
 * {@link TelegramPollRun} (one run's liveness, error policy and cancellation).
 *
 * A run is superseded when a newer start() or stopAndFlush() replaces it. The
 * /scan import does exactly that while its handler is still running, so the
 * superseded run's cycle settles after the next run has started. It still
 * dispatches the updates it fetched, but it never moves the shared poll offset
 * and never retries: it ends and logs the outcome at debug.
 *
 * Public class API is byte-identical to the pre-PR-7 version.
 */

import { getLogger } from '../Logger/Index.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage, repeatWhile } from '../Utils/Index.js';
import TelegramPollHttp, { type PollOutcome } from './TelegramPollHttp.js';
import type { IRecoveryDecision } from './TelegramPollRecovery.js';
import TelegramPollRun from './TelegramPollRun.js';
import TelegramUpdateDispatcher, {
  type PhotoHandler, type TextHandler,
} from './TelegramUpdateDispatcher.js';

/** Backoff meaning the next poll cycle starts at once. */
const NO_BACKOFF_MS = 0;

/**
 * Describes how a poll settled, for the superseded-run debug line.
 *
 * @param outcome - The settled poll outcome.
 * @returns `data`, `aborted` or `http-<status>`.
 */
function describeOutcome(outcome: PollOutcome): string {
  if (outcome.kind === 'http-error') return `http-${String(outcome.statusCode)}`;
  return outcome.kind;
}

/**
 * Applies a recovery decision: ends the run on fatal or circuit-breaker
 * outcomes, or hands a retry's backoff to the poll loop to wait out.
 *
 * @param run - The run the decision belongs to.
 * @param decision - The classified decision from the run's recovery policy.
 * @returns The retry backoff in milliseconds, or zero once the run is ending.
 */
function backoffFor(run: TelegramPollRun, decision: IRecoveryDecision): number {
  if (decision.outcome === 'retry') return decision.sleepMs;
  run.end();
  return NO_BACKOFF_MS;
}

/**
 * Ends a superseded run's cycle without classifying or retrying it: the run
 * that replaced it owns error handling from here on.
 *
 * @param detail - How the superseded run's last cycle settled.
 * @returns Zero, so the ended run's loop exits without a backoff.
 */
function endSupersededCycle(detail: string): number {
  getLogger().debug(`Telegram poll: superseded run ended (${detail})`);
  return NO_BACKOFF_MS;
}

/** Long-polls the Telegram Bot API for updates and dispatches them to a handler. */
export default class TelegramPoller {
  private readonly _http: TelegramPollHttp;
  private _offset = 0;
  private _run: TelegramPollRun | null = null;
  private _onPhoto?: PhotoHandler;

  /**
   * Creates a TelegramPoller for the given bot and chat.
   *
   * @param botToken - The Telegram Bot API token.
   * @param chatId - The chat ID to filter from.
   * @param onMessage - Async callback for text messages and callback data.
   */
  constructor(
    botToken: string,
    private readonly chatId: string,
    private readonly onMessage: TextHandler
  ) {
    this._http = new TelegramPollHttp(botToken);
  }

  /**
   * Sets an optional photo handler for receipt import.
   *
   * @param handler - Callback invoked with file_id (and optional caption) on photo.
   * @returns Nothing — this is a side-effecting setter.
   */
  public setPhotoHandler(handler: PhotoHandler): void {
    this._onPhoto = handler;
  }

  /**
   * Starts the long-poll loop, blocking until stop() is called.
   * Clears any old pending messages before entering the loop. Supersedes a
   * run that is still in progress.
   *
   * @returns Procedure indicating the poll loop has ended.
   */
  public async start(): Promise<Procedure<{ status: string }>> {
    this._run?.end();
    const run = new TelegramPollRun();
    this._run = run;
    await this.clearOldMessages(run);
    if (!this.isCurrent(run)) return succeed({ status: 'superseded' });
    getLogger().info('🤖 Telegram command listener started');
    return await this.pollLoop(run);
  }

  /**
   * Stops the poll loop and aborts any in-flight HTTP request.
   *
   * @returns Procedure indicating the poller was stopped.
   */
  public stop(): Procedure<{ status: string }> {
    this._run?.stop();
    return succeed({ status: 'stopped' });
  }

  /**
   * Stops the poller and confirms all processed updates with Telegram so a
   * future getUpdates does not replay them.
   *
   * @returns Procedure indicating the flush status.
   */
  public async stopAndFlush(): Promise<Procedure<{ status: string }>> {
    this.stop();
    this._run = null;
    if (this._offset === 0) return succeed({ status: 'nothing-to-flush' });
    return await this._http.flushOffset(this._offset);
  }

  /**
   * Whether the run is still the poller's current run, not superseded.
   *
   * @param run - The run to check.
   * @returns True when no newer start() or stopAndFlush() has replaced it.
   */
  private isCurrent(run: TelegramPollRun): boolean {
    return this._run === run;
  }

  /**
   * Runs poll cycles one at a time until the run ends, backing off
   * (interruptibly) after a failed cycle while the run is still active.
   *
   * @param run - The run this loop belongs to.
   * @returns Procedure indicating the loop has ended.
   */
  private async pollLoop(run: TelegramPollRun): Promise<Procedure<{ status: string }>> {
    const backoffs = repeatWhile(() => run.isActive, () => this.runOnePollCycle(run));
    for await (const backoffMs of backoffs) {
      if (backoffMs > NO_BACKOFF_MS && run.isActive) await run.sleep(backoffMs);
    }
    return succeed({ status: 'stopped' });
  }

  /**
   * Executes one poll cycle: HTTP request + dispatch + error classification.
   *
   * @param run - The run this cycle belongs to.
   * @returns Milliseconds to back off before the next cycle, or zero for none.
   */
  private async runOnePollCycle(run: TelegramPollRun): Promise<number> {
    try {
      const outcome = await run.poll((signal) => this._http.poll(this._offset, signal));
      if (outcome.kind === 'data') await this.dispatchUpdates(run, outcome);
      return this.settleCycle(run, outcome);
    } catch (error: unknown) {
      if (!this.isCurrent(run)) return endSupersededCycle(`error: ${errorMessage(error)}`);
      const decision = run.recovery.onException(error);
      return backoffFor(run, decision);
    }
  }

  /**
   * Classifies a settled poll for the current run; a superseded run just ends.
   *
   * @param run - The run the poll belongs to.
   * @param outcome - The settled poll outcome, already dispatched when data.
   * @returns Milliseconds to back off before the next cycle, or zero for none.
   */
  private settleCycle(run: TelegramPollRun, outcome: PollOutcome): number {
    if (!this.isCurrent(run)) {
      const detail = describeOutcome(outcome);
      return endSupersededCycle(detail);
    }
    if (outcome.kind === 'http-error') {
      const code = String(outcome.statusCode);
      const decision = run.recovery.onHttpError(code);
      return backoffFor(run, decision);
    }
    if (outcome.kind === 'data') run.recovery.reset();
    return NO_BACKOFF_MS;
  }

  /**
   * Dispatches the returned updates to the registered handlers and advances
   * the poll offset.
   *
   * @param run - The run that fetched the updates.
   * @param outcome - The data outcome from a successful poll.
   * @returns Resolves when all updates have been dispatched.
   */
  private async dispatchUpdates(
    run: TelegramPollRun, outcome: PollOutcome & { kind: 'data' }
  ): Promise<Procedure<{ status: string }>> {
    const dispatcher = this.buildDispatcher(run);
    const result = await dispatcher.apply(outcome.data);
    if (result.success && result.data.nextOffset !== undefined) {
      this.recordOffset(run, result.data.nextOffset);
    }
    return succeed({ status: 'dispatched' });
  }

  /**
   * Builds a dispatcher bound to the current handler set.
   *
   * @param run - The run whose start time filters out older messages.
   * @returns A new TelegramUpdateDispatcher instance.
   */
  private buildDispatcher(run: TelegramPollRun): TelegramUpdateDispatcher {
    return new TelegramUpdateDispatcher(this._http, {
      chatId: this.chatId,
      startedAt: run.startedAt,
      onText: this.onMessage,
      onPhoto: this._onPhoto,
    });
  }

  /**
   * Sets the offset to skip all messages that arrived before the bot started.
   * Prevents replaying stale commands from a previous session.
   *
   * @param run - The run that is starting.
   * @returns Procedure indicating the initial offset was set.
   */
  private async clearOldMessages(run: TelegramPollRun): Promise<Procedure<{ status: string }>> {
    const result = await this._http.getInitialOffset();
    if (result.success && result.data.offset !== 0) {
      this.recordOffset(run, result.data.offset);
    }
    return succeed({ status: 'initial-offset-set' });
  }

  /**
   * Records the next offset to poll from, unless the run was superseded: a
   * newer run has already read a later offset from Telegram.
   *
   * @param run - The run reporting the offset.
   * @param offset - One past the last update the run has seen.
   * @returns True when the offset was recorded.
   */
  private recordOffset(run: TelegramPollRun, offset: number): boolean {
    if (!this.isCurrent(run)) return false;
    this._offset = offset;
    return true;
  }
}
