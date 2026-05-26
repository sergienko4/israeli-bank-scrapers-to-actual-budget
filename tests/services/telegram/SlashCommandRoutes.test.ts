import { describe, expect, it, vi } from 'vitest';

import type {
  ISlashHandlers,
  SlashHandler,
} from '../../../src/Services/Telegram/SlashCommandRoutes.js';
import { buildSlashCommandRoutes } from '../../../src/Services/Telegram/SlashCommandRoutes.js';
import { succeed } from '../../../src/Types/Index.js';

/**
 * Builds a SlashHandler spy returning the supplied status.
 * @param status - Status string the spy resolves with.
 * @returns Spy implementing SlashHandler.
 */
function spyHandler(status: string): SlashHandler {
  return vi.fn().mockResolvedValue(succeed({ status })) as SlashHandler;
}

/**
 * Builds an ISlashHandlers bundle composed entirely of spy handlers.
 * @returns Fresh ISlashHandlers bundle.
 */
function spyHandlers(): ISlashHandlers {
  return {
    handleScan: spyHandler('scan'),
    handleScanAll: spyHandler('scan-all'),
    handleStatus: spyHandler('status'),
    handleLogs: spyHandler('logs'),
    handleWatch: spyHandler('watch'),
    handleCheckConfig: spyHandler('check'),
    handlePreview: spyHandler('preview'),
    handleHelp: spyHandler('help'),
    handleRetry: spyHandler('retry'),
    handleImportReceipt: spyHandler('import-receipt'),
  };
}

interface IExpectedRoute {
  readonly pattern: string;
  readonly match: 'exact' | 'prefix';
}

const EXPECTED: readonly IExpectedRoute[] = [
  { pattern: '/scan', match: 'exact' },
  { pattern: '/import', match: 'exact' },
  { pattern: '/status', match: 'exact' },
  { pattern: '/logs', match: 'exact' },
  { pattern: '/watch', match: 'exact' },
  { pattern: '/check_config', match: 'exact' },
  { pattern: '/preview', match: 'exact' },
  { pattern: '/help', match: 'exact' },
  { pattern: '/retry', match: 'exact' },
  { pattern: '/start', match: 'exact' },
  { pattern: '/import_receipt', match: 'exact' },
  { pattern: 'scan_all', match: 'exact' },
  { pattern: 'scan:', match: 'prefix' },
];

describe('buildSlashCommandRoutes', () => {
  it('produces the documented 13 routes with the right patterns', () => {
    const routes = buildSlashCommandRoutes(spyHandlers());
    expect(routes.length).toBe(EXPECTED.length);
    for (let i = 0; i < EXPECTED.length; i += 1) {
      expect(routes[i].pattern).toBe(EXPECTED[i].pattern);
      expect(routes[i].match).toBe(EXPECTED[i].match);
    }
  });

  it('routes /scan and /import to handleScan', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    await routes.find(r => r.pattern === '/scan')!.handle('a');
    await routes.find(r => r.pattern === '/import')!.handle('b');
    expect(h.handleScan).toHaveBeenCalledTimes(2);
  });

  it('routes /help and /start both to handleHelp', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    await routes.find(r => r.pattern === '/help')!.handle('');
    await routes.find(r => r.pattern === '/start')!.handle('');
    expect(h.handleHelp).toHaveBeenCalledTimes(2);
  });

  it('routes scan_all to handleScanAll, not handleScan', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    await routes.find(r => r.pattern === 'scan_all')!.handle('');
    expect(h.handleScanAll).toHaveBeenCalledOnce();
    expect(h.handleScan).not.toHaveBeenCalled();
  });

  it('scan: prefix route extracts payload and forwards to handleScan', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    const route = routes.find(r => r.pattern === 'scan:');
    expect(route?.parse?.('scan:cal')).toBe('cal');
    expect(route?.parse?.('scan:')).toBe('');
    await route!.handle('cal');
    expect(h.handleScan).toHaveBeenCalledWith('cal');
  });

  it('scan: prefix route forwards empty payload as empty string to handleScan', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    const route = routes.find(r => r.pattern === 'scan:');
    await route!.handle('');
    expect(h.handleScan).toHaveBeenCalledWith('');
  });

  it('each individual exact handler forwards parsed arg', async () => {
    const h = spyHandlers();
    const routes = buildSlashCommandRoutes(h);
    await routes.find(r => r.pattern === '/logs')!.handle('100');
    expect(h.handleLogs).toHaveBeenCalledWith('100');
  });
});
