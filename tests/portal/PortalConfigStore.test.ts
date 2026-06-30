import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import type { IImporterConfig, Procedure } from '../../src/Types/Index.js';
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

/**
 * Prepares then commits a config through the store, mirroring the old one-shot
 * save so existing assertions keep exercising the full validate + write path.
 * @param store - Store under test.
 * @param next - Candidate config to persist.
 * @returns The prepare failure, or the commit result.
 */
function save(store: PortalConfigStore, next: IImporterConfig): Procedure<{ saved: true }> {
  const prepared = store.prepare(next);
  return isFail(prepared) ? prepared : store.commit(prepared.data);
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
    const result = save(store, next);
    expect(isSuccess(result)).toBe(true);
    expect(store.raw().banks.discount.password).not.toBe('********');
  });

  it('rejects an invalid config without persisting', () => {
    const { store } = makeStore();
    const result = save(store, fakeImporterConfig({ banks: {} }));
    expect(isFail(result)).toBe(true);
  });

  it('coerces a comma-separated target accounts string into an array on save', () => {
    const bank = fakeBankConfig({
      targets: [{ actualAccountId: '11111111-1111-1111-1111-111111111111', reconcile: false, accounts: '123, 456' as unknown as string[] }],
    });
    const { store } = makeStore(fakeImporterConfig({ banks: { discount: bank } }));
    const result = save(store, store.masked());
    expect(isSuccess(result)).toBe(true);
    expect(store.raw().banks.discount.targets?.[0].accounts).toEqual(['123', '456']);
  });

  it('returns a failure instead of throwing on a malformed config', () => {
    const { store } = makeStore();
    const malformed = { actual: {}, banks: {} } as unknown as IImporterConfig;
    const result = save(store, malformed);
    expect(isFail(result)).toBe(true);
  });

  it('reports a failure (not a throw) when shaping a structurally broken body', () => {
    const { store } = makeStore();
    const broken = { actual: {}, banks: undefined } as unknown as IImporterConfig;
    const result = save(store, broken);
    expect(isFail(result)).toBe(true);
  });

  it('throws on construction when the initial config fails to load (never serves or overwrites blanks)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'portal-bad-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ this is not valid json', 'utf8');
    expect(() => new PortalConfigStore(path)).toThrow(/did not load cleanly/);
  });

  it('commit fails (server error) when the config directory is removed before write', () => {
    const { store, path } = makeStore();
    const prepared = store.prepare(store.masked());
    expect(isSuccess(prepared)).toBe(true);
    if (isFail(prepared)) return;
    rmSync(dirname(path), { recursive: true, force: true });
    expect(isFail(store.commit(prepared.data))).toBe(true);
  });
});
