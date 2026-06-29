import { describe, expect, it } from 'vitest';

import splitSecrets from '../../src/Config/SecretSplitter.js';
import { fakeBankConfig, fakeImporterConfig } from '../helpers/factories.js';

describe('SecretSplitter.splitSecrets', () => {
  it('moves bank password + otpLongTermToken into the secrets half', () => {
    const config = fakeImporterConfig({
      banks: { discount: fakeBankConfig({ id: '123', password: 'pw', otpLongTermToken: 'otp', daysBack: 7 }) },
    });
    const { settings, secrets } = splitSecrets(config);
    expect(secrets.banks?.discount).toEqual({ password: 'pw', otpLongTermToken: 'otp' });
    expect(settings.banks.discount.password).toBeUndefined();
    expect(settings.banks.discount.otpLongTermToken).toBeUndefined();
    expect(settings.banks.discount.id).toBe('123');
  });

  it('leaves banks without secrets clean in both halves', () => {
    const config = fakeImporterConfig({ banks: { discount: fakeBankConfig({ id: '7', password: undefined, otpLongTermToken: undefined }) } });
    const { settings, secrets } = splitSecrets(config);
    expect(settings.banks.discount.id).toBe('7');
    expect(secrets.banks?.discount).toBeUndefined();
  });
});
