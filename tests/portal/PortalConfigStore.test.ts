import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import type { IImporterConfig } from '../../src/Types/Index.js';
import { isFail, isSuccess } from '../../src/Types/Index.js';
import { fakeBankConfig, fakeImporterConfig } from '../helpers/factories.js';
import { seedConfigDir } from '../helpers/portalFactories.js';

const dirs: string[] = [];

/**
 * Seeds a store from a fresh tmp config dir, tracking it for cleanup.
 * @param config - Optional importer config override.
 * @returns The store + its config path.
 */
function makeStore(config = fakeImporterConfig()): { store: PortalConfigStore; path: string } {
  const seed = seedConfigDir(config);
  dirs.push(seed.dir);
  return { store: new PortalConfigStore(seed.path), path: seed.path };
}

describe('PortalConfigStore', () => {
  afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }); });

  it('masks secrets in masked() but keeps them in raw()', () => {
    const { store } = makeStore(fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 'pw' }) } }));
    expect(store.masked().banks.discount.password).toBe('********');
    expect(store.raw().banks.discount.password).toBe('pw');
  });

  it('saves a valid config and restores masked secrets', () => {
    const { store } = makeStore();
    const next = store.masked();
    const result = store.save(next);
    expect(isSuccess(result)).toBe(true);
    expect(store.raw().banks.discount.password).not.toBe('********');
  });

  it('rejects an invalid config without persisting', () => {
    const { store } = makeStore();
    const result = store.save(fakeImporterConfig({ banks: {} }));
    expect(isFail(result)).toBe(true);
  });

  it('coerces a comma-separated target accounts string into an array on save', () => {
    const bank = fakeBankConfig({
      targets: [{ actualAccountId: '11111111-1111-1111-1111-111111111111', reconcile: false, accounts: '123, 456' as unknown as string[] }],
    });
    const { store } = makeStore(fakeImporterConfig({ banks: { discount: bank } }));
    const result = store.save(store.masked());
    expect(isSuccess(result)).toBe(true);
    expect(store.raw().banks.discount.targets?.[0].accounts).toEqual(['123', '456']);
  });

  it('returns a failure instead of throwing on a malformed config', () => {
    const { store } = makeStore();
    const malformed = { actual: {}, banks: {} } as unknown as IImporterConfig;
    const result = store.save(malformed);
    expect(isFail(result)).toBe(true);
  });

  it('reports a failure (not a throw) when shaping a structurally broken body', () => {
    const { store } = makeStore();
    const broken = { actual: {}, banks: undefined } as unknown as IImporterConfig;
    const result = store.save(broken);
    expect(isFail(result)).toBe(true);
  });

  it('refuses to save when the initial config failed to load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portal-bad-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ this is not valid json', 'utf8');
    const store = new PortalConfigStore(path);
    expect(isFail(store.save(fakeImporterConfig()))).toBe(true);
  });
});
