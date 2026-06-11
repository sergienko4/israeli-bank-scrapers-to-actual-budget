/**
 * Edge-case unit tests for PollerLifecycle â€” locks the three-state
 * machine (no-poller / stopped / poller-resumed) and the idempotent
 * stop() behaviour that ImportMediator relies on for queue draining.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PollerLifecycle from '../../../src/Services/Import/PollerLifecycle.js';
import type TelegramPoller from '../../../src/Services/TelegramPoller.js';

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

interface IFakePoller {
  stopAndFlush: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
}

const buildFakePoller = (): IFakePoller => ({
  stopAndFlush: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue(undefined),
});

describe('PollerLifecycle.setPoller', () => {
  it('returns poller-set status', () => {
    const sut = new PollerLifecycle();
    const poller = buildFakePoller();
    const result = sut.setPoller(poller as unknown as TelegramPoller);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('poller-set');
  });
});

describe('PollerLifecycle.stop', () => {
  it('returns no-poller before setPoller is called', async () => {
    const sut = new PollerLifecycle();
    const result = await sut.stop();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('no-poller');
  });

  it('returns stopped on the first call and calls stopAndFlush', async () => {
    const sut = new PollerLifecycle();
    const poller = buildFakePoller();
    sut.setPoller(poller as unknown as TelegramPoller);
    const result = await sut.stop();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('stopped');
    expect(poller.stopAndFlush).toHaveBeenCalledTimes(1);
  });

  it('returns already-stopped on repeated calls and does not re-stop', async () => {
    const sut = new PollerLifecycle();
    const poller = buildFakePoller();
    sut.setPoller(poller as unknown as TelegramPoller);
    await sut.stop();
    const second = await sut.stop();
    expect(second.success).toBe(true);
    if (second.success) expect(second.data.status).toBe('already-stopped');
    expect(poller.stopAndFlush).toHaveBeenCalledTimes(1);
  });
});

describe('PollerLifecycle.resume', () => {
  let sut: PollerLifecycle;
  let poller: IFakePoller;

  beforeEach(() => {
    sut = new PollerLifecycle();
    poller = buildFakePoller();
  });

  it('returns no-poller when no poller is wired', () => {
    const result = sut.resume();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('no-poller');
  });

  it('returns no-poller when poller is wired but never stopped', () => {
    sut.setPoller(poller as unknown as TelegramPoller);
    const result = sut.resume();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('no-poller');
    expect(poller.start).not.toHaveBeenCalled();
  });

  it('returns poller-resumed after a stop and calls start exactly once', async () => {
    sut.setPoller(poller as unknown as TelegramPoller);
    await sut.stop();
    const result = sut.resume();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('poller-resumed');
    expect(poller.start).toHaveBeenCalledTimes(1);
  });

  it('swallows start() rejections so the queue-empty callback never throws', async () => {
    poller.start.mockRejectedValueOnce(new Error('start failed'));
    sut.setPoller(poller as unknown as TelegramPoller);
    await sut.stop();
    expect(() => sut.resume()).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
