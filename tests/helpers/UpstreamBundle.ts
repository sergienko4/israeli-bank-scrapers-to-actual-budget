/**
 * Reads the installed provider package's shipped files, for drift checks that
 * pin the wording and codes the importer depends on but the provider exports
 * no value for. One reader keeps every check on the same install, and an
 * anchor that is gone fails with its name instead of an empty match.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The provider package's `lib/` directory in the installed tree. */
const PROVIDER_LIB = new URL('../../node_modules/@sergienko4/israeli-bank-scrapers/lib/', import.meta.url);

/** The shipped files a drift check may read. */
type ProviderFile = 'index.mjs' | 'index.d.ts';

/** Each file's text, read once per test file. */
const texts = new Map<ProviderFile, string>();

/**
 * Reads one shipped provider file, once.
 * @param file - The file under the package's `lib/`.
 * @returns The file's text.
 */
function providerText(file: ProviderFile): string {
  const known = texts.get(file);
  if (known !== undefined) return known;
  const text = readFileSync(fileURLToPath(new URL(file, PROVIDER_LIB)), 'utf8');
  texts.set(file, text);
  return text;
}

/**
 * Reads the provider's ESM bundle, which holds its failure wording.
 * @returns The bundle's text.
 */
export function providerBundle(): string {
  return providerText('index.mjs');
}

/**
 * Reads the provider's type declarations, which hold its failure codes.
 * @returns The declarations' text.
 */
export function providerTypes(): string {
  return providerText('index.d.ts');
}

/**
 * Runs a pattern over provider text and returns one named group, failing
 * loudly when the anchor is gone so a drift check never passes on nothing.
 * @param text - Provider text to search.
 * @param anchor - Pattern with a named `value` group.
 * @returns The group's text.
 */
export function anchored(text: string, anchor: RegExp): string {
  const value = anchor.exec(text)?.groups?.value;
  if (value === undefined) throw new Error(`The provider no longer ships ${String(anchor)}`);
  return value;
}
