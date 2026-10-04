/**
 * Pepper's durable device login: which state an attempt sends, and how the
 * callback keeps the one Pepper hands back.
 *
 * <p>From scraper 8.7.4 Pepper enrolls this host as a device with one SMS
 * code and hands back an opaque state. Sending it on later runs logs in with
 * no SMS. The state lives in the bank token store under its own key,
 * `pepper-device:<entry>`, apart from the legacy `pepper:<entry>` token, which
 * Pepper never sends again. Cases run a real {@link BankTokenStore} over a
 * {@link FakeFileSystem}, except those that need a store which fails.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import type { ILogger } from '../../src/Logger/ILogger.js';
import redactSecrets from '../../src/Logger/SecretRedaction.js';
import type { IAuthFlowCaptureParams } from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import { NO_LOGIN } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { IDeviceAuthTarget } from '../../src/Scraper/Tokens/PepperDeviceState.js';
import {
  attachDeviceAuth, withoutLongTermToken,
} from '../../src/Scraper/Tokens/PepperDeviceState.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import { fakeBankConfig, fakeLoginFingerprint } from '../helpers/factories.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, seedRaw, seedRecords, storedRecords,
} from './BankTokenStoreFixture.js';

/** The config entry name every attempt here comes from. */
const ACCOUNT_KEY = 'primary';

/** The legacy long-term token's key for that entry. */
const LEGACY_KEY = `pepper:${ACCOUNT_KEY}`;

/** The device state's key for that entry, written out rather than built by the code under test. */
const DEVICE_KEY = `pepper-device:${ACCOUNT_KEY}`;

/** A login other than the attempt's, as after a phone change. */
const OTHER_LOGIN = fakeLoginFingerprint();

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One logged line: its level, its text and any context passed with it. */
type LoggedLine = readonly [level: keyof ILogger, ...args: Parameters<ILogger['info']>];

/** How a case wires one attempt. */
interface IAttemptSetup {
  /** The bank; Pepper unless given. */
  readonly companyType?: CompanyTypes;
  /** The attempt's login; {@link ACCOUNT_LOGIN} unless given. */
  readonly login?: string;
  /** Whether the attempt can ask for an SMS code; true unless given. */
  readonly canAskForOtp?: boolean;
}

/** One attempt's provider options after the device login is attached, and what was logged. */
interface IAttached {
  readonly target: IDeviceAuthTarget;
  readonly stateWasSent: boolean;
  readonly logger: SpyLogger;
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
 * Builds the capture bundle one attempt shares, keyed on the legacy token, as the setup builds it.
 * @param store - Token store the attempt reads and writes.
 * @param setup - Bank and login for the attempt.
 * @returns The bundle and its spy logger.
 */
function captureParams(
  store: IBankTokenStore, setup: IAttemptSetup = {},
): IAuthFlowCaptureParams & { readonly logger: SpyLogger } {
  return {
    storeKey: LEGACY_KEY, companyType: setup.companyType ?? CompanyTypes.Pepper,
    login: setup.login ?? ACCOUNT_LOGIN, store, logger: spyLogger(),
  };
}

/**
 * Attaches the device login to fresh provider options, over a given store.
 * @param store - Token store the attempt reads.
 * @param setup - Bank, login and OTP ability for the attempt.
 * @returns The options, whether a state was sent, and the logger.
 */
function attachOver(store: IBankTokenStore, setup: IAttemptSetup = {}): IAttached {
  const params = captureParams(store, setup);
  const target: IDeviceAuthTarget = {};
  const request = { accountKey: ACCOUNT_KEY, canAskForOtp: setup.canAskForOtp ?? true };
  const { didSendState: stateWasSent } = attachDeviceAuth(target, params, request);
  return { target, stateWasSent, logger: params.logger };
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
 * Serialises every argument an attempt logged, for leak checks.
 * @param logger - Logger the attempt used.
 * @returns All arguments of all calls as one string.
 */
function everythingLogged(logger: SpyLogger): string {
  return JSON.stringify(linesLogged(logger));
}

/**
 * Builds a store stub whose every method is a spy.
 * @param overrides - Methods a case pins.
 * @returns The stub.
 */
function stubStore(overrides: Partial<IBankTokenStore> = {}): IBankTokenStore & Record<keyof IBankTokenStore, Mock> {
  return {
    read: vi.fn(), write: vi.fn(), remove: vi.fn(), sweepStagedLeftovers: vi.fn(),
    ...overrides,
  } as IBankTokenStore & Record<keyof IBankTokenStore, Mock>;
}

/**
 * Takes the save callback a case expects to be attached.
 * @param target - The provider options.
 * @returns The callback.
 */
function saveHookOf(target: IDeviceAuthTarget): NonNullable<IDeviceAuthTarget['onPersistentAuthStateUpdate']> {
  const hook = target.onPersistentAuthStateUpdate;
  if (hook === undefined) throw new Error('no save callback was attached');
  return hook;
}

describe('attachDeviceAuth', () => {
  describe('with nothing stored for the entry', () => {
    it('attaches only the save callback, so Pepper enrolls this device with one SMS code', () => {
      const { store } = makeStore();

      const { target, stateWasSent } = attachOver(store);

      expect(target.onPersistentAuthStateUpdate).toBeTypeOf('function');
      expect(target).not.toHaveProperty('persistentAuthState');
      expect(stateWasSent).toBe(false);
    });

    it('never sends the legacy long-term token as a device state', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [LEGACY_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { target, stateWasSent } = attachOver(store);

      expect(target).not.toHaveProperty('persistentAuthState');
      expect(stateWasSent).toBe(false);
    });

    it('logs nothing when the attempt can ask for an SMS code', () => {
      const { store } = makeStore();

      const { logger } = attachOver(store);

      expect(linesLogged(logger)).toEqual([]);
    });

    it('warns how to fix an attempt that cannot ask for an SMS code', () => {
      const { store } = makeStore();

      const { logger } = attachOver(store, { canAskForOtp: false });

      expect(linesLogged(logger)).toEqual([[
        'warn',
        `  ⚠️  No Pepper device state for ${DEVICE_KEY}, and this run cannot ask for an SMS code: `
        + 'turn on twoFactorAuth for one SMS login',
      ]]);
    });

    it('warns that the damaged token file holds no usable state, and still enrolls', () => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, '{ not json');

      const { target, logger } = attachOver(store);

      expect(target.onPersistentAuthStateUpdate).toBeTypeOf('function');
      expect(target).not.toHaveProperty('persistentAuthState');
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  The token file is damaged and holds no usable Pepper device state for ${DEVICE_KEY}`],
      ]);
    });
  });

  describe('with a state stored for the entry', () => {
    it('sends the stored state bound to this login, with the save callback', () => {
      const { store, fileSystem } = makeStore();
      const state = fakeToken();
      seedRecords(fileSystem, { [DEVICE_KEY]: { token: state, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { target, stateWasSent } = attachOver(store);

      expect(target.persistentAuthState).toBe(state);
      expect(target.onPersistentAuthStateUpdate).toBeTypeOf('function');
      expect(stateWasSent).toBe(true);
    });

    it('says at INFO that it uses the stored state, naming the entry but not the state', () => {
      const { store, fileSystem } = makeStore();
      const state = fakeToken();
      seedRecords(fileSystem, { [DEVICE_KEY]: { token: state, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { logger } = attachOver(store, { canAskForOtp: false });

      expect(linesLogged(logger)).toEqual([['info', `  🔐 Using the stored Pepper device state for ${DEVICE_KEY}`]]);
      expect(everythingLogged(logger)).not.toContain(state);
    });

    it('hides the state it sends from every log line', () => {
      const { store, fileSystem } = makeStore();
      const state = fakeToken();
      seedRecords(fileSystem, { [DEVICE_KEY]: { token: state, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      attachOver(store);

      expect(redactSecrets(`echoed ${state}`)).not.toContain(state);
    });

    it('does not send a state bound to another login, and enrolls this one instead', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [DEVICE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { target, stateWasSent, logger } = attachOver(store);

      expect(target).not.toHaveProperty('persistentAuthState');
      expect(target.onPersistentAuthStateUpdate).toBeTypeOf('function');
      expect(stateWasSent).toBe(false);
      expect(linesLogged(logger)).toEqual([[
        'info',
        `  🔐 The stored Pepper device state for ${DEVICE_KEY} belongs to another login; `
        + 'enrolling this device with an SMS code',
      ]]);
    });
  });

  describe('when the store cannot carry a device login', () => {
    it('attaches neither option for an entry with no login identity, so the run logs in as before', () => {
      const store = stubStore();

      const { target, stateWasSent, logger } = attachOver(store, { login: NO_LOGIN });

      expect(target).toEqual({});
      expect(stateWasSent).toBe(false);
      expect(store.read).not.toHaveBeenCalled();
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  No login identity for ${DEVICE_KEY}, so the Pepper device login is not kept`],
      ]);
    });

    it.each([
      ['reports a failure', (): IBankTokenStore['read'] => () => fail('EACCES: permission denied')],
      ['throws', (): IBankTokenStore['read'] => () => { throw new Error('EACCES: permission denied'); }],
    ])('attaches neither option when reading the token file %s', (_how, readFor) => {
      const store = stubStore({ read: vi.fn(readFor()) });

      const { target, stateWasSent, logger } = attachOver(store);

      expect(target).toEqual({});
      expect(stateWasSent).toBe(false);
      expect(linesLogged(logger)).toEqual([[
        'warn',
        `  ⚠️  Could not read the Pepper device state for ${DEVICE_KEY}: EACCES: permission denied`,
      ]]);
    });

    it('still warns how to fix an attempt that cannot ask for an SMS code', () => {
      const store = stubStore({ read: vi.fn(() => fail('EACCES: permission denied')) });

      const { logger } = attachOver(store, { canAskForOtp: false });

      expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining('cannot ask for an SMS code'));
    });
  });

  it.each([CompanyTypes.OneZero, CompanyTypes.PayBox, CompanyTypes.Discount])(
    'attaches nothing, and never reads the store, for %s',
    (companyType) => {
      const store = stubStore();

      const { target, stateWasSent, logger } = attachOver(store, { companyType, canAskForOtp: false });

      expect(target).toEqual({});
      expect(stateWasSent).toBe(false);
      expect(store.read).not.toHaveBeenCalled();
      expect(linesLogged(logger)).toEqual([]);
    },
  );
});

describe('the save callback', () => {
  it('resolves once the store holds the state under the device key, bound to this login', async () => {
    const { store, fileSystem } = makeStore();
    const legacy = { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
    seedRecords(fileSystem, { [LEGACY_KEY]: legacy });
    const state = fakeToken();

    await saveHookOf(attachOver(store).target)(state);

    const records = storedRecords(fileSystem);
    expect(records[DEVICE_KEY]).toMatchObject({ token: state, login: ACCOUNT_LOGIN });
    expect(records[LEGACY_KEY]).toEqual(legacy);
  });

  it('replaces a renewed state', async () => {
    const { store, fileSystem } = makeStore();
    seedRecords(fileSystem, { [DEVICE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    const renewed = fakeToken();

    await saveHookOf(attachOver(store).target)(renewed);

    expect(storedRecords(fileSystem)[DEVICE_KEY]).toMatchObject({ token: renewed, login: ACCOUNT_LOGIN });
  });

  it('says at INFO that it stored the state, without showing it', async () => {
    const { store } = makeStore();
    const attached = attachOver(store);
    const state = fakeToken();

    await saveHookOf(attached.target)(state);

    expect(linesLogged(attached.logger)).toEqual([['info', `  🔐 Stored the Pepper device state for ${DEVICE_KEY}`]]);
    expect(everythingLogged(attached.logger)).not.toContain(state);
  });

  it('resolves, silently, when the store already holds the same state', async () => {
    const { store, fileSystem } = makeStore();
    const state = fakeToken();
    seedRecords(fileSystem, { [DEVICE_KEY]: { token: state, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
    const attached = attachOver(store);
    attached.logger.info.mockClear();

    await expect(saveHookOf(attached.target)(state)).resolves.toBeUndefined();

    expect(linesLogged(attached.logger)).toEqual([]);
  });

  it('rejects with the store\'s reason, and warns, when the write fails', async () => {
    const reason = `Could not store the long-term token for ${DEVICE_KEY}: ENOSPC: no space left on device`;
    const empty = makeStore().store;
    const store = stubStore({ read: vi.fn((key: string) => empty.read(key)), write: vi.fn(() => fail(reason)) });
    const attached = attachOver(store);

    const saved = saveHookOf(attached.target)(fakeToken());

    await expect(saved).rejects.toThrow(new StorageError(reason));
    expect(linesLogged(attached.logger)).toEqual([['warn', `  ⚠️  ${reason}`]]);
  });

  it('rejects, and warns, when the store throws', async () => {
    const empty = makeStore().store;
    const store = stubStore({
      read: vi.fn((key: string) => empty.read(key)),
      write: vi.fn(() => { throw new Error('EIO: i/o error'); }),
    });
    const attached = attachOver(store);
    const reason = `Could not store the Pepper device state for ${DEVICE_KEY}: EIO: i/o error`;

    const saved = saveHookOf(attached.target)(fakeToken());

    await expect(saved).rejects.toThrow(new StorageError(reason));
    expect(linesLogged(attached.logger)).toEqual([['warn', `  ⚠️  ${reason}`]]);
  });

  it('rejects a state the file binds to another login', async () => {
    const { store, fileSystem } = makeStore();
    const state = fakeToken();
    seedRecords(fileSystem, { 'pepper-device:other': { token: state, capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

    const saved = saveHookOf(attachOver(store).target)(state);

    await expect(saved).rejects.toBeInstanceOf(StorageError);
    expect(storedRecords(fileSystem)).not.toHaveProperty(DEVICE_KEY);
  });
});

describe('withoutLongTermToken', () => {
  /**
   * Builds a frozen Pepper entry carrying a seed of any shape, as a hand-edited file can.
   * @param seed - The `otpLongTermToken` value, or undefined for none.
   * @returns The entry; any mutation throws.
   */
  const entryWith = (seed: unknown): IBankConfig => {
    const base = fakeBankConfig({ phoneNumber: '0501234567' });
    const entry = seed === undefined ? base : { ...base, otpLongTermToken: seed as string };
    return Object.freeze(entry);
  };

  it('drops a configured long-term token and warns, without showing it', () => {
    const seed = fakeToken();
    const params = captureParams(makeStore().store);

    const loginConfig = withoutLongTermToken(params, entryWith(seed));

    expect(loginConfig.otpLongTermToken).toBeUndefined();
    expect(linesLogged(params.logger)).toEqual([[
      'warn',
      `  ⚠️  The configured long-term token for ${LEGACY_KEY} is not sent: Pepper now logs in `
      + 'as an enrolled device, so remove otpLongTermToken from this entry',
    ]]);
    expect(everythingLogged(params.logger)).not.toContain(seed);
  });

  it('warns about a configured value that is not text', () => {
    const params = captureParams(makeStore().store);

    const loginConfig = withoutLongTermToken(params, entryWith(12_345));

    expect(loginConfig.otpLongTermToken).toBeUndefined();
    expect(params.logger.warn).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, '', '   '])('is silent for an entry whose configured token is %j', (seed) => {
    const params = captureParams(makeStore().store);

    const loginConfig = withoutLongTermToken(params, entryWith(seed));

    expect(loginConfig.otpLongTermToken).toBeUndefined();
    expect(linesLogged(params.logger)).toEqual([]);
  });

  it('keeps every other field of the entry as configured', () => {
    const entry = entryWith(fakeToken());

    const loginConfig = withoutLongTermToken(captureParams(makeStore().store), entry);

    expect(loginConfig).toEqual({ ...entry, otpLongTermToken: undefined });
  });
});
