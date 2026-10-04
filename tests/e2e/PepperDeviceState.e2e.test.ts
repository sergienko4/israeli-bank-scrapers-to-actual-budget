/**
 * E2E: Pepper's enrolled-device login through the real import assembly.
 *
 * <p>From scraper 8.7.4 Pepper keeps a login across runs only as an enrolled
 * device: one SMS code enrolls it, and the state Pepper hands back logs in
 * later runs with no code. This suite drives the shipped composition through
 * {@link runImport} against the fake Pepper from {@link openPepper}, with the
 * token file sealed under the config password, and checks what the operator
 * relies on:
 *
 * <ul>
 *   <li>one SMS code enrolls, and the next runs ask for none;</li>
 *   <li>no long-term token is ever sent, even one an earlier version stored;</li>
 *   <li>a renewed state replaces the old one;</li>
 *   <li>a state Pepper refuses is removed, so the next run enrolls again
 *       with one code instead of failing every run, while a failure that may
 *       pass keeps it;</li>
 *   <li>a state that cannot be stored fails the run and keeps the old one.</li>
 * </ul>
 */

import { chmodSync, readFileSync } from 'node:fs';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import openBankTokenStore from '../../src/Importer/BankTokenStoreWiring.js';
import loginFingerprint from '../../src/Scraper/Tokens/LoginFingerprint.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeUuid } from '../helpers/factories.js';
import { TEST_ENCRYPTION_KEY } from '../helpers/testCredentials.js';
import type { IFakePepper } from './helpers/fakePepperBank.js';
import { DATA_REFUSED, LOGIN_REFUSED, openPepper, PEPPER } from './helpers/fakePepperBank.js';
import type { IRun, ITokenStoreDir } from './helpers/warmStartHarness.js';
import {
  closeTokenStore, countingPrompter, everythingLogged, openTokenStore, runImport, spyLogger,
} from './helpers/warmStartHarness.js';

const provider = vi.hoisted(() => ({ createScraper: vi.fn() }));
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: provider.createScraper };
});

/** A directory mode that denies writes is ignored on Windows and by root. */
const CANNOT_DENY_WRITES = process.platform === 'win32' || process.getuid?.() === 0;

const [FIRST, SECOND] = PEPPER.entries;

/** One run, and how many SMS codes it asked the operator for. */
interface IPepperRun extends IRun {
  readonly smsCount: number;
}

let store: ITokenStoreDir;
let pepper: IFakePepper;

/**
 * Imports one entry, with a prompter that counts the SMS codes it is asked for.
 *
 * <p>A failed scrape ends the import with a thrown error, as it ends the
 * importer's run, so the run is read from the logger it was given.
 * @param entry - The entry's name.
 * @param bankConfig - The entry's config.
 * @returns The run, failed when the import threw, and how many SMS codes it asked for.
 */
async function importOnce(entry: string, bankConfig: IBankConfig): Promise<IPepperRun> {
  const sms = countingPrompter();
  const logger = spyLogger();
  const run = await runImport({ entry, bankConfig, prompter: sms.prompter, logger }).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result = { success: false, errorMessage } as IScraperScrapingResult;
    return { result, logger, bankConfig, notified: [] };
  });
  return { ...run, smsCount: sms.smsCount() };
}

/**
 * Names the key an entry's device state is stored under.
 * @param entry - The entry's name.
 * @returns The store key.
 */
function deviceKey(entry: string): string {
  return `pepper-device:${entry}`;
}

/**
 * Reads what the next run would read for a key, through the shipped store.
 * @param storeKey - The key.
 * @returns The stored value, or an empty string when there is none.
 */
function storedUnder(storeKey: string): string {
  const view = openBankTokenStore().read(storeKey);
  if (!view.success) throw new Error(view.message);
  return view.data.record.token;
}

/**
 * Fingerprints an entry's login the way the importer binds what it stores.
 * @param bankConfig - The entry's config.
 * @returns The login fingerprint.
 */
function loginOf(bankConfig: IBankConfig): string {
  const login = loginFingerprint(PEPPER.companyType, bankConfig);
  if (!login.success) throw new Error(login.message);
  return login.data;
}

/**
 * Collects every warning a run logged.
 * @param run - The run.
 * @returns The warnings, as one string.
 */
function warningsOf(run: IRun): string {
  return JSON.stringify(run.logger.warn.mock.calls);
}

describe('E2E: Pepper device login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = openTokenStore('pepper-device-');
    process.env.CREDENTIALS_ENCRYPTION_PASSWORD = TEST_ENCRYPTION_KEY;
    pepper = openPepper(provider.createScraper);
  });

  afterEach(() => {
    chmodSync(store.directory, 0o700);
    closeTokenStore(store);
  });

  it('enrolls with one SMS code, then logs in with none, sending no long-term token', async () => {
    const entry = pepper.customer();

    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

    expect(runs.map((run) => run.result.success)).toEqual([true, true]);
    expect(runs.map((run) => run.smsCount)).toEqual([1, 0]);
    expect(pepper.sentStates).toEqual([undefined, pepper.issued[0]]);
    expect(pepper.sentTokens).toEqual([undefined, undefined]);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[0]);
  });

  it('seals the state: the file holds neither the state nor the login, and no log shows the state', async () => {
    const entry = pepper.customer();

    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

    const [state] = pepper.issued;
    const onDisk = readFileSync(store.tokensPath, 'utf8');
    expect(onDisk).not.toContain(state);
    expect(onDisk).not.toContain(loginOf(entry));
    expect(runs.map((run) => everythingLogged(run.logger)).join('\n')).not.toContain(state);
  });

  it('never sends the long-term token an earlier version stored, and enrolls once instead', async () => {
    const entry = pepper.customer();
    const legacyToken = `lt-${fakeUuid()}`;
    openBankTokenStore().write(`pepper:${FIRST}`, legacyToken, loginOf(entry));

    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

    expect(runs.map((run) => run.smsCount)).toEqual([1, 0]);
    expect(pepper.sentTokens).toEqual([undefined, undefined]);
    expect(runs.map((run) => everythingLogged(run.logger)).join('\n')).not.toContain(legacyToken);
  });

  it('renews an expired access token with no SMS code and keeps the renewed state', async () => {
    const entry = pepper.customer();
    await importOnce(FIRST, entry);
    pepper.expire(entry);

    const runs = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

    expect(runs.map((run) => run.smsCount)).toEqual([0, 0]);
    expect(pepper.issued).toHaveLength(2);
    expect(pepper.sentStates).toEqual([undefined, pepper.issued[0], pepper.issued[1]]);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[1]);
  });

  it('warns how to enroll when the run cannot ask for an SMS code, and stores nothing', async () => {
    const entry = pepper.customer();

    const run = await runImport({ entry: FIRST, bankConfig: entry });

    expect(run.result.success).toBe(false);
    expect(warningsOf(run)).toContain(
      `No Pepper device state for ${deviceKey(FIRST)}, and this run cannot ask for an SMS code`,
    );
    expect(pepper.issued).toEqual([]);
  });

  describe.each([
    {
      name: 'a device Pepper forgot, at renewal',
      refuse: (entry: IBankConfig): void => { pepper.forgetDevice(entry); pepper.expire(entry); },
      failure: LOGIN_REFUSED,
    },
    {
      name: 'a state in a format Pepper retired',
      refuse: (): void => { pepper.retireStateFormat(); },
      failure: 'persistent auth state invalid: version',
    },
  ])('when Pepper refuses $name', ({ refuse, failure }) => {
    it('removes only that state, then enrolls again with one SMS code', async () => {
      const entry = pepper.customer();
      const sibling = pepper.customer();
      await importOnce(FIRST, entry);
      await importOnce(SECOND, sibling);
      const siblingState = pepper.issued[1];
      refuse(entry);

      const refusedRun = await importOnce(FIRST, entry);

      expect(refusedRun.result.success).toBe(false);
      expect(refusedRun.result.errorMessage).toContain(failure);
      expect(storedUnder(deviceKey(FIRST))).toBe('');
      expect(storedUnder(deviceKey(SECOND))).toBe(siblingState);
      expect(warningsOf(refusedRun)).toContain(
        `Removed the Pepper device state for ${deviceKey(FIRST)}; the next run asks for one SMS code`,
      );

      const healed = [await importOnce(FIRST, entry), await importOnce(FIRST, entry)];

      expect(healed.map((run) => run.smsCount)).toEqual([1, 0]);
      expect(pepper.sentStates.slice(-2)).toEqual([undefined, pepper.issued.at(-1)]);
    });
  });

  it.each([
    { name: 'a timeout', errorType: 'TIMEOUT', message: 'timed out' },
    { name: 'a WAF page', errorType: 'WAF_BLOCKED', message: 'POST https://sa.pepper.co.il/api/v2/auth/login 403: <html>' },
    { name: 'rate limiting', errorType: 'GENERIC', message: 'POST https://sa.pepper.co.il/api/v2/auth/login 429: {}' },
    { name: 'a server error', errorType: 'GENERIC', message: 'POST https://sa.pepper.co.il/api/v2/auth/login 502: {}' },
    { name: 'a network error', errorType: 'GENERIC', message: 'network error' },
  ])('keeps the state through $name, and the next run needs no SMS code', async ({ errorType, message }) => {
    const entry = pepper.customer();
    await importOnce(FIRST, entry);
    pepper.failNextLogin(errorType, message);

    const failed = await importOnce(FIRST, entry);
    const next = await importOnce(FIRST, entry);

    expect(failed.result.success).toBe(false);
    expect(next.result.success).toBe(true);
    expect(next.smsCount).toBe(0);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[0]);
    expect(warningsOf(failed)).not.toContain('Removed the Pepper device state');
  });

  it('keeps the state when Pepper refuses the password, and says to check the password', async () => {
    const entry = pepper.customer();
    await importOnce(FIRST, entry);
    pepper.failNextLogin('GENERIC', 'POST https://sa.pepper.co.il/api/v2/auth/assert 401: {}');

    const failed = await importOnce(FIRST, entry);
    const next = await importOnce(FIRST, entry);

    expect(failed.result.success).toBe(false);
    expect(warningsOf(failed)).toContain(
      `Kept the Pepper device state for ${deviceKey(FIRST)}; Pepper refused the password, so check the password in the config`,
    );
    expect(warningsOf(failed)).not.toContain('Removed the Pepper device state');
    expect(next.result.success).toBe(true);
    expect(next.smsCount).toBe(0);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[0]);
  });

  it('keeps a state whose data requests are refused, until Pepper refuses its renewal', async () => {
    const entry = pepper.customer();
    await importOnce(FIRST, entry);
    pepper.forgetDevice(entry);

    const dataRefused = await importOnce(FIRST, entry);

    expect(dataRefused.result.errorMessage).toContain(DATA_REFUSED);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[0]);

    pepper.expire(entry);
    const renewalRefused = await importOnce(FIRST, entry);

    expect(renewalRefused.result.errorMessage).toContain(LOGIN_REFUSED);
    expect(storedUnder(deviceKey(FIRST))).toBe('');
  });

  it.skipIf(CANNOT_DENY_WRITES)('fails the run and keeps the old state when the renewed one cannot be stored', async () => {
    const entry = pepper.customer();
    await importOnce(FIRST, entry);
    pepper.expire(entry);
    chmodSync(store.directory, 0o500);

    const run = await importOnce(FIRST, entry);
    chmodSync(store.directory, 0o700);

    expect(run.result.success).toBe(false);
    expect(run.result.errorMessage).toContain('persistent auth failed: callback');
    expect(warningsOf(run)).toContain(`Could not store the long-term token for ${deviceKey(FIRST)}`);
    expect(pepper.issued).toHaveLength(2);
    expect(storedUnder(deviceKey(FIRST))).toBe(pepper.issued[0]);
  });
});
