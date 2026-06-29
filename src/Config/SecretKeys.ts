/**
 * Secret-bearing config key names, DERIVED from the Config Manifest.
 *
 * The manifest marks every secret field with `secret: true`; this list is the
 * de-duplicated set of those key names. Both the portal masker
 * ({@link maskSecrets}) and the on-disk splitter ({@link splitSecrets}) consult
 * it, so a value is never masked in the API yet written in plaintext to
 * config.json (or vice-versa). Any config key whose name appears here is
 * treated as a credential: masked on read and routed to the encryptable
 * credentials.json on write.
 */

import { deriveSecretKeys } from './ConfigManifest.js';

/** Config key names whose string values are secrets (manifest-derived). */
const SECRET_KEYS: readonly string[] = deriveSecretKeys();

export default SECRET_KEYS;
