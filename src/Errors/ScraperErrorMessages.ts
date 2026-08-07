/**
 * Maps scraper error codes to user-friendly messages with actionable advice.
 * OCP pattern: add new entries without modifying existing code.
 *
 * Two lookups are layered. {@link SCRAPER_ERROR_ADVICE} matches the provider's
 * error CODE, which is stable. {@link UPSTREAM_FAILURE_SIGNATURES} matches
 * distinctive text inside the provider's error MESSAGE, for failures that
 * arrive under a catch-all code such as `GENERIC` and whose upstream wording
 * misdirects the reader (see the zero-accounts entry).
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
  TWO_FACTOR_RETRIEVER_MISSING: {
    message: 'The bank asked for an OTP but no way to collect one was configured',
    action: 'Set twoFactorAuth: true for this bank and configure Telegram or the mobile app',
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

/** A distinctive fragment of an upstream error message, and what it really means. */
export interface IFailureSignature {
  /** Case-insensitive pattern matched against the provider's error message. */
  readonly pattern: RegExp;
  /** Advice shown instead of the upstream wording. */
  readonly advice: IErrorAdvice;
}

/**
 * Upstream failures whose own message points the reader at the wrong cause.
 *
 * OCP: add a signature here rather than teaching call sites about bank quirks.
 */
export const UPSTREAM_FAILURE_SIGNATURES: readonly IFailureSignature[] = [
  {
    // israeli-bank-scrapers ends a zero-account scrape with "Re-authenticate;
    // a logged-in customer always has at least one account", which reads as a
    // credentials problem. It is not: the scrape only reaches this guard AFTER
    // the login handshake succeeded. Confirmed for visaCal in 13/13 runs where
    // the bank's own dashboard failed to boot, so the session was never
    // completed and the accounts call answered HTTP 500. Sending the operator
    // to re-check a working password wastes the one thing they can act on.
    pattern: /resolved zero accounts/iu,
    advice: {
      message: 'Signed in, but the bank returned no accounts',
      action:
        'Your credentials are fine — the bank\'s own site failed to load. '
        + 'Retry later; if it persists for more than a day the bank has a server-side fault',
    },
  },
];

/**
 * Formats an advice entry into the single-line form shown to the user.
 * @param entry - The advice entry to render.
 * @returns Sentence-formatted advice text.
 */
function renderAdvice(entry: IErrorAdvice): string {
  return `${entry.message}. ${entry.action}.`;
}

/**
 * Finds advice for a known upstream failure signature in an error message.
 * @param errorText - The error message or error type string from the scraper.
 * @returns Formatted advice, or empty string when no signature applies.
 */
function findSignatureAdvice(errorText: string): string {
  /**
   * Tests one signature against the error text.
   * @param signature - Candidate signature from the OCP list.
   * @returns True when this signature describes the failure.
   */
  const matches = (signature: IFailureSignature): boolean =>
    signature.pattern.test(errorText);
  const hit = UPSTREAM_FAILURE_SIGNATURES.find(matches);
  return hit ? renderAdvice(hit.advice) : '';
}

/**
 * Finds advice for a provider error code appearing anywhere in the text.
 * @param errorText - The error message or error type string from the scraper.
 * @returns Formatted advice, or empty string when no code applies.
 */
function findCodeAdvice(errorText: string): string {
  /**
   * Tests one mapped error code against the error text.
   * @param pair - Entry pairing a provider error code with its advice.
   * @returns True when the error text carries this code.
   */
  const matches = (pair: readonly [string, IErrorAdvice]): boolean =>
    errorText.includes(pair[0]);
  const hit = Object.entries(SCRAPER_ERROR_ADVICE).find(matches);
  return hit ? renderAdvice(hit[1]) : '';
}

/**
 * Looks up actionable advice for a scraper error.
 *
 * Matches known upstream message signatures as well as provider error codes.
 * Signatures win: a failure carrying a catch-all code plus recognisable wording
 * is described by the wording, which is the more specific signal.
 * @param errorText - The error message or error type string from the scraper.
 * @returns Formatted advice string, or empty string if nothing matched.
 */
export function getScraperErrorAdvice(errorText: string): string {
  return findSignatureAdvice(errorText) || findCodeAdvice(errorText);
}
