/**
 * Stand-in for `readConfigText` that reads through the suite's mocked `fs`.
 *
 * <p>Suites that drive config loading with `fs.existsSync` and
 * `fs.readFileSync` mocks swap the real reader, which opens a descriptor, for
 * this one. It keeps the reader's contract: a missing file fails with status
 * `ENOENT`, and a read error fails with its errno (or `EUNKNOWN`) and never
 * its message. The real reader is tested against the real file system in
 * `tests/config/ConfigFileText.test.ts`.
 */

import * as fs from 'node:fs';

import type { Procedure } from '../../src/Types/Index.js';
import { fail, succeed } from '../../src/Types/Index.js';

/**
 * Reads a config file's text through the mocked `fs`.
 * @param filePath - Path the loader asked for.
 * @returns The text, or a failure carrying the errno in `status`.
 */
export default function configTextFromFsMock(filePath: string): Procedure<string> {
  if (!fs.existsSync(filePath)) {
    return fail(`Could not read ${filePath}: ENOENT`, { status: 'ENOENT' });
  }
  try {
    const text = String(fs.readFileSync(filePath, 'utf8'));
    return succeed(text);
  } catch (error: unknown) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code : 'EUNKNOWN';
    return fail(`Could not read ${filePath}: ${code}`, { status: code });
  }
}
