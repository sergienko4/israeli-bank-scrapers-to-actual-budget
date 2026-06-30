/**
 * The Config Manifest — ONE single source of truth describing every config
 * section and field. The portal UI, the secret-key list, the per-bank
 * credential specs, and the CI completeness gate all derive from this module.
 *
 * Adding a new config field means adding ONE manifest entry; the CI gate
 * (`npm run lint:manifest`) fails if a config key has no manifest entry.
 */

import {
  CATEGORIZATION_SECTION, NOTIFICATIONS_SECTION, SPENDING_WATCH_SECTION,
} from './Manifest/AlertManifest.js';
import { BANKS_SECTION } from './Manifest/BankManifest.js';
import {
  ACTUAL_SECTION, GENERAL_SECTION, LOG_SECTION, PROXY_SECTION,
} from './Manifest/CoreManifest.js';
import type { IManifestField, IManifestSection } from './Manifest/ManifestTypes.js';
import PORTAL_SECTION from './Manifest/PortalManifest.js';

export { BANK_REQUIREMENTS } from './Manifest/BankManifest.js';
export type { FieldKind, IManifestField, IManifestSection } from './Manifest/ManifestTypes.js';

/** Every config section, in portal nav order. */
export const CONFIG_MANIFEST: readonly IManifestSection[] = [
  GENERAL_SECTION, ACTUAL_SECTION, BANKS_SECTION, NOTIFICATIONS_SECTION,
  SPENDING_WATCH_SECTION, CATEGORIZATION_SECTION, LOG_SECTION, PROXY_SECTION, PORTAL_SECTION,
];

/**
 * Collects every top-level field carried by a section (across all slots).
 * @param section - Section to read.
 * @returns Flat list of the section's directly-held fields.
 */
function sectionFields(section: IManifestSection): readonly IManifestField[] {
  return [
    ...(section.fields ?? []), ...(section.itemFields ?? []),
    ...(section.bankFields ?? []), ...(section.targetFields ?? []),
  ];
}

/**
 * Recursively collects field keys whose kind is `secret`.
 * @param fields - Fields to walk.
 * @returns Secret field key names found anywhere in the subtree.
 */
function secretKeysIn(fields: readonly IManifestField[]): string[] {
  const out: string[] = [];
  for (const field of fields) {
    if (field.kind === 'secret') out.push(field.key);
    if (field.fields) out.push(...secretKeysIn(field.fields));
  }
  return out;
}

/**
 * Collects every secret field key declared anywhere in a section.
 * @param section - Section to scan.
 * @returns Secret field key names within the section.
 */
function sectionSecretKeys(section: IManifestSection): string[] {
  const fields = sectionFields(section);
  return secretKeysIn(fields);
}

/**
 * Derives the unique set of secret-bearing config key names from the manifest.
 * @returns Sorted, de-duplicated secret key names.
 */
export function deriveSecretKeys(): readonly string[] {
  const all = CONFIG_MANIFEST.flatMap(sectionSecretKeys);
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}
