/**
 * The names the OTP files take beside the configured `OTP_REQUESTS_PATH`.
 *
 * <p>Every request is its own file, `<stem>.<id>.json`, and its answer is
 * `<stem>.<id>.answer.json`, where the stem is the configured name without
 * `.json` and the id is a lower-case UUID. The configured name itself is the
 * combined file an older release wrote. A staged copy of any of these adds a
 * `.<uuid>.tmp` tail, the grammar every store stages under.
 *
 * <p>Parsing is as strict as naming: a name is a request's or an answer's only
 * if the id in it is a UUID, so no name built here can leave the directory and
 * no stranger's file is mistaken for one of these.
 * @module
 */

import { basename, dirname } from 'node:path';

import entryPath from '../../Storage/EntryPath.js';
import { isStagingPath } from '../../Storage/StagingPaths.js';
import UUID_PATTERN from '../../Utils/IdPatterns.js';

/** What an entry in the OTP directory is, by its name alone. */
export type OtpFileKind = 'request' | 'answer' | 'staged' | 'legacy' | 'other';

/** The extension the configured name carries, and each request file too. */
const JSON_SUFFIX = '.json';

/** What an answer file's name ends with. */
const ANSWER_SUFFIX = '.answer.json';

/** What a staged copy's name ends with. */
const STAGED_SUFFIX = '.tmp';

/** Builds and parses the OTP file names under one configured path. */
export default class OtpFileNames {
  /** The directory every OTP file lives in. */
  public readonly directory: string;

  private readonly _legacyName: string;

  private readonly _prefix: string;

  /**
   * Derives the names from the configured path.
   * @param basePath - Absolute `OTP_REQUESTS_PATH`.
   */
  constructor(basePath: string) {
    this.directory = dirname(basePath);
    this._legacyName = basename(basePath);
    this._prefix = `${basename(basePath, JSON_SUFFIX)}.`;
  }

  /**
   * Names a request's own file.
   *
   * <p>Built on the directory as given, like every listed path, so a `..`
   * after a symlink names the directory `pending` lists (see `EntryPath`).
   * @param id - The request id, already known to be a UUID.
   * @returns The request file path.
   */
  public requestPath(id: string): string {
    return entryPath(this.directory, `${this._prefix}${id}${JSON_SUFFIX}`);
  }

  /**
   * Names a request's answer file.
   * @param id - The request id, already known to be a UUID.
   * @returns The answer file path.
   */
  public answerPath(id: string): string {
    return entryPath(this.directory, `${this._prefix}${id}${ANSWER_SUFFIX}`);
  }

  /**
   * Reads the request id out of a request file's name.
   * @param path - A path listed in the directory.
   * @returns The id, or false when the name is not a request file's.
   */
  public requestIdOf(path: string): string | false {
    const name = basename(path);
    return this.idBetween(name, JSON_SUFFIX);
  }

  /**
   * Reads the request id out of an answer file's name.
   * @param path - A path listed in the directory.
   * @returns The id, or false when the name is not an answer file's.
   */
  public answerIdOf(path: string): string | false {
    const name = basename(path);
    return this.idBetween(name, ANSWER_SUFFIX);
  }

  /**
   * Lists the requests in a directory listing that have no answer yet.
   * @param paths - Every path listed in the directory.
   * @returns The ids of the unanswered requests.
   */
  public unansweredIds(paths: readonly string[]): string[] {
    const answered = new Set(paths.map((path) => this.answerIdOf(path)));
    const ids = paths.map((path) => this.requestIdOf(path));
    return ids.filter((id): id is string => id !== false && !answered.has(id));
  }

  /**
   * Picks the staged copies of one request's answer out of a directory listing.
   * @param id - The request id, already known to be a UUID.
   * @param paths - Every path listed in the directory.
   * @returns The paths named `<answer name>.<uuid>.tmp` for that request.
   */
  public answerStagesOf(id: string, paths: readonly string[]): string[] {
    const answerPath = this.answerPath(id);
    return paths.filter((path) => isStagingPath(answerPath, path));
  }

  /**
   * Classifies an entry in the directory by its name.
   * @param path - A path listed in the directory.
   * @returns What the entry is.
   */
  public kindOf(path: string): OtpFileKind {
    const name = basename(path);
    return this.isStagedCopy(name) ? 'staged' : this.publishedKindOf(name);
  }

  /**
   * Classifies a name as one of the files published under their own name.
   * @param name - A file name in the directory.
   * @returns The kind, or `other` when it is none of them.
   */
  private publishedKindOf(name: string): OtpFileKind {
    if (name === this._legacyName) return 'legacy';
    if (this.answerIdOf(name) !== false) return 'answer';
    return this.requestIdOf(name) === false ? 'other' : 'request';
  }

  /**
   * Reports whether a name is a staged copy of an OTP file.
   * @param name - A file name in the directory.
   * @returns True for `<request, answer or legacy name>.<uuid>.tmp`.
   */
  private isStagedCopy(name: string): boolean {
    if (!name.endsWith(STAGED_SUFFIX)) return false;
    const tokenStart = name.lastIndexOf('.', name.length - STAGED_SUFFIX.length - 1);
    const unstaged = name.slice(0, tokenStart);
    return isStagingPath(unstaged, name) && this.publishedKindOf(unstaged) !== 'other';
  }

  /**
   * Reads the id between the shared prefix and a suffix.
   * @param name - A file name in the directory.
   * @param suffix - What the name must end with.
   * @returns The id, or false unless the name is prefix, UUID, suffix.
   */
  private idBetween(name: string, suffix: string): string | false {
    if (!name.startsWith(this._prefix) || !name.endsWith(suffix)) return false;
    const id = name.slice(this._prefix.length, name.length - suffix.length);
    return UUID_PATTERN.test(id) && id;
  }
}
