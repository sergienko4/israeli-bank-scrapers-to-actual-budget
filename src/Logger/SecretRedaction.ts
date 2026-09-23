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
 * JSON body. A bare `[REDACTED]` followed by a space, a period ending a
 * sentence or the end of the text is this masker's own output, so it is left
 * as it is: text masked once, then quoted in a longer message, loses nothing
 * more when that message is masked again. The only value this can let
 * through is `[REDACTED]` itself. `[REDACTED]` before anything else, as in
 * `[REDACTED],"x"`, is not the masker's output and is hidden like any other
 * value; a quoted `"[REDACTED]"` needs no such rule, as masking it again
 * writes the same text.
 *
 * <p>A separator inside a bare value introduces the next value, which is
 * hidden with it: in `null,"idToken":"a b"`, in `null,jwt=Basic <secret>`,
 * or in an empty value before `authToken:` on the next line, a key is
 * waiting for that value, and printing it would fail open. A quoted value,
 * an escaped one or an object is not bare, so a `: ` inside it cannot cut it
 * short. Then the value takes one of three shapes:
 *
 * <ul>
 * <li>An object or a list hides the rest of the text. Its inner fields may be
 * secrets under harmless names, and the bank's snippet is often cut off
 * before the closing brace, so there is no end to match.</li>
 * <li>A quoted value is hidden through its closing quote, spaces and all.
 * Backticks count, as `util.inspect` uses them for text holding both other
 * quotes. A quote after an odd number of backslashes is part of the value,
 * and one after an even number closes it, as `"a\\"` ends in an escaped
 * backslash. An escaped value (`\"a b\"`) counts the same way, in the
 * doubled backslashes its escaping writes. The closing quote must also be
 * followed by a space, a separator, a period ending a sentence or the end of
 * the text, so a stray quote inside the value cannot end it early. A value
 * the snippet cut off before its closing quote hides the rest of the
 * text.</li>
 * <li>Any other value is hidden up to the next space. It may open with an
 * auth scheme: a bearer is `Bearer <jwt>`, and a match that stopped at the
 * first word would hide the scheme and print the jwt.</li>
 * </ul>
 */
const SECRET_PATTERN = new RegExp(
  String.raw`(?<key>${SECRET_KEYS})(?<sep>[\\"']*\s*[=:]\s*)` +
    String.raw`(?!\[REDACTED\]\.?(?:\s|$))` +
    String.raw`(?:(?![\\"'\x60{[])\S*?[=:]\s*)*(?:[{[][\s\S]*` +
    String.raw`|(?<esc>\\*)(?<quote>["'\x60])[\s\S]*?` +
    String.raw`(?:(?<!\\)(?:\k<esc>\\\k<esc>\\)*(?<close>\k<esc>\k<quote>)` +
    String.raw`(?=[\s,;)\]}]|\.(?!\S)|$)|$)` +
    String.raw`|(?:(?:Bearer|Basic)\s+)?\S+)`,
  'gi',
);

/** The named parts of a secret match that its masked form keeps. */
interface ISecretParts {
  /** The secret key, such as `idToken`. */
  readonly key: string;
  /** What joins the key to its value, such as `":` in JSON. */
  readonly sep: string;
  /** The value's closing quote with its escaping, when it has one. */
  readonly close?: string;
}

/**
 * Writes the masked form of one secret match.
 *
 * <p>A value closed by its quote keeps its quotes and the key's separator, so
 * `{"idToken":"x"}` stays valid JSON as `{"idToken":"[REDACTED]"}` and masking
 * it again writes the same text. Any other value, including one cut off
 * before its closing quote, is written as `key=[REDACTED]`.
 * @param args - The replace callback's arguments; the last is the named groups.
 * @returns The key with its value replaced by `[REDACTED]`.
 */
function maskMatch(...args: unknown[]): string {
  const { key, sep, close } = args.at(-1) as ISecretParts;
  if (close === undefined) return `${key}=[REDACTED]`;
  return `${key}${sep}${close}[REDACTED]${close}`;
}

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
 * Replaces each secret value with `[REDACTED]`, keeping its key.
 *
 * <p>Bare keywords are kept, so `AuthenticationError` still reads as the
 * error it is; only a key followed by `=` or `:` loses its value, per the
 * preventive-masking rule in `logging-pii-guidlines.md` §1.
 * @param text - Free text that may quote a credential, such as an error.
 * @returns The text with every secret value replaced.
 */
export default function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, maskMatch);
}
