/**
 * Unit coverage for the bounded teardown primitives.
 *
 * These live apart from the e2e suites on purpose: the helpers exist to survive
 * a close that never returns, and the only way to assert that behaviour quickly
 * and deterministically is against a stub rather than a real browser. The e2e
 * suite proves the browser-facing half — that a parked page really does reach
 * `about:blank` — which cannot be faked here.
 */

import type { Page } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeStep, CLOSE_STEP_MS, quiescePage, QUIESCE_MS } from './teardown.js';

/**
 * Builds a stub standing in for the one `Page` method `quiescePage` touches.
 * @param goto - Behaviour for the navigation under test.
 * @returns A page-shaped stub carrying the supplied `goto`.
 */
function stubPage(goto: unknown): Page {
  return { goto } as unknown as Page;
}

/** A promise that never settles, standing in for a wedged close. */
function neverSettles(): Promise<never> {
  return new Promise<never>(() => undefined);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('closeStep', () => {
  it('resolves as soon as the close does, without waiting out the deadline', async () => {
    const closed = vi.fn(async () => await Promise.resolve('done'));

    await expect(closeStep('portal server', closed)).resolves.toBeUndefined();
    expect(closed).toHaveBeenCalledOnce();
  });

  it('names the resource that overran, so the failure says where to look', async () => {
    vi.useFakeTimers();

    const pending = closeStep('browser context', neverSettles, 15_000);
    const asserted = expect(pending).rejects.toThrow(
      'teardown stalled closing browser context after 15000ms',
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await asserted;
  });

  it('surfaces a genuine close failure rather than masking it as a timeout', async () => {
    const boom = new Error('server refused to close');

    await expect(
      closeStep('portal server', async () => await Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it('clears its timer on the happy path so the deadline cannot outlive the step', async () => {
    vi.useFakeTimers();
    const cleared = vi.spyOn(globalThis, 'clearTimeout');

    await closeStep('portal server', async () => await Promise.resolve());

    expect(cleared).toHaveBeenCalled();
    // A leaked timer would still be pending here and could reject a later step.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the step rejects', async () => {
    vi.useFakeTimers();

    await expect(
      closeStep('portal server', async () => await Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies the shared budget when no deadline is given', async () => {
    vi.useFakeTimers();

    const pending = closeStep('fake Google', neverSettles);
    const asserted = expect(pending).rejects.toThrow(`after ${CLOSE_STEP_MS}ms`);
    await vi.advanceTimersByTimeAsync(CLOSE_STEP_MS);

    await asserted;
  });
});

describe('quiescePage', () => {
  it('parks the page on a blank document, committing rather than awaiting load', async () => {
    const goto = vi.fn(async () => await Promise.resolve(null));

    await quiescePage(stubPage(goto));

    // `commit` matters: waiting for `load` would reintroduce an unbounded-feeling
    // wait on the very page we are trying to get rid of.
    expect(goto).toHaveBeenCalledWith('about:blank', {
      waitUntil: 'commit',
      timeout: QUIESCE_MS,
    });
  });

  it('swallows a failed park, because the close behind it is what matters', async () => {
    const goto = vi.fn(async () => await Promise.reject(new Error('navigation timeout')));

    await expect(quiescePage(stubPage(goto))).resolves.toBeUndefined();
  });
});
