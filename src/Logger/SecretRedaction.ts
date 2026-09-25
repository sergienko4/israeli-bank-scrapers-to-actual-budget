/**
 * Masks credential values and phone numbers quoted in free text.
 *
 * Scraper errors carry the first 120 characters of a bank's response body,
 * and banks sometimes echo credentials there. This is the one redactor that
 * log lines, metrics records and error notifications all share, so a key
 * added here is hidden from every one of them.
 */

/**
 * Spells a key or scheme word so an invisible mark may sit between any two of
 * its letters, as `idTok\u200een` puts one there: the mark reads as nothing.
 *
 * <p>A mark may only follow a letter here, never lead or trail the word, so
 * one run of marks can be read only one way and the search stays linear.
 * @param word - The word's letters, digits and dashes, with no regex syntax.
 * @returns A pattern source that matches the word with or without marks.
 */
function marked(word: string): string {
  return Array.from(word).join(String.raw`\p{Cf}*`);
}

/**
 * Lists words as alternatives, each spelled with `marked`.
 * @param words - The words, such as scheme names.
 * @returns A non-capturing group that matches any one of them.
 */
function markedAny(words: readonly string[]): string {
  return `(?:${words.map(marked).join('|')})`;
}

/** The `auth` and `authorization` keys, which alone read an unlisted scheme. */
const AUTH_KEY = String.raw`${marked('auth')}(?:\p{Cf}*${marked('orization')})?`;

/**
 * Keys whose value is hidden.
 *
 * <p>Any name ending in "token", "password" or "secret" is a secret, so the
 * scraper's durable login token is hidden under each of its names:
 * `otpLongTermToken`, `longTermToken`, `persistentOtpToken`, `idToken` and
 * PayBox's `access_token`, as are `clientSecret` and `new_password`. Listing
 * them one by one would miss the next rename. A name ending in
 * `phoneNumber`, `phone_number` or `phone-number` is hidden too: a phone
 * number is personal data, and the login for OneZero, PayBox and Pepper.
 *
 * <p>The other keys must be a word of their own, so the importer's own
 * `twoFactorAuth: true` hint and `OAuth:` stay readable.
 */
const SECRET_KEYS = [
  // Starts only where a word does. Starting after every `_` would rescan the
  // rest of the word from each one, which is quadratic on `a_a_a_...`.
  String.raw`\b\w*(?:${markedAny(['token', 'password', 'secret'])}` +
    String.raw`|${marked('phone')}(?:\p{Cf}*[_-])?\p{Cf}*${marked('number')})`,
  // Here `_` also splits words, so `card_cvv` is caught; `\b` would not be.
  `(?<![a-z0-9])(?:${AUTH_KEY}|${markedAny(['creditcard', 'cvv', 'bearer', 'jwt'])})`,
].join('|');

/**
 * A space, or an invisible format character such as a bidi mark.
 *
 * <p>Right-to-left text wraps a number in marks like U+200E and U+2066 that
 * show as nothing, so one between a key and its value must not end the
 * value's search at the mark and print the value after it. A chained value
 * may not start with such a mark, so only this gap can take one; were both
 * able to, a run of marks could be split between them in many ways.
 */
const GAP = String.raw`[\s\p{Cf}]`;

/**
 * The end of a key, up to its `=` or `:`: any quotes closing or escaping it,
 * with spaces and marks among them, as `{"idToken\u200e" : "..."}` has.
 */
const KEY_END = String.raw`[\\"'\s\p{Cf}]*[=:]`;

/**
 * A line break that carries a header on to the next line, as an obsolete
 * folded header does: that line starts with a space or a tab, after any
 * invisible marks, which read as nothing.
 */
const FOLD = String.raw`\r?\n\p{Cf}*[ \t]`;

/**
 * What may sit between a parameter's name and its `=`: spaces, tabs,
 * invisible marks and folded lines, as HTTP allows space there.
 */
const BEFORE_EQUALS = String.raw`(?:[ \t\p{Cf}]|${FOLD})*=`;

/**
 * A character HTTP allows in a token, and so in a scheme's or a parameter's
 * name (RFC 9110 §5.6.2): a letter, a digit or one of ``!#$%&'*+-.^_`|~``.
 */
const TOKEN_CHAR = String.raw`[\w!#$%&'*+.^\x60|~-]`;

/**
 * An unlisted scheme's name, then its first parameter's name and `=`, as in
 * `AWS4-HMAC-SHA256 Credential=`.
 *
 * <p>Both names are HTTP tokens, per `TOKEN_CHAR`. Invisible marks inside
 * either name read as nothing, and what may sit before the `=` is read as
 * `BEFORE_EQUALS` reads it. A space, a tab or a folded line splits the two
 * names, or marks alone do, as in `AWS4-HMAC-SHA256\u200eCredential=`. The
 * two splits are read apart so that the search stays linear. With a space,
 * the scheme's name ends at it, so the parameter's name is read from that one
 * place; a space here is one that is not also a mark, as U+FEFF is, so a run
 * of U+FEFF is read as marks alone. With marks alone, the run up to the `=`
 * is read once, as words split by marks. Were every mark run a place the
 * scheme's name might end, the parameter's name would be read again from each
 * one, which is quadratic on `A\u200e\u200eA\u200e\u200e...`.
 */
const SCHEME_THEN_PARAM =
  String.raw`(?:${TOKEN_CHAR}(?:${TOKEN_CHAR}|\p{Cf}+(?=${TOKEN_CHAR}))*` +
  String.raw`\p{Cf}*(?:(?![\r\n\p{Cf}])\s|${FOLD})` +
  String.raw`(?:(?![\r\n])${GAP}|${FOLD})*` +
  String.raw`${TOKEN_CHAR}+(?:\p{Cf}+${TOKEN_CHAR}+)*${BEFORE_EQUALS}` +
  String.raw`|${TOKEN_CHAR}+(?:\p{Cf}+${TOKEN_CHAR}+)+${BEFORE_EQUALS})`;

/**
 * A field name that ends in a secret key, in any case.
 *
 * <p>It reads marks as the text masker does: inside the key they read as
 * nothing, and spaces and marks after it are ignored, so `idTok\u200een` and
 * `idToken\u200e` are secrets.
 */
const SECRET_KEY_NAME = new RegExp(`(?:${SECRET_KEYS})${GAP}*$`, 'iu');

/**
 * A value that starts like a number, with the words after it on its line
 * that hold no letter, such as `+972 50-000-0016` or `050\u00a0123 4567!`.
 */
const NUMBER_VALUE = String.raw`(?:[(+]\p{Cf}*)*\d\S*(?:[^\S\r\n]+[^\s\p{L}]+(?!\S))*`;

/**
 * An auth scheme whose credential is the one word after it.
 *
 * <p>These are the schemes IANA registers with a single-word credential
 * (RFC 9110 §11.4), and the unregistered `Token` and `NTLM` in common use.
 */
const ONE_WORD_SCHEME = markedAny(['Basic', 'Bearer', 'DPoP', 'GNAP', 'Negotiate', 'NTLM', 'Token']);

/**
 * An auth scheme whose credential is a list of parameters.
 *
 * <p>These are the other schemes IANA registers. Any parameter can carry the
 * secret under a name of its own, such as Digest's `response` or vapid's `t`,
 * so hiding one more word would hide only the first of them. A chained value
 * may not start with one either: were an invisible mark to join the scheme to
 * its first parameter, as in `Digest\u200eusername="u", response="..."`, that
 * parameter's `=` would read as a separator and end the match before
 * `response`.
 */
const PARAM_LIST_SCHEME = markedAny([
  'Concealed', 'Digest', 'HOBA', 'Mutual', 'OAuth', 'PrivateToken', 'SCRAM-SHA-1', 'SCRAM-SHA-256',
  'vapid',
]);

/**
 * An auth header's value that opens with a scheme neither list names, then a
 * parameter, such as `AWS4-HMAC-SHA256 Credential=..., Signature=...`.
 *
 * <p>A `name=` after the scheme shows that it sends parameters, so its value
 * is hidden as a `PARAM_LIST_SCHEME` value is. Only an `auth` or
 * `authorization` key is read this way, as under any key `token=abc bank=x`
 * would lose `bank`. A listed one-word scheme keeps its own rule. As with
 * `PARAM_LIST_SCHEME`, a chained value may not start here, so an invisible
 * mark joining the scheme to its first parameter cannot end the match there.
 * Marks in the names read as `SCHEME_THEN_PARAM` reads them.
 */
const UNLISTED_PARAM_SCHEME =
  `(?!${ONE_WORD_SCHEME}${GAP})(?=${SCHEME_THEN_PARAM})` +
  `(?<=(?<![a-z0-9])${AUTH_KEY}${KEY_END}${GAP}*)`;

/** The rest of a header's line, and each folded line after it. */
const HEADER_REST = String.raw`[^\r\n]*(?:${FOLD}[^\r\n]*)*`;

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
 * short. Then the value takes one of six shapes:
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
 * <li>A value that opens with a whole scheme name from `PARAM_LIST_SCHEME`
 * hides the rest of its line, and each line after it that starts with a space
 * or a tab, as an obsolete folded header carries on there.</li>
 * <li>Under an `auth` or `authorization` key, a value that opens with any
 * other scheme and then a `name=` parameter, per `UNLISTED_PARAM_SCHEME`,
 * hides the same. It is read before a number, as a scheme may start with a
 * digit.</li>
 * <li>A value that starts with a digit, `+` or `(` runs on through each word
 * after it on the same line that holds no letter, so a phone number is
 * hidden whole however its groups are spaced or dashed, and the punctuation
 * after it goes too. A word such as `2nd` or `retry` ends it.</li>
 * <li>Any other value is hidden up to the next space. It may open with an
 * auth scheme from `ONE_WORD_SCHEME`, which is hidden with the word after it:
 * a bearer is `Bearer <jwt>`, and a match that stopped at the first word
 * would hide the scheme and print the jwt.</li>
 * </ul>
 */
const SECRET_PATTERN = new RegExp(
  `(?<key>${SECRET_KEYS})(?<sep>${KEY_END}${GAP}*)` +
    String.raw`(?!\[REDACTED\]\.?(?:\s|$))` +
    String.raw`(?:(?![\\"'\x60{[\p{Cf}]|${PARAM_LIST_SCHEME}\b|${UNLISTED_PARAM_SCHEME})` +
    String.raw`\S*?[=:]${GAP}*)*` +
    String.raw`(?:[{[][\s\S]*` +
    String.raw`|(?<esc>\\*)(?<quote>["'\x60])[\s\S]*?` +
    String.raw`(?:(?<!\\)(?:\k<esc>\\\k<esc>\\)*(?<close>\k<esc>\k<quote>)` +
    String.raw`(?=[\s,;)\]}]|\.(?!\S)|$)|$)` +
    String.raw`|${PARAM_LIST_SCHEME}\b${HEADER_REST}` +
    `|${UNLISTED_PARAM_SCHEME}${HEADER_REST}` +
    `|${NUMBER_VALUE}` +
    String.raw`|(?:${ONE_WORD_SCHEME}${GAP}+)?\S+)`,
  'giu',
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
 * @param args - The replace callback's arguments, whose last is the named
 * groups.
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
 * <p>Uses the same keys, read the same way, as the text masker, so a logged
 * `{ authToken }` is hidden whenever `authToken=...` in a message would be.
 * A mark inside a key reads as nothing, so `idTok\u200een` is a secret, and
 * one before a key starts a word, so `two\u200eauth` is one too.
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
