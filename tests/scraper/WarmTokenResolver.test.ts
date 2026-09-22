/**
 * WarmTokenResolver tests — proves a token captured by a previous run wins
 * over the bootstrap seed in config, and that neither value reaches the logs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withWarmToken } from '../../src/Scraper/Tokens/WarmTokenResolver.js';
import type { ILogger } from '../../src/Logger/ILogger.js';
import { fakeBankConfig, fakeBankTokenStore } from '../helpers/factories.js';

const STORED = 'stored-ten-year-id-token';
const SEEDED = 'config-bootstrap-token';

const logger = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
} as unknown as ILogger;

describe('withWarmToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the token a previous run captured over the config seed', () => {
    const config = fakeBankConfig({ id: 'oneZero', otpLongTermToken: SEEDED });
    const store = fakeBankTokenStore({ oneZero: STORED });

    const resolved = withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    expect(resolved.otpLongTermToken).toBe(STORED);
  });

  it('falls back to the config seed on the very first run', () => {
    const config = fakeBankConfig({ id: 'oneZero', otpLongTermToken: SEEDED });
    const store = fakeBankTokenStore();

    const resolved = withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    expect(resolved.otpLongTermToken).toBe(SEEDED);
  });

  it('leaves the config untouched when no token exists anywhere', () => {
    const config = fakeBankConfig({ id: 'oneZero' });
    const store = fakeBankTokenStore();

    const resolved = withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    expect(resolved.otpLongTermToken).toBeUndefined();
  });

  it('never consults the store for a bank that cannot warm-start', () => {
    const config = fakeBankConfig({ id: 'hapoalim' });
    const store = fakeBankTokenStore({ hapoalim: STORED });

    const resolved = withWarmToken(config, { store, bankId: 'hapoalim', storeKey: 'hapoalim', companyType: 'hapoalim', logger });

    expect(resolved.otpLongTermToken).toBeUndefined();
  });

  it('says the configured seed is in use when the store holds nothing', () => {
    const config = fakeBankConfig({ id: 'oneZero', otpLongTermToken: SEEDED });
    const store = fakeBankTokenStore();

    withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    const [[line]] = vi.mocked(logger.info).mock.calls;
    expect(line).toContain('Using the configured long-term token');
  });

  it('warns an SMS is coming when neither source holds a token', () => {
    const config = fakeBankConfig({ id: 'oneZero' });
    const store = fakeBankTokenStore();

    withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    const [[line]] = vi.mocked(logger.info).mock.calls;
    expect(line).toContain('expect one SMS this run');
  });

  it('does not mutate the caller\'s bank config', () => {
    const config = fakeBankConfig({ id: 'oneZero', otpLongTermToken: SEEDED });
    const store = fakeBankTokenStore({ oneZero: STORED });

    withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    expect(config.otpLongTermToken).toBe(SEEDED);
  });

  it('preserves every other credential field', () => {
    const config = fakeBankConfig({ id: 'oneZero', email: 'a@b.co', password: 'pw' });
    const store = fakeBankTokenStore({ oneZero: STORED });

    const resolved = withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    expect(resolved.email).toBe('a@b.co');
    expect(resolved.password).toBe('pw');
  });

  it('never writes either token value to the logs', () => {
    const config = fakeBankConfig({ id: 'oneZero', otpLongTermToken: SEEDED });
    const store = fakeBankTokenStore({ oneZero: STORED });

    withWarmToken(config, { store, bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', logger });

    const calls = [
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.debug).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ];
    const text = JSON.stringify(calls);
    expect(text).not.toContain(STORED);
    expect(text).not.toContain(SEEDED);
  });
});
