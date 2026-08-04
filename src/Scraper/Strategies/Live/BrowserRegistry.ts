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

  /**
   * Records a browser the provider has just launched.
   * @param browser - Provider browser handle to track.
   * @returns Number of browsers currently tracked.
   */
  public register(browser: IProviderBrowser): number {
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
    const closing = browsers.map((b) => closeQuietly(b, logger));
    const closed = await Promise.all(closing);
    return closed.filter(Boolean).length;
  }
}
