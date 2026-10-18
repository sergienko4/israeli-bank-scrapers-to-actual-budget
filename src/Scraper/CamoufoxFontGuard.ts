/**
 * Stops startup when the bundled Camoufox lacks the fonts for its spoofed OS.
 *
 * The image ships only the Windows fonts, the set the default fingerprint
 * uses. Camoufox does not fail when the fonts for its OS are missing: it
 * launches with fallback fonts, and its font fingerprint then contradicts the
 * OS it claims to be. A CAMOUFOX_OS that selects a font set the install lacks
 * must therefore stop the process before any bank login, not degrade it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

/** OS fingerprints the scraper accepts, sorted so a hint lists them stably. */
const CAMOUFOX_OSES = ['linux', 'macos', 'windows'] as const;

/** OS fingerprint the scraper spoofs when CAMOUFOX_OS is unset or unknown. */
const DEFAULT_OS = 'windows';

/** Leading text of every guard failure, for operators and the image E2E. */
export const FONT_GUARD_PREFIX = 'Camoufox font check failed';

/** OS fingerprint Camoufox spoofs. */
export type CamoufoxOs = (typeof CAMOUFOX_OSES)[number];

/** Process facts the guard reads, passed in so tests need no globals. */
export interface IFontGuardInput {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
}

/** What a failure message describes. */
interface IMissingFonts {
  readonly raw: string | undefined;
  readonly os: CamoufoxOs;
  readonly fontsDir: string;
}

/**
 * Resolves the spoofed OS exactly as the scraper does: CAMOUFOX_OS lower-cased,
 * not trimmed, and anything unknown becomes the default.
 * @param env - Environment the browser is launched with.
 * @returns The OS whose fingerprint the browser will claim.
 */
function resolveOs(env: IFontGuardInput['env']): CamoufoxOs {
  const lowered = env.CAMOUFOX_OS?.toLowerCase();
  const known = CAMOUFOX_OSES.find((candidate) => candidate === lowered);
  return known ?? DEFAULT_OS;
}

/**
 * Resolves the Camoufox install directory exactly as camoufox-js does on Linux.
 * @param input - Process facts.
 * @returns Absolute install directory.
 */
function installDir(input: IFontGuardInput): string {
  const configured = input.env.CAMOUFOX_INSTALL_DIR;
  if (configured) return path.resolve(configured);
  return path.join(input.homeDir, '.cache', 'camoufox');
}

/**
 * Reports whether a path is an existing directory. A path that cannot be
 * inspected counts as absent instead of crashing the guard: the browser runs
 * as the same user, so it could not read that path either.
 * @param target - Path to check.
 * @returns True only for a directory.
 */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch {
    return false;
  }
}

/**
 * Reports whether an install has the font set for one OS.
 * @param fontsDir - The install's fonts directory.
 * @param os - OS whose font set to look for.
 * @returns True when the OS font directory exists.
 */
function hasFontSet(fontsDir: string, os: CamoufoxOs): boolean {
  const osDir = path.join(fontsDir, os);
  return isDirectory(osDir);
}

/**
 * Builds the failure message, naming the OS sets the install does have.
 * @param missing - The requested OS and where its fonts were looked for.
 * @returns The operator-facing message.
 */
function describeMissing(missing: IMissingFonts): string {
  const available = CAMOUFOX_OSES.filter((candidate) => hasFontSet(missing.fontsDir, candidate));
  const raw = missing.raw ?? '(unset)';
  const head = `${FONT_GUARD_PREFIX}: CAMOUFOX_OS=${raw} selects the ${missing.os} fingerprint,`
    + ` but ${missing.fontsDir} has no`;
  const reinstall = `${head} fonts for any OS. Reinstall the pinned Camoufox build.`;
  if (available.length === 0) return reinstall;
  const choices = available.join(', ');
  const remedy = available.includes(DEFAULT_OS) ? 'Unset CAMOUFOX_OS or set it' : 'Set CAMOUFOX_OS';
  return `${head} ${missing.os} fonts. ${remedy} to one of: ${choices}.`;
}

/**
 * Reads the guard's facts from the running process.
 * @returns The live environment, home directory and platform.
 */
function processFacts(): IFontGuardInput {
  return { env: process.env, homeDir: os.homedir(), platform: process.platform };
}

/**
 * Checks that the install has the fonts for the OS the browser will spoof.
 *
 * Only the Linux install layout, the one the image uses, is checked. A host
 * without the browser install starts exactly as before; an install that is
 * present needs a readable font set for the spoofed OS, even when its whole
 * fonts directory is gone, because the browser would still launch.
 * @param input - Process facts; the running process when omitted.
 * @returns The resolved OS, or a failure carrying the operator message.
 */
export default function checkCamoufoxFonts(
  input: IFontGuardInput = processFacts(),
): Procedure<{ os: CamoufoxOs }> {
  const spoofed = resolveOs(input.env);
  if (input.platform !== 'linux') return succeed({ os: spoofed });
  const installRoot = installDir(input);
  const fontsDir = path.join(installRoot, 'fonts');
  const isSatisfied = !isDirectory(installRoot) || hasFontSet(fontsDir, spoofed);
  if (isSatisfied) return succeed({ os: spoofed });
  const message = describeMissing({ raw: input.env.CAMOUFOX_OS, os: spoofed, fontsDir });
  return fail(message);
}
