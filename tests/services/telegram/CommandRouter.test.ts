import { describe, expect, it, vi } from 'vitest';

import CommandRouter from '../../../src/Services/Telegram/CommandRouter.js';
import type { ICommandRoute } from '../../../src/Services/Telegram/ICommandRoute.js';
import { succeed } from '../../../src/Types/Index.js';

/**
 * Builds an exact-match route with a vi.fn() spy handler.
 * @param pattern - Exact pattern literal.
 * @param status - Status string returned by the handler.
 * @returns Tuple of [route, spy].
 */
function exactRoute(
  pattern: string,
  status: string,
): [ICommandRoute, ReturnType<typeof vi.fn>] {
  const spy = vi.fn().mockResolvedValue(succeed({ status }));
  return [{ match: 'exact', pattern, handle: spy }, spy];
}

/**
 * Builds a prefix-match route that uses raw.slice(prefix.length) as payload.
 * @param pattern - Prefix literal.
 * @param status - Status string returned by the handler.
 * @returns Tuple of [route, spy].
 */
function prefixRoute(
  pattern: string,
  status: string,
): [ICommandRoute, ReturnType<typeof vi.fn>] {
  const spy = vi.fn().mockResolvedValue(succeed({ status }));
  return [
    {
      match: 'prefix', pattern,
      /**
       * Returns the payload after the prefix.
       * @param raw - Raw command.
       * @returns Payload string.
       */
      parse: (raw: string) => raw.slice(pattern.length),
      handle: spy,
    },
    spy,
  ];
}

describe('CommandRouter', () => {
  it('dispatches to an exact-match route', async () => {
    const [route, spy] = exactRoute('/scan', 'scan-ok');
    const router = new CommandRouter([route]);
    const out = await router.dispatch('/scan');
    expect(spy).toHaveBeenCalledOnce();
    expect(out.data.status).toBe('scan-ok');
  });

  it('passes the parsed whitespace arg to handlers without a parser', async () => {
    const [route, spy] = exactRoute('/scan', 'ok');
    const router = new CommandRouter([route]);
    await router.dispatch('/scan discount');
    expect(spy).toHaveBeenCalledWith('discount');
  });

  it('dispatches prefix matches and forwards parsed payload', async () => {
    const [route, spy] = prefixRoute('scan:', 'prefix-ok');
    const router = new CommandRouter([route]);
    await router.dispatch('scan:cal');
    expect(spy).toHaveBeenCalledWith('cal');
  });

  it('preserves mixed-case payload while lowercasing only the prefix token', async () => {
    const [route, spy] = prefixRoute('scan:', 'prefix-ok');
    const router = new CommandRouter([route]);
    await router.dispatch('SCAN:Cal');
    expect(spy).toHaveBeenCalledWith('Cal');
  });

  it('parses payload from raw with mixed case (case-sensitive route parser sees lowercased prefix)', async () => {
    const [route, spy] = prefixRoute('receipt_acc:', 'acc-ok');
    const router = new CommandRouter([route]);
    await router.dispatch('Receipt_Acc:Account-42');
    expect(spy).toHaveBeenCalledWith('Account-42');
  });

  it('returns no-route silently when nothing matches', async () => {
    const router = new CommandRouter([]);
    const out = await router.dispatch('/unknown');
    expect(out.data.status).toBe('no-route');
  });

  it('prefers exact match over prefix match (no shadow)', async () => {
    const [pref, prefSpy] = prefixRoute('receipt_', 'wrong-prefix');
    const [exa, exaSpy] = exactRoute('receipt_confirm', 'right-exact');
    const router = new CommandRouter([pref, exa]);
    await router.dispatch('receipt_confirm');
    expect(exaSpy).toHaveBeenCalledOnce();
    expect(prefSpy).not.toHaveBeenCalled();
  });

  it('first-match wins among prefix routes', async () => {
    const [first, firstSpy] = prefixRoute('receipt_', 'first');
    const [second, secondSpy] = prefixRoute('receipt_acc:', 'second');
    const router = new CommandRouter([first, second]);
    await router.dispatch('receipt_acc:abc');
    expect(firstSpy).toHaveBeenCalledOnce();
    expect(secondSpy).not.toHaveBeenCalled();
  });
});
