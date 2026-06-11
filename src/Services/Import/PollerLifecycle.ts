/**
 * PollerLifecycle — owns the TelegramPoller pause/resume state machine.
 *
 * Extracted from ImportMediator so the {idle → stopped → resumed}
 * transition (plus its "poller not yet set" / "already stopped"
 * guards) lives in one place. The orchestrator no longer needs to
 * carry `_poller` and `_pollerStopped` fields — it just calls
 * lifecycle.setPoller(...), lifecycle.stop(), and lifecycle.resume().
 *
 * Returns Procedure<{ status }> per P1 so the caller can distinguish
 * `no-poller` / `already-stopped` / `stopped` / `poller-resumed`
 * outcomes explicitly.
 *
 * The poller resume is intentionally fire-and-forget (background
 * Promise) because handleQueueEmpty is called synchronously from the
 * ImportQueue drain callback — awaiting it would re-enter the queue
 * and dead-lock. The .catch logs the failure so it is never silent.
 */

import { getLogger } from '../../Logger/Index.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type TelegramPoller from '../TelegramPoller.js';

/** Manages start/stop lifecycle of an injected TelegramPoller. */
export default class PollerLifecycle {
  private _poller: TelegramPoller | null = null;
  private _stopped = false;

  /**
   * Binds the lifecycle to a concrete TelegramPoller instance.
   * Must be called once after construction (the poller is created
   * after the mediator).
   * @param poller - The TelegramPoller to manage.
   * @returns Procedure indicating the poller was set.
   */
  public setPoller(poller: TelegramPoller): Procedure<{ status: string }> {
    this._poller = poller;
    return succeed({ status: 'poller-set' });
  }

  /**
   * Stops the poller before an import begins. Idempotent — repeated
   * calls before resume() do nothing.
   * @returns Procedure with status `no-poller`, `already-stopped`, or `stopped`.
   */
  public async stop(): Promise<Procedure<{ status: string }>> {
    if (!this._poller) return succeed({ status: 'no-poller' });
    if (this._stopped) return succeed({ status: 'already-stopped' });
    this._stopped = true;
    await this._poller.stopAndFlush();
    return succeed({ status: 'stopped' });
  }

  /**
   * Resumes the poller after the queue drains. Fire-and-forget on
   * the resume Promise to avoid dead-locking the queue-empty
   * callback.
   * @returns Procedure with status `no-poller` or `poller-resumed`.
   */
  public resume(): Procedure<{ status: string }> {
    if (!this._stopped || !this._poller) {
      return succeed({ status: 'no-poller' });
    }
    this._stopped = false;
    this._poller.start().catch((err: unknown) => {
      getLogger().error(
        `Failed to resume poller: ${errorMessage(err)}`
      );
    });
    return succeed({ status: 'poller-resumed' });
  }
}
