/**
 * Shared arrangement for the {@link BankTokenStore} behaviour suites.
 *
 * <p>Every store runs over a fresh {@link FakeFileSystem}, so no case shares
 * state with another and none needs a temp directory. The real filesystem is
 * exercised once, in `BankTokenStoreOnRealFs.test.ts`.
 */

import BankTokenStore from '../../src/Scraper/Tokens/BankTokenStore.js';
import type { ITokenRecordCipher } from '../../src/Scraper/Tokens/TokenRecordCipher.js';
import { fakeLoginFingerprint, fakeUuid } from '../helpers/factories.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

/** Directory the store lives in, as the image provisions it. */
export const DATA_DIRECTORY = '/app/data';

/** Path every case reads from and writes to. */
export const STORE_PATH = `${DATA_DIRECTORY}/bank-tokens.json`;

/** Owner read/write only. */
export const OWNER_ONLY = 0o600;

/** Readable by every local user, as a restored backup might be. */
export const WORLD_READABLE = 0o644;

/** Capture moment used where the exact value is asserted. */
export const CAPTURED_AT = '2026-09-23T15:11:00.000Z';

/** Login every case binds its tokens to, unless it needs a second one. */
export const ACCOUNT_LOGIN = fakeLoginFingerprint();

/** A store under test and the filesystem behind it. */
export interface IStoreUnderTest {
  readonly store: BankTokenStore;
  readonly fileSystem: FakeFileSystem;
}

/**
 * Builds a store over an in-memory filesystem holding the data volume.
 * @param fileSystem - Filesystem to use; a fresh fake unless a case needs a variant.
 * @param cipher - Cipher for the records; the store's own default unless a case seals them.
 * @returns The store under test and the filesystem behind it.
 */
export function makeStore(
  fileSystem = new FakeFileSystem(), cipher?: ITokenRecordCipher,
): IStoreUnderTest {
  fileSystem.seedDirectory(DATA_DIRECTORY);
  return { store: new BankTokenStore(fileSystem, STORE_PATH, cipher), fileSystem };
}

/**
 * Mints a token shaped like the long-term tokens providers return.
 * @returns A unique token value.
 */
export function fakeToken(): string {
  return `lt-${fakeUuid()}`;
}

/**
 * Leaves a store file behind as an earlier run would have.
 * @param fileSystem - Filesystem to seed.
 * @param contents - Raw file contents, so damaged stores can be seeded too.
 * @param mode - Permission bits the file carries.
 * @returns Nothing.
 */
export function seedRaw(fileSystem: FakeFileSystem, contents: string, mode = OWNER_ONLY): void {
  fileSystem.seedFile(STORE_PATH, contents, mode);
}

/**
 * Leaves a well-formed store behind holding the given entries.
 * @param fileSystem - Filesystem to seed.
 * @param records - Entries by store key.
 * @param mode - Permission bits the file carries.
 * @returns Nothing.
 */
export function seedRecords(
  fileSystem: FakeFileSystem,
  records: Record<string, unknown>,
  mode = OWNER_ONLY,
): void {
  const contents = JSON.stringify(records);
  seedRaw(fileSystem, contents, mode);
}

/**
 * Parses what is now at the store path.
 * @param fileSystem - Filesystem holding the store.
 * @returns The stored entries by store key.
 */
export function storedRecords(fileSystem: FakeFileSystem): Record<string, unknown> {
  const contents = fileSystem.contentsOf(STORE_PATH);
  return JSON.parse(contents) as Record<string, unknown>;
}

/**
 * Lists the names damaged stores were moved aside under.
 * @param fileSystem - Filesystem holding the store.
 * @returns Every quarantine name beside the store.
 */
export function quarantinedNames(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => name.startsWith(`${STORE_PATH}.quarantined-`));
}
