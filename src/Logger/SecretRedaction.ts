/**
 * Masks credential values quoted in free text.
 *
 * Scraper errors carry the first 120 characters of a bank's response body,
 * and banks sometimes echo credentials there. This is the one redactor that
 * log lines, metrics records and error notifications all share, so a key
 * added here is hidden from every one of them.
 */

/**
 * Keys whose value is hidden.
 *
 * `\w*token` covers every name ending in "token", so the scraper's durable
 * login token is hidden under each of its names: `otpLongTermToken`,
 * `longTermToken`, `persistentOtpToken`, `idToken` and PayBox's
 * `access_token`. Listing them one by one would miss the next rename.
 */
const SECRET_KEYS = [
  String.raw`\w*token`, 'password', 'secret', 'auth(?:orization)?', 'creditcard', 'cvv',
  'bearer', 'jwt',
].join('|');

/**
 * A secret key, then its value.
 *
 * <p>The key may be quoted, even escaped (`\"idToken\"`), as in an echoed
 * JSON body. A plain value may be quoted, and may open with an auth scheme:
 * a bearer is `Bearer <jwt>`, and a match that stopped at the first word
 * would hide the scheme and print the jwt.
 *
 * <p>A value that opens an object or a list hides the rest of the text. Its
 * inner fields may be secrets under harmless names, and the bank's snippet
 * is often cut off before the closing brace, so there is no end to match.
 */
const SECRET_PATTERN = new RegExp(
  String.raw`\b(${SECRET_KEYS})[\\"']*\s*[=:]\s*` +
    String.raw`(?:[{[][\s\S]*|[\\"']*(?:(?:Bearer|Basic)\s+)?\S+)`,
  'gi',
);

/**
 * Replaces each quoted secret value with `[REDACTED]`, keeping its key.
 *
 * <p>Bare keywords are kept, so `AuthenticationError` still reads as the
 * error it is; only a key followed by `=` or `:` loses its value, per the
 * preventive-masking rule in `logging-pii-guidlines.md` §1.
 * @param text - Free text that may quote a credential, such as an error.
 * @returns The text with every secret value replaced.
 */
export default function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, (_match, key: string) => `${key}=[REDACTED]`);
}
