/**
 * The teardown contract that replaced an unbounded wait.
 *
 * A CI run of `portal-app-auth` once burned its entire 60s hook budget in
 * `context.close()`: Playwright passes a "wait forever" sentinel to that call,
 * Juggler then waits for a Firefox window destruction with no timeout and no
 * retry, and Firefox is free to decline it. The page in that suite was still
 * navigating, which is the state that makes declining likely.
 *
 * What follows deliberately does NOT claim the hang is gone — that race cannot
 * be summoned on demand (removing the fix and re-running still tears down in
 * ~2.7s), so a green run here would prove nothing about it. It pins down the
 * one guarantee that needs a real browser to verify: that a page carrying a
 * pending navigation is verifiably parked before its context is closed.
 *
 * The deadline mechanics around it — bounding a close, naming a stalled
 * resource, not masking a genuine failure — are covered far more cheaply
 * against a stub in `tests/helpers/Teardown.test.ts`.
 */

import Fastify from 'fastify';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeStep, quiescePage } from '../helpers/teardown.js';
import { launchPortalBrowser } from './helpers/portalHarness.js';

/**
 * A promise that never settles, standing in for a wedged close or a dead route.
 * @returns A promise that stays pending for the life of the test.
 */
async function neverSettles(): Promise<never> {
  return await new Promise<never>(() => {
    // Intentionally empty: the point is that it never resolves.
  });
}

describe('teardown of a page left mid-navigation', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchPortalBrowser();
  }, 120_000);

  afterAll(async () => {
    if (browser) await closeStep('browser', () => browser.close());
  }, 60_000);

  it('parks the page on a blank document before the context is closed', async () => {
    // This mirrors the real failure precisely: a document that has committed
    // and is quietly sitting there, with a cross-document navigation already
    // in flight that will never land. That is the state `app.js` leaves the
    // page in when it calls `window.location.replace`, and the state in which
    // Firefox may decline the window close that `context.close()` waits on.
    const stalled = Fastify();
    stalled.get('/ok', async (_request, reply) =>
      await reply.type('text/html').send('<a id="go" href="/hang">go</a>'));
    stalled.get('/hang', async () => await neverSettles());
    await stalled.listen({ port: 0, host: '127.0.0.1' });
    const port = (stalled.server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    const context = await browser.newContext({ viewport: null });
    try {
      const page = await context.newPage();
      await page.goto(`${base}/ok`);

      const leaving = page.waitForRequest(`${base}/hang`, { timeout: 30_000 });
      // `click()` auto-waits for the navigation it triggers, which by design
      // never lands here; dispatching the event returns as soon as it is sent.
      await page.locator('#go').dispatchEvent('click');
      await leaving;
      // Still on the committed document, with a navigation that cannot finish.
      expect(page.url()).toBe(`${base}/ok`);

      // This is the assertion that discriminates. The close timing below does
      // not: Firefox usually honours the window close even from a navigating
      // page, so a fast teardown here proves nothing. What can be proven is that
      // the page no longer holds the pending navigation that makes Firefox
      // decline in the first place.
      await quiescePage(page);
      expect(page.url()).toBe('about:blank');

      const started = Date.now();
      await closeStep('browser context', () => context.close());
      expect(Date.now() - started).toBeLessThan(20_000);
    } finally {
      // A test about leaking teardown has no business leaking its own fixtures
      // when an assertion above fails. Closing twice is a no-op.
      await closeStep('browser context', () => context.close()).catch(() => undefined);
      await closeStep('stalled server', () => stalled.close()).catch(() => undefined);
    }
  }, 120_000);
});
