import { afterEach, describe, expect, it, vi } from 'vitest';

import { fail, succeed } from '../../src/Types/Index.js';
import { fakeImporterConfig } from '../helpers/factories.js';

const { loadRaw, startPortal } = vi.hoisted(() => ({ loadRaw: vi.fn(), startPortal: vi.fn() }));

vi.mock('../../src/Config/ConfigLoader.js', () => ({
  ConfigLoader: class { public loadRaw = loadRaw; },
}));
vi.mock('../../src/Portal/PortalServer.js', () => ({ startPortal }));

const { default: bootPortal } = await import('../../src/Portal/PortalBootstrap.js');

describe('bootPortal', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('returns false when config cannot be loaded', async () => {
    loadRaw.mockReturnValue(fail('boom'));
    expect(await bootPortal()).toBe(false);
  });

  it('returns false when the portal is disabled', async () => {
    loadRaw.mockReturnValue(succeed(fakeImporterConfig()));
    expect(await bootPortal()).toBe(false);
    expect(startPortal).not.toHaveBeenCalled();
  });

  it('starts and returns true when enabled', async () => {
    loadRaw.mockReturnValue(succeed(fakeImporterConfig({ portal: { enabled: true, port: 0, sessionSecret: 'a-strong-session-secret' } })));
    startPortal.mockResolvedValue({});
    expect(await bootPortal()).toBe(true);
    expect(startPortal).toHaveBeenCalledOnce();
  });

  it('returns false when the session secret is weak', async () => {
    loadRaw.mockReturnValue(succeed(fakeImporterConfig({ portal: { enabled: true, port: 0, sessionSecret: 'weak' } })));
    expect(await bootPortal()).toBe(false);
    expect(startPortal).not.toHaveBeenCalled();
  });

  it('returns false when startup throws', async () => {
    loadRaw.mockReturnValue(succeed(fakeImporterConfig({ portal: { enabled: true, port: 0, sessionSecret: 'a-strong-session-secret' } })));
    startPortal.mockRejectedValue(new Error('bind failed'));
    expect(await bootPortal()).toBe(false);
  });
});
