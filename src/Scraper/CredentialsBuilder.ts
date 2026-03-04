import type { ScraperCredentials } from '@sergienko4/israeli-bank-scrapers';
import type { BankConfig } from '../Types/Index.js';

/**
 * Builds scraper credentials for a bank.
 * When otpRetriever is provided, it is included in the credentials for
 * banks that read otpCodeRetriever from credentials (e.g. oneZero), and
 * is also passed via ScraperOptions for banks that use OtpHandler (e.g. beinleumi).
 */
export function buildCredentials(
  bankConfig: BankConfig, otpRetriever?: () => Promise<string>
): ScraperCredentials {
  const { id, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber, otpLongTermToken } = bankConfig;
  if (otpLongTermToken) {
    return { email: email!, password: password!, otpLongTermToken } as ScraperCredentials;
  }
  return {
    id, password, num, username, userCode, nationalID,
    card6Digits, email, phoneNumber,
    ...(otpRetriever ? { otpCodeRetriever: otpRetriever } : {}),
  } as ScraperCredentials;
}
