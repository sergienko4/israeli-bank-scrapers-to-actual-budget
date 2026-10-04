/**
 * Removing a Pepper device state that Pepper has refused.
 *
 * <p>A dead state fails every run that sends it, and Pepper never falls back
 * to an SMS code by itself, so a run whose result proves the state dead
 * removes it and the next run enrolls again with one code. Removing a live
 * state costs a code on every run, so only two results count as proof: the
 * provider rejected the state's contents, or Pepper refused the device at
 * login with a 401 or 403. The password step that follows sends the
 * configured password, so its refusal keeps the state and says to check the
 * password. Cases run a real {@link BankTokenStore} over a
 * {@link FakeFileSystem}, except those that need a store which fails.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { IDeviceAuthTarget, IDeviceStateWatch } from '../../src/Scraper/Tokens/PepperDeviceState.js';
import { attachDeviceAuth } from '../../src/Scraper/Tokens/PepperDeviceState.js';
import forgetRefusedState from '../../src/Scraper/Tokens/PepperStateRefusal.js';
import { fail, succeed } from '../../src/Types/ProcedureHelpers.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, seedRecords, storedRecords,
} from './BankTokenStoreFixture.js';

/** The config entry name every attempt here comes from. */
const ACCOUNT_KEY = 'primary';

/** The device state's key for that entry, written out rather than built by the code under test. */
const DEVICE_KEY = `pepper-device:${ACCOUNT_KEY}`;

/** Pepper's renewal steps, as upstream names them in a failure. */
const LOGIN_URL = 'https://sa.pepper.co.il/api/v2/auth/login';
const ASSERT_URL = 'https://sa.pepper.co.il/api/v2/auth/assert';

/** The body Pepper's live server answered a synthetic device's login with. */
const SESSION_REJECTED = '{"error_code":4001,"error_message":"Session rejected","headers":[]}';

/** The one line a removal logs. */
const REMOVED_LINE = `  ⚠️  Removed the Pepper device state for ${DEVICE_KEY}; the next run asks for one SMS code`;

/** The one line a refused password step logs. */
const PASSWORD_REFUSED_LINE =
  `  ⚠️  Kept the Pepper device state for ${DEVICE_KEY}; Pepper refused the password, so check the password in the config`;

/** Every category upstream 8.7.4 rejects a state's contents with. */
const STATE_CATEGORIES = [
  'encoding', 'json', 'shape', 'version', 'provider', 'account',
  'clientInstanceId', 'deviceId', 'accessToken', 'ecPrivateKey',
] as const;

/** Every category upstream 8.7.4 fails a durable login with after the state decoded. */
const DURABLE_CATEGORIES = [
  'callback', 'enrollment-identity', 'enrollment-key', 'enrollment-budget', 'in-run-renewal',
] as const;

/** Every category upstream 8.7.4 refuses a set of device options with before any request. */
const OPTION_CATEGORIES = [
  'malformed', 'state-with-legacy-token', 'callback-with-legacy-token',
  'state-without-callback', 'account',
] as const;

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One logged line: its level, its text and any context passed with it. */
type LoggedLine = readonly [level: keyof ILogger, ...args: Parameters<ILogger['info']>];

/** One provider result and what it should do to a state the attempt sent. */
interface IVerdictCase {
  readonly label: string;
  readonly errorType: string;
  readonly errorMessage: string;
}

/**
 * Builds a logger that records every call.
 * @returns A logger of spies.
 */
function spyLogger(): SpyLogger {
  return {
    debug: vi.fn<ILogger['debug']>(), info: vi.fn<ILogger['info']>(),
    warn: vi.fn<ILogger['warn']>(), error: vi.fn<ILogger['error']>(),
  };
}

/**
 * Lists every line an attempt logged at any level, so a case can pin all of them.
 * @param logger - Logger the attempt used.
 * @returns Each call's level and every argument, level by level.
 */
function linesLogged(logger: SpyLogger): LoggedLine[] {
  const levels = ['debug', 'info', 'warn', 'error'] as const;
  return levels.flatMap((level) =>
    logger[level].mock.calls.map((args): LoggedLine => [level, ...args]));
}

/**
 * Attaches the device login for one attempt, as the setup does, and returns its watch.
 * @param store - Token store the attempt reads.
 * @param companyType - The bank; Pepper unless given.
 * @returns The watch and the logger the attempt uses.
 */
function attempt(
  store: IBankTokenStore, companyType: CompanyTypes = CompanyTypes.Pepper,
): { readonly watch: IDeviceStateWatch; readonly logger: SpyLogger; readonly target: IDeviceAuthTarget } {
  const logger = spyLogger();
  const params = { storeKey: `pepper:${ACCOUNT_KEY}`, companyType, login: ACCOUNT_LOGIN, store, logger };
  const target: IDeviceAuthTarget = {};
  const watch = attachDeviceAuth(target, params, { accountKey: ACCOUNT_KEY, canAskForOtp: true });
  logger.info.mockClear();
  return { watch, logger, target };
}

/**
 * Builds a failed provider result.
 * @param errorType - The result's error type, as upstream sends it.
 * @param errorMessage - The result's message, as upstream words it.
 * @returns The result.
 */
function failed(errorType: string, errorMessage: string): IScraperScrapingResult {
  return { success: false, errorType: errorType as IScraperScrapingResult['errorType'], errorMessage };
}

/** One stored entry, as the file holds it. */
interface IStoredEntry {
  readonly token: string;
  readonly capturedAt: string;
  readonly login: string;
}

/**
 * Seeds the entry's device state beside unrelated entries.
 * @param fileSystem - The store's filesystem.
 * @returns Every entry the file held, by key.
 */
function seedDeviceState(fileSystem: Parameters<typeof seedRecords>[0]): Record<string, IStoredEntry> {
  const record = (): IStoredEntry => ({ token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN });
  const records = {
    [DEVICE_KEY]: record(), 'pepper:primary': record(), 'pepper-device:secondary': record(), 'onezero:primary': record(),
  };
  seedRecords(fileSystem, records);
  return records;
}

/** Results that prove the sent state dead. */
const REMOVING_CASES: readonly IVerdictCase[] = [
  ...STATE_CATEGORIES.map((category) => ({
    label: `the state is invalid: ${category}`, errorType: 'GENERIC',
    errorMessage: `persistent auth state invalid: ${category}`,
  })),
  { label: 'Pepper rejects the session at login', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 401: ${SESSION_REJECTED}` },
  { label: 'Pepper forbids the login', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 403: {"error_code":403}` },
];

/**
 * Pepper refusing the password step after it accepted the device at login.
 * The step sends the configured password, so the state is kept and the
 * entry's password is what to check.
 */
const PASSWORD_REFUSED_CASES: readonly IVerdictCase[] = ['400', '401', '403', '404', '422'].map((status) => ({
  label: `Pepper answers the password step ${status}`, errorType: 'GENERIC',
  errorMessage: `POST ${ASSERT_URL} ${status}: ${SESSION_REJECTED}`,
}));

/** Results that may pass, or say nothing about the state, so it is kept. */
const KEEPING_CASES: readonly IVerdictCase[] = [
  ...DURABLE_CATEGORIES.map((category) => ({
    label: `the durable login failed: ${category}`, errorType: 'GENERIC',
    errorMessage: `persistent auth failed: ${category}`,
  })),
  ...OPTION_CATEGORIES.map((category) => ({
    label: `the options are invalid: ${category}`, errorType: 'GENERIC',
    errorMessage: `persistent auth options invalid: ${category}`,
  })),
  { label: 'Pepper answers the login 400', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 400: {}` },
  { label: 'Pepper answers the login 404', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 404: {}` },
  { label: 'the password step times out at 408', errorType: 'GENERIC', errorMessage: `POST ${ASSERT_URL} 408: {}` },
  { label: 'the password step is rate limited', errorType: 'GENERIC', errorMessage: `POST ${ASSERT_URL} 429: {}` },
  { label: 'the password step meets a server error', errorType: 'GENERIC', errorMessage: `POST ${ASSERT_URL} 500: {}` },
  { label: 'a Cloudflare page answers the password step', errorType: 'WAF_BLOCKED', errorMessage: `POST ${ASSERT_URL} 403: <html>cloudflare` },
  { label: 'the login times out at 408', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 408: {}` },
  { label: 'the login is rate limited', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 429: {}` },
  { label: 'the login meets a server error', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 500: {}` },
  { label: 'the login meets a bad gateway', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} 502: <html>` },
  { label: 'the login meets a network error', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} network error: connect ECONNREFUSED` },
  { label: 'the login times out in the browser', errorType: 'TIMEOUT', errorMessage: `POST ${LOGIN_URL} network error: Timeout 30000ms exceeded` },
  { label: 'the login answer is not JSON', errorType: 'GENERIC', errorMessage: `POST ${LOGIN_URL} parse error: Unexpected token <` },
  { label: 'a Cloudflare page answers the login', errorType: 'WAF_BLOCKED', errorMessage: `POST ${LOGIN_URL} 403: <html>cloudflare` },
  { label: 'the bank refuses a data request', errorType: 'GENERIC', errorMessage: 'POST https://fe-sec.pepper.co.il/graphql 401: {"error":"unauthorized"}' },
  { label: 'the enrollment bind is refused', errorType: 'GENERIC', errorMessage: 'POST https://sa.pepper.co.il/api/v2/auth/bind 401: {}' },
  { label: 'a look-alike host refuses the login', errorType: 'GENERIC', errorMessage: 'POST https://sa.pepper.co.il.example/api/v2/auth/login 401: {}' },
  { label: 'a refusal is quoted inside another failure', errorType: 'GENERIC', errorMessage: `retry: POST ${LOGIN_URL} 401: {}` },
  { label: 'a rejected state is quoted inside another failure', errorType: 'GENERIC', errorMessage: 'retry: persistent auth state invalid: shape' },
  { label: 'a login answer misses its field', errorType: 'GENERIC', errorMessage: 'envelope selector miss: token at /data' },
  { label: 'the password is wrong', errorType: 'INVALID_PASSWORD', errorMessage: 'invalid password' },
  { label: 'no SMS code can be asked for', errorType: 'TWO_FACTOR_RETRIEVER_MISSING', errorMessage: 'no retriever' },
];

describe('forgetRefusedState', () => {
  describe('after an attempt that sent the stored state', () => {
    it.each(REMOVING_CASES)('removes it when $label', ({ errorType, errorMessage }) => {
      const { store, fileSystem } = makeStore();
      seedDeviceState(fileSystem);
      const { watch } = attempt(store);

      const isRemoved = forgetRefusedState(watch, failed(errorType, errorMessage));

      expect(isRemoved).toBe(true);
      expect(storedRecords(fileSystem)).not.toHaveProperty([DEVICE_KEY]);
    });

    it.each(KEEPING_CASES)('keeps it when $label', ({ errorType, errorMessage }) => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch, logger } = attempt(store);

      const isRemoved = forgetRefusedState(watch, failed(errorType, errorMessage));

      expect(isRemoved).toBe(false);
      expect(storedRecords(fileSystem)).toEqual(seeded);
      expect(linesLogged(logger)).toEqual([]);
    });

    it.each(PASSWORD_REFUSED_CASES)('keeps it, and says once to check the password, when $label', ({ errorType, errorMessage }) => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch, logger } = attempt(store);

      const isRemoved = forgetRefusedState(watch, failed(errorType, errorMessage));

      expect(isRemoved).toBe(false);
      expect(storedRecords(fileSystem)).toEqual(seeded);
      expect(linesLogged(logger)).toEqual([['warn', PASSWORD_REFUSED_LINE]]);
      expect(JSON.stringify(linesLogged(logger))).not.toContain(seeded[DEVICE_KEY]?.token);
    });

    it('keeps it when the attempt succeeded', () => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch } = attempt(store);

      expect(forgetRefusedState(watch, { success: true, accounts: [] })).toBe(false);
      expect(storedRecords(fileSystem)).toEqual(seeded);
    });

    it('keeps it when a GENERIC failure carries no message', () => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch } = attempt(store);

      expect(forgetRefusedState(watch, { success: false, errorType: 'GENERIC' as never })).toBe(false);
      expect(storedRecords(fileSystem)).toEqual(seeded);
    });

    it('keeps every other entry, including the legacy token and another entry\'s state', () => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch } = attempt(store);

      forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: ${SESSION_REJECTED}`));

      const { [DEVICE_KEY]: removed, ...others } = seeded;
      expect(removed).toBeDefined();
      expect(storedRecords(fileSystem)).toEqual(others);
    });

    it('says once, as a warning, that the next run asks for one SMS code', () => {
      const { store, fileSystem } = makeStore();
      const seeded = seedDeviceState(fileSystem);
      const { watch, logger } = attempt(store);

      forgetRefusedState(watch, failed('GENERIC', 'persistent auth state invalid: shape'));

      expect(linesLogged(logger)).toEqual([['warn', REMOVED_LINE]]);
      expect(JSON.stringify(linesLogged(logger))).not.toContain(seeded[DEVICE_KEY]?.token);
    });

    it('leaves the next attempt to enroll with the save callback only', () => {
      const { store, fileSystem } = makeStore();
      seedDeviceState(fileSystem);
      const { watch } = attempt(store);
      forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: ${SESSION_REJECTED}`));

      const next = attempt(store);

      expect(next.watch.didSendState).toBe(false);
      expect(next.target).not.toHaveProperty('persistentAuthState');
      expect(next.target.onPersistentAuthStateUpdate).toBeTypeOf('function');
    });
  });

  describe('when nothing was sent', () => {
    it('removes nothing after an enrollment, whatever the result says', () => {
      const { store, fileSystem } = makeStore();
      const { watch, logger } = attempt(store);
      seedDeviceState(fileSystem);

      const isRemoved = forgetRefusedState(watch, failed('GENERIC', 'persistent auth state invalid: shape'));

      expect(watch.didSendState).toBe(false);
      expect(isRemoved).toBe(false);
      expect(storedRecords(fileSystem)).toHaveProperty([DEVICE_KEY]);
      expect(linesLogged(logger)).toEqual([]);
    });

    it('says nothing about a refused password after an enrollment', () => {
      const { store, fileSystem } = makeStore();
      const { watch, logger } = attempt(store);
      seedDeviceState(fileSystem);

      const isRemoved = forgetRefusedState(watch, failed('GENERIC', `POST ${ASSERT_URL} 401: {}`));

      expect(isRemoved).toBe(false);
      expect(linesLogged(logger)).toEqual([]);
    });

    it('never touches the store for another bank', () => {
      const remove = vi.fn<IBankTokenStore['remove']>();
      const store: IBankTokenStore = { read: vi.fn(), write: vi.fn(), remove, sweepStagedLeftovers: vi.fn() };
      const watch: IDeviceStateWatch = {
        params: { storeKey: DEVICE_KEY, companyType: CompanyTypes.OneZero, login: ACCOUNT_LOGIN, store, logger: spyLogger() },
        didSendState: false,
      };

      expect(forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: {}`))).toBe(false);
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe('when the store cannot remove the state', () => {
    /**
     * Builds a watch over a store whose remove a case pins, as if the state had been sent.
     * @param remove - The store's remove.
     * @returns The watch and its logger.
     */
    function sentOver(remove: IBankTokenStore['remove']): { readonly watch: IDeviceStateWatch; readonly logger: SpyLogger } {
      const logger = spyLogger();
      const store: IBankTokenStore = { read: vi.fn(), write: vi.fn(), remove, sweepStagedLeftovers: vi.fn() };
      const params = { storeKey: DEVICE_KEY, companyType: CompanyTypes.Pepper, login: ACCOUNT_LOGIN, store, logger };
      return { watch: { params, didSendState: true }, logger };
    }

    it('warns why, and reports nothing removed', () => {
      const reason = `Could not remove the long-term token for ${DEVICE_KEY}: disk full`;
      const { watch, logger } = sentOver(vi.fn<IBankTokenStore['remove']>(() => fail(reason)));

      const isRemoved = forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: {}`));

      expect(isRemoved).toBe(false);
      expect(linesLogged(logger)).toEqual([['warn', `  ⚠️  ${reason}`]]);
    });

    it('turns a throw into a warning that names the entry', () => {
      const { watch, logger } = sentOver(vi.fn<IBankTokenStore['remove']>(() => {
        throw new Error('EACCES');
      }));

      const isRemoved = forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: {}`));

      expect(isRemoved).toBe(false);
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  Could not remove the Pepper device state for ${DEVICE_KEY}: EACCES`],
      ]);
    });

    it('stays silent when the state is already gone', () => {
      const remove = vi.fn<IBankTokenStore['remove']>(() => succeed({ written: false }));
      const { watch, logger } = sentOver(remove);

      expect(forgetRefusedState(watch, failed('GENERIC', `POST ${LOGIN_URL} 401: {}`))).toBe(false);
      expect(linesLogged(logger)).toEqual([]);
    });
  });
});

/** The installed provider bundle, read as text. */
const PROVIDER_BUNDLE = fileURLToPath(new URL(
  '../../node_modules/@sergienko4/israeli-bank-scrapers/lib/index.mjs', import.meta.url,
));

/**
 * Lists the categories one upstream rule table names.
 * @param bundle - The provider bundle.
 * @param table - The table's variable name.
 * @returns The categories, in order.
 */
function categoriesOf(bundle: string, table: string): string[] {
  const block = new RegExp(`var ${table} = \\[(?<body>[^\\]]*)\\];`, 'u').exec(bundle)?.groups?.body ?? '';
  return [...block.matchAll(/category: "(?<name>[^"]+)"/gu)].map((match) => match.groups?.name ?? '');
}

/**
 * Lists the literal categories one upstream failure helper is called with.
 * @param bundle - The provider bundle.
 * @param helper - The helper's name.
 * @returns The distinct categories, in first-seen order.
 */
function literalCategories(bundle: string, helper: string): string[] {
  const calls = bundle.matchAll(new RegExp(`\\b${helper}\\("(?<name>[^"]+)"\\)`, 'gu'));
  return [...new Set([...calls].map((match) => match.groups?.name ?? ''))];
}

describe('the upstream wording the refusal rule reads', () => {
  const bundle = readFileSync(PROVIDER_BUNDLE, 'utf8');

  it('names the two renewal steps at the URLs the rule matches', () => {
    expect(bundle).toContain(`"auth.login": "${LOGIN_URL}"`);
    expect(bundle).toContain(`"auth.assert": "${ASSERT_URL}"`);
  });

  it('words a non-2xx answer as verb, origin and path, then the status, on both fetch paths', () => {
    expect(bundle).toContain('return mintSafeUrlForLog(`${parsed.origin}${parsed.pathname}`);');
    const shapes = bundle.match(/`\$\{verb\} \$\{safeUrl\} \$\{String\((?:response|env)\.status\)\}: \$\{snippet\}`/gu);
    expect(shapes).toHaveLength(2);
  });

  it('words an invalid state with the prefix the rule matches', () => {
    expect(bundle).toContain('`persistent auth state invalid: ${category}`');
  });

  it('rejects a state for exactly the categories the table removes on', () => {
    const fromBundle = [...categoriesOf(bundle, 'STATE_RULES'), ...literalCategories(bundle, 'invalid')];
    expect(new Set(fromBundle)).toEqual(new Set(STATE_CATEGORIES));
  });

  it('fails a durable login for exactly the categories the table keeps on', () => {
    expect(new Set(literalCategories(bundle, 'durableFail'))).toEqual(new Set(DURABLE_CATEGORIES));
  });

  it('refuses device options for exactly the categories the table keeps on', () => {
    expect(new Set(categoriesOf(bundle, 'OPTION_RULES'))).toEqual(new Set(OPTION_CATEGORIES));
  });
});
