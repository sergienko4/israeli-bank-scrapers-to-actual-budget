import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramCommandHandler } from '../../src/services/TelegramCommandHandler.js';
import { createLogger, getLogBuffer } from '../../src/logger/index.js';

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
    createLogger({ maxBufferSize: 50 });
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
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('/logs'));
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

  // ─── /logs command tests ───

  it('/logs shows empty message when no entries', async () => {
    getLogBuffer().clear();
    await handler.handle('/logs');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No log entries'));
  });

  it('/logs shows recent entries from buffer', async () => {
    const buffer = getLogBuffer();
    buffer.clear();
    buffer.add('line 1');
    buffer.add('line 2');
    await handler.handle('/logs');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('line 1'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('line 2'));
  });

  it('/logs with count parameter limits entries', async () => {
    const buffer = getLogBuffer();
    buffer.clear();
    for (let i = 1; i <= 10; i++) buffer.add(`entry ${i}`);
    await handler.handle('/logs 3');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('entry 8');
    expect(msg).toContain('entry 9');
    expect(msg).toContain('entry 10');
    expect(msg).not.toContain('entry 7');
  });

  it('/logs caps count at 150', async () => {
    const buffer = getLogBuffer();
    buffer.clear();
    buffer.add('test');
    await handler.handle('/logs 9999');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('test'));
  });

  it('/logs handles non-numeric arg gracefully', async () => {
    const buffer = getLogBuffer();
    buffer.clear();
    buffer.add('test');
    await handler.handle('/logs abc');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('test'));
  });

  it('/logs wraps output in pre tags', async () => {
    const buffer = getLogBuffer();
    buffer.clear();
    buffer.add('formatted line');
    await handler.handle('/logs');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('<pre>');
    expect(msg).toContain('</pre>');
  });

  it('/logs shows disabled message when buffer off', async () => {
    createLogger({ maxBufferSize: 0 });
    await handler.handle('/logs');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Log buffer disabled'));
  });
});
