/**
 * Long-term bank token store wiring.
 *
 * Builds the {@link BankTokenStore} the live scrape strategy owns: the token
 * file at `BANK_TOKENS_PATH`, sealed under the config password when one is
 * set and plaintext otherwise. Kept apart from PipelineComposition.ts so
 * that file stays under the max-dependencies cap.
 */

import { getEncryptionPassword } from '../Config/ConfigEncryption.js';
import resolveBankTokensPath from '../Scraper/Tokens/BankTokenPath.js';
import BankTokenStore from '../Scraper/Tokens/BankTokenStore.js';
import createTokenRecordCipher from '../Scraper/Tokens/TokenRecordCipher.js';
import createNodeFileSystem from '../Storage/NodeFileSystem.js';

/**
 * Opens the long-term token store, sealed under the config password when one is set.
 *
 * Building it touches no file and derives no key; a malformed
 * `BANK_TOKENS_PATH` throws here.
 * @returns The store at `BANK_TOKENS_PATH`.
 */
export default function openBankTokenStore(): BankTokenStore {
  const password = getEncryptionPassword();
  const cipher = createTokenRecordCipher(password);
  return new BankTokenStore(createNodeFileSystem(), resolveBankTokensPath(), cipher);
}
