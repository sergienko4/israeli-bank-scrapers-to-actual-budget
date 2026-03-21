/**
 * Maps scraper error codes to user-friendly messages with actionable advice.
 * OCP pattern: add new entries without modifying existing code.
 */

/** Advice entry with a user-friendly message and a suggested action. */
export interface IErrorAdvice {
  /** Short description of what happened. */
  readonly message: string;
  /** What the user should do to fix it. */
  readonly action: string;
}

/** OCP map of scraper error codes to actionable advice. */
export const SCRAPER_ERROR_ADVICE: Record<string, IErrorAdvice> = {
  INVALID_PASSWORD: {
    message: 'Password incorrect',
    action: 'Verify your password on the bank website',
  },
  CHANGE_PASSWORD: {
    message: 'Bank requires password change',
    action: 'Update password on bank website, then update config.json',
  },
  ACCOUNT_BLOCKED: {
    message: 'Account is locked/blocked',
    action: 'Contact your bank to unlock the account',
  },
  GENERIC_ERROR: {
    message: 'Scraping failed unexpectedly',
    action: 'Bank website may have changed — check for scraper updates',
  },
  WAF_BLOCKED: {
    message: 'Blocked by bank firewall (WAF)',
    action: 'Wait 1-2 hours before retrying',
  },
  INVALID_OTP: {
    message: 'OTP code rejected',
    action: 'Code may have expired — enter it quickly next time',
  },
  TIMEOUT: {
    message: 'Bank website timed out',
    action: 'Try again later — bank may be under maintenance',
  },
  NO_PASSWORD: {
    message: 'Missing credentials',
    action: 'Check bank config in config.json — password field is empty',
  },
};

/**
 * Looks up actionable advice for a scraper error by matching known codes.
 * @param errorText - The error message or error type string from the scraper.
 * @returns Formatted advice string, or undefined if no matching code found.
 */
export function getScraperErrorAdvice(errorText: string): string {
  const entry = Object.entries(SCRAPER_ERROR_ADVICE)
    .find(([code]) => errorText.includes(code));
  return entry ? `${entry[1].message}. ${entry[1].action}.` : '';
}
