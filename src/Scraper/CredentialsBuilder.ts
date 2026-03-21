import type { ScraperCredentials } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig } from '../Types/Index.js';

/**
 * Builds scraper credentials for a bank.
 * When otpRetriever is provided, it is included in the credentials for
 * banks that read otpCodeRetriever from credentials (e.g. oneZero), and
 * is also passed via ScraperOptions for banks that use OtpHandler (e.g. beinleumi).
 * @param bankConfig - The IBankConfig containing login credentials for the bank.
 * @param otpRetriever - Optional async function that returns an OTP code on demand.
 * @returns ScraperCredentials object ready for use with the israeli-bank-scrapers library.
 */
export default function buildCredentials(
  bankConfig: IBankConfig, otpRetriever?: () => Promise<string>
): ScraperCredentials {
  const { id: bankId, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber, otpLongTermToken } = bankConfig;
  if (otpLongTermToken) {
    return { email: email ?? '', password: password ?? '', otpLongTermToken } as ScraperCredentials;
  }
  return {
    id: bankId, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber,
    ...(otpRetriever ? { otpCodeRetriever: otpRetriever } : {}),
  } as ScraperCredentials;
}
