import { describe, expect, it } from 'vitest';

import deepMerge from '../../src/Config/Loaders/ConfigMerger.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

/**
 * Builds a minimal valid IImporterConfig for use as a merge baseline.
 *
 * @returns A fresh IImporterConfig instance with an empty banks map.
 */
function baseConfig(): IImporterConfig {
  return {
    actual: {
      init: { dataDir: '/data', serverURL: 'http://localhost:5006', password: 'pw' },
      budget: { syncId: 'sync', password: 'bp' },
    },
    banks: {},
  };
}

describe('ConfigMerger deepMerge', () => {
  it('returns a new object that is not the same reference as target', () => {
    const target = baseConfig();
    const merged = deepMerge(target, {});
    expect(merged).not.toBe(target);
    expect(merged).toEqual(target);
  });

  it('does not mutate the target when source overrides a nested primitive', () => {
    const target = baseConfig();
    const snapshot = JSON.parse(JSON.stringify(target));
    deepMerge(target, {
      actual: { ...target.actual, budget: { syncId: 'sync', password: 'override' } },
    });
    expect(target).toEqual(snapshot);
  });

  it('overrides primitive top-level fields with source values', () => {
    const target = baseConfig();
    const merged = deepMerge(target, { delayBetweenBanks: 5000 });
    expect(merged.delayBetweenBanks).toBe(5000);
  });

  it('deep-merges nested objects (actual.budget.password)', () => {
    const target = baseConfig();
    const merged = deepMerge(target, {
      actual: { ...target.actual, budget: { syncId: 'sync', password: 'newpw' } },
    });
    expect(merged.actual.init.password).toBe('pw');
    expect(merged.actual.budget.password).toBe('newpw');
  });

  it('adds new top-level keys from source not present in target', () => {
    const target = baseConfig();
    const merged = deepMerge(target, { proxy: { server: 'socks5://1.2.3.4:1080' } });
    expect(merged.proxy?.server).toBe('socks5://1.2.3.4:1080');
  });

  it('adds new nested keys (banks.discount) from source', () => {
    const target = baseConfig();
    const merged = deepMerge(target, {
      banks: { discount: { id: 'x', password: 'y', num: 'z' } },
    });
    expect(merged.banks.discount?.id).toBe('x');
  });

  it('replaces arrays wholesale (source array wins over target array)', () => {
    const target: IImporterConfig = {
      ...baseConfig(),
      spendingWatch: [{ alertFromAmount: 100, numOfDayToCount: 30 }],
    };
    const merged = deepMerge(target, {
      spendingWatch: [
        { alertFromAmount: 200, numOfDayToCount: 7 },
        { alertFromAmount: 300, numOfDayToCount: 14 },
      ],
    });
    expect(merged.spendingWatch).toHaveLength(2);
    expect(merged.spendingWatch?.[0]?.alertFromAmount).toBe(200);
  });

  it('replaces a primitive in target with a nested object from source', () => {
    const target: IImporterConfig = {
      ...baseConfig(),
      delayBetweenBanks: 1000,
    };
    const merged = deepMerge(target, {
      proxy: { server: 'http://proxy:8080' },
    });
    expect(merged.delayBetweenBanks).toBe(1000);
    expect(merged.proxy?.server).toBe('http://proxy:8080');
  });

  it('replaces a nested object in target with a primitive from source', () => {
    const target = baseConfig();
    const merged = deepMerge(target, { actual: 'not-an-object' as never });
    expect(merged.actual as unknown).toBe('not-an-object');
  });

  it('keeps target value when source value is undefined', () => {
    const target = baseConfig();
    const merged = deepMerge(target, { delayBetweenBanks: undefined });
    expect(merged.delayBetweenBanks).toBeUndefined();
  });

  it('overrides target value when source value is null', () => {
    const target: IImporterConfig = { ...baseConfig(), delayBetweenBanks: 1234 };
    const merged = deepMerge(target, { delayBetweenBanks: null as unknown as number });
    expect(merged.delayBetweenBanks).toBeNull();
  });

  it('merges three-level deep nested objects (notifications.telegram)', () => {
    const target: IImporterConfig = {
      ...baseConfig(),
      notifications: {
        enabled: true,
        telegram: { botToken: 'old', chatId: 'old', messageFormat: 'summary' },
      },
    };
    const merged = deepMerge(target, {
      notifications: {
        enabled: true,
        telegram: { botToken: 'new', chatId: 'old' },
      },
    });
    expect(merged.notifications?.telegram?.botToken).toBe('new');
    expect(merged.notifications?.telegram?.chatId).toBe('old');
    expect(merged.notifications?.telegram?.messageFormat).toBe('summary');
  });

  it('returns an empty target intact when source is empty', () => {
    const target = baseConfig();
    const merged = deepMerge(target, {});
    expect(merged).toEqual(target);
  });

  it('extends banks map with new bank entries without removing existing ones', () => {
    const target: IImporterConfig = {
      ...baseConfig(),
      banks: { discount: { id: 'd-id', password: 'd-pw', num: 'd-num' } },
    };
    const merged = deepMerge(target, {
      banks: { leumi: { username: 'l-user', password: 'l-pw' } },
    });
    expect(merged.banks.discount?.id).toBe('d-id');
    expect(merged.banks.leumi?.username).toBe('l-user');
  });
});
