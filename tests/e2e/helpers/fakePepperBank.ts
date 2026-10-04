/**
 * A fake Pepper for the device login E2E suite.
 *
 * <p>From scraper 8.7.4 Pepper logs in as an enrolled device. This fake stands
 * in for upstream's scraper at `createScraper`, the one seam the importer
 * calls, and follows upstream's persistent-auth flow
 * (`TokenStrategyFromConfig.persistent.ts` and `OPTION_RULES`), not the
 * importer's code:
 *
 * <ul>
 *   <li>the options are checked first: a state needs the callback, and neither
 *       may travel with a long-term token
 *       (`persistent auth options invalid: <category>`);</li>
 *   <li>with the callback and no state, the login enrolls a new device with
 *       one SMS code and hands its state to the callback;</li>
 *   <li>with a state, a fresh access token replays with no call to Pepper and
 *       no callback, and an expired one renews through `auth/login` with no
 *       SMS code and hands the renewed state to the callback;</li>
 *   <li>a state it cannot read, one issued to another account, or one in a
 *       retired format fails as `persistent auth state invalid: <category>`;</li>
 *   <li>a callback that rejects fails the run as
 *       `persistent auth failed: callback`;</li>
 *   <li>a device Pepper has forgotten has its renewal refused with the 401
 *       the real server answers, and its data requests with GraphQL's 401.</li>
 * </ul>
 *
 * <p>The state is opaque to the importer, so the fake issues random text and
 * remembers what each one stands for.
 */

import type {
  IScraperScrapingResult, ScraperCredentials, ScraperOptions,
} from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';

import type { IBankConfig } from '../../../src/Types/Index.js';
import type { IApiDirectBank } from '../../helpers/apiDirectBanks.js';
import {
  accountOf, API_DIRECT_BANKS, apiDirectEntry, drawAccountValue, loginValuesOf,
} from '../../helpers/apiDirectBanks.js';
import { fakeBankTransactions, fakeCanonicalAccount, fakeUuid } from '../../helpers/factories.js';

/** What the real `auth/login` answered a device it no longer knows. */
export const LOGIN_REFUSED = 'POST https://sa.pepper.co.il/api/v2/auth/login 401: '
  + '{"error_code":4001,"error_message":"Session rejected","headers":[]}';

/** What the real GraphQL endpoint answered a data request it refused. */
export const DATA_REFUSED = 'POST https://fe-sec.pepper.co.il/graphql 401: {"error":"unauthorized"}';

/** The provider callback that receives each state Pepper issues. */
type StateUpdateHook = NonNullable<ScraperOptions['onPersistentAuthStateUpdate']>;

/** What one issued state stands for. */
interface IIssuedState {
  readonly account: string;
  readonly device: string;
  readonly format: number;
}

/** A fake Pepper, and what a case can do to it. */
export interface IFakePepper {
  /** The device state each login sent, in order; undefined for none. */
  readonly sentStates: readonly (string | undefined)[];
  /** The long-term token each login sent, in order; undefined for none. */
  readonly sentTokens: readonly (string | undefined)[];
  /** Every state Pepper issued, in order. */
  readonly issued: readonly string[];
  /**
   * Opens an account with a login of its own and returns its `banks` entry.
   * @returns The entry, with 2FA on.
   */
  readonly customer: () => IBankConfig;
  /**
   * Expires the access token in the account's latest state, so the next run renews it.
   * @param bankConfig - An entry of the account.
   * @returns Nothing.
   */
  readonly expire: (bankConfig: IBankConfig) => void;
  /**
   * Forgets the device the account's latest state enrolled.
   * @param bankConfig - An entry of the account.
   * @returns Nothing.
   */
  readonly forgetDevice: (bankConfig: IBankConfig) => void;
  /**
   * Retires the state format every state so far was issued in, as a provider upgrade may.
   * @returns Nothing.
   */
  readonly retireStateFormat: () => void;
  /**
   * Fails the next login before it reaches Pepper.
   * @param errorType - Upstream's error type.
   * @param errorMessage - Upstream's message.
   * @returns Nothing.
   */
  readonly failNextLogin: (errorType: string, errorMessage: string) => void;
}

/** What the fake Pepper remembers. */
interface IPepperMemory {
  readonly sentStates: (string | undefined)[];
  readonly sentTokens: (string | undefined)[];
  readonly issued: string[];
  /** The login field values of each account, by account. */
  readonly customers: Map<string, Readonly<Record<string, unknown>>>;
  /** What each issued state stands for. */
  readonly states: Map<string, IIssuedState>;
  /** The latest state issued for each account. */
  readonly latestOf: Map<string, string>;
  /** States whose access token has expired. */
  readonly expired: Set<string>;
  /** Devices Pepper no longer knows. */
  readonly forgotten: Set<string>;
  /** Failures the coming logins return, in order. */
  readonly failures: IScraperScrapingResult[];
  /** The state format Pepper reads. */
  readonly format: { current: number };
}

/**
 * Finds Pepper's row among the API-direct banks.
 * @returns Pepper, as its login works.
 */
function pepperRow(): IApiDirectBank {
  const row = API_DIRECT_BANKS.find((bank) => bank.bankId === 'pepper');
  if (row === undefined) throw new Error('No Pepper row');
  return row;
}

/** Pepper, as its login works. */
export const PEPPER = pepperRow();

/**
 * Builds a failed scrape.
 * @param errorType - Upstream's error type.
 * @param errorMessage - Why.
 * @returns The failure.
 */
function refused(errorType: string, errorMessage: string): IScraperScrapingResult {
  return { success: false, errorType, errorMessage } as IScraperScrapingResult;
}

/**
 * Reads a text credential by upstream's field name.
 * @param credentials - What the importer sent.
 * @param field - The field.
 * @returns The value, or undefined when it is not text.
 */
function textIn(credentials: ScraperCredentials, field: string): string | undefined {
  const value = (credentials as Readonly<Record<string, unknown>>)[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the SMS code retriever a login sent, by upstream's own credential field.
 * @param credentials - What the importer sent.
 * @returns The retriever, or undefined when the login cannot ask for a code.
 */
function retrieverIn(credentials: ScraperCredentials): (() => Promise<string>) | undefined {
  return 'otpCodeRetriever' in credentials ? credentials.otpCodeRetriever : undefined;
}

/**
 * Names the option rule a login breaks, as upstream's `OPTION_RULES` read it.
 * @param options - The options the importer built the scraper with.
 * @param credentials - What the importer sent.
 * @returns The rule's category, or undefined when none is broken.
 */
function brokenOption(options: ScraperOptions, credentials: ScraperCredentials): string | undefined {
  const hasState = options.persistentAuthState !== undefined;
  const hasCallback = options.onPersistentAuthStateUpdate !== undefined;
  const hasToken = (textIn(credentials, 'otpLongTermToken') ?? '').length > 0;
  if (hasState && hasToken) return 'state-with-legacy-token';
  if (hasCallback && hasToken) return 'callback-with-legacy-token';
  if (hasState && !hasCallback) return 'state-without-callback';
  if (hasCallback && (textIn(credentials, PEPPER.accountField) ?? '') === '') return 'account';
  return undefined;
}

/**
 * Names the customer whose login fields a login sent, if they all match.
 * @param memory - What Pepper remembers.
 * @param credentials - What the importer sent.
 * @returns The account, or undefined when Pepper does not know the login.
 */
function customerOf(memory: IPepperMemory, credentials: ScraperCredentials): string | undefined {
  const account = textIn(credentials, PEPPER.accountField);
  const known = account === undefined ? undefined : memory.customers.get(account);
  if (account === undefined || known === undefined) return undefined;
  const sent = credentials as Readonly<Record<string, unknown>>;
  return PEPPER.loginFields.every((field) => sent[field] === known[field]) ? account : undefined;
}

/**
 * Issues a state for a device of an account, in the current format.
 * @param memory - What Pepper remembers.
 * @param account - The account.
 * @param device - The enrolled device.
 * @returns The state.
 */
function issue(memory: IPepperMemory, account: string, device: string): string {
  const state = `pepper-state-${fakeUuid()}`;
  memory.states.set(state, { account, device, format: memory.format.current });
  memory.latestOf.set(account, state);
  memory.issued.push(state);
  return state;
}

/**
 * Hands a state to the callback, as upstream waits for it.
 * @param onUpdate - The importer's callback.
 * @param state - The state Pepper issued.
 * @returns Undefined once saved, or the failure upstream reports when the callback rejects.
 */
async function publish(onUpdate: StateUpdateHook, state: string): Promise<IScraperScrapingResult | undefined> {
  try {
    await onUpdate(state);
    return undefined;
  } catch {
    return refused('GENERIC', 'persistent auth failed: callback');
  }
}

/**
 * Enrolls a new device with one SMS code.
 * @param memory - What Pepper remembers.
 * @param onUpdate - The importer's callback.
 * @param login - What the importer sent, and the customer its login fields name.
 * @returns Undefined once enrolled, or why it failed.
 */
async function enroll(
  memory: IPepperMemory, onUpdate: StateUpdateHook, login: { credentials: ScraperCredentials; account: string },
): Promise<IScraperScrapingResult | undefined> {
  const retriever = retrieverIn(login.credentials);
  if (retriever === undefined) return refused('TWO_FACTOR_RETRIEVER_MISSING', 'no SMS code retriever');
  await retriever();
  const state = issue(memory, login.account, fakeUuid());
  return publish(onUpdate, state);
}

/**
 * Logs in on a stored state: replays a fresh access token, or renews an expired one.
 * @param memory - What Pepper remembers.
 * @param onUpdate - The importer's callback.
 * @param sent - The state sent and the customer the login fields name.
 * @returns Undefined once logged in, or why it failed.
 */
async function resume(
  memory: IPepperMemory, onUpdate: StateUpdateHook, sent: { state: string; account: string },
): Promise<IScraperScrapingResult | undefined> {
  const held = memory.states.get(sent.state);
  if (held === undefined) return refused('GENERIC', 'persistent auth state invalid: shape');
  if (held.account !== sent.account) return refused('GENERIC', 'persistent auth state invalid: account');
  if (held.format !== memory.format.current) return refused('GENERIC', 'persistent auth state invalid: version');
  const isForgotten = memory.forgotten.has(held.device);
  if (!memory.expired.has(sent.state)) return isForgotten ? refused('GENERIC', DATA_REFUSED) : undefined;
  if (isForgotten) return refused('GENERIC', LOGIN_REFUSED);
  return publish(onUpdate, issue(memory, sent.account, held.device));
}

/**
 * Builds the result of a scrape of one account.
 * @param account - The account's phone number.
 * @returns A successful scrape.
 */
function scrapeOf(account: string): IScraperScrapingResult {
  const txns = fakeBankTransactions(2, { date: new Date().toISOString() });
  return { success: true, accounts: [fakeCanonicalAccount({ accountNumber: `acct-${account}`, txns })] } as IScraperScrapingResult;
}

/**
 * Logs in as an enrolled device, then scrapes the account.
 * @param memory - What Pepper remembers.
 * @param options - The options the importer built the scraper with.
 * @param credentials - The credentials the importer sent.
 * @returns The scrape, or why Pepper refused it.
 */
async function scrape(
  memory: IPepperMemory, options: ScraperOptions, credentials: ScraperCredentials,
): Promise<IScraperScrapingResult> {
  const state = options.persistentAuthState;
  memory.sentStates.push(state);
  memory.sentTokens.push(textIn(credentials, 'otpLongTermToken'));
  if (options.companyId !== PEPPER.companyType) return refused('GENERIC', 'another bank\'s scraper');
  const broken = brokenOption(options, credentials);
  if (broken !== undefined) return refused('GENERIC', `persistent auth options invalid: ${broken}`);
  const onUpdate = options.onPersistentAuthStateUpdate;
  if (onUpdate === undefined) return refused('GENERIC', 'the fake Pepper logs in only as an enrolled device');
  const account = customerOf(memory, credentials);
  if (account === undefined) return refused('INVALID_PASSWORD', 'unknown login');
  const failure = memory.failures.shift() ?? await (state === undefined
    ? enroll(memory, onUpdate, { credentials, account })
    : resume(memory, onUpdate, { state, account }));
  return failure ?? scrapeOf(account);
}

/**
 * Names the latest state Pepper issued for an entry's account.
 * @param memory - What Pepper remembers.
 * @param bankConfig - An entry of the account.
 * @returns The state.
 */
function latestStateOf(memory: IPepperMemory, bankConfig: IBankConfig): string {
  const state = memory.latestOf.get(accountOf(PEPPER, bankConfig));
  if (state === undefined) throw new Error('The account has no enrolled device');
  return state;
}

/**
 * Draws a phone number no customer has yet, and registers a new entry under it.
 * @param memory - What Pepper remembers.
 * @returns The entry.
 */
function newCustomer(memory: IPepperMemory): IBankConfig {
  let phoneNumber = drawAccountValue(PEPPER);
  while (memory.customers.has(phoneNumber)) phoneNumber = drawAccountValue(PEPPER);
  const entry = apiDirectEntry(PEPPER, { phoneNumber });
  memory.customers.set(phoneNumber, loginValuesOf(PEPPER, entry));
  return entry;
}

/**
 * Makes the provider a fake Pepper.
 * @param createScraper - The spec's `createScraper` mock.
 * @returns The case controls.
 */
export function openPepper(createScraper: Mock): IFakePepper {
  const memory: IPepperMemory = {
    sentStates: [], sentTokens: [], issued: [], customers: new Map(), states: new Map(),
    latestOf: new Map(), expired: new Set(), forgotten: new Set(), failures: [], format: { current: 1 },
  };
  createScraper.mockImplementation((options: ScraperOptions) => ({
    /**
     * Logs in and scrapes, as Pepper does.
     * @param credentials - The credentials the importer built.
     * @returns The scrape, or why Pepper refused it.
     */
    scrape: (credentials: ScraperCredentials): Promise<IScraperScrapingResult> => scrape(memory, options, credentials),
  }));
  return {
    sentStates: memory.sentStates,
    sentTokens: memory.sentTokens,
    issued: memory.issued,
    customer: () => newCustomer(memory),
    expire: (bankConfig): void => { memory.expired.add(latestStateOf(memory, bankConfig)); },
    forgetDevice: (bankConfig): void => {
      const held = memory.states.get(latestStateOf(memory, bankConfig));
      if (held !== undefined) memory.forgotten.add(held.device);
    },
    retireStateFormat: (): void => { memory.format.current += 1; },
    failNextLogin: (errorType, errorMessage): void => { memory.failures.push(refused(errorType, errorMessage)); },
  };
}
