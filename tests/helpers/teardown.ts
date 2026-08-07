/**
 * Bounded teardown primitives for the browser-backed e2e suites.
 *
 * Playwright's close path has no clock anywhere in it: `close()` accepts only a
 * `reason`, and internally passes a sentinel meaning "wait forever". Whether the
 * wait ever ends is decided by Firefox, which is free to silently decline. That
 * left the test runner's hook timeout as the only bound in the entire stack, so
 * a declined close surfaced as an anonymous timeout with no clue as to which
 * resource was stuck. These two helpers put the clock back.
 *
 * They live outside `tests/e2e/helpers` deliberately: keeping them free of the
 * browser-launch import graph is what lets them be unit-tested against a stub.
 */

import type { Page } from 'playwright-core';

/** How long a page gets to reach a blank document before teardown gives up. */
export const QUIESCE_MS = 10_000;

/** How long any single close may run before it is declared stuck. */
export const CLOSE_STEP_MS = 15_000;

/**
 * Parks a page on a blank document so its window can actually be destroyed.
 *
 * `context.close()` waits for Firefox to destroy the page's chrome window, and
 * Firefox is free to silently decline: `nsGlobalWindowOuter::CloseOuter()` bails
 * out early from several gates, one of which runs the unload check against a
 * document viewer that is mid-swap during a cross-document navigation. Nothing
 * below the hook timeout bounds that wait, so a page left navigating can hang
 * teardown outright. Navigating to `about:blank` first cancels the pending load
 * and leaves a document with nothing to object to.
 *
 * `about:blank` is used rather than `page.close()` because closing a page walks
 * that same window-destruction path and is equally unbounded. Failures are
 * swallowed: this is best-effort hygiene, and the close that follows is the step
 * whose failure matters.
 * @param page - The page to park.
 * @returns Resolves once the page is parked, or the attempt is abandoned.
 */
export async function quiescePage(page: Page): Promise<void> {
  try {
    await page.goto('about:blank', { waitUntil: 'commit', timeout: QUIESCE_MS });
  } catch {
    // A page that cannot be parked is exactly the case the deadline below covers.
  }
}

/**
 * Runs one teardown step under a deadline it cannot exceed.
 *
 * Racing a timer cannot cancel Playwright's internal wait, so this does not
 * rescue a wedged resource. What it does is stop one stuck close from consuming
 * the whole hook budget and report *which* resource stalled, instead of an
 * anonymous hook timeout that says nothing about where to look.
 * @param label - Resource name reported when the step overruns.
 * @param step - The close to run.
 * @param timeoutMs - Deadline for this step; defaults to the shared budget.
 * @returns Resolves when the step finishes; rejects when the deadline expires.
 */
export async function closeStep(
  label: string,
  step: () => Promise<unknown>,
  timeoutMs: number = CLOSE_STEP_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`teardown stalled closing ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
    // Never let the deadline itself be the reason the process stays alive.
    timer.unref();
  });
  try {
    await Promise.race([step(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
