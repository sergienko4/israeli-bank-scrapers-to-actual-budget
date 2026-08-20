import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { startPortal } = await import('../../src/Portal/PortalServer.js');
const { fakePortalRuntime, seedConfigDir } = await import('../helpers/portalFactories.js');

/**
 * Boots the portal on an ephemeral port and returns everything it warned about.
 * @param host - Bind host for the run.
 * @returns The warning lines the boot emitted.
 */
async function warningsFromBoot(host: string): Promise<string[]> {
  const seed = seedConfigDir();
  const server = await startPortal(fakePortalRuntime({ host, port: 0 }), seed.path);
  await server.close();
  rmSync(seed.dir, { recursive: true, force: true });
  return mockLogger.warn.mock.calls.map((call) => String(call[0]));
}

describe('portal boot warnings', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.PORTAL_TRUST_PROXY; });
  afterEach(() => { delete process.env.PORTAL_TRUST_PROXY; });

  // A hop count silently resolves to "trust nothing" now, which collapses every
  // caller into one rate-limit bucket. Operators upgrading from the documented
  // `PORTAL_TRUST_PROXY=1` must be told, or they lose per-caller limits quietly.
  it('warns when PORTAL_TRUST_PROXY is still a proxy hop count', async () => {
    process.env.PORTAL_TRUST_PROXY = '1';
    const warnings = await warningsFromBoot('127.0.0.1');
    expect(warnings.some((line) => line.includes('GHSA-3m5p-2c4r-xxw2'))).toBe(true);
  });

  it('stays quiet when PORTAL_TRUST_PROXY names an address', async () => {
    process.env.PORTAL_TRUST_PROXY = 'loopback';
    const warnings = await warningsFromBoot('127.0.0.1');
    expect(warnings).toEqual([]);
  });

  it('stays quiet when no proxy is configured at all', async () => {
    const warnings = await warningsFromBoot('127.0.0.1');
    expect(warnings).toEqual([]);
  });

  it('warns when the portal is reachable beyond loopback', async () => {
    const warnings = await warningsFromBoot('0.0.0.0');
    expect(warnings.some((line) => line.includes('non-loopback host'))).toBe(true);
  });
});
