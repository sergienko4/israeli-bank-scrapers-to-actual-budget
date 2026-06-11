import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IImporterConfig } from '../../../src/Types/Index.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

vi.mock('../../../src/Services/Notifications/TelegramNotifier.js', () => {
  class MockTelegramNotifier {
    registerCommands = vi.fn(async () => ({ success: true, data: { status: 'registered' } }));
  }
  return { default: MockTelegramNotifier };
});

import { buildExtraCommands, logCommandCount, registerNotifierCommands }
  from '../../../src/Scheduler/Telegram/CommandRegistry.js';
import TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';

describe('CommandRegistry edge cases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not add watch command when spendingWatch is an empty array', () => {
    const cfg = { banks: {}, spendingWatch: [] } as unknown as IImporterConfig;
    const extras = buildExtraCommands(cfg);
    expect(extras.map(c => c.command)).not.toContain('watch');
  });

  it('does not crash when notifications object is undefined', () => {
    const cfg = { banks: {} } as IImporterConfig;
    expect(() => buildExtraCommands(cfg)).not.toThrow();
  });

  it('does not add import_receipt when notifications.telegram is undefined', () => {
    const cfg = { banks: {}, notifications: { enabled: true } } as IImporterConfig;
    const extras = buildExtraCommands(cfg);
    expect(extras.map(c => c.command)).not.toContain('import_receipt');
  });

  it('logCommandCount with empty array still emits a count line', () => {
    logCommandCount([]);
    const calls = mockLogger.info.mock.calls.flat();
    expect(calls.some((s: unknown) => typeof s === 'string' && s.includes('4 bot commands'))).toBe(true);
  });

  it('registerNotifierCommands invokes the notifier registerCommands hook once', async () => {
    const notifier = new TelegramNotifier({ botToken: 't', chatId: 'c' });
    const cfg = { banks: {} } as IImporterConfig;
    await registerNotifierCommands(notifier, cfg);
    expect(notifier.registerCommands).toHaveBeenCalledTimes(1);
  });
});
