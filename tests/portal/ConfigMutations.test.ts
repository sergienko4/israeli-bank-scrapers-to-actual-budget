import { describe, expect, it } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  addBank, coerceAccounts, coerceTargetAccounts, hashPlainPortalPassword,
  maskSecrets, pruneEmptyNotificationChannels, pruneEmptyOptionalSections, removeBank, restoreMasked,
} from '../../src/Portal/ConfigMutations.js';
import { hashPassword, verifyPassword } from '../../src/Portal/PortalPassword.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig, fakeTelegramConfig } from '../helpers/factories.js';

const MASK = '********';

describe('ConfigMutations', () => {
  describe('maskSecrets', () => {
    it('masks secret-keyed strings while keeping other fields', () => {
      const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '12345', password: 'topsecret', daysBack: 30 }) } });
      const masked = maskSecrets(config);
      expect(masked.banks.discount.password).toBe(MASK);
      expect(masked.banks.discount.id).toBe(MASK);
      expect(masked.banks.discount.daysBack).toBe(30);
    });

    it('passes primitives and empty secrets through untouched', () => {
      expect(maskSecrets(42)).toBe(42);
      expect(maskSecrets({ password: '' })).toEqual({ password: '' });
    });

    it('masks notification botToken and webhook url', () => {
      const config = fakeImporterConfig({
        notifications: { enabled: true, telegram: fakeTelegramConfig({ botToken: 'bt' }), webhook: { url: 'https://hook' } },
      });
      const masked = maskSecrets(config);
      expect(masked.notifications?.telegram?.botToken).toBe(MASK);
      expect(masked.notifications?.webhook?.url).toBe(MASK);
    });

    it('masks a numeric value at a secret key (e.g. a hand-edited numeric password)', () => {
      const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ password: 123456 as unknown as string, daysBack: 30 }) } });
      const masked = maskSecrets(config);
      expect(masked.banks.discount.password).toBe(MASK);
      expect(masked.banks.discount.daysBack).toBe(30);
    });
  });

  describe('restoreMasked', () => {
    it('replaces MASK values with the previous secret', () => {
      const restored = restoreMasked({ password: MASK, id: '999' }, { password: 'real', id: '111' });
      expect(restored).toEqual({ password: 'real', id: '999' });
    });

    it('returns primitives unchanged', () => {
      expect(restoreMasked('plain', undefined)).toBe('plain');
    });

    it('restores masked secrets nested inside array items', () => {
      const next = { items: [{ password: MASK, id: '1' }, { password: 'typed', id: '2' }] };
      const prev = { items: [{ password: 'old-secret', id: '1' }, { password: 'x', id: '2' }] };
      const restored = restoreMasked(next, prev);
      expect(restored.items[0].password).toBe('old-secret');
      expect(restored.items[1].password).toBe('typed');
    });
  });

  describe('hashPlainPortalPassword', () => {
    it('hashes a freshly-typed plaintext portal password so login works', async () => {
      const config = fakeImporterConfig({ portal: { enabled: true, passwordHash: 'Sergienko-Portal-9182' } });
      const out = hashPlainPortalPassword(config);
      expect(out.portal?.passwordHash).toMatch(/^scrypt\$/);
      expect(await verifyPassword('Sergienko-Portal-9182', out.portal?.passwordHash ?? '')).toBe(true);
    });

    it('leaves an already-encoded scrypt hash untouched', () => {
      const stored = hashPassword('Already-Hashed-7766');
      const config = fakeImporterConfig({ portal: { enabled: true, passwordHash: stored } });
      expect(hashPlainPortalPassword(config).portal?.passwordHash).toBe(stored);
    });

    it('hashes a plaintext that merely starts with scrypt$ but is not a real hash', async () => {
      const config = fakeImporterConfig({ portal: { enabled: true, passwordHash: 'scrypt$fake' } });
      const out = hashPlainPortalPassword(config);
      expect(out.portal?.passwordHash).not.toBe('scrypt$fake');
      expect(await verifyPassword('scrypt$fake', out.portal?.passwordHash ?? '')).toBe(true);
    });

    it('leaves empty or absent passwords untouched', () => {
      const empty = fakeImporterConfig({ portal: { enabled: true, passwordHash: '' } });
      expect(hashPlainPortalPassword(empty).portal?.passwordHash).toBe('');
      const none = fakeImporterConfig({ portal: { enabled: true } });
      expect(hashPlainPortalPassword(none).portal?.passwordHash).toBeUndefined();
    });

    it('returns the same config when there is no portal block', () => {
      const config = fakeImporterConfig();
      expect(hashPlainPortalPassword(config)).toBe(config);
    });
  });

  describe('addBank / removeBank', () => {
    const base: IImporterConfig = fakeImporterConfig({ banks: { discount: fakeBankConfig() } });

    it('adds a bank immutably', () => {
      const next = addBank(base, 'leumi', fakeBankConfig());
      expect(Object.keys(next.banks)).toContain('leumi');
      expect(Object.keys(base.banks)).not.toContain('leumi');
    });

    it('removes a bank', () => {
      const next = removeBank(addBank(base, 'leumi', fakeBankConfig()), 'discount');
      expect(Object.keys(next.banks)).toEqual(['leumi']);
    });
  });

  describe('coerceAccounts', () => {
    it('keeps the "all" sentinel for empty, whitespace and "all" input', () => {
      expect(coerceAccounts('all')).toBe('all');
      expect(coerceAccounts('ALL')).toBe('all');
      expect(coerceAccounts('')).toBe('all');
      expect(coerceAccounts('   ')).toBe('all');
    });

    it('splits a comma/space-separated string into trimmed account numbers', () => {
      expect(coerceAccounts('123, 456 ,789')).toEqual(['123', '456', '789']);
      expect(coerceAccounts('123 456')).toEqual(['123', '456']);
    });

    it('cleans existing arrays and falls back to "all" when empty', () => {
      expect(coerceAccounts([' 12 ', '', '34'])).toEqual(['12', '34']);
      expect(coerceAccounts([])).toBe('all');
      expect(coerceAccounts(42)).toBe('all');
    });

    it('preserves the "all" sentinel when it is present inside an array input', () => {
      expect(coerceAccounts(['all'])).toBe('all');
      expect(coerceAccounts(['ALL'])).toBe('all');
      expect(coerceAccounts([' all '])).toBe('all');
      expect(coerceAccounts(['all', '123'])).toBe('all');
    });
  });

  describe('coerceTargetAccounts', () => {
    it('normalizes every bank target accounts field to string[] | "all"', () => {
      const config = fakeImporterConfig({
        banks: {
          discount: fakeBankConfig({
            targets: [
              fakeBankTarget({ accounts: '123,456' as unknown as string[] }),
              fakeBankTarget({ accounts: '' as unknown as 'all' }),
            ],
          }),
        },
      });
      const out = coerceTargetAccounts(config);
      expect(out.banks.discount.targets?.[0].accounts).toEqual(['123', '456']);
      expect(out.banks.discount.targets?.[1].accounts).toBe('all');
    });

    it('leaves banks without targets untouched', () => {
      const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ targets: undefined }) } });
      const out = coerceTargetAccounts(config);
      expect(out.banks.discount.targets).toBeUndefined();
    });
  });

  describe('pruneEmptyOptionalSections', () => {
    it('drops an empty proxy block the UI materialized on navigation', () => {
      const withEmpty = { ...fakeImporterConfig(), proxy: {} } as unknown as IImporterConfig;
      expect('proxy' in pruneEmptyOptionalSections(withEmpty)).toBe(false);
    });

    it('keeps a proxy block that has a server', () => {
      const withProxy = { ...fakeImporterConfig(), proxy: { server: 'http://p:8080' } } as unknown as IImporterConfig;
      expect(pruneEmptyOptionalSections(withProxy).proxy).toEqual({ server: 'http://p:8080' });
    });

    it('drops empty notifications and spendingWatch but keeps required banks', () => {
      const base = fakeImporterConfig();
      const withEmpties = { ...base, notifications: {}, spendingWatch: [] } as unknown as IImporterConfig;
      const pruned = pruneEmptyOptionalSections(withEmpties);
      expect('notifications' in pruned).toBe(false);
      expect('spendingWatch' in pruned).toBe(false);
      expect(pruned.banks).toEqual(base.banks);
    });
  });

  describe('pruneEmptyNotificationChannels', () => {
    it('drops an empty webhook sibling but keeps a configured telegram channel', () => {
      const base = fakeImporterConfig();
      const withEmptySibling = {
        ...base,
        notifications: { enabled: true, telegram: fakeTelegramConfig(), webhook: {} },
      } as unknown as IImporterConfig;
      const pruned = pruneEmptyNotificationChannels(withEmptySibling);
      expect('webhook' in (pruned.notifications ?? {})).toBe(false);
      expect(pruned.notifications?.telegram).toEqual(withEmptySibling.notifications?.telegram);
      expect(pruned.notifications?.enabled).toBe(true);
    });

    it('empties both channels so a top-level prune can drop the whole block (dead-key fix)', () => {
      const base = fakeImporterConfig();
      const materialized = {
        ...base,
        notifications: { telegram: {}, webhook: {} },
      } as unknown as IImporterConfig;
      const pruned = pruneEmptyOptionalSections(pruneEmptyNotificationChannels(materialized));
      expect('notifications' in pruned).toBe(false);
    });

    it('leaves a config without notifications untouched', () => {
      const base = fakeImporterConfig();
      expect(pruneEmptyNotificationChannels(base)).toEqual(base);
    });
  });
});
