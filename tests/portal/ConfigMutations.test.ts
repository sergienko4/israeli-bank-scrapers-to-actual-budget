import { describe, expect, it } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';
import {
  addBank, coerceAccounts, coerceTargetAccounts, maskSecrets, removeBank, restoreMasked,
} from '../../src/Portal/ConfigMutations.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig, fakeTelegramConfig } from '../helpers/factories.js';

const MASK = '********';

describe('ConfigMutations', () => {
  describe('maskSecrets', () => {
    it('masks secret-keyed strings while keeping other fields', () => {
      const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '12345', password: 'topsecret' }) } });
      const masked = maskSecrets(config);
      expect(masked.banks.discount.password).toBe(MASK);
      expect(masked.banks.discount.id).toBe('12345');
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
  });

  describe('restoreMasked', () => {
    it('replaces MASK values with the previous secret', () => {
      const restored = restoreMasked({ password: MASK, id: '999' }, { password: 'real', id: '111' });
      expect(restored).toEqual({ password: 'real', id: '999' });
    });

    it('returns primitives unchanged', () => {
      expect(restoreMasked('plain', undefined)).toBe('plain');
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
});
