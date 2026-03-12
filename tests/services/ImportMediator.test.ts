import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportMediator } from '../../src/Services/ImportMediator.js';
import type { TelegramPoller } from '../../src/Services/TelegramPoller.js';

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/**
 * Creates a mock notifier for testing.
 * @returns Mock INotifier with stub methods.
 */
function createMockNotifier(): { sendMessage: ReturnType<typeof vi.fn>; sendSummary: ReturnType<typeof vi.fn>; sendError: ReturnType<typeof vi.fn> } {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendSummary: vi.fn().mockResolvedValue(undefined),
    sendError: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a mock TelegramPoller for testing.
 * @returns Mock poller with start and stopAndFlush stubs.
 */
function createMockPoller(): TelegramPoller {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    stopAndFlush: vi.fn().mockResolvedValue(undefined),
  } as unknown as TelegramPoller;
}

describe('ImportMediator', () => {
  let spawnImport: ReturnType<typeof vi.fn>;
  let getBankNames: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    spawnImport = vi.fn().mockResolvedValue(0);
    getBankNames = vi.fn().mockReturnValue(['discount', 'leumi']);
  });

  it('requestImport returns a batchId when idle', () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    expect(batchId).toBeTruthy();
    expect(typeof batchId).toBe('string');
  });

  it('requestImport returns null when already busy', async () => {
    let resolveSpawn: ((v: number) => void) | undefined;
    spawnImport.mockImplementation(
      () => new Promise<number>((r) => { resolveSpawn = r; })
    );
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });

    const first = mediator.requestImport({ source: 'cron' });
    expect(first).toBeTruthy();

    const second = mediator.requestImport({ source: 'telegram' });
    expect(second).toBeNull();

    resolveSpawn?.(0);
  });

  it('waitForBatch resolves with BatchResult on completion', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    expect(batchId).toBeTruthy();

    const result = await mediator.waitForBatch(batchId!);
    expect(result.batchId).toBe(batchId);
    expect(result.source).toBe('cron');
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
    expect(result.jobs).toHaveLength(1);
  });

  it('waitForBatch rejects for unknown batchId', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    await expect(mediator.waitForBatch('unknown')).rejects.toThrow('Unknown batch');
  });

  it('tracks failure when spawnImport returns non-zero', async () => {
    spawnImport.mockResolvedValue(1);
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({ source: 'telegram' });
    const result = await mediator.waitForBatch(batchId!);

    expect(result.failureCount).toBe(1);
    expect(result.successCount).toBe(0);
  });

  it('sends aggregate summary via notifier on completion', async () => {
    const notifier = createMockNotifier();
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId!);

    expect(notifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Batch complete')
    );
  });

  it('handles notifier failure gracefully', async () => {
    const notifier = createMockNotifier();
    notifier.sendMessage.mockRejectedValue(new Error('Network'));
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    // Should not throw
    const result = await mediator.waitForBatch(batchId!);
    expect(result.successCount).toBe(1);
  });

  it('isImporting returns true while processing', async () => {
    let resolveSpawn: ((v: number) => void) | undefined;
    spawnImport.mockImplementation(
      () => new Promise<number>((r) => { resolveSpawn = r; })
    );
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });

    expect(mediator.isImporting()).toBe(false);

    const batchId = mediator.requestImport({ source: 'cron' });
    // Queue is now busy
    await vi.waitFor(() => expect(mediator.isImporting()).toBe(true));

    resolveSpawn?.(0);
    await mediator.waitForBatch(batchId!);
    expect(mediator.isImporting()).toBe(false);
  });

  it('getLastResult and getLastRunTime update after completion', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });

    expect(mediator.getLastResult()).toBeNull();
    expect(mediator.getLastRunTime()).toBeNull();

    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId!);

    expect(mediator.getLastResult()).toBeTruthy();
    expect(mediator.getLastRunTime()).toBeInstanceOf(Date);
  });

  it('passes IMPORT_BANKS env for specific bank', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({
      source: 'telegram', banks: ['discount'],
    });
    await mediator.waitForBatch(batchId!);

    expect(spawnImport).toHaveBeenCalledWith(
      expect.objectContaining({ IMPORT_BANKS: 'discount' })
    );
  });

  it('passes extra env (DRY_RUN) to spawnImport', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({
      source: 'telegram', extraEnv: { DRY_RUN: 'true' },
    });
    await mediator.waitForBatch(batchId!);

    expect(spawnImport).toHaveBeenCalledWith(
      expect.objectContaining({ DRY_RUN: 'true' })
    );
  });

  it('stops poller before import and resumes after', async () => {
    const poller = createMockPoller();
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    mediator.setPoller(poller);

    const batchId = mediator.requestImport({ source: 'telegram' });
    await mediator.waitForBatch(batchId!);

    expect(poller.stopAndFlush).toHaveBeenCalled();
    expect(poller.start).toHaveBeenCalled();
  });

  it('does not stop poller when none is set', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    // No setPoller call
    const batchId = mediator.requestImport({ source: 'cron' });
    // Should not throw
    const result = await mediator.waitForBatch(batchId!);
    expect(result.successCount).toBe(1);
  });

  it('handles spawnImport throwing an error', async () => {
    spawnImport.mockRejectedValue(new Error('spawn failed'));
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    const result = await mediator.waitForBatch(batchId!);

    // Error case: exitCode defaults to 1
    expect(result.failureCount).toBe(1);
    expect(result.successCount).toBe(0);
  });

  it('imports all banks when no specific banks requested', async () => {
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId!);

    // Should pass empty env (no IMPORT_BANKS) for 'all' label
    expect(spawnImport).toHaveBeenCalledWith({});
  });

  it('handles poller.start failure gracefully', async () => {
    const poller = createMockPoller();
    (poller.start as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('poller crash')
    );
    const mediator = new ImportMediator({
      spawnImport, getBankNames, notifier: null,
    });
    mediator.setPoller(poller);

    const batchId = mediator.requestImport({ source: 'cron' });
    await mediator.waitForBatch(batchId!);

    // Should not throw — error is caught internally
    expect(poller.start).toHaveBeenCalled();
  });
});
