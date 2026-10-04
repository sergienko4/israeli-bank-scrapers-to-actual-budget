/**
 * Keeps Pepper's durable device login across runs.
 *
 * <p>From scraper 8.7.4 Pepper enrolls this host as a device with one SMS
 * code and hands back an opaque state through `onPersistentAuthStateUpdate`.
 * Sending that state as `persistentAuthState` on later runs logs in with no
 * SMS. Pepper also refuses its old long-term token whenever the callback is
 * attached, so the legacy `pepper:<entry>` token is never sent again.
 *
 * <p>The state lives in the bank token store under its own key,
 * `pepper-device:<entry>`, bound to the login that enrolled it, so the store's
 * rules on damage, logins and secrets cover it as they cover the tokens.
 *
 * <p>The provider fails a run that attaches the callback for an entry without
 * a phone number, and saving the state is its proof the device is kept. When
 * the store cannot bind a state to this login, or cannot be read, neither
 * option is attached and Pepper logs in with an SMS code as it did before.
 */

import type { ScraperOptions } from '@sergienko4/israeli-bank-scrapers';
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import StorageError from '../../Errors/StorageError.js';
import { registerSecretValues } from '../../Logger/SecretValues.js';
import type { IBankConfig } from '../../Types/Index.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import { buildTokenStoreKey } from './AuthFlowCapture.js';
import { isLoginFingerprint, NO_TOKEN } from './BankTokenRecords.js';
import type { IBankTokenWrite, ITokenView } from './BankTokenStore.js';

/** The store's bank id for Pepper's device state, apart from its legacy token's `pepper`. */
const PEPPER_DEVICE_BANK = 'pepper-device';

/** Provider callback invoked with each device state Pepper issues. */
type StateUpdateHook = NonNullable<ScraperOptions['onPersistentAuthStateUpdate']>;

/** Provider options subset that carries Pepper's device login. */
export interface IDeviceAuthTarget {
  persistentAuthState?: string;
  onPersistentAuthStateUpdate?: StateUpdateHook;
}

/** What one attempt tells the device login about itself. */
export interface IDeviceAuthRequest {
  /** Name of the `banks` config entry, when known. */
  readonly accountKey?: string;
  /** Whether the attempt has an OTP retriever. */
  readonly canAskForOtp: boolean;
}

/** Whether an attempt sent a stored device state, and where that state is kept. */
export interface IDeviceStateWatch {
  /** The attempt's capture parameters, keyed on `pepper-device:<entry>`. */
  readonly params: IAuthFlowCaptureParams;
  /** True when the attempt sent the stored state, so only its refusal can remove it. */
  readonly didSendState: boolean;
}

/**
 * How an attempt starts Pepper's login: as before, by enrolling this device,
 * or by resuming the device the store holds.
 */
type DeviceMode = 'legacy' | 'enroll' | 'resume';

/** The mode an attempt starts in, and the state it resumes, if any. */
interface IDeviceStart {
  readonly mode: DeviceMode;
  /** The stored state to send, or {@link NO_TOKEN}. */
  readonly state: string;
}

/** Logs in as before, with neither device option. */
const LEGACY_START: IDeviceStart = { mode: 'legacy', state: NO_TOKEN };

/** Enrolls this device with one SMS code. */
const ENROLL_START: IDeviceStart = { mode: 'enroll', state: NO_TOKEN };

/** Pepper's provider company id, as text so any company id compares with it. */
const PEPPER_COMPANY: string = CompanyTypes.Pepper;

/**
 * Tells whether a bank logs in as an enrolled device.
 * @param companyType - Provider company id of the bank being scraped.
 * @returns True for Pepper.
 */
export function isPepper(companyType: string): boolean {
  return companyType === PEPPER_COMPANY;
}

/**
 * Re-keys an attempt's capture parameters onto its device state.
 * @param captureParams - Capture parameters keyed on the legacy token.
 * @param accountKey - Name of the `banks` config entry, when known.
 * @returns The same parameters keyed on `pepper-device:<entry>`.
 */
function deviceParams(
  captureParams: IAuthFlowCaptureParams, accountKey?: string,
): IAuthFlowCaptureParams {
  const storeKey = buildTokenStoreKey(PEPPER_DEVICE_BANK, accountKey);
  return { ...captureParams, storeKey };
}

/**
 * Logs a warning in the importer's format.
 * @param params - Device parameters carrying the logger.
 * @param message - What happened, naming the entry but not the state.
 * @returns The legacy start, so callers can fall back in one step.
 */
function warnOf(params: IAuthFlowCaptureParams, message: string): IDeviceStart {
  params.logger.warn(`  ⚠️  ${message}`);
  return LEGACY_START;
}

/**
 * Reads the entry's view of the store, turning a throw into a failure.
 * @param params - Device parameters carrying the store and key.
 * @returns The view, or why the store could not be read.
 */
function readView(params: IAuthFlowCaptureParams): Procedure<ITokenView> {
  try {
    return params.store.read(params.storeKey);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(detail);
  }
}

/**
 * Enrolls an entry the store holds no state for, warning when the file is damaged.
 *
 * <p>The damage may have cost the entry its state, which would explain the
 * SMS code that follows; the view cannot say whose entry was damaged.
 * @param params - Device parameters carrying the key and logger.
 * @param view - The entry's view of the store.
 * @returns The enroll start.
 */
function enrollUnstored(params: IAuthFlowCaptureParams, view: ITokenView): IDeviceStart {
  if (view.isIntact) return ENROLL_START;
  const key = params.storeKey;
  warnOf(params, `The token file is damaged and holds no usable Pepper device state for ${key}`);
  return ENROLL_START;
}

/**
 * Resumes a stored state bound to this login, or enrolls this one instead.
 *
 * <p>A state bound to another login was enrolled before the entry's phone
 * changed, so it is not sent for this one.
 * @param params - Device parameters carrying the key, login and logger.
 * @param view - The entry's view of the store.
 * @returns The start the store vouches for.
 */
function startFromView(params: IAuthFlowCaptureParams, view: ITokenView): IDeviceStart {
  const { record } = view;
  const key = params.storeKey;
  if (record.token === NO_TOKEN) return enrollUnstored(params, view);
  if (record.login !== params.login) {
    params.logger.info(
      `  🔐 The stored Pepper device state for ${key} belongs to another login; `
      + 'enrolling this device with an SMS code',
    );
    return ENROLL_START;
  }
  params.logger.info(`  🔐 Using the stored Pepper device state for ${key}`);
  return { mode: 'resume', state: record.token };
}

/**
 * Chooses how the attempt starts, falling back to the legacy login on every doubt.
 * @param params - Device parameters carrying the store, key and login.
 * @returns The start the store vouches for.
 */
function chooseStart(params: IAuthFlowCaptureParams): IDeviceStart {
  const key = params.storeKey;
  if (!isLoginFingerprint(params.login)) {
    return warnOf(params, `No login identity for ${key}, so the Pepper device login is not kept`);
  }
  const view = readView(params);
  if (!view.success) {
    return warnOf(params, `Could not read the Pepper device state for ${key}: ${view.message}`);
  }
  return startFromView(params, view.data);
}

/**
 * Writes one device state, turning a throw into a failure.
 * @param params - Device parameters carrying the store, key and login.
 * @param state - The state Pepper issued.
 * @returns Whether the file was replaced, or why it was not.
 */
function writeState(params: IAuthFlowCaptureParams, state: string): Procedure<IBankTokenWrite> {
  try {
    return params.store.write(params.storeKey, state, params.login);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(`Could not store the Pepper device state for ${params.storeKey}: ${detail}`);
  }
}

/**
 * Builds the callback that stores each device state Pepper issues.
 *
 * <p>Pepper waits for it before going on, and fails the run when it rejects,
 * so a state the store refused never leaves the device enrolled unrecorded.
 * @param params - Device parameters carrying the store, key, login and logger.
 * @returns The provider callback.
 */
function buildSaveHook(params: IAuthFlowCaptureParams): StateUpdateHook {
  return (state: string): ReturnType<StateUpdateHook> => {
    const saved = writeState(params, state);
    if (!saved.success) {
      warnOf(params, saved.message);
      return Promise.reject(new StorageError(saved.message));
    }
    if (saved.data.written) {
      params.logger.info(`  🔐 Stored the Pepper device state for ${params.storeKey}`);
    }
    return Promise.resolve();
  };
}

/**
 * Sets the provider options a start calls for.
 * @param target - Provider options that receive the device options.
 * @param params - Device parameters the save callback writes through.
 * @param start - The start the store vouches for.
 * @returns True when the stored state was sent.
 */
function applyStart(
  target: IDeviceAuthTarget, params: IAuthFlowCaptureParams, start: IDeviceStart,
): boolean {
  if (start.mode === 'legacy') return false;
  target.onPersistentAuthStateUpdate = buildSaveHook(params);
  if (start.mode === 'enroll') return false;
  registerSecretValues([start.state]);
  target.persistentAuthState = start.state;
  return true;
}

/**
 * Attaches Pepper's device login to an attempt's provider options.
 *
 * <p>The save callback is attached whenever the store can bind a state to
 * this login; the stored state is sent too when there is one for it. With no
 * state to send and no OTP retriever, the run cannot enroll, so it warns how.
 * @param target - Provider options that receive the device options.
 * @param captureParams - The attempt's capture parameters, keyed on its legacy token.
 * @param request - The entry's name and whether the run can ask for an SMS code.
 * @returns The watch on the state the attempt sent, which never holds the state.
 */
export function attachDeviceAuth(
  target: IDeviceAuthTarget, captureParams: IAuthFlowCaptureParams, request: IDeviceAuthRequest,
): IDeviceStateWatch {
  const params = deviceParams(captureParams, request.accountKey);
  if (!isPepper(captureParams.companyType)) return { params, didSendState: false };
  const start = chooseStart(params);
  if (start.mode !== 'resume' && !request.canAskForOtp) {
    warnOf(
      params,
      `No Pepper device state for ${params.storeKey}, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login',
    );
  }
  const didSendState = applyStart(target, params, start);
  return { params, didSendState };
}

/**
 * Tells whether an entry configures a long-term token, as loaded.
 * @param seed - The entry's `otpLongTermToken`, of any shape.
 * @returns True for non-blank text and for any value that is not text.
 */
function isConfigured(seed: unknown): boolean {
  if (seed === undefined || seed === null) return false;
  return typeof seed !== 'string' || seed.trim() !== NO_TOKEN;
}

/**
 * Copies a Pepper entry without its configured long-term token.
 *
 * <p>Pepper refuses that token next to the device callback, and the device
 * state replaces it, so a configured one only earns a warning to remove it.
 * @param params - The attempt's capture parameters, carrying its key and logger.
 * @param bankConfig - The entry's config; never modified.
 * @returns A new config whose `otpLongTermToken` is undefined.
 */
export function withoutLongTermToken(
  params: IAuthFlowCaptureParams, bankConfig: IBankConfig,
): IBankConfig {
  if (isConfigured(bankConfig.otpLongTermToken)) {
    warnOf(
      params,
      `The configured long-term token for ${params.storeKey} is not sent: Pepper now logs in `
      + 'as an enrolled device, so remove otpLongTermToken from this entry',
    );
  }
  return { ...bankConfig, otpLongTermToken: undefined };
}
