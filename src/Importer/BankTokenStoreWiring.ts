/**
 * Long-term bank token store wiring.
 *
 * Builds the {@link BankTokenStore} the live scrape strategy owns: the token
 * file at `BANK_TOKENS_PATH`, sealed under the config password when one is
 * set and plaintext otherwise, and the {@link RefusedTokens} file beside it.
 * Kept apart from PipelineComposition.ts so that file stays under the
 * max-dependencies cap.
 */

import { getEncryptionPassword } from '../Config/ConfigEncryption.js';
import resolveBankTokensPath, { refusedTokensPathOf } from '../Scraper/Tokens/BankTokenPath.js';
import BankTokenStore from '../Scraper/Tokens/BankTokenStore.js';
import RefusedTokens from '../Scraper/Tokens/RefusedTokens.js';
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

/**
 * Opens the file of refused long-term token digests, beside the token file.
 *
 * Building it touches no file; a malformed `BANK_TOKENS_PATH` throws here.
 * @returns The registry next to the file at `BANK_TOKENS_PATH`.
 */
export function openRefusedTokens(): RefusedTokens {
  const tokensPath = resolveBankTokensPath();
  const filePath = refusedTokensPathOf(tokensPath);
  return new RefusedTokens(createNodeFileSystem(), filePath);
}
