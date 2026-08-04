/**
 * BrowserRegistry tests — proves abandoned provider browsers are reclaimed.
 *
 * Production incident: a timed-out scrape left its Camoufox process running,
 * every retry launched another, and the importer grew to ~22 GB RSS until the
 * host wedged. These tests pin the reclamation contract that prevents it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  BrowserRegistry,
  BROWSER_CLOSE_TIMEOUT_MS,
  type IProviderBrowser,
} from '../../../src/Scraper/Strategies/Live/BrowserRegistry.js';

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

/**
 * Builds a fake browser that reports connected until close() resolves.
 * @returns Fake browser handle usable as a provider browser.
 */
function fakeBrowser() {
  let connected = true;
  return {
    isConnected: vi.fn((): boolean => connected),
    close: vi.fn(async (): Promise<void> => {
      connected = false;
      await Promise.resolve();
    }),
  };
}


describe('BrowserRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts any handle matching the provider browser contract', () => {
    const contract: IProviderBrowser = fakeBrowser();
    expect(contract.isConnected()).toBe(true);
  });

  it('reports the number of browsers tracked after each registration', () => {
    const registry = new BrowserRegistry();
    expect(registry.register(fakeBrowser())).toBe(1);
    expect(registry.register(fakeBrowser())).toBe(2);
  });

  it('tracks a browser only once when registered twice', () => {
    const registry = new BrowserRegistry();
    const browser = fakeBrowser();
    registry.register(browser);
    expect(registry.register(browser)).toBe(1);
  });

  it('closes every still-connected browser and reports the count', async () => {
    const registry = new BrowserRegistry();
    const [first, second] = [fakeBrowser(), fakeBrowser()];
    registry.register(first);
    registry.register(second);

    const reclaimed = await registry.closeAll(logger);

    expect(reclaimed).toBe(2);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
  });

  it('skips browsers the provider already closed', async () => {
    const registry = new BrowserRegistry();
    const alreadyClosed = fakeBrowser();
    alreadyClosed.isConnected.mockReturnValue(false);
    registry.register(alreadyClosed);

    const reclaimed = await registry.closeAll(logger);

    expect(reclaimed).toBe(0);
    expect(alreadyClosed.close).not.toHaveBeenCalled();
  });

  it('counts only the leaked browsers when the provider closed some itself', async () => {
    const registry = new BrowserRegistry();
    const leaked = fakeBrowser();
    const closedByProvider = fakeBrowser();
    closedByProvider.isConnected.mockReturnValue(false);
    registry.register(leaked);
    registry.register(closedByProvider);

    expect(await registry.closeAll(logger)).toBe(1);
  });

  it('forgets browsers so a second reclaim finds nothing to close', async () => {
    const registry = new BrowserRegistry();
    const browser = fakeBrowser();
    registry.register(browser);

    await registry.closeAll(logger);

    expect(await registry.closeAll(logger)).toBe(0);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('returns zero when no browser was ever registered', async () => {
    expect(await new BrowserRegistry().closeAll(logger)).toBe(0);
  });

  it('absorbs a failing close and warns instead of throwing', async () => {
    const registry = new BrowserRegistry();
    const broken = fakeBrowser();
    broken.close.mockRejectedValue(new Error('browser already gone'));
    registry.register(broken);

    const reclaimed = await registry.closeAll(logger);

    expect(reclaimed).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('browser already gone'));
  });

  it('still closes healthy browsers when one of them fails to close', async () => {
    const registry = new BrowserRegistry();
    const broken = fakeBrowser();
    broken.close.mockRejectedValue(new Error('boom'));
    const healthy = fakeBrowser();
    registry.register(broken);
    registry.register(healthy);

    expect(await registry.closeAll(logger)).toBe(1);
    expect(healthy.close).toHaveBeenCalledOnce();
  });
});

describe('BrowserRegistry cleanup race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Builds a browser whose close blocks until the returned release is called.
   * @returns The browser handle plus the function that completes its close.
   */
  function blockingBrowser() {
    const browser = fakeBrowser();
    let release = (): void => undefined;
    browser.close.mockReturnValue(
      new Promise<void>((resolve) => {
        release = (): void => { resolve(); };
      }));
    return { browser, release: (): void => { release(); } };
  }

  it('closes a browser the provider launches while cleanup is in flight', async () => {
    const registry = new BrowserRegistry();
    const slow = blockingBrowser();
    registry.register(slow.browser);

    const pending = registry.closeAll(logger);
    const late = fakeBrowser();
    registry.register(late);
    slow.release();
    await pending;

    expect(late.close).toHaveBeenCalledOnce();
  });

  it('counts a browser registered mid-cleanup in the reclaimed total', async () => {
    const registry = new BrowserRegistry();
    const slow = blockingBrowser();
    registry.register(slow.browser);

    const pending = registry.closeAll(logger);
    registry.register(fakeBrowser());
    slow.release();

    expect(await pending).toBe(2);
  });

  it('leaves nothing tracked after a browser arrives mid-cleanup', async () => {
    const registry = new BrowserRegistry();
    const slow = blockingBrowser();
    registry.register(slow.browser);

    const pending = registry.closeAll(logger);
    registry.register(fakeBrowser());
    slow.release();
    await pending;

    expect(await registry.closeAll(logger)).toBe(0);
  });

  it('tracks browsers normally again once cleanup has finished', async () => {
    const registry = new BrowserRegistry();
    await registry.closeAll(logger);

    const next = fakeBrowser();

    expect(registry.register(next)).toBe(1);
    expect(next.close).not.toHaveBeenCalled();
  });
});

describe('BrowserRegistry seal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('closes the browsers tracked when the attempt is sealed', async () => {
    const registry = new BrowserRegistry();
    const live = fakeBrowser();
    registry.register(live);

    expect(await registry.seal(logger)).toBe(1);
    expect(live.close).toHaveBeenCalledOnce();
  });

  it('closes a browser the abandoned scrape launches after the attempt ends', async () => {
    const registry = new BrowserRegistry();
    await registry.seal(logger);

    const stray = fakeBrowser();
    registry.register(stray);

    expect(stray.close).toHaveBeenCalledOnce();
  });

  it('never tracks a browser that arrives after the attempt ends', async () => {
    const registry = new BrowserRegistry();
    await registry.seal(logger);

    expect(registry.register(fakeBrowser())).toBe(0);
  });

  it('keeps refusing browsers even after a later cleanup runs', async () => {
    const registry = new BrowserRegistry();
    await registry.seal(logger);
    await registry.closeAll(logger);

    const stray = fakeBrowser();
    registry.register(stray);

    expect(stray.close).toHaveBeenCalledOnce();
  });
});

describe('BrowserRegistry deadline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('abandons a wedged close so cleanup cannot stall the import', async () => {
    const registry = new BrowserRegistry();
    const wedged = fakeBrowser();
    wedged.close.mockReturnValue(new Promise<void>(() => undefined));
    registry.register(wedged);

    const pending = registry.closeAll(logger);
    await vi.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS + 1);

    expect(await pending).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });
});
