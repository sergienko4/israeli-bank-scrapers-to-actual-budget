import type { ScraperCredentials } from '@sergienko4/israeli-bank-scrapers';

import { getLogger } from '../Logger/Index.js';
import maskPhone from '../Logger/MaskPhone.js';
import type { IBankConfig } from '../Types/Index.js';
import normalisePhoneNumber, { stripPhoneFormatting } from './PhoneNumberNormaliser.js';

/**
 * Coerces a config phoneNumber to the upstream-required canonical form,
 * logging a masked WARN on normalisation failure and returning the
 * stripped candidate (no `+`/`-`/spaces) so the upstream wire-format
 * step is never asked to handle separator characters.
 * @param raw - phoneNumber from IBankConfig, already verified non-empty.
 * @param bankId - bank id used in the failure WARN; '' when unknown.
 * @returns canonical digits-only string, or stripped candidate on failure.
 */
function coerceCredsPhone(raw: string, bankId: string): string {
  const result = normalisePhoneNumber(raw);
  if (result.success) return result.data;
  const label = bankId === '' ? 'bank' : bankId;
  getLogger().warn(
    `Phone normalisation failed for ${label} (${maskPhone(raw)}): ${result.message}`
  );
  return stripPhoneFormatting(raw);
}

/**
 * Builds scraper credentials for a bank.
 * Normalises phoneNumber at this boundary so the upstream
 * `validateInternationalDigits` step never falls back to the raw input.
 * When otpRetriever is provided, it is included in the credentials for
 * banks that read otpCodeRetriever from credentials (oneZero, pepper,
 * payBox), and is also passed via ScraperOptions for banks that use
 * OtpHandler (beinleumi). The otpLongTermToken branch covers API-direct
 * banks; the retriever is still attached when supplied so upstream's
 * cold-path fallback works when the token is stale.
 * @param bankConfig - The IBankConfig containing login credentials for the bank.
 * @param otpRetriever - Optional async function that returns an OTP code on demand.
 * @returns ScraperCredentials object ready for use with the israeli-bank-scrapers library.
 */
export default function buildCredentials(
  bankConfig: IBankConfig, otpRetriever?: () => Promise<string>
): ScraperCredentials {
  const { id: bankId, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber, otpLongTermToken } = bankConfig;
  const phone = phoneNumber ? coerceCredsPhone(phoneNumber, bankId ?? '') : '';
  if (otpLongTermToken) {
    return {
      email: email ?? '', password: password ?? '',
      ...(phone ? { phoneNumber: phone } : {}),
      otpLongTermToken,
      ...(otpRetriever ? { otpCodeRetriever: otpRetriever } : {}),
    };
  }
  return {
    id: bankId, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber: phone || undefined,
    ...(otpRetriever ? { otpCodeRetriever: otpRetriever } : {}),
  } as ScraperCredentials;
}
