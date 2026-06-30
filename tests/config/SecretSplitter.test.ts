import { describe, expect, it } from 'vitest';

import splitSecrets from '../../src/Config/SecretSplitter.js';
import { fakeBankConfig, fakeImporterConfig, fakeTelegramConfig } from '../helpers/factories.js';

describe('SecretSplitter.splitSecrets', () => {
  it('moves bank login identifiers + secrets into the secrets half', () => {
    const config = fakeImporterConfig({
      banks: { discount: fakeBankConfig({ id: '123', num: undefined, password: 'pw', otpLongTermToken: 'otp', daysBack: 7 }) },
    });
    const { settings, secrets } = splitSecrets(config);
    expect(secrets.banks?.discount).toEqual({ id: '123', password: 'pw', otpLongTermToken: 'otp' });
    expect(settings.banks.discount.id).toBeUndefined();
    expect(settings.banks.discount.password).toBeUndefined();
    expect(settings.banks.discount.otpLongTermToken).toBeUndefined();
    expect(settings.banks.discount.daysBack).toBe(7);
  });

  it('leaves banks without secrets clean in both halves', () => {
    const config = fakeImporterConfig({
      banks: { discount: fakeBankConfig({ id: undefined, num: undefined, password: undefined, otpLongTermToken: undefined, daysBack: 5 }) },
    });
    const { settings, secrets } = splitSecrets(config);
    expect(settings.banks.discount.daysBack).toBe(5);
    expect(secrets.banks?.discount).toBeUndefined();
  });

  it('routes portal, actual, and notification secrets out of settings', () => {
    const config = fakeImporterConfig({
      portal: {
        enabled: true, passwordHash: 'hash', sessionSecret: 'session-secret-1234',
        google: { clientId: 'id', clientSecret: 'cs', redirectUri: 'r', allowedEmails: [] },
      },
      notifications: { enabled: true, telegram: fakeTelegramConfig({ botToken: 'bt' }), webhook: { url: 'https://hook' } },
    });
    const { settings, secrets } = splitSecrets(config);
    expect(settings.actual.init.password).toBeUndefined();
    expect(secrets.actual?.init.password).toBeDefined();
    expect(settings.portal?.passwordHash).toBeUndefined();
    expect(settings.portal?.sessionSecret).toBeUndefined();
    expect(settings.portal?.google?.clientSecret).toBeUndefined();
    expect(secrets.portal).toMatchObject({ passwordHash: 'hash', sessionSecret: 'session-secret-1234' });
    expect(secrets.portal?.google?.clientSecret).toBe('cs');
    expect(settings.notifications?.telegram?.botToken).toBeUndefined();
    expect(settings.notifications?.webhook?.url).toBeUndefined();
    expect(secrets.notifications?.telegram?.botToken).toBe('bt');
    expect(secrets.notifications?.webhook?.url).toBe('https://hook');
  });

  it('keeps non-secret portal + notification fields in settings', () => {
    const config = fakeImporterConfig({
      portal: { enabled: true, sessionSecret: 'session-secret-1234', google: { clientId: 'id', redirectUri: 'r', allowedEmails: ['a@b.c'] } },
      notifications: { enabled: true, telegram: fakeTelegramConfig({ botToken: 'bt', chatId: '-42' }) },
    });
    const { settings } = splitSecrets(config);
    expect(settings.portal?.enabled).toBe(true);
    expect(settings.portal?.google?.clientId).toBe('id');
    expect(settings.notifications?.telegram?.chatId).toBe('-42');
  });

  it('relocates a numeric secret out of the never-encrypted settings half', () => {
    const config = fakeImporterConfig({
      banks: { discount: fakeBankConfig({ id: undefined, num: undefined, otpLongTermToken: undefined, password: 654321 as unknown as string, daysBack: 7 }) },
    });
    const { settings, secrets } = splitSecrets(config);
    expect(secrets.banks?.discount).toEqual({ password: 654321 });
    expect(settings.banks.discount.password).toBeUndefined();
    expect(settings.banks.discount.daysBack).toBe(7);
  });
});
