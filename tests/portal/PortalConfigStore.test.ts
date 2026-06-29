import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
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
});
