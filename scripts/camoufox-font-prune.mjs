/**
 * Deletes the Camoufox font groups the Windows fingerprint never reads.
 *
 * Camoufox stores each font face once, under fonts/<group>, a directory named
 * for the set of OSes that use it (L, M, W, LM, LW, MW, LMW), and
 * fonts/groups.json lists the groups each OS reads. camoufox-js points the
 * browser at the whole fonts directory, so the image deletes every group
 * Windows does not read: what remains is exactly the Windows set.
 *
 * Usage: node scripts/camoufox-font-prune.mjs <fontsDir>
 *
 * Nothing is deleted unless groups.json names at least one Windows group,
 * every one it names is present, and every entry is a file or a directory, so
 * a future layout change fails the build instead of shipping a browser
 * without its fonts.
 */

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const USAGE = 'Usage: node scripts/camoufox-font-prune.mjs <fontsDir>';
const GROUPS_FILE = 'groups.json';
const OS_KEY = 'win';

/**
 * Reads the font groups Windows reads from the install's groups.json.
 * @param {string} fontsDir - The install's fonts directory.
 * @returns {string[]} Group directory names.
 */
function windowsGroups(fontsDir) {
  const parsed = JSON.parse(readFileSync(join(fontsDir, GROUPS_FILE), 'utf8'));
  const groups = parsed?.readBy?.[OS_KEY];
  const isNameList = Array.isArray(groups) && groups.length > 0
    && groups.every((group) => typeof group === 'string' && /^[a-z]+$/i.test(group));
  if (!isNameList) throw new Error(`${GROUPS_FILE} names no ${OS_KEY} font groups`);
  return groups;
}

/**
 * Lists the fonts directory's subdirectories that are not kept groups.
 *
 * Root files are faces every OS shares and stay. Anything that is neither a
 * file nor a directory, such as a symlinked group, would survive the prune
 * and still be scanned, so it fails instead.
 *
 * @param {string} fontsDir - The install's fonts directory.
 * @param {string[]} keep - Group names to keep; each must be present.
 * @returns {string[]} Sorted subdirectory names to delete.
 */
function groupsToRemove(fontsDir, keep) {
  const entries = readdirSync(fontsDir, { withFileTypes: true });
  const odd = entries.filter((entry) => !entry.isFile() && !entry.isDirectory()).map((entry) => entry.name);
  if (odd.length > 0) throw new Error(`neither a file nor a directory: ${odd.sort().join(', ')}`);
  const present = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const missing = keep.filter((group) => !present.has(group));
  if (missing.length > 0) throw new Error(`missing Windows font groups: ${missing.join(', ')}`);
  return [...present].filter((name) => !keep.includes(name)).sort();
}

/**
 * Prunes the fonts directory named on the command line.
 * @param {string[]} args - Command-line arguments after the script path.
 * @returns {number} Process exit code.
 */
function run(args) {
  if (args.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  const [fontsDir] = args;
  const keep = windowsGroups(fontsDir);
  const remove = groupsToRemove(fontsDir, keep);
  for (const name of remove) rmSync(join(fontsDir, name), { recursive: true, force: true });
  console.log(`Kept font groups: ${[...keep].sort().join(', ')}; removed: ${remove.join(', ') || 'none'}`);
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR: Camoufox font prune: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
