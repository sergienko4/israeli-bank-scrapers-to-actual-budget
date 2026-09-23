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
 * <p>Any name ending in "token", "password" or "secret" is a secret, so the
 * scraper's durable login token is hidden under each of its names:
 * `otpLongTermToken`, `longTermToken`, `persistentOtpToken`, `idToken` and
 * PayBox's `access_token`, as are `clientSecret` and `new_password`. Listing
 * them one by one would miss the next rename.
 *
 * <p>The other keys must be a word of their own, so the importer's own
 * `twoFactorAuth: true` hint and `OAuth:` stay readable.
 */
const SECRET_KEYS = [
  // Starts only where a word does. Starting after every `_` would rescan the
  // rest of the word from each one, which is quadratic on `a_a_a_...`.
  String.raw`\b\w*(?:token|password|secret)`,
  // Here `_` also splits words, so `card_cvv` is caught; `\b` would not be.
  '(?<![a-z0-9])(?:auth(?:orization)?|creditcard|cvv|bearer|jwt)',
].join('|');

/** A field name that ends in a secret key, in any case. */
const SECRET_KEY_NAME = new RegExp(`(?:${SECRET_KEYS})$`, 'i');

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
  String.raw`(${SECRET_KEYS})[\\"']*\s*[=:]\s*` +
    String.raw`(?:[{[][\s\S]*|[\\"']*(?:(?:Bearer|Basic)\s+)?\S+)`,
  'gi',
);

/**
 * Tells whether a structured field's name marks its value as a secret.
 *
 * <p>Uses the same keys as the text masker, so a logged `{ authToken }` is
 * hidden exactly when `authToken=...` in a message would be.
 * @param name - The field name, such as a key of a log call's context.
 * @returns True when the name ends in a secret key.
 */
export function isSecretKey(name: string): boolean {
  return SECRET_KEY_NAME.test(name);
}

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
