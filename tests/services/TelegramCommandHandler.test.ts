import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramCommandHandler } from '../../src/services/TelegramCommandHandler.js';

describe('TelegramCommandHandler', () => {
  let handler: TelegramCommandHandler;
  let mockRunImport: any;
  let mockNotifier: any;

  beforeEach(() => {
    mockRunImport = vi.fn().mockResolvedValue(0);
    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendSummary: vi.fn(),
      sendError: vi.fn()
    };
    handler = new TelegramCommandHandler(mockRunImport, mockNotifier);
  });

  it('runs import on /scan', async () => {
    await handler.handle('/scan');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Starting import'));
    expect(mockRunImport).toHaveBeenCalled();
  });

  it('runs import on /import', async () => {
    await handler.handle('/import');
    expect(mockRunImport).toHaveBeenCalled();
  });

  it('prevents concurrent imports', async () => {
    let resolveImport: any;
    mockRunImport.mockImplementation(() => new Promise(resolve => { resolveImport = resolve; }));

    const first = handler.handle('/scan');

    // Wait for first to start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Try second while first is running
    await handler.handle('/scan');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already running'));

    resolveImport(0);
    await first;
  });

  it('responds to /help', async () => {
    await handler.handle('/help');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('/scan'));
  });

  it('responds to /start', async () => {
    await handler.handle('/start');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));
  });

  it('responds to /status with no previous runs', async () => {
    await handler.handle('/status');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No imports run yet'));
  });

  it('responds to /status after a run', async () => {
    await handler.handle('/scan');
    await handler.handle('/status');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('ago'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('ignores unknown commands', async () => {
    await handler.handle('/unknown');
    expect(mockRunImport).not.toHaveBeenCalled();
  });
});
