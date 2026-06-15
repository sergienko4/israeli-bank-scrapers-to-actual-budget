/**
 * Regex patterns and numeric constants for Israeli receipt OCR field extraction.
 * Centralises all pattern constants so extractor modules stay pure logic only.
 *
 * ReDoS safety: every caller that iterates lines MUST check `line.length`
 * against {@link MAX_LINE_LEN} before applying any regex from this module.
 */

/** Matches Israeli date formats: DD/MM/YYYY, DD.MM.YY, DD-MM-YYYY. */
export const DATE_PATTERN = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})/;

/** Hebrew "total" variants including common OCR misread (סה"ג for סה"כ). */
export const TOTAL_HEB = 'סה.{1,2}[כגך]';

/** Hebrew "to pay" and "total due" pattern alternatives. */
export const PAY_HEB = String.raw`לתשלום|יתרה\s*לתשלום|שולם|נותר\s*לתשלום`;

/**
 * Priority-ordered regex list for labeled amount extraction.
 * Index 0–1 = לתשלום (highest priority, final total).
 * Index 2–3 = סה"כ (subtotal/total, second priority).
 * Index 4–5 = currency-symbol patterns (last resort before fallback).
 */
export const AMOUNT_PATTERNS = [
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*=?(?:${PAY_HEB})`),
  new RegExp(String.raw`(?:${PAY_HEB})[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`),
  new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)[\s[\]]*(?:${TOTAL_HEB}|total|סכום)`, 'i'),
  new RegExp(String.raw`(?:${TOTAL_HEB}|total|סכום|amount)[:?\s]*₪?(\d[\d,]*(?:\.\d+)?)`, 'i'),
  /₪\s*(\d[\d,]*(?:\.\d+)?)/,
  /(\d{1,3}(?:,\d{3})*\.\d{2})\s*(?:₪|ILS|ש"ח)/,
];

/**
 * Line patterns that indicate boilerplate noise to skip when finding
 * the merchant name: registration numbers, "invoice", "copy", phone, etc.
 */
export const SKIP_LINE_PATTERNS = [
  /^\d{7,}/, // business reg number (7+ digits)
  /חשבונית/, // "invoice"
  /קבלה\s*מס/, // "receipt number"
  /העתק/, // "copy"
  /עוסק\s*(מורשה|פטור)/, // "authorized/exempt dealer"
  /ע[.\s]*מ[.\s]|ח[.\s]*פ[.\s]/, // entity abbreviations
  /מספר[:\s]*\d/, // "number: NNN"
  /תאריך/, // "date" header line
  /טלפו?ן/, // "phone"
  /פקס/, // "fax"
  /כתובת/, // "address" label
  /לכבוד/, // "to:" salutation
  /^[-–—\s*]+$/, // separator lines
  /^\s*\d+\s*$/, // lines with only digits
  /^\d{2,3}[-\s]?\d{7}$/, // phone numbers (050-1234567)
];

/**
 * Max byte-length of a receipt line before all regex checks are skipped.
 * Guards every extractor against ReDoS on adversarially-long lines.
 */
export const MAX_LINE_LEN = 200;

/** Global regex for the fallback "largest amount" scan (comma-formatted numbers). */
export const LARGEST_AMOUNT_PATTERN = /(\d{1,3}(?:,\d{3})*\.\d{2})/g;

/** Maximum number of receipt lines to include in the memo field. */
export const MEMO_MAX_LINES = 5;

/** Maximum character count for the truncated memo field. */
export const MEMO_MAX_CHARS = 200;

/** Minimum character length for a candidate merchant name to be accepted. */
export const MERCHANT_MIN_LEN = 3;

/** Hebrew "to/for" label used to identify the recipient (merchant) line. */
export const TO_LABEL = 'לכבוד';

/** Matches a "לכבוד:" style recipient-address line. */
export const TO_LABEL_PATTERN = /לכבוד\s*[;:]/;

/** Rejects recipient lines containing directory/pagination tokens. */
export const TO_LABEL_BLOCKLIST = /מספר|טלפון|כתובת|דף|מתוך/;

/** Strips RTL/LTR mark characters (U+200F, U+200E). */
export const INVISIBLE_CHARS = /[\u200F\u200E]/g;

/** Strips all bidirectional control characters (U+200F, U+200E, U+202A–U+202E). */
export const ALL_INVISIBLE_CHARS = /[\u200F\u200E\u202A-\u202E]/g;
