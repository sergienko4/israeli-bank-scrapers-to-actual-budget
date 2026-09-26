/**
 * Seeds the staged file a killed write leaves behind, old enough to sweep.
 */

import { STALE_STAGING_AGE_MS } from '../../src/Storage/StagingSweep.js';
import type FakeFileSystem from './FakeFileSystem.js';

/** A valid staging token, so the name matches the store's staging scheme. */
const STAGED_UUID = '0f0e0d0c-0b0a-4908-8706-050403020100';

/**
 * Seeds an abandoned staged file beside a store, with its directory.
 * @param fileSystem - Filesystem to seed.
 * @param storePath - Absolute path of the store the leftover belongs to.
 * @returns The staged file's path.
 */
export default function seedStaleStaged(fileSystem: FakeFileSystem, storePath: string): string {
  fileSystem.seedDirectory(storePath.slice(0, storePath.lastIndexOf('/')));
  const staged = `${storePath}.${STAGED_UUID}.tmp`;
  fileSystem.seedFile(staged, '{}', 0o600);
  fileSystem.setModifiedAt(staged, Date.now() - STALE_STAGING_AGE_MS - 1_000);
  return staged;
}
