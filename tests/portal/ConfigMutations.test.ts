import { describe, expect, it } from 'vitest';

import type { IImporterConfig } from '../../src/Types/Index.js';
import { addBank, maskSecrets, removeBank, restoreMasked, setTargets } from '../../src/Portal/ConfigMutations.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig } from '../helpers/factories.js';

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

  describe('addBank / removeBank / setTargets', () => {
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

    it('replaces targets', () => {
      const targets = [fakeBankTarget(), fakeBankTarget()];
      const next = setTargets(base, 'discount', targets);
      expect(next.banks.discount.targets).toHaveLength(2);
    });
  });
});
