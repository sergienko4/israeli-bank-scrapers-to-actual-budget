/**
 * Secret sink invariant.
 *
 * One secret, written under every secret key in every shape a bank's reply or
 * a log call can give it, must not reach any output the importer writes or
 * sends. Each output reaches the secret through its own path: the text
 * masker, the structured field walk, the audit history and the `/logs`
 * replay. A masking rule that one path learns and another misses fails here,
 * whichever path a change touched.
 *
 * <p>Each case also carries a canary outside the secret, which a sink must
 * keep, so an output that dropped the whole line cannot pass vacuously.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import pino from 'pino';
import { afterAll, describe, expect, it } from 'vitest';

import { ErrorFormatter } from '../../src/Errors/ErrorFormatter.js';
import { SCRAPER_ERROR_ADVICE } from '../../src/Errors/ScraperErrorMessages.js';
import LogFileReader from '../../src/Logger/LogFileReader.js';
import { baseOptions } from '../../src/Logger/LoggerOptions.js';
import redactSecrets, { isSecretKey } from '../../src/Logger/SecretRedaction.js';
import { isFail } from '../../src/Scrapers/Pipeline/Index.js';
import scrapeStage from '../../src/Scrapers/Pipeline/Steps/Bank/ScrapeStage.js';
import type { IBankOpts } from '../../src/Scrapers/Pipeline/Steps/Bank/Shared.js';
import type { IAuditEntry } from '../../src/Services/AuditLogService.js';
import { AuditLogService } from '../../src/Services/AuditLogService.js';
import type { IBankMetrics, IImportSummary } from '../../src/Services/MetricsService.js';
import { MetricsService } from '../../src/Services/MetricsService.js';
import { formatSummaryMessage } from '../../src/Services/Notifications/TelegramFormatter.js';
import { formatWebhookSummary } from '../../src/Services/Notifications/Webhook/Index.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

/** Text outside the secret, which every output must still carry. */
const CANARY = 'import-step-canary';

/** A part of the secret that no output may show, even cut short. */
const SECRET_PART = TEST_CREDENTIAL.slice(TEST_CREDENTIAL.indexOf('-') + 1);

/** A name for each kind of secret the masker knows, as banks and callers write it. */
const SECRET_KEY_NAMES = [
  'otpLongTermToken', 'longTermToken', 'persistentOtpToken', 'idToken', 'access_token',
  'token', 'bearer', 'password', 'new_password', 'clientSecret', 'phoneNumber',
  'phone_number', 'auth', 'authorization', 'Authorization', 'jwt', 'cvv', 'card_cvv',
  'creditCard',
];

/** Invisible format characters that a bank's reply or Hebrew text can carry. */
const MARKS = ['\u200e', '\u200f', '\u200b', '\u00ad', '\u2066', '\ufeff'];

/** The marks tried between every two letters of a key. */
const INSIDE_MARKS = ['\u200e', '\u00ad'];

/**
 * Spells a key each way it can reach the masker: in another case, with a
 * space or a mark after it, and with a mark between any two of its letters.
 * @param key - A secret key name.
 * @returns Every spelling, each once.
 */
function keySpellings(key: string): string[] {
  const letters = [...key];
  const inside = letters.slice(1).flatMap((_letter, index) => INSIDE_MARKS.map(
    mark => letters.slice(0, index + 1).join('') + mark + letters.slice(index + 1).join(''),
  ));
  const after = MARKS.map(mark => key + mark);
  return [...new Set([key, key.toUpperCase(), `${key} `, ...inside, ...after])];
}

/** Every key spelling under test. */
const KEYS = SECRET_KEY_NAMES.flatMap(keySpellings);

/** The ways text can pair a key with its value, from a log call to escaped JSON. */
const TEXT_SHAPES: readonly ((key: string) => string)[] = [
  key => `${key}=${TEST_CREDENTIAL}`,
  key => `${key}: ${TEST_CREDENTIAL}`,
  key => `{"${key}":"${TEST_CREDENTIAL}"}`,
  key => `{"${key}" : "${TEST_CREDENTIAL}"}`,
  key => `{'${key}': '${TEST_CREDENTIAL}'}`,
  key => String.raw`{\"${key}\":\"${TEST_CREDENTIAL}\"}`,
  key => `${key}\u200e: \u200f${TEST_CREDENTIAL}`,
];

/** Every key and value pair in every text shape. */
const PAIRS = KEYS.flatMap(key => TEXT_SHAPES.map(shape => shape(key)));

/** Keys an auth header's value can sit under, spelled plainly and with marks. */
const AUTH_KEYS = ['authorization', 'Authorization', 'Authori\u200ezation', 'auth', 'a\u00aduth'];

/** Keys under which only a listed scheme is read. */
const OTHER_KEYS = ['token', 'id\u200eTok\u200een'];

/**
 * Spells a word plainly and with a mark between any two of its letters.
 * @param word - A scheme or parameter name.
 * @returns Every spelling.
 */
function markedSpellings(word: string): string[] {
  const letters = [...word];
  const inside = letters.slice(1).map((_letter, index) =>
    `${letters.slice(0, index + 1).join('')}\u200e${letters.slice(index + 1).join('')}`);
  return [word, ...inside];
}

/** A folded line: LF or CRLF, then any marks, then a space or a tab. */
const FOLDED = ['\n ', '\r\n\t', '\n\u200e ', '\r\n\u200e\t'];

/**
 * What may sit between an auth header's words, wherever HTTP allows a space:
 * a space or a tab, marks with or without a space, U+FEFF, which is both, or
 * a folded line.
 */
const HEADER_GAPS = [' ', '\t', '\u200e', '\u200e ', ' \u200e', '\ufeff', '\ufeff ', ...FOLDED];

/** An unlisted scheme's parameters, with marks in the first name and a gap before its `=`. */
const UNLISTED_RESTS = [
  ...markedSpellings('Credential'), ...HEADER_GAPS.map(gap => `Credential${gap}`),
].map(name => `${name}=u/x, Signature=${TEST_CREDENTIAL}`);

/**
 * Auth values a bank may echo, each with the secret in its credential or a
 * parameter. The first `rests` entry is tried with every spelling of the
 * scheme's name, and every entry with each gap after its name as written.
 */
const SCHEMES: readonly { name: string; rests: readonly string[]; listed: boolean }[] = [
  { name: 'Bea' + 'rer', rests: [TEST_CREDENTIAL], listed: true },
  { name: 'Basic', rests: [TEST_CREDENTIAL], listed: true },
  { name: 'Token', rests: [TEST_CREDENTIAL], listed: true },
  {
    name: 'Digest',
    rests: ['', ...FOLDED].map(fold => `username="u",${fold}response="${TEST_CREDENTIAL}"`),
    listed: true,
  },
  {
    name: 'AWS4-HMAC-SHA256',
    rests: [...UNLISTED_RESTS, ...FOLDED.map(fold => `Credential=u/x,${fold}Signature=${TEST_CREDENTIAL}`)],
    listed: false,
  },
];

/**
 * Quotes a value as `util.inspect` does: in the first of `'`, `"` and a
 * backtick that the value does not hold.
 * @param value - The value to quote.
 * @returns The quoted value.
 */
function inspectQuote(value: string): string {
  const quote = ["'", '"', '`'].find(mark => !value.includes(mark)) ?? "'";
  return `${quote}${value}${quote}`;
}

/**
 * The ways text can carry an auth value: a header, one folded right after
 * its colon, a query, JSON, `util.inspect`, and a quoted key with a mark
 * before its closing quote.
 */
const VALUE_SHAPES: readonly ((key: string, value: string) => string)[] = [
  (key, value) => `${key}: ${value}`,
  (key, value) => `${key}:\r\n\t${value}`,
  (key, value) => `"${key}\u200e": ${value}`,
  (key, value) => `${key}=${value}`,
  (key, value) => JSON.stringify({ [key]: value }),
  (key, value) => `{ ${key}: ${inspectQuote(value)} }`,
];

/** Every auth value case, with an unlisted scheme only under an auth key. */
const SCHEME_PAIRS = SCHEMES.flatMap(({ name, rests, listed }) => {
  const keys = listed ? [...AUTH_KEYS, ...OTHER_KEYS] : AUTH_KEYS;
  const values = [
    ...markedSpellings(name).slice(1).map(scheme => `${scheme} ${rests[0]}`),
    ...HEADER_GAPS.flatMap(gap => rests.map(rest => `${name}${gap}${rest}`)),
  ];
  return values.flatMap(value => keys.flatMap(key => VALUE_SHAPES.map(shape => shape(key, value))));
});

/** Every character HTTP allows in a token other than a letter or digit (RFC 9110 §5.6.2). */
const TOKEN_MARKS = "!#$%&'*+-.^_`|~";

/**
 * Unlisted schemes whose scheme or parameter name holds each token character
 * at its start, inside it or at its end, or starts with a digit, as HTTP
 * allows.
 */
const TOKEN_VALUES = [...TOKEN_MARKS].flatMap(char => [
  `${char}Custom sig=a, Signature=${TEST_CREDENTIAL}`,
  `Cus${char}tom sig=a, Signature=${TEST_CREDENTIAL}`,
  `Custom${char} sig=a, Signature=${TEST_CREDENTIAL}`,
  `Custom ${char}sig=a, Signature=${TEST_CREDENTIAL}`,
  `Custom sig${char}x=a, Signature=${TEST_CREDENTIAL}`,
  `Custom sig${char}=a, Signature=${TEST_CREDENTIAL}`,
  `Custom\u200esig${char}x=a, Signature=${TEST_CREDENTIAL}`,
  `Custom sig${char}x\r\n\t=a, Signature=${TEST_CREDENTIAL}`,
]).concat([`4Custom sig=a, Signature=${TEST_CREDENTIAL}`, `Custom 1sig=a, Signature=${TEST_CREDENTIAL}`]);

/** Every token value case, under each auth key and in each value shape. */
const TOKEN_PAIRS = TOKEN_VALUES.flatMap(value =>
  AUTH_KEYS.flatMap(key => VALUE_SHAPES.map(shape => shape(key, value))));

/** Every text case: a canary, Hebrew error text, then one key and its value. */
const TEXTS = [...PAIRS, ...SCHEME_PAIRS, ...TOKEN_PAIRS].map(pair => `${CANARY} שגיאה: ${pair}`);

/** The ways a log call can hold a secret field. */
const FIELD_SHAPES: readonly ((key: string) => Record<string, unknown>)[] = [
  key => ({ [key]: TEST_CREDENTIAL }),
  key => ({ result: { [key]: TEST_CREDENTIAL } }),
  key => ({ list: [{ [key]: TEST_CREDENTIAL }] }),
];

/** Every structured case. */
const FIELDS = KEYS.flatMap(key => FIELD_SHAPES.map(shape => shape(key)));

/** Temp directory holding the files that older releases would have left. */
const DIR = mkdtempSync(join(tmpdir(), 'secret-sinks-'));

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

/**
 * Builds a logger with the shared options that collects each written line.
 * @returns The logger and the lines it has written, in order.
 */
function collectingLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = { write: (line: string): number => lines.push(line) };
  return { logger: pino({ ...baseOptions(), level: 'info' }, sink), lines };
}

/**
 * Lists the cases whose output shows the secret, or lost the canary.
 * @param inputs - The cases, in order, for the report.
 * @param outputs - What the sink produced for each case, in the same order.
 * @param keepsCanary - Whether this sink must keep the text around the secret.
 * @returns A readable line per failing case; empty when the sink is safe.
 */
function failures(inputs: readonly unknown[], outputs: readonly string[], keepsCanary = true): string[] {
  expect(outputs).toHaveLength(inputs.length);
  return inputs.flatMap((input, index) => {
    const output = outputs[index];
    const leaked = output.includes(SECRET_PART);
    const lost = keepsCanary && !output.includes(CANARY);
    if (!leaked && !lost) return [];
    return [`${leaked ? 'LEAK' : 'LOST'} ${JSON.stringify(input)} -> ${JSON.stringify(output)}`];
  });
}

/**
 * Writes an audit file the way an older release left it, with one failed
 * bank per text case and its error unmasked.
 * @param texts - One failed bank's error per case.
 * @returns The audit file's path.
 */
function seedAuditFile(texts: readonly string[]): string {
  const path = join(mkdtempSync(join(DIR, 'audit-')), 'audit-log.json');
  const banks = texts.map((error, index) => ({ name: `bank${String(index)}`, status: 'failure', txns: 0, error }));
  const entry = {
    timestamp: '2026-01-01T00:00:00.000Z', totalBanks: banks.length, successfulBanks: 0,
    failedBanks: banks.length, totalTransactions: 0, totalDuplicates: 0, totalDuration: 0,
    successRate: 0, banks,
  };
  writeFileSync(path, JSON.stringify([entry]));
  return path;
}

/** The parts of a failed bank's error that the failure reason shows. */
const ERROR_PARTS: readonly [string, (text: string) => Error][] = [
  ['message', text => new Error(text)],
  ['name', text => Object.assign(new Error('login failed'), { name: text })],
];

/**
 * Builds a summary of the given failed banks, as the import step hands it on.
 * @param banks - One failed bank per case, with its error text.
 * @returns The summary the notifiers and the import history receive.
 */
function summaryOf(banks: IBankMetrics[]): IImportSummary {
  return {
    totalBanks: banks.length, successfulBanks: 0, failedBanks: banks.length,
    totalTransactions: 0, totalDuplicates: 0, totalDuration: 0, averageDuration: 0,
    successRate: 0, banks,
  };
}

/**
 * Records one failed bank the way the import step does.
 * @param error - The bank's error.
 * @returns The summary of that one-bank run.
 */
function failedRun(error: Error): IImportSummary {
  const metrics = new MetricsService();
  metrics.startImport();
  metrics.startBank('oneZero');
  metrics.recordBankFailure('oneZero', error);
  const summary = metrics.getSummary();
  return summary.success ? summary.data : summaryOf([]);
}

/**
 * Records one failed bank per case into a fresh import history, then reads
 * back the errors the file holds.
 * @param texts - One failed bank's error per case.
 * @returns The errors as written to disk, in case order.
 */
function recordedErrors(texts: readonly string[]): string[] {
  const path = join(mkdtempSync(join(DIR, 'recorded-')), 'audit-log.json');
  const banks = texts.map((error, index): IBankMetrics => ({
    bankName: `bank${String(index)}`, startTime: 0, status: 'failure',
    transactionsImported: 0, transactionsSkipped: 0, accounts: [], error,
  }));
  expect(new AuditLogService(path).record(summaryOf(banks)).success).toBe(true);
  const [entry] = JSON.parse(readFileSync(path, 'utf8')) as IAuditEntry[];
  return entry.banks.map(bank => bank.error ?? '');
}

/**
 * Writes a log file the way an older release left it, one unmasked line per
 * text case.
 * @param texts - One logged message per case.
 * @returns The directory holding the log file.
 */
function seedLogDir(texts: readonly string[]): string {
  const logDir = mkdtempSync(join(DIR, 'logs-'));
  const lines = texts.map(msg => JSON.stringify({ time: 0, level: 30, msg }));
  writeFileSync(join(logDir, 'app.2026-01-01.1.log'), `${lines.join('\n')}\n`);
  return logDir;
}

describe('a secret under any key spelling reaches no output', () => {
  it('covers enough spellings to mean something', () => {
    expect(KEYS.length).toBeGreaterThan(400);
    expect(PAIRS.length).toBe(KEYS.length * TEXT_SHAPES.length);
    expect(SCHEME_PAIRS.length).toBeGreaterThan(500);
  });

  it('the text masker hides it', () => {
    expect(failures(TEXTS, TEXTS.map(text => redactSecrets(text)))).toEqual([]);
  });

  it('masking a masked text again changes nothing, as the /logs replay relies on', () => {
    const changed = TEXTS.map(text => redactSecrets(text)).filter(once => redactSecrets(once) !== once);
    expect(changed).toEqual([]);
  });

  it('a JSON text stays valid JSON once masked', () => {
    const json = TEXTS.map(text => text.slice(text.indexOf('{'))).filter(text => {
      try { JSON.parse(text); return true; } catch { return false; }
    });
    expect(json.length).toBeGreaterThan(1000);
    const broken = json.map(text => redactSecrets(text)).filter(masked => {
      try { JSON.parse(masked); return false; } catch { return true; }
    });
    expect(broken).toEqual([]);
  });

  it('a log message hides it', () => {
    const { logger, lines } = collectingLogger();
    for (const text of TEXTS) logger.info(text);
    expect(failures(TEXTS, lines)).toEqual([]);
  });

  it('a logged error hides it in its message and stack', () => {
    const { logger, lines } = collectingLogger();
    for (const text of TEXTS) logger.error(new Error(text));
    expect(failures(TEXTS, lines)).toEqual([]);
  });

  it('an error alert hides it', () => {
    const formatter = new ErrorFormatter();
    const alerts = TEXTS.map(text => formatter.format(new Error(text)));
    expect(failures(TEXTS, alerts, false)).toEqual([]);
  });

  it('an error alert hides it in its context label', () => {
    const formatter = new ErrorFormatter();
    const alerts = TEXTS.map(text => formatter.format(new Error('login failed'), text));
    expect(failures(TEXTS, alerts)).toEqual([]);
  });

  it.each(ERROR_PARTS)('a failure reason hides it in the error %s', (_part, toError) => {
    const reasons = TEXTS.map(text => failedRun(toError(text)).banks[0]?.error ?? '');
    expect(failures(TEXTS, reasons)).toEqual([]);
  });

  it.each(ERROR_PARTS)('a Telegram and a webhook summary hide it in the error %s', (_part, toError) => {
    const summaries = TEXTS.map(text => failedRun(toError(text)));
    const opts = { showTransactions: 'none', maxTransactions: 0 } as const;
    const telegram = summaries.map(summary => formatSummaryMessage(summary, 'summary', opts));
    const webhook = summaries.map(summary => formatWebhookSummary('plain', summary));
    expect(failures(TEXTS, telegram)).toEqual([]);
    expect(failures(TEXTS, webhook)).toEqual([]);
  });

  it('the import history a new record writes hides it on disk', () => {
    expect(failures(TEXTS, recordedErrors(TEXTS))).toEqual([]);
  });

  it('a structured field hides it at any depth', () => {
    const { logger, lines } = collectingLogger();
    for (const fields of FIELDS) logger.info(fields, CANARY);
    expect(failures(FIELDS, lines)).toEqual([]);
  });

  it('a field a child logger bound hides it', () => {
    const { logger, lines } = collectingLogger();
    for (const fields of FIELDS) logger.child(fields).info(CANARY);
    expect(failures(FIELDS, lines)).toEqual([]);
  });

  it('the import history an older release stored hides it', () => {
    const result = new AuditLogService(seedAuditFile(TEXTS)).getRecent(1);
    expect(result.success).toBe(true);
    const errors = result.success ? result.data[0].banks.map(bank => bank.error ?? '') : [];
    expect(failures(TEXTS, errors)).toEqual([]);
  });

  it('the /logs replay of a file an older release wrote hides it', () => {
    const replayed = new LogFileReader(seedLogDir(TEXTS)).getRecent(TEXTS.length);
    expect(failures(TEXTS, replayed)).toEqual([]);
  });
});

/** The provider package's type declarations, which hold its failure codes. */
const PROVIDER_TYPES = fileURLToPath(new URL(
  '../../node_modules/@sergienko4/israeli-bank-scrapers/lib/index.d.ts', import.meta.url,
));

/**
 * Reads the provider's failure codes from its type declarations: the package
 * declares `ScraperErrorTypes` but exports no value to import.
 * @returns Every wire value the enum declares.
 */
function providerFailureCodes(): string[] {
  const declarations = readFileSync(PROVIDER_TYPES, 'utf8');
  const body = /declare enum ScraperErrorTypes \{(?<body>[^}]*)\}/u.exec(declarations)?.groups?.body ?? '';
  return [...body.matchAll(/= "(?<code>[A-Z_]+)"/gu)].map(match => match.groups?.code ?? '');
}

/** Every failure code the provider sends or the importer gives advice for. */
const FAILURE_CODES = [...new Set([...providerFailureCodes(), ...Object.keys(SCRAPER_ERROR_ADVICE)])];

/**
 * The provider's own failure prose for the codes that end in a secret key, as
 * its 8.7 release words them, so a shape the masker hides is caught.
 */
const PROVIDER_FAILURES: readonly [string, string][] = [
  ['INVALID_PASSWORD', 'Form: שם המשתמש או הסיסמה שגויים'],
  ['INVALID_PASSWORD', 'Form: Invalid username or code'],
  ['INVALID_PASSWORD', 'Auth API gateway (401): Unauthorized'],
  ['INVALID_PASSWORD', 'LOGIN POST: scope intact + URL unchanged — credentials likely invalid'],
  ['INVALID_PASSWORD', 'LOGIN POST: bounced back to login path /login'],
  ['INVALID_PASSWORD', 'Login failed with invalid error — url: https://bank.example/login'],
  ['CHANGE_PASSWORD', 'Password change required'],
];

/**
 * Writes a failed scrape's message through the scrape stage, the one place
 * that joins a failure code to the provider's prose.
 * @param errorType - The provider's failure code.
 * @param errorMessage - The provider's prose.
 * @returns The message the scrape stage fails with.
 */
async function stageMessage(errorType: string, errorMessage: string): Promise<string> {
  const result = { success: false, errorType, errorMessage, accounts: [] } as unknown as IScraperScrapingResult;
  const bankScraper = { scrapeBankWithResilience: (): Promise<IScraperScrapingResult> => Promise.resolve(result) };
  const opts = { entry: { bankName: 'oneZero', bankConfig: {} }, ctx: { services: { bankScraper } }, start: 0 };
  const outcome = await scrapeStage(opts as unknown as IBankOpts);
  if (!isFail(outcome)) throw new Error(`expected the scrape stage to fail for ${errorType}`);
  return outcome.message;
}

/** A failed scrape's message per case, as the scrape stage writes it: the code, then the provider's prose. */
const FAILURE_TEXTS = (await Promise.all([
  ...FAILURE_CODES.map(code => stageMessage(code, 'Login failed at the bank')),
  ...PROVIDER_FAILURES.map(([code, prose]) => stageMessage(code, prose)),
])).map(text => `${text}, ${CANARY}`);

/**
 * The provider's reasons for a phone number it cannot use, as its 8.7.3
 * release words them. Each starts with the `phoneNumber:` field label, a
 * secret key, so the word after it is hidden like any phone value; the rest of
 * the reason must stay readable.
 */
const PHONE_REASONS = [
  'phoneNumber: expected ≥10 digits, got 9',
  'phoneNumber: must be digits-only international form (no +, -, spaces)',
  'phoneNumber: must start with country code 972',
].map(reason => `${reason} (cannot be normalised to the international-plus wire format)`);

/** Each phone reason as the scrape stage writes it, with the canary after it. */
const PHONE_TEXTS = (await Promise.all(PHONE_REASONS.map(reason => stageMessage('INVALID_PHONE_NUMBER', reason))))
  .map(text => `${text}, ${CANARY}`);

/**
 * What an output must show for a phone reason: the code, the label with its
 * first word hidden, and every word after that.
 * @param reason - The provider's reason.
 * @returns The text the output must contain.
 */
function phoneReasonShown(reason: string): string {
  const rest = reason.split(' ').slice(2).join(' ');
  return `INVALID_PHONE_NUMBER — phoneNumber=[REDACTED] ${rest}, ${CANARY}`;
}

/**
 * Lists the cases the masker touched, or whose output lost the case's text.
 * @param texts - The cases, in order.
 * @param outputs - What the sink produced for each case, in the same order.
 * @param keepsText - Whether this sink passes the text on, rather than
 * replacing some of it with advice, as the error alert does.
 * @returns A readable line per failing case; empty when every text survived.
 */
function unreadable(texts: readonly string[], outputs: readonly string[], keepsText: boolean): string[] {
  expect(outputs).toHaveLength(texts.length);
  return texts.flatMap((text, index) => {
    const output = outputs[index];
    const lost = output.includes('[REDACTED]') || (keepsText && !output.includes(text));
    return lost ? [`${JSON.stringify(text)} -> ${JSON.stringify(output)}`] : [];
  });
}

/**
 * Logs each case through the shared options and collects the lines.
 * @param texts - One message per case.
 * @param write - How one case is logged.
 * @returns One written line per case.
 */
function loggedLines(texts: readonly string[], write: (logger: pino.Logger, text: string) => void): string[] {
  const { logger, lines } = collectingLogger();
  for (const text of texts) write(logger, text);
  return lines;
}

/** Each output a failed scrape's message reaches, and what it writes for each case. */
const FAILURE_SINKS: readonly [string, (texts: readonly string[]) => string[], boolean][] = [
  ['the text masker', texts => texts.map(text => redactSecrets(text)), true],
  ['a log message', texts => loggedLines(texts, (logger, text) => { logger.info(text); }), true],
  ['a logged error', texts => loggedLines(texts, (logger, text) => { logger.error(new Error(text)); }), true],
  ['an error alert', texts => texts.map(text => new ErrorFormatter().format(new Error(text))), false],
  ['a failure reason', texts => texts.map(text => failedRun(new Error(text)).banks[0]?.error ?? ''), true],
  ['a Telegram summary', texts => texts.map(text => formatSummaryMessage(
    failedRun(new Error(text)), 'summary', { showTransactions: 'none', maxTransactions: 0 },
  )), true],
  ['a webhook summary', texts => texts.map(text => formatWebhookSummary('plain', failedRun(new Error(text)))), true],
  ['the import history a new record writes', recordedErrors, true],
  ['the import history an older release stored', texts => {
    const result = new AuditLogService(seedAuditFile(texts)).getRecent(1);
    return result.success ? result.data[0].banks.map(bank => bank.error ?? '') : [];
  }, true],
  ['the /logs replay', texts => new LogFileReader(seedLogDir(texts)).getRecent(texts.length), true],
];

describe('a provider failure code reaches every output readable', () => {
  it('reads every code the provider declares', () => {
    expect(providerFailureCodes()).toEqual(expect.arrayContaining(['INVALID_PASSWORD', 'CHANGE_PASSWORD', 'GENERIC']));
    expect(FAILURE_CODES.length).toBeGreaterThan(10);
  });

  it.each(FAILURE_SINKS)('%s keeps the code and the prose after it', (_sink, outputsFor, keepsText) => {
    expect(unreadable(FAILURE_TEXTS, outputsFor(FAILURE_TEXTS), keepsText)).toEqual([]);
  });

  it.each(FAILURE_SINKS.filter(([, , keepsText]) => keepsText))(
    '%s keeps a phone reason readable after the word its label hides',
    (_sink, outputsFor) => {
      const outputs = outputsFor(PHONE_TEXTS);
      const unshown = PHONE_REASONS.filter((reason, index) => !outputs[index]?.includes(phoneReasonShown(reason)));
      expect(unshown).toEqual([]);
    },
  );
});

/** A secret of letters only, the shape an older release let through after a failure code. */
const LETTERS_SECRET = TEST_CREDENTIAL.replaceAll('-', '');

/** How an older release's records put a failure code before a value. */
const OLD_CODE_SHAPES: readonly ((code: string) => string)[] = [
  code => `${code}: ${LETTERS_SECRET}`,
  code => `❌ oneZero: ${code}: ${LETTERS_SECRET}`,
  code => `error "${code}: ${LETTERS_SECRET}"`,
  code => `Import failed\n${code}: ${LETTERS_SECRET}`,
  code => `${code}: Form: ${LETTERS_SECRET}`,
];

/** The failure codes that end in a secret word, so the value after them is a secret's. */
const SECRET_CODES = FAILURE_CODES.filter(code => isSecretKey(code));

/** Each secret-word code before a letters-only secret, in each older shape. */
const OLD_CODE_TEXTS = SECRET_CODES.flatMap(code => OLD_CODE_SHAPES.map(shape => `${shape(code)}, ${CANARY}`));

/**
 * Lists the cases whose output shows the letters-only secret, or lost the canary.
 * @param texts - The cases, in order.
 * @param outputs - What the sink produced for each case, in the same order.
 * @param keepsCanary - Whether this sink passes the text around the secret on.
 * @returns A readable line per failing case; empty when the sink is safe.
 */
function lettersLeaks(texts: readonly string[], outputs: readonly string[], keepsCanary: boolean): string[] {
  expect(outputs).toHaveLength(texts.length);
  return texts.flatMap((text, index) => {
    const output = outputs[index];
    const leaked = output.includes(LETTERS_SECRET);
    const lost = keepsCanary && !output.includes(CANARY);
    if (!leaked && !lost) return [];
    return [`${leaked ? 'LEAK' : 'LOST'} ${JSON.stringify(text)} -> ${JSON.stringify(output)}`];
  });
}

describe('a letters-only secret after a failure code reaches no output', () => {
  it('reads the codes that end in a secret word', () => {
    expect(SECRET_CODES).toEqual(expect.arrayContaining([
      'CHANGE_PASSWORD', 'INVALID_PASSWORD', 'INVALID_PHONE_NUMBER', 'NO_PASSWORD',
    ]));
  });

  it.each(FAILURE_SINKS)('%s hides it, including a record an older release stored', (_sink, outputsFor, keepsText) => {
    expect(lettersLeaks(OLD_CODE_TEXTS, outputsFor(OLD_CODE_TEXTS), keepsText)).toEqual([]);
  });
});
