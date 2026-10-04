/**
 * Removes Pepper's stored device state once a run proves Pepper refuses it.
 *
 * <p>A dead state fails every run that sends it, and Pepper never falls back
 * to an SMS code by itself, so the run that proves it dead removes it and the
 * next run enrolls again with one code. Removing a live state would cost a
 * code on every run, so only two results count as proof:
 * <ul>
 *   <li>the provider rejected the state's contents
 *       (`persistent auth state invalid: <category>`);</li>
 *   <li>Pepper refused the device at `auth/login` with a 401 or 403.</li>
 * </ul>
 * Every renewal request is signed with the state's device key, and
 * `auth/login` goes first, so a dead device is refused there. The
 * `auth/assert` step that follows adds the configured password, so its 4xx
 * other than 408 or 429 keeps the state and warns to check the password:
 * removing it would cost an SMS code once the password is fixed.
 *
 * <p>A timeout, a Cloudflare page, a network, parse or server error, any other
 * status, a refused data request, a failed save and any other failure may
 * pass, so the state is kept. Both of upstream's fetch paths word a refusal as
 * `POST <origin><path> <status>: <body>` under `GENERIC`; a Cloudflare page is
 * `WAF_BLOCKED` and a timeout `TIMEOUT`, so only `GENERIC` is read. Upstream
 * spots only Cloudflare's page, so another proxy's 401 or 403 on `auth/login`
 * reads as Pepper's own and costs one SMS code.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/ProcedureHelpers.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IAuthFlowCaptureParams } from './AuthFlowCapture.js';
import type { IBankTokenWrite } from './BankTokenStore.js';
import type { IDeviceStateWatch } from './PepperDeviceState.js';

/** How the provider words a state whose contents it rejects. */
const STATE_INVALID = 'persistent auth state invalid: ';

/** A renewal step's 4xx, as both of upstream's fetch paths word it. */
const RENEWAL_REFUSAL =
  /^POST https:\/\/sa\.pepper\.co\.il\/api\/v2\/auth\/(?<step>login|assert) (?<status>4\d\d): /u;

/** Login statuses that say Pepper no longer accepts the device. */
const DEVICE_REFUSED_STATUSES: ReadonlySet<string> = new Set(['401', '403']);

/** Client errors that ask to come back later rather than refuse the request. */
const TRY_LATER_STATUSES: ReadonlySet<string> = new Set(['408', '429']);

/** What an attempt's result says about the state it sent. */
type StateVerdict = 'dead' | 'password-refused' | 'may-pass';

/**
 * Reads a renewal step's refusal.
 * @param message - The failure's message.
 * @returns `dead` for a 401 or 403 on `auth/login`, `password-refused` for a
 *   4xx other than 408 or 429 on `auth/assert`, and `may-pass` otherwise.
 */
function renewalVerdict(message: string): StateVerdict {
  const groups = RENEWAL_REFUSAL.exec(message)?.groups;
  const status = groups?.status ?? '';
  if (groups?.step === 'login') return DEVICE_REFUSED_STATUSES.has(status) ? 'dead' : 'may-pass';
  if (groups?.step !== 'assert' || TRY_LATER_STATUSES.has(status)) return 'may-pass';
  return 'password-refused';
}

/**
 * Reads what an attempt's result says about the state it sent.
 * @param result - The attempt's provider result.
 * @returns `dead` only when the state was rejected or the device refused,
 *   never on a failure that may pass.
 */
function verdictOf(result: IScraperScrapingResult): StateVerdict {
  if (result.success || String(result.errorType) !== 'GENERIC') return 'may-pass';
  const message = result.errorMessage ?? '';
  if (message.startsWith(STATE_INVALID)) return 'dead';
  return renewalVerdict(message);
}

/**
 * Removes the entry's device state, turning a throw into a failure.
 * @param params - Device parameters carrying the store and key.
 * @returns Whether the file was replaced, or why it was not.
 */
function removeState(params: IAuthFlowCaptureParams): Procedure<IBankTokenWrite> {
  try {
    return params.store.remove(params.storeKey);
  } catch (error: unknown) {
    const detail = errorMessage(error);
    return fail(`Could not remove the Pepper device state for ${params.storeKey}: ${detail}`);
  }
}

/**
 * Keeps a state whose password step Pepper refused, and says to check the password.
 * @param params - Device parameters carrying the key and logger; the warning names the key, never the state.
 * @returns False: nothing was removed.
 */
function keepAfterRefusedPassword(params: IAuthFlowCaptureParams): boolean {
  params.logger.warn(
    `  ⚠️  Kept the Pepper device state for ${params.storeKey}; `
    + 'Pepper refused the password, so check the password in the config',
  );
  return false;
}

/**
 * Removes a state proved dead, warning either way.
 * @param params - Device parameters carrying the store, key and logger.
 * @returns True when the state was removed.
 */
function removeDeadState(params: IAuthFlowCaptureParams): boolean {
  const removed = removeState(params);
  if (!removed.success) {
    params.logger.warn(`  ⚠️  ${removed.message}`);
    return false;
  }
  if (!removed.data.written) return false;
  const { storeKey, logger } = params;
  logger.warn(
    `  ⚠️  Removed the Pepper device state for ${storeKey}; `
    + 'the next run asks for one SMS code',
  );
  return true;
}

/**
 * Removes the device state an attempt sent when its result proves Pepper refuses it.
 *
 * <p>A store that cannot remove it costs a warning, never the scrape; the next
 * run sends the state again and fails the same way. A refused password keeps
 * the state and warns to check the password.
 * @param watch - The attempt's watch on the state it sent.
 * @param result - The attempt's provider result.
 * @returns True when the state was removed.
 */
export default function forgetRefusedState(
  watch: IDeviceStateWatch, result: IScraperScrapingResult,
): boolean {
  if (!watch.didSendState) return false;
  const verdict = verdictOf(result);
  if (verdict === 'dead') return removeDeadState(watch.params);
  if (verdict === 'password-refused') return keepAfterRefusedPassword(watch.params);
  return false;
}
