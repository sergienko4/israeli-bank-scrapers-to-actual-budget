/**
 * E2E: logging in with the stored long-term token through the real import assembly.
 *
 * <p>A long-term token is what lets an unattended run skip the SMS login, and
 * for Pepper and PayBox it logs in by itself, so the token a run sends decides
 * whose account it imports. This suite drives the shipped composition through
 * {@link runImport}, once for each API-direct bank, against a fake bank
 * ({@link openApiDirectBank}) that knows its customers, honours only the
 * latest fresh token it minted for each account, imports the account the
 * token belongs to, and charges one SMS code for a cold login.
 *
 * <p>Each account returns its own account number, so a run that sends a token
 * for the wrong login shows up as the wrong account, not just a wrong call.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import type { IApiDirectBank } from '../helpers/apiDirectBanks.js';
import { accountOf, API_DIRECT_BANKS } from '../helpers/apiDirectBanks.js';
import type { IFakeApiDirectBank } from './helpers/fakeApiDirectBank.js';
import { accountNumberOf, openApiDirectBank } from './helpers/fakeApiDirectBank.js';
import type { IRun, ITokenStoreDir, SpyLogger } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, countingPrompter, everythingLogged, openTokenStore, runImport, storedTokens,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** One run, and how many SMS codes it asked the operator for. */
interface IReplayRun extends IRun {
  readonly smsCount: number;
}

/** A way the bank stops honouring a token it minted. */
interface IRefusal {
  readonly why: string;
  readonly refuse: (bank: IFakeApiDirectBank, bankConfig: IBankConfig) => void;
}

/** A way the token file can fail, and the warning the run gives for it. */
interface IBrokenStore {
  readonly why: string;
  readonly breakStore: () => void;
  readonly warning: (storeKey: string) => string;
}

/** What upstream returns when a cold login is due and the credentials carry no SMS code retriever. */
const NO_RETRIEVER = { success: false, errorType: 'TWO_FACTOR_RETRIEVER_MISSING' };

let store: ITokenStoreDir;

/**
 * Imports one entry, with a prompter that counts the SMS codes it is asked for.
 * @param entry - The entry's name.
 * @param bankConfig - The entry's config.
 * @returns The run, and how many SMS codes it asked for.
 */
async function importOnce(entry: string, bankConfig: IBankConfig): Promise<IReplayRun> {
  const sms = countingPrompter();
  const run = await runImport({ entry, bankConfig, prompter: sms.prompter });
  return { ...run, smsCount: sms.smsCount() };
}

/**
 * Reads the number of the account a run imported.
 * @param run - The run.
 * @returns The first account's number, if any.
 */
function importedAccount(run: IRun): string | undefined {
  return run.result.accounts?.[0]?.accountNumber;
}

/**
 * Serialises what a logger method was called with, for message checks.
 * @param spy - One logger method.
 * @returns All its calls as one string.
 */
function said(spy: SpyLogger['info']): string {
  return JSON.stringify(spy.mock.calls);
}

/**
 * Lists the warnings a run gave about a token it sent and the bank did not accept.
 * @param run - The run.
 * @returns Each such warning, in order.
 */
function notAcceptedWarnings(run: IRun): string[] {
  return run.logger.warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('was not accepted'));
}

const refusals: IRefusal[] = [
  { why: 'a revoked', refuse: (bank, bankConfig): void => { bank.revoke(bankConfig); } },
  { why: 'an expired', refuse: (bank, bankConfig): void => { bank.expire(bankConfig); } },
];

const damagedFile: IBrokenStore = {
  why: 'is damaged',
  breakStore: (): void => {
    rmSync(store.tokensPath);
    mkdirSync(store.tokensPath);
  },
  warning: (storeKey) => `The token file is damaged, so the configured long-term token for ${storeKey} is not sent`,
};

const brokenStores: IBrokenStore[] = [
  damagedFile,
  {
    why: 'cannot be read',
    breakStore: (): void => {
      const notADirectory = join(store.directory, 'not-a-directory');
      writeFileSync(notADirectory, '');
      process.env.BANK_TOKENS_PATH = join(notADirectory, 'bank-tokens.json');
    },
    warning: (storeKey) => `Could not read the long-term token for ${storeKey}`,
  },
];

describe.each(API_DIRECT_BANKS)('E2E: long-term token replay, $name', (row: IApiDirectBank) => {
  const [FIRST, SECOND] = row.entries;
  let bank: IFakeApiDirectBank;

  /**
   * Names the store key of one of this bank's entries.
   * @param entry - The entry's name.
   * @returns `<bankId>:<entry>`.
   */
  const keyOf = (entry: string): string => `${row.bankId}:${entry}`;

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

  /**
   * Names the account number the bank returns for an entry's login.
   * @param bankConfig - The entry's config.
   * @returns The account number.
   */
  const accountNumberFor = (bankConfig: IBankConfig): string => accountNumberOf(accountOf(row, bankConfig));

  beforeEach(() => {
    vi.clearAllMocks();
    store = openTokenStore('warm-start-replay-');
    bank = openApiDirectBank(provider.createScraper, row);
  });

  afterEach(() => {
    closeTokenStore(store);
  });

  it('logs in cold with one SMS, then with the stored token and no SMS', async () => {
    const entry = bank.customer();

    const cold = await importOnce(FIRST, entry);
    const warm = await importOnce(FIRST, entry);

    expect([cold.smsCount, warm.smsCount]).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, bank.minted[0]]);
    expect(importedAccount(warm)).toBe(accountNumberFor(entry));
    expect(said(warm.logger.info)).toContain(`Using the stored long-term token for ${keyOf(FIRST)}`);
  });

  it('logs in with the stored token and no SMS when twoFactorAuth is off', async () => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);

    const unattended = await importOnce(FIRST, { ...entry, twoFactorAuth: false });

    expect(unattended.result.success).toBe(true);
    expect(unattended.smsCount).toBe(0);
    expect(bank.sent.at(-1)).toBe(bank.minted[0]);
  });

  it.each(refusals)('pays one SMS for $why token, then logs in with its replacement', async ({ refuse }) => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    refuse(bank, entry);

    const refused = await importOnce(FIRST, entry);
    const replaced = await importOnce(FIRST, entry);

    expect([refused.smsCount, replaced.smsCount]).toEqual([1, 0]);
    expect(bank.sent).toEqual([undefined, bank.minted[0], bank.minted[1]]);
    expect(storedTokens(store.tokensPath)[keyOf(FIRST)]?.token).toBe(bank.minted[1]);
  });

  it.each(refusals)('warns once that $why token was not accepted, so the run logs in with an SMS', async ({
    refuse,
  }) => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    refuse(bank, entry);

    const refused = await importOnce(FIRST, entry);

    expect(notAcceptedWarnings(refused)).toEqual([
      `  ⚠️  The long-term token for ${keyOf(FIRST)} was not accepted, so this run logs in with an SMS code`,
    ]);
  });

  it.each(refusals)('says how to fix it when $why token is not accepted and twoFactorAuth is off', async ({
    refuse,
  }) => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    refuse(bank, entry);

    const stuck = await importOnce(FIRST, { ...entry, twoFactorAuth: false });

    expect(notAcceptedWarnings(stuck)).toEqual([
      `  ⚠️  The long-term token for ${keyOf(FIRST)} was not accepted, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login',
    ]);
  });

  it('gives no such warning when the token is accepted, or when none is sent', async () => {
    const entry = bank.customer();
    const cold = await importOnce(FIRST, entry);
    const warm = await importOnce(FIRST, entry);
    const moved = await importOnce(FIRST, bank.movedTo(entry));

    expect([cold, warm, moved].map((run) => run.smsCount)).toEqual([1, 0, 1]);
    expect([cold, warm, moved].flatMap(notAcceptedWarnings)).toEqual([]);
  });

  it.each(refusals)('fails with no SMS for $why token when twoFactorAuth is off, keeping the token', async ({
    refuse,
  }) => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    refuse(bank, entry);

    const stuck = await importOnce(FIRST, { ...entry, twoFactorAuth: false });

    expect(stuck.result).toMatchObject(NO_RETRIEVER);
    expect(stuck.smsCount).toBe(0);
    expect(bank.sent).toEqual([undefined, bank.minted[0]]);
    expect(storedTokens(store.tokensPath)[keyOf(FIRST)]?.token).toBe(bank.minted[0]);
  });

  it('keeps a token per entry, so two entries of one bank both log in without SMS', async () => {
    const first = bank.customer();
    const second = bank.customer();
    expect(loginOf(second)).not.toBe(loginOf(first));
    await importOnce(FIRST, first);
    await importOnce(SECOND, second);

    const again = [await importOnce(FIRST, first), await importOnce(SECOND, second)];

    expect(again.map((run) => run.smsCount)).toEqual([0, 0]);
    expect(again.map(importedAccount)).toEqual([accountNumberFor(first), accountNumberFor(second)]);
  });

  it('never sends the stored token after the login changes, and binds the new one', async () => {
    const before = bank.customer();
    await importOnce(FIRST, before);
    const after = bank.movedTo(before);
    expect(loginOf(after)).not.toBe(loginOf(before));

    const changed = await importOnce(FIRST, after);

    expect(bank.sent[1]).toBeUndefined();
    expect(changed.smsCount).toBe(1);
    expect(importedAccount(changed)).toBe(accountNumberFor(after));
    expect(storedTokens(store.tokensPath)[keyOf(FIRST)]).toMatchObject({ token: bank.minted[1], login: loginOf(after) });
  });

  it('never sends a configured token minted for another login', async () => {
    const owner = bank.customer();
    await importOnce(FIRST, owner);
    const clone = bank.customer({ otpLongTermToken: bank.minted[0] });
    expect(loginOf(clone)).not.toBe(loginOf(owner));

    const cloned = await importOnce(SECOND, clone);

    expect(bank.sent[1]).toBeUndefined();
    expect(importedAccount(cloned)).toBe(accountNumberFor(clone));
    expect(said(cloned.logger.warn)).toContain(
      `The configured long-term token for ${keyOf(SECOND)} belongs to another login, so it is not sent`,
    );
  });

  it('sends a configured token the store has never seen, with no SMS, and binds it to the login', async () => {
    const entry = bank.customer();
    const seed = bank.mintElsewhere(entry);

    const seeded = await importOnce(FIRST, { ...entry, otpLongTermToken: seed });

    expect(seeded.smsCount).toBe(0);
    expect(bank.sent).toEqual([seed]);
    expect(importedAccount(seeded)).toBe(accountNumberFor(entry));
    expect(storedTokens(store.tokensPath)[keyOf(FIRST)]).toMatchObject({ token: seed, login: loginOf(entry) });
  });

  it.each(brokenStores)('sends no token, not even its own configured one, when the token file $why', async ({
    breakStore, warning,
  }) => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    breakStore();

    const broken = await importOnce(FIRST, { ...entry, otpLongTermToken: bank.minted[0] });

    expect(bank.sent[1]).toBeUndefined();
    expect(broken.smsCount).toBe(1);
    expect(said(broken.logger.warn)).toContain(warning(keyOf(FIRST)));
  });

  it('warns when the token file is damaged and no token is configured, then logs in with an SMS', async () => {
    const entry = bank.customer();
    await importOnce(FIRST, entry);
    damagedFile.breakStore();

    const broken = await importOnce(FIRST, entry);

    expect(bank.sent[1]).toBeUndefined();
    expect(broken.smsCount).toBe(1);
    expect(said(broken.logger.warn)).toContain(
      `The token file is damaged and holds no usable long-term token for ${keyOf(FIRST)}`,
    );
  });

  it('fails, and says how to fix it, when twoFactorAuth is off and no token is usable', async () => {
    const entry = bank.customer({ twoFactorAuth: false });

    const stuck = await importOnce(FIRST, entry);

    expect(stuck.result).toMatchObject(NO_RETRIEVER);
    expect(stuck.smsCount).toBe(0);
    expect(bank.sent).toEqual([undefined]);
    expect(said(stuck.logger.warn)).toContain(
      `No usable long-term token for ${keyOf(FIRST)}, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login, or restore the token file',
    );
  });

  it('never logs a token, cold, warm, revoked, expired or after a login change', async () => {
    const entry = bank.customer();
    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];
    bank.revoke(entry);
    runs.push(await importOnce(FIRST, entry));
    bank.expire(entry);
    runs.push(await importOnce(FIRST, entry), await importOnce(FIRST, bank.movedTo(entry)));

    const logged = runs.map((run) => everythingLogged(run.logger)).join('\n');

    expect(bank.minted).toHaveLength(4);
    for (const token of bank.minted) expect(logged).not.toContain(token);
  });
});
