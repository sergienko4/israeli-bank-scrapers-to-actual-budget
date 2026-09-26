/**
 * E2E: a rejected SMS code ends an API-direct bank's run without a second code.
 *
 * <p>An API-direct bank sends one SMS code per run. When the bank rejects the
 * code (`INVALID_OTP`), a retry would be a new login and a second SMS, so the
 * importer reports the rejection and leaves the new code to the next run. A
 * browser bank keeps its one retry with a new code.
 *
 * <p>Each case drives the shipped composition through {@link runImport}. The
 * API-direct cases run against the fake bank of {@link openApiDirectBank},
 * which rejects the code of a cold login when a case asks it to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IBankConfig } from '../../src/Types/Index.js';
import type { IApiDirectBank } from '../helpers/apiDirectBanks.js';
import { accountOf, API_DIRECT_BANKS } from '../helpers/apiDirectBanks.js';
import { fakeValidBankConfigFor } from '../helpers/factories.js';
import type { IFakeApiDirectBank } from './helpers/fakeApiDirectBank.js';
import { accountNumberOf, openApiDirectBank } from './helpers/fakeApiDirectBank.js';
import type { IRun, ITokenStoreDir } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, countingPrompter, openTokenStore, runImport, scrapedAccount, storedTokens,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** One run, and how many SMS codes it asked the operator for. */
interface ICodeRun extends IRun {
  readonly smsCount: number;
}

let store: ITokenStoreDir;

beforeEach(() => {
  vi.clearAllMocks();
  store = openTokenStore('rejected-sms-code-');
});

afterEach(() => {
  closeTokenStore(store);
});

/**
 * Imports one entry, with a prompter that counts the SMS codes it is asked for.
 * @param entry - The entry's name.
 * @param bankConfig - The entry's config.
 * @returns The run, and how many SMS codes it asked for.
 */
async function importOnce(entry: string, bankConfig: IBankConfig): Promise<ICodeRun> {
  const sms = countingPrompter();
  const run = await runImport({ entry, bankConfig, prompter: sms.prompter });
  return { ...run, smsCount: sms.smsCount() };
}

/**
 * Lists the warnings a run gave about a rejected code.
 * @param run - The run.
 * @returns Each such warning, in order.
 */
function otpWarnings(run: IRun): string[] {
  return run.logger.warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('OTP rejected'));
}

describe.each(API_DIRECT_BANKS)('E2E: a rejected SMS code, $name', (row: IApiDirectBank) => {
  const [ENTRY] = row.entries;
  let bank: IFakeApiDirectBank;

  beforeEach(() => {
    bank = openApiDirectBank(provider.createScraper, row);
  });

  it('fails with INVALID_OTP after one SMS code, without a second login', async () => {
    const entry = bank.customer();
    bank.rejectNextCode();

    const rejected = await importOnce(ENTRY, entry);

    expect(rejected.result).toMatchObject({ success: false, errorType: 'INVALID_OTP' });
    expect(rejected.smsCount).toBe(1);
    expect(bank.sent).toEqual([undefined]);
    expect(bank.minted).toEqual([]);
  });

  it('warns and notifies once that this run asks for no new code', async () => {
    bank.rejectNextCode();

    const rejected = await importOnce(ENTRY, bank.customer());

    expect(otpWarnings(rejected)).toEqual([`  ⚠️  OTP rejected for ${row.bankId} — this run asks for no new code`]);
    expect(rejected.notified).toEqual([
      `⚠️ OTP for <b>${row.bankId}</b> was rejected. This run asks for no new code; `
      + 'the next run can ask for a new one.',
    ]);
  });

  it('logs in with one new SMS code on the next run, and stores its token', async () => {
    const entry = bank.customer();
    bank.rejectNextCode();
    await importOnce(ENTRY, entry);

    const next = await importOnce(ENTRY, entry);

    expect(next.smsCount).toBe(1);
    expect(next.result.accounts?.[0]?.accountNumber).toBe(accountNumberOf(accountOf(row, entry)));
    expect(storedTokens(store.tokensPath)[`${row.bankId}:${ENTRY}`]?.token).toBe(bank.minted[0]);
  });
});

describe('E2E: a rejected SMS code, browser bank', () => {
  it('asks once more for a new code and imports with it', async () => {
    provider.createScraper
      .mockImplementationOnce(() => ({ scrape: () => Promise.resolve({ success: false, errorType: 'INVALID_OTP' }) }))
      .mockImplementationOnce(() => ({ scrape: () => Promise.resolve(scrapedAccount()) }));

    const retried = await runImport({ entry: 'discount', bankConfig: fakeValidBankConfigFor('discount') });

    expect(retried.result.success).toBe(true);
    expect(provider.createScraper).toHaveBeenCalledTimes(2);
    expect(retried.notified).toEqual([
      '⚠️ OTP for <b>discount</b> was rejected. A new code will be requested — please check your SMS.',
    ]);
  });
});
