/**
 * The save id that ties config.json to the credentials.json saved with it.
 *
 * <p>The portal replaces the two files with two renames, so a process killed
 * between them leaves one file from each save. Every save writes one random id
 * into both files (inside the encryption, for encrypted credentials), and the
 * loader accepts a pair only when both carry the same id or neither carries
 * one (a pair written by hand or by an older release). The id is removed as
 * soon as the pair is read, so it never reaches validation, the value masker
 * or the portal's API.
 */

import { randomUUID } from 'node:crypto';

import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type { IImporterConfig } from '../Types/Index.js';
import UUID_PATTERN from '../Utils/IdPatterns.js';
import type { ISplitConfig } from './SecretSplitter.js';

/** The key both files of one save carry its id under. */
const SAVE_ID_KEY = 'saveId';

const MIXED_PAIR_MESSAGE = 'config.json and credentials.json come from different saves '
  + '(a save was interrupted). Check both files, then remove `saveId` from both to accept them.';

/** The two halves of one save, each carrying the save's id. */
export interface IMarkedSave {
  readonly settings: object;
  readonly secrets: object;
}

/** config.json and the credentials.json beside it, as read from disk. */
export interface IConfigPair {
  readonly config: IImporterConfig;
  /** Absent when there is no credentials.json. */
  readonly credentials: IImporterConfig | undefined;
}

/**
 * Adds one new save id to both halves of a save, leaving the halves unchanged.
 * @param split - The settings and secrets a save writes.
 * @returns Copies of both halves carrying the same new id.
 */
export function markOneSave(split: ISplitConfig): IMarkedSave {
  const saveId = randomUUID();
  return {
    settings: { ...split.settings, [SAVE_ID_KEY]: saveId },
    secrets: { ...split.secrets, [SAVE_ID_KEY]: saveId },
  };
}

/**
 * Reads the save id a file carries.
 * @param file - One file's parsed contents.
 * @returns The id, or undefined when the file carries none.
 */
function saveIdOf(file: IImporterConfig): unknown {
  return Object.hasOwn(file, SAVE_ID_KEY) ? Reflect.get(file, SAVE_ID_KEY) : undefined;
}

/**
 * Whether a value has the shape of an id {@link markOneSave} mints.
 * @param value - The id read from a file.
 * @returns True for a lowercase UUID string.
 */
function isSaveId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Whether both files come from one save: both carry the same valid id, or
 * neither carries one. A config with no credentials.json is not checked.
 * @param pair - The two files as read.
 * @returns True when the pair can be loaded.
 */
function isOneSave(pair: IConfigPair): boolean {
  if (!pair.credentials) return true;
  const configId = saveIdOf(pair.config);
  const credId = saveIdOf(pair.credentials);
  if (configId === undefined && credId === undefined) return true;
  return isSaveId(configId) && configId === credId;
}

/**
 * Reads the pair, and reads it once more when it does not match, since a
 * save may have finished its second rename between the two reads.
 * @param readPair - Reads both files from disk.
 * @returns A pair from one save.
 * @throws ConfigurationError when the pair still comes from two saves.
 */
function settledPair(readPair: () => IConfigPair): IConfigPair {
  const first = readPair();
  if (isOneSave(first)) return first;
  getLogger().warn('⚠️  config.json and credentials.json do not match; reading both again');
  const second = readPair();
  if (isOneSave(second)) return second;
  throw new ConfigurationError(MIXED_PAIR_MESSAGE);
}

/**
 * Copies a file without its save id; a file carrying none is returned as is.
 * @param file - One file's parsed contents.
 * @returns The contents without the id.
 */
function withoutSaveId(file: IImporterConfig): IImporterConfig {
  if (!Object.hasOwn(file, SAVE_ID_KEY)) return file;
  const copy = { ...file };
  Reflect.deleteProperty(copy, SAVE_ID_KEY);
  return copy;
}

/**
 * Reads config.json and credentials.json as one save, without their save ids.
 * Every failure it throws is a ConfigurationError worded for the operator, and
 * both processes log it before refusing to start.
 * @param readPair - Reads both files from disk; called at most twice.
 * @returns Both files, the id removed from each.
 * @throws ConfigurationError when the two files come from different saves.
 */
export default function readOneSave(readPair: () => IConfigPair): IConfigPair {
  const pair = settledPair(readPair);
  const credentials = pair.credentials ? withoutSaveId(pair.credentials) : undefined;
  const config = withoutSaveId(pair.config);
  return { config, credentials };
}
