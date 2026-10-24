/**
 * Which long-term token an API-direct login is allowed to send.
 *
 * <p>A Pepper or PayBox token logs in by itself, so the token an attempt sends
 * decides which account it imports. The resolver sends a token only when the
 * store vouches that it belongs to this attempt's login: the entry's own
 * stored token first, then the configured seed, and otherwise none, so the
 * provider logs in cold with an SMS. The replay journey through the shipped
 * assembly is `tests/e2e/WarmStartReplay.e2e.test.ts`; this suite pins each
 * branch of the decision. Cases run a real {@link BankTokenStore} over a
 * {@link FakeFileSystem}, except those that need a store which fails.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import redactSecrets from '../../src/Logger/SecretRedaction.js';
import type { IAuthFlowCaptureParams } from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import { NO_LOGIN } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { IRefusedTokens } from '../../src/Scraper/Tokens/RefusedTokens.js';
import tokenDigest from '../../src/Scraper/Tokens/TokenDigest.js';
import type { ILoginContext } from '../../src/Scraper/Tokens/WarmTokenResolver.js';
import resolveWarmToken from '../../src/Scraper/Tokens/WarmTokenResolver.js';
import type { WarmTokenDecision } from '../../src/Scraper/Tokens/WarmTokenWatch.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import { fakeBankConfig, fakeLoginFingerprint } from '../helpers/factories.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeRefusals, makeStore, OWNER_ONLY, REFUSED_PATH,
  seedRaw, seedRecords,
} from './BankTokenStoreFixture.js';

/** The key a `oneZero` config entry resolves to. */
const STORE_KEY = 'onezero:oneZero';

/** The key of another entry, which may send the same token under another login. */
const OTHER_KEY = 'onezero:other';

/** A login other than the attempt's, as after an email or phone change. */
const OTHER_LOGIN = fakeLoginFingerprint();

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One resolution: the config the attempt logs in with, what it sent, and what was logged. */
interface IResolved {
  readonly bankConfig: IBankConfig;
  readonly decision: WarmTokenDecision;
  readonly logger: SpyLogger;
}

/** A configured token, and the other entries the file holds beside the one under test. */
interface ISeedArrangement {
  readonly seed: unknown;
  readonly others: Record<string, unknown>;
}

/** How a case wires one resolution. */
interface IResolveSetup {
  /** The configured `otpLongTermToken`; none unless given. */
  readonly seed?: unknown;
  /** The attempt's login; {@link ACCOUNT_LOGIN} unless given. */
  readonly login?: string;
  /** Whether the attempt can ask for an SMS code; true unless given. */
  readonly canAskForOtp?: boolean;
  /** Tokens that were not accepted before; an empty registry unless given. */
  readonly refusals?: IRefusedTokens;
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
 * Builds a config entry carrying a seed of any shape, as a hand-edited file can.
 * @param seed - The `otpLongTermToken` value, or undefined for none.
 * @returns A frozen config entry, so any mutation throws.
 */
function configWith(seed: unknown): IBankConfig {
  const base = fakeBankConfig();
  const entry = seed === undefined ? base : { ...base, otpLongTermToken: seed as string };
  return Object.freeze(entry);
}

/**
 * Resolves the token one OneZero attempt sends, over a given store.
 * @param store - Token store the resolver reads.
 * @param setup - Seed, login and OTP ability for the attempt.
 * @returns The config the attempt logs in with, and the logger.
 */
function resolveOver(store: IBankTokenStore, setup: IResolveSetup = {}): IResolved {
  const logger = spyLogger();
  const capture: IAuthFlowCaptureParams = {
    storeKey: STORE_KEY, companyType: CompanyTypes.OneZero,
    login: setup.login ?? ACCOUNT_LOGIN, store, logger,
  };
  const context: ILoginContext = { capture, refusals: setup.refusals ?? makeRefusals() };
  const request = { bankConfig: configWith(setup.seed), canAskForOtp: setup.canAskForOtp ?? true };
  return { ...resolveWarmToken(context, request), logger };
}

/**
 * Builds a registry over the store's own volume that refuses the given tokens for the entry.
 * @param fileSystem - The store's filesystem, so both files share one volume.
 * @param tokens - Tokens that were not accepted before.
 * @returns The registry.
 */
function refusing(fileSystem: FakeFileSystem, ...tokens: string[]): IRefusedTokens {
  const refusals = makeRefusals(fileSystem);
  for (const token of tokens) {
    const digest = tokenDigest(token);
    const refused = refusals.refuse(STORE_KEY, digest);
    if (!refused.success) throw new Error(`refuse failed: ${refused.message}`);
  }
  return refusals;
}

/**
 * Builds a registry over the store's own volume in which another entry refused a token.
 * @param fileSystem - The store's filesystem, so both files share one volume.
 * @param token - The token the other entry sent.
 * @returns The registry.
 */
function refusedElsewhere(fileSystem: FakeFileSystem, token: string): IRefusedTokens {
  const refusals = makeRefusals(fileSystem);
  const refused = refusals.refuse(OTHER_KEY, tokenDigest(token));
  if (!refused.success) throw new Error(`refuse failed: ${refused.message}`);
  return refusals;
}

/**
 * Builds a registry whose file is on a volume that refuses every read.
 * @returns The registry.
 */
function unreadableRefusals(): IRefusedTokens {
  const refusalVolume = new FakeFileSystem();
  const refusals = makeRefusals(refusalVolume);
  refusalVolume.seedFile(REFUSED_PATH, '{}', OWNER_ONLY);
  refusalVolume.forcedFailures.set('openForRead', 'EACCES');
  return refusals;
}

/**
 * Seeds the entry's stored token, bound to the attempt's login.
 * @param fileSystem - The store's filesystem.
 * @returns The stored token.
 */
function storedToken(fileSystem: FakeFileSystem): string {
  const stored = fakeToken();
  seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
  return stored;
}

/**
 * Serialises every argument a resolution logged, for leak checks.
 * @param logger - Logger the resolution used.
 * @returns All arguments of all calls as one string.
 */
function everythingLogged(logger: SpyLogger): string {
  const calls = [logger.debug, logger.info, logger.warn, logger.error].flatMap((spy) => spy.mock.calls);
  return JSON.stringify(calls);
}

/** One logged line: its level, its text and any context passed with it. */
type LoggedLine = readonly [level: keyof ILogger, ...args: Parameters<ILogger['info']>];

/**
 * Lists every line a resolution logged at any level, so a case can pin all of them.
 * @param logger - Logger the resolution used.
 * @returns Each call's level and every argument, level by level.
 */
function linesLogged(logger: SpyLogger): LoggedLine[] {
  const levels = ['debug', 'info', 'warn', 'error'] as const;
  return levels.flatMap((level) =>
    logger[level].mock.calls.map((args): LoggedLine => [level, ...args]));
}

/**
 * Builds a store whose read reports a failure, and counts its reads.
 * @param read - What `read` does.
 * @returns A store that never vouches for a token.
 */
function storeThatReads(read: IBankTokenStore['read']): IBankTokenStore & { readonly read: Mock } {
  return {
    read: vi.fn(read),
    write: vi.fn(),
    remove: vi.fn(),
    removeMatching: vi.fn(),
    sweepStagedLeftovers: vi.fn(),
  };
}

describe('resolveWarmToken', () => {
  describe('with a token stored for the entry', () => {
    it('sends the stored token when the store binds it to this login', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    it('says at INFO that it uses the stored token, naming the entry but not the token', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { logger } = resolveOver(store);

      expect(linesLogged(logger)).toEqual([['info', `  🔐 Using the stored long-term token for ${STORE_KEY}`]]);
      expect(everythingLogged(logger)).not.toContain(stored);
    });

    it('sends the stored token rather than the configured one', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    const unsendableSeeds = [
      { why: 'is not text', arrange: (): ISeedArrangement => ({ seed: 12_345, others: {} }) },
      {
        why: 'belongs to another login',
        arrange: (): ISeedArrangement => {
          const seed = fakeToken();
          return { seed, others: { 'onezero:other': { token: seed, capturedAt: CAPTURED_AT, login: OTHER_LOGIN } } };
        },
      },
    ];

    it.each(unsendableSeeds)('sends the stored token, silent on a configured one that $why', ({ arrange }) => {
      const { store, fileSystem } = makeStore();
      const { seed, others } = arrange();
      const stored = fakeToken();
      seedRecords(fileSystem, {
        ...others,
        [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
      });

      const { bankConfig, logger } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBe(stored);
      expect(linesLogged(logger)).toEqual([['info', `  🔐 Using the stored long-term token for ${STORE_KEY}`]]);
    });

    it('sends the stored token even when another entry in the file is damaged', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, {
        [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'pepper:main': { token: fakeToken(), capturedAt: CAPTURED_AT },
      });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    it('says only that it uses the stored token when another entry in the file is damaged', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, {
        [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'pepper:main': { token: fakeToken(), capturedAt: CAPTURED_AT },
      });

      const { logger } = resolveOver(store, { seed: fakeToken() });

      expect(linesLogged(logger)).toEqual([['info', `  🔐 Using the stored long-term token for ${STORE_KEY}`]]);
    });

    it('sends no token when the store binds the stored one to another login', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBeUndefined();
    });

    it('ignores the configured token when the stored one belongs to another login', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
    });

    it('says at INFO that the login changed, so this run logs in with an SMS', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { logger } = resolveOver(store);

      expect(linesLogged(logger)).toEqual([[
        'info',
        `  🔐 The stored long-term token for ${STORE_KEY} belongs to another login; logging in with an SMS`,
      ]]);
    });
  });

  describe('with only a configured token', () => {
    it('sends the configured token when the store holds nothing', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('says at INFO that it uses the configured token, naming the entry but not the token', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { logger } = resolveOver(store, { seed });

      expect(linesLogged(logger)).toEqual([['info', `  🔐 Using the configured long-term token for ${STORE_KEY}`]]);
      expect(everythingLogged(logger)).not.toContain(seed);
    });

    it('sends the configured token without the whitespace around it', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig } = resolveOver(store, { seed: `  ${seed}\n` });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('sends a configured token the store binds to this login under another key', () => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();
      seedRecords(fileSystem, { 'onezero:old': { token: seed, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    const refusedSeeds = [
      {
        why: 'is not text',
        arrange: (): unknown => 12_345,
        warning: `The configured long-term token for ${STORE_KEY} is not text, so it is not sent`,
      },
      {
        why: 'comes with a damaged token file',
        arrange: (fileSystem: Parameters<typeof seedRaw>[0]): unknown => {
          seedRaw(fileSystem, '{ not json');
          return fakeToken();
        },
        warning: `The token file is damaged, so the configured long-term token for ${STORE_KEY} is not sent`,
      },
      {
        why: 'belongs to another login',
        arrange: (fileSystem: Parameters<typeof seedRaw>[0]): unknown => {
          const seed = fakeToken();
          seedRecords(fileSystem, { 'onezero:other': { token: seed, capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });
          return seed;
        },
        warning: `The configured long-term token for ${STORE_KEY} belongs to another login, so it is not sent`,
      },
    ];

    it.each(refusedSeeds)('sends no token, and warns, when the configured one $why', ({ arrange, warning }) => {
      const { store, fileSystem } = makeStore();
      const seed = arrange(fileSystem);

      const { bankConfig, logger } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([['warn', `  ⚠️  ${warning}`]]);
    });
  });

  describe('with nothing to send', () => {
    it.each([undefined, null, '', '   '])('sends no token and logs nothing when the configured one is %j', (seed) => {
      const { store } = makeStore();

      const { bankConfig, logger } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([]);
    });

    it.each([undefined, null, '', '   '])(
      'sends no token, and warns, when the token file is damaged and the configured one is %j',
      (seed) => {
        const { store, fileSystem } = makeStore();
        seedRaw(fileSystem, '{ not json');

        const { bankConfig, logger } = resolveOver(store, { seed });

        expect(bankConfig.otpLongTermToken).toBeUndefined();
        expect(linesLogged(logger)).toEqual([
          ['warn', `  ⚠️  The token file is damaged and holds no usable long-term token for ${STORE_KEY}`],
        ]);
      },
    );

    it('warns the same way when only another entry in the file is unusable', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { 'pepper:main': { token: fakeToken(), capturedAt: CAPTURED_AT } });

      const { bankConfig, logger } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  The token file is damaged and holds no usable long-term token for ${STORE_KEY}`],
      ]);
    });

    it('warns that the file is damaged, then how to fix it, when none is configured and no code can be asked for', () => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, '{ not json');

      const { logger } = resolveOver(store, { canAskForOtp: false });

      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  The token file is damaged and holds no usable long-term token for ${STORE_KEY}`],
        ['warn', `  ⚠️  No usable long-term token for ${STORE_KEY}, and this run cannot ask for an SMS code: `
          + 'turn on twoFactorAuth for one SMS login, or restore the token file'],
      ]);
    });

    it('sends no token, and warns, when the entry has no login to bind one to', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig, logger } = resolveOver(store, { login: NO_LOGIN, seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  No login identity for ${STORE_KEY}, so no long-term token is sent`],
      ]);
    });

    it('does not read the store for an entry with no login, even one with a configured token', () => {
      const store = storeThatReads(() => fail('never asked'));

      resolveOver(store, { login: NO_LOGIN, seed: fakeToken() });

      expect(store.read).not.toHaveBeenCalled();
    });

    it('sends no token, and warns with the cause, when the store cannot be read', () => {
      const store = storeThatReads(() => fail('EACCES: permission denied'));

      const { bankConfig, logger } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  Could not read the long-term token for ${STORE_KEY}: EACCES: permission denied`],
      ]);
    });

    it('sends no token, and warns with the cause, when reading the store throws', () => {
      const store = storeThatReads(() => { throw new Error('disk vanished'); });

      const { bankConfig, logger } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([
        ['warn', `  ⚠️  Could not read the long-term token for ${STORE_KEY}: disk vanished`],
      ]);
    });
  });

  describe('when the run cannot ask for an SMS code', () => {
    const fix = `No usable long-term token for ${STORE_KEY}, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login, or restore the token file';

    it('warns how to fix a run that has no token to send', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { canAskForOtp: false });

      expect(linesLogged(logger)).toEqual([['warn', `  ⚠️  ${fix}`]]);
    });

    it('does not warn about the fix when a token is sent', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { seed: fakeToken(), canAskForOtp: false });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not warn about the fix when the run can ask for an SMS code', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { canAskForOtp: true });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('what it returns', () => {
    it.each([
      { why: 'it removes the configured token', login: NO_LOGIN, sendsSeed: false },
      { why: 'it sends the configured token as given', login: ACCOUNT_LOGIN, sendsSeed: true },
    ])('returns a new config entry and leaves the given one untouched when $why', ({ login, sendsSeed }) => {
      const { store } = makeStore();
      const logger = spyLogger();
      const capture: IAuthFlowCaptureParams = {
        storeKey: STORE_KEY, companyType: CompanyTypes.OneZero, login, store, logger,
      };
      const seed = fakeToken();
      const bankConfig = configWith(seed);
      const context: ILoginContext = { capture, refusals: makeRefusals() };

      const resolved = resolveWarmToken(context, { bankConfig, canAskForOtp: true }).bankConfig;

      expect(resolved).not.toBe(bankConfig);
      expect(resolved.otpLongTermToken).toBe(sendsSeed ? seed : undefined);
      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('keeps every other field of the config entry', () => {
      const { store } = makeStore();
      const logger = spyLogger();
      const capture: IAuthFlowCaptureParams = {
        storeKey: STORE_KEY, companyType: CompanyTypes.OneZero, login: ACCOUNT_LOGIN, store, logger,
      };
      const bankConfig = configWith(fakeToken());
      const context: ILoginContext = { capture, refusals: makeRefusals() };

      const resolved = resolveWarmToken(context, { bankConfig, canAskForOtp: true });
      const { otpLongTermToken: _sent, ...rest } = resolved.bankConfig;

      const { otpLongTermToken: _configured, ...expected } = bankConfig;
      expect(rest).toEqual(expected);
    });

    it.each([true, false])('hides the configured token it sends from every output (canAskForOtp: %s)', (canAskForOtp) => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig } = resolveOver(store, { seed, canAskForOtp });

      expect(bankConfig.otpLongTermToken).toBe(seed);
      expect(redactSecrets(`provider said ${seed} back`)).not.toContain(seed);
    });

    it('tags what it sent with the source and the digest of the token, never the token', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { decision } = resolveOver(store);

      expect(decision).toEqual({ source: 'stored', digest: tokenDigest(stored) });
      expect(JSON.stringify(decision)).not.toContain(stored);
    });

    it('tags a configured token with the digest of the trimmed token it sent', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig, decision } = resolveOver(store, { seed: `  ${seed}\n` });

      expect(bankConfig.otpLongTermToken).toBe(seed);
      expect(decision).toEqual({ source: 'configured', digest: tokenDigest(seed) });
    });

    it('tags an attempt that sends no token as sending none', () => {
      const { store } = makeStore();

      const { decision } = resolveOver(store);

      expect(decision).toEqual({ source: 'none' });
    });
  });

  describe('with a token that was not accepted before', () => {
    /** What the resolver warns when it skips the entry's stored token. */
    const STORED_SKIPPED = `  ⚠️  The stored long-term token for ${STORE_KEY} was not accepted before, so it is not sent`;

    /** What the resolver warns when it skips the entry's configured token. */
    const CONFIGURED_SKIPPED = `  ⚠️  The configured long-term token for ${STORE_KEY} was not accepted before, `
      + 'so it is not sent — remove or replace otpLongTermToken';

    it('sends nothing when the refused stored token is the only one', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { bankConfig, decision, logger } = resolveOver(store, { refusals: refusing(fileSystem, stored) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(decision).toEqual({ source: 'none' });
      expect(linesLogged(logger)).toEqual([['warn', STORED_SKIPPED]]);
    });

    it('sends nothing when the configured token is the same refused one', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { bankConfig, logger } = resolveOver(store, { seed: stored, refusals: refusing(fileSystem, stored) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([['warn', STORED_SKIPPED], ['warn', CONFIGURED_SKIPPED]]);
    });

    it('falls through to a different configured token once the stored one is refused', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);
      const seed = fakeToken();

      const { bankConfig, decision, logger } = resolveOver(store, { seed, refusals: refusing(fileSystem, stored) });

      expect(bankConfig.otpLongTermToken).toBe(seed);
      expect(decision).toEqual({ source: 'configured', digest: tokenDigest(seed) });
      expect(linesLogged(logger)).toEqual([
        ['info', `  🔐 Using the configured long-term token for ${STORE_KEY}`], ['warn', STORED_SKIPPED],
      ]);
    });

    it('sends nothing for a refused configured token when nothing is stored', () => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();

      const { bankConfig, logger } = resolveOver(store, { seed: ` ${seed} `, refusals: refusing(fileSystem, seed) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([['warn', CONFIGURED_SKIPPED]]);
    });

    it('still keeps a stored token bound to another login from the configured one', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed: fakeToken(), refusals: refusing(fileSystem, stored) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
    });

    it('skips a stored token another entry retired', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { bankConfig, logger } = resolveOver(store, { refusals: refusedElsewhere(fileSystem, stored) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(linesLogged(logger)).toEqual([['warn', STORED_SKIPPED]]);
    });

    it.each([
      { whose: 'another login', login: OTHER_LOGIN },
      { whose: 'this login', login: ACCOUNT_LOGIN },
    ])('never sends a configured token another entry retired, for $whose', ({ login }) => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();

      const { bankConfig, decision, logger } = resolveOver(
        store, { seed, login, refusals: refusedElsewhere(fileSystem, seed) },
      );

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(decision).toEqual({ source: 'none' });
      expect(linesLogged(logger)).toEqual([['warn', CONFIGURED_SKIPPED]]);
    });

    it('reads the refusals once for both tokens it checks', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);
      const refusals = refusing(fileSystem, stored);
      const read = vi.spyOn(refusals, 'read');

      resolveOver(store, { seed: fakeToken(), refusals });

      expect(read).toHaveBeenCalledOnce();
    });

    it('never logs the token or its digest', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { logger } = resolveOver(store, { seed: stored, refusals: refusing(fileSystem, stored) });

      const logged = everythingLogged(logger);
      expect(logged).not.toContain(stored);
      expect(logged).not.toContain(tokenDigest(stored));
    });
  });

  describe('when the refusals cannot be trusted', () => {
    it('warns and sends the stored token as before when the file cannot be read', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);

      const { bankConfig, logger } = resolveOver(store, { refusals: unreadableRefusals() });

      expect(bankConfig.otpLongTermToken).toBe(stored);
      const [warning] = logger.warn.mock.calls[0] ?? [];
      expect(String(warning)).toMatch(
        new RegExp(`^  ⚠️  Could not read which long-term tokens for ${STORE_KEY} were not accepted before, so none is skipped: .*EACCES`, 'u'),
      );
    });

    it('warns and sends the stored token as before when reading throws', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);
      const refusals: IRefusedTokens = {
        read: () => { throw new Error('EIO: i/o error'); },
        refuse: vi.fn(), sweepStagedLeftovers: vi.fn(),
      };

      const { bankConfig, logger } = resolveOver(store, { refusals });

      expect(bankConfig.otpLongTermToken).toBe(stored);
      expect(String(logger.warn.mock.calls[0]?.[0])).toContain('EIO: i/o error');
    });

    it('warns that the file is damaged and still skips the refusals it holds', () => {
      const { store, fileSystem } = makeStore();
      const stored = storedToken(fileSystem);
      const contents = JSON.stringify({ [STORE_KEY]: [tokenDigest(stored)], 'onezero:other': 'junk' });
      fileSystem.seedFile(REFUSED_PATH, contents, OWNER_ONLY);

      const { bankConfig, logger } = resolveOver(store, { refusals: makeRefusals(fileSystem) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.warn.mock.calls.map(([line]) => line)).toEqual([
        '  ⚠️  The list of long-term tokens that were not accepted is damaged, so only the ones it still holds are skipped',
        `  ⚠️  The stored long-term token for ${STORE_KEY} was not accepted before, so it is not sent`,
      ]);
    });

    /** What the resolver warns when the list cannot say a configured token was never retired. */
    const NOT_VOUCHED = `  ⚠️  The configured long-term token for ${STORE_KEY} is not saved for this login, `
      + 'and the list of tokens that were not accepted could not be fully read, so it is not sent';

    const untrustedLists = [
      { why: 'cannot be read', open: (): IRefusedTokens => unreadableRefusals() },
      {
        why: 'throws',
        open: (): IRefusedTokens => ({
          read: () => { throw new Error('EIO: i/o error'); }, refuse: vi.fn(), sweepStagedLeftovers: vi.fn(),
        }),
      },
      {
        why: 'is damaged',
        open: (fileSystem: FakeFileSystem): IRefusedTokens => {
          fileSystem.seedFile(REFUSED_PATH, JSON.stringify({ [OTHER_KEY]: 'junk' }), OWNER_ONLY);
          return makeRefusals(fileSystem);
        },
      },
    ];

    it.each(untrustedLists)('sends no configured token the store does not bind to this login when the list $why', ({ open }) => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();

      const { bankConfig, decision, logger } = resolveOver(store, { seed, refusals: open(fileSystem) });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(decision).toEqual({ source: 'none' });
      expect(logger.warn.mock.calls.map(([line]) => line).at(-1)).toBe(NOT_VOUCHED);
      expect(logger.info).not.toHaveBeenCalled();
    });

    it.each(untrustedLists)('sends a configured token the store binds to this login when the list $why', ({ open }) => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();
      seedRecords(fileSystem, { [OTHER_KEY]: { token: seed, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig, logger } = resolveOver(store, { seed, refusals: open(fileSystem) });

      expect(bankConfig.otpLongTermToken).toBe(seed);
      expect(logger.warn.mock.calls.map(([line]) => line)).not.toContain(NOT_VOUCHED);
    });
  });
});
