/**
 * Tracks provider browsers so abandoned scrapes release their native memory.
 *
 * A scrape is time-boxed with `Promise.race`, which abandons the losing promise
 * instead of cancelling it. The provider therefore keeps its Camoufox process
 * alive after a timeout, and every retry launches another one. Registering each
 * launched browser lets an attempt close whatever the provider left behind.
 * @internal
 */

import type { ILogger } from '../../../Logger/ILogger.js';
import { TimeoutWrapper } from '../../../Resilience/TimeoutWrapper.js';
import { errorMessage } from '../../../Utils/Index.js';

/**
 * Minimal provider browser surface needed to reclaim a leaked instance.
 * Declared structurally so production code never depends on playwright-core
 * types, while staying assignable from the provider's Playwright `Browser`.
 */
export interface IProviderBrowser {
  isConnected(): boolean;
  close(): Promise<void>;
}

/** Upper bound on one browser close so a wedged browser cannot stall an import. */
export const BROWSER_CLOSE_TIMEOUT_MS = 15_000;

/** Deadline applied to each close so cleanup can never block the pipeline. */
const CLOSE_DEADLINE = new TimeoutWrapper();

/**
 * Closes a browser the provider left running, absorbing cleanup failures.
 * Already-disconnected browsers are skipped so the caller can distinguish a
 * genuine leak from the normal path where the provider closed its own browser.
 * @param browser - Provider browser handle to close.
 * @param logger - Logger used to report a failed or stalled close.
 * @returns True when a still-connected browser was closed by this call.
 */
async function closeQuietly(browser: IProviderBrowser, logger: ILogger): Promise<boolean> {
  if (!browser.isConnected()) return false;
  const closing = browser.close();
  const deadline = CLOSE_DEADLINE.wrap(closing, BROWSER_CLOSE_TIMEOUT_MS, 'Closing browser');
  return await deadline.then(() => true, (error: unknown) => reportCloseFailure(error, logger));
}

/**
 * Reports a browser that refused to close so the operator can investigate.
 * @param error - Failure raised by the close attempt or by its deadline.
 * @param logger - Logger used to surface the warning.
 * @returns False, signalling the browser was not reclaimed.
 */
function reportCloseFailure(error: unknown, logger: ILogger): boolean {
  logger.warn(`  ⚠️  Failed to close abandoned browser: ${errorMessage(error)}`);
  return false;
}

/** Collects live provider browsers so a single attempt can reclaim all of them. */
export class BrowserRegistry {
  private readonly _live = new Set<IProviderBrowser>();

  /** Logger of the cleanup in flight; non-null only while `closeAll` runs. */
  private _cleanup: ILogger | null = null;

  /** Logger kept once the attempt is over; non-null from `seal` onwards. */
  private _sealed: ILogger | null = null;

  /** Closes already started for browsers that arrived after cleanup began. */
  private _lateCloses: Promise<boolean>[] = [];

  /**
   * Records a browser the provider has just launched.
   *
   * A browser that arrives while cleanup is running, or after the attempt has
   * been sealed, is closed at once rather than tracked. An abandoned scrape
   * keeps launching browsers after its deadline fires, and once the attempt is
   * over no later cleanup exists to collect them.
   * @param browser - Provider browser handle to track.
   * @returns Number of browsers currently tracked.
   */
  public register(browser: IProviderBrowser): number {
    const closer = this._cleanup ?? this._sealed;
    if (closer !== null) return this.closeDuringCleanup(browser, closer);
    this._live.add(browser);
    return this._live.size;
  }

  /**
   * Closes and forgets every tracked browser.
   * @param logger - Logger used to report browsers that were still running.
   * @returns Number of browsers that were still connected and had to be closed.
   */
  public async closeAll(logger: ILogger): Promise<number> {
    const browsers = [...this._live];
    this._live.clear();
    this._cleanup = logger;
    try {
      return await this.closeSnapshot(browsers, logger);
    } finally {
      this._cleanup = null;
    }
  }

  /**
   * Closes every tracked browser and refuses to track any more.
   *
   * `closeAll` runs after every retry, so it cannot latch — the next retry has
   * to be able to track its own browsers. Sealing marks the point where no
   * further retry follows, so a browser an abandoned scrape launches from here
   * on is closed on arrival instead of outliving the import.
   * @param logger - Logger used to report browsers that were still running.
   * @returns Number of browsers that were still connected and had to be closed.
   */
  public async seal(logger: ILogger): Promise<number> {
    this._sealed = logger;
    return await this.closeAll(logger);
  }

  /**
   * Closes the snapshot cleanup captured, then drains anything that arrived after.
   * @param browsers - Browsers tracked when cleanup started.
   * @param logger - Logger used to report a failed or stalled close.
   * @returns Number of browsers that were still connected and had to be closed.
   */
  private async closeSnapshot(
    browsers: IProviderBrowser[], logger: ILogger
  ): Promise<number> {
    const closing = browsers.map((b) => closeQuietly(b, logger));
    const closed = await Promise.all(closing);
    const late = await this.drainLateCloses();
    return closed.filter(Boolean).length + late;
  }

  /**
   * Closes a browser that appeared after cleanup took its snapshot.
   *
   * Only a cleanup in flight waits for the close; one that arrives after the
   * attempt was sealed is closed without being queued, so a long-lived registry
   * cannot accumulate settled promises.
   * @param browser - Provider browser handle that arrived too late to track.
   * @param logger - Logger used to report a failed or stalled close.
   * @returns Number of browsers still tracked, which this browser never joins.
   */
  private closeDuringCleanup(browser: IProviderBrowser, logger: ILogger): number {
    const closing = closeQuietly(browser, logger);
    if (this._cleanup !== null) this._lateCloses.push(closing);
    return this._live.size;
  }

  /**
   * Awaits every late close, including any a late close itself triggers.
   * @returns Number of late browsers that were still connected when closed.
   */
  private async drainLateCloses(): Promise<number> {
    const pending = this._lateCloses;
    if (pending.length === 0) return 0;
    this._lateCloses = [];
    const closed = await Promise.all(pending);
    const nested = await this.drainLateCloses();
    return closed.filter(Boolean).length + nested;
  }
}
