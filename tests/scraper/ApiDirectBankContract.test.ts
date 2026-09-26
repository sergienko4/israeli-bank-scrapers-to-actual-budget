import { SCRAPERS } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import { createBankRegistry } from '../../src/Scraper/BankRegistry.js';
import buildCredentials from '../../src/Scraper/CredentialsBuilder.js';
import { isApiDirectBank } from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import type { IApiDirectBank } from '../helpers/apiDirectBanks.js';
import {
  accountOf, API_DIRECT_BANKS, apiDirectEntry, drawAccountValue, loginValuesOf,
} from '../helpers/apiDirectBanks.js';
import { fakeUuid } from '../helpers/factories.js';

/**
 * The three API-direct banks, held against upstream and the importer.
 *
 * <p>The long-term token suites fake each bank from the rows in
 * `apiDirectBanks.ts`. This file proves those rows are true: upstream logs in
 * with the fields a row names, each entry name reaches that bank's scraper,
 * and the importer builds the credentials the bank expects. If it goes red
 * after a dependency bump, the fake banks no longer match the real ones.
 */

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

/**
 * Fingerprints an entry's login, failing the case when none is derived.
 * @param bank - The bank.
 * @param bankConfig - The entry.
 * @returns The login fingerprint.
 */
function fingerprintOf(bank: IApiDirectBank, bankConfig: IBankConfig): string {
  const login = loginFingerprint(bank.companyType, bankConfig);
  if (!login.success) throw new Error(login.message);
  return login.data;
}

/**
 * Builds an SMS code retriever that is never asked.
 * @returns The retriever.
 */
function smsRetriever(): () => Promise<string> {
  return vi.fn(() => Promise.resolve('482913'));
}

describe.each(API_DIRECT_BANKS)('API-direct bank contract: $name', (bank) => {
  it('logs in upstream with the fields the fake bank checks', () => {
    const upstream = SCRAPERS[bank.companyType as keyof typeof SCRAPERS];

    expect(upstream.loginFields).toEqual(bank.loginFields);
  });

  it('reaches this bank from both entry names', () => {
    const registry = createBankRegistry();

    const resolved = bank.entries.map((name) => {
      const entry = registry.resolve(name);
      if (!entry.success) throw new Error(entry.message);
      return { bankId: entry.data.bankId, companyType: entry.data.companyType };
    });

    const expected = { bankId: bank.bankId, companyType: bank.companyType };
    expect(resolved).toEqual([expected, expected]);
  });

  it('is an API-direct bank, so its tokens are stored and replayed', () => {
    expect(isApiDirectBank(bank.companyType)).toBe(true);
  });

  it('fingerprints the login of a valid entry', () => {
    const login = loginFingerprint(bank.companyType, apiDirectEntry(bank));

    expect(login.success).toBe(true);
  });

  it('fingerprints another login when the account changes', () => {
    const before = apiDirectEntry(bank);
    const after = { ...before, [bank.accountField]: drawAccountValue(bank) };

    expect(accountOf(bank, after)).not.toBe(accountOf(bank, before));
    expect(fingerprintOf(bank, after)).not.toBe(fingerprintOf(bank, before));
  });

  it('sends the login, the token and the SMS retriever when it has a token', () => {
    const token = fakeUuid();
    const entry = apiDirectEntry(bank, { otpLongTermToken: token });
    const retriever = smsRetriever();

    const credentials = buildCredentials(entry, retriever);

    expect(credentials).toMatchObject({
      ...loginValuesOf(bank, entry), otpLongTermToken: token, otpCodeRetriever: retriever,
    });
  });

  it('sends the login and the SMS retriever, and no token, when it has none', () => {
    const entry = apiDirectEntry(bank);
    const retriever = smsRetriever();

    const credentials = buildCredentials(entry, retriever);

    expect(credentials).toMatchObject({ ...loginValuesOf(bank, entry), otpCodeRetriever: retriever });
    expect(credentials).not.toHaveProperty('otpLongTermToken');
  });
});
