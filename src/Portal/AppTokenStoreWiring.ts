/**
 * App-token store wiring: the store at `APP_TOKENS_PATH` on the real
 * filesystem. Only the portal opens it; the importer never reads app tokens.
 */

import createNodeFileSystem from '../Storage/NodeFileSystem.js';
import { AppTokenStore, resolveAppTokensPath } from './AppTokenStore.js';

/**
 * Opens the app-token store.
 * Opening it touches no file.
 * @returns The store at `APP_TOKENS_PATH`.
 */
export default function openAppTokenStore(): AppTokenStore {
  return new AppTokenStore(createNodeFileSystem(), resolveAppTokensPath());
}
