/**
 * E2E: the long-term token file sealed under the config password.
 *
 * <p>A long-term token skips the bank's SMS, so a copied token file must not
 * hand it over. This suite sets the config password and drives the shipped
 * composition through {@link runImport}, once for each API-direct bank,
 * against the fake bank from {@link openApiDirectBank}. The token must still
 * replay, while the file on disk holds neither the token nor the login it is
 * bound to. A changed password must cost one SMS, not every run.
 */

import { readdirSync, readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import type { IApiDirectBank } from '../helpers/apiDirectBanks.js';
import { API_DIRECT_BANKS } from '../helpers/apiDirectBanks.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';
import type { IFakeApiDirectBank } from './helpers/fakeApiDirectBank.js';
import { openApiDirectBank } from './helpers/fakeApiDirectBank.js';
import type { IRun, ITokenStoreDir } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, countingPrompter, everythingLogged, openTokenStore, runImport, storedTokens,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** One run, and how many SMS codes it asked the operator for. */
interface ISealedRun extends IRun {
  readonly smsCount: number;
}

/** The config password after the operator changes it. */
const CHANGED_PASSWORD = `${TEST_ENCRYPTION_KEY}-changed`;

let store: ITokenStoreDir;

/**
 * Imports one entry, with a prompter that counts the SMS codes it is asked for.
 * @param entry - The entry's name.
 * @param bankConfig - The entry's config.
 * @returns The run, and how many SMS codes it asked for.
 */
async function importOnce(entry: string, bankConfig: IBankConfig): Promise<ISealedRun> {
  const sms = countingPrompter();
  const run = await runImport({ entry, bankConfig, prompter: sms.prompter });
  return { ...run, smsCount: sms.smsCount() };
}

/**
 * Lists the files the store set aside as damaged.
 * @returns Their names.
 */
function quarantinedFiles(): string[] {
  return readdirSync(store.directory).filter((name) => name.startsWith('bank-tokens.json.quarantined-'));
}

describe.each(API_DIRECT_BANKS)('E2E: long-term token sealed at rest, $name', (row: IApiDirectBank) => {
  const [FIRST] = row.entries;
  const storeKey = `${row.bankId}:${FIRST}`;
  let bank: IFakeApiDirectBank;

  /**
   * Fingerprints an entry's login the way the importer binds tokens.
   * @param bankConfig - The entry's config.
   * @returns The login fingerprint.
   */
  const loginOf = (bankConfig: IBankConfig): string => {
    const login = loginFingerprint(row.companyType, bankConfig);
    if (!login.success) throw new Error(login.message);
    return login.data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store = openTokenStore('warm-start-sealed-');
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    bank = openApiDirectBank(provider.createScraper, row);
  });

  afterEach(() => {
    closeTokenStore(store);
  });

  it('logs in warm with no SMS, while the file holds neither the token nor the login', async () => {
    const entry = bank.customer();

    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

    expect(runs.map((run) => run.smsCount)).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, bank.minted[0]]);
    const onDisk = readFileSync(store.tokensPath, 'utf8');
    expect(onDisk).not.toContain(bank.minted[0]);
    expect(onDisk).not.toContain(loginOf(entry));
    expect(storedTokens(store.tokensPath)[storeKey]).toMatchObject({ encrypted: true, version: 1 });
    const logged = runs.map((run) => everythingLogged(run.logger)).join('\n');
    expect(logged).not.toContain(bank.minted[0]);
  });

  it('after the password changes, costs one SMS, sets the old file aside, then logs in warm', async () => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = CHANGED_PASSWORD;

    const changed = await importOnce(FIRST, entry);
    const healed = await importOnce(FIRST, entry);

    expect([changed.smsCount, healed.smsCount]).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, undefined, bank.minted[1]]);
    expect(JSON.stringify(changed.logger.warn.mock.calls)).toContain(
      `The token file is damaged and holds no usable long-term token for ${storeKey}`,
    );
    expect(quarantinedFiles()).toHaveLength(1);
  });
});
