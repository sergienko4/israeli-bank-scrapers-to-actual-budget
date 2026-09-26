/**
 * Guards that the optional portal in the shipped compose file shares the
 * importer's data volume.
 *
 * <p>The importer and the portal coordinate through files under `/app/data`:
 * OTP requests and answers, the OTP channel, push device tokens, app tokens and
 * the import history. A portal that mounts only `./config` sees none of them,
 * so a code typed in the app never reaches the importer and every one of those
 * features fails silently. The portal block ships commented out, so nothing
 * else would notice it drifting.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** The parts of a compose service this suite reads. */
interface IComposeService {
  readonly volumes?: readonly string[];
}

/** The parts of a compose file this suite reads. */
interface IComposeFile {
  readonly services: Record<string, IComposeService>;
}

/** Where both services keep the files they share. */
const DATA_TARGET = ':/app/data';

/** The first line of the commented-out portal service. */
const PORTAL_START = '  # portal:';

/**
 * Reads the shipped compose file.
 * @returns Its text.
 */
function composeText(): string {
  const path = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));
  return readFileSync(path, 'utf8');
}

/**
 * Parses the portal service as a user gets it by uncommenting its block.
 * @param text - The compose file's text.
 * @returns The portal service.
 */
function uncommentedPortal(text: string): IComposeService {
  const lines = text.split('\n');
  const start = lines.indexOf(PORTAL_START);
  expect(start).toBeGreaterThan(-1);
  const block = lines.slice(start);
  const end = block.findIndex((line) => !line.startsWith('  #'));
  const commented = block.slice(0, end === -1 ? block.length : end);
  const uncommented = commented.map((line) => line.replace(/^ {2}# /, '  '));
  const doc = parse(`services:\n${uncommented.join('\n')}`) as IComposeFile;
  return doc.services.portal;
}

/**
 * Finds the mount a service keeps its shared files on.
 * @param service - A compose service.
 * @returns The `source:/app/data` mount, without any access mode.
 */
function dataMount(service: IComposeService): string | undefined {
  const mounts = service.volumes ?? [];
  const mount = mounts.find((entry) => entry.replace(/:(rw|ro)$/, '').endsWith(DATA_TARGET));
  return mount?.replace(/:(rw|ro)$/, '');
}

describe('docker-compose.yml portal', () => {
  it('mounts the importer\'s data volume at the same path, writable', () => {
    const text = composeText();
    const importer = (parse(text) as IComposeFile).services.importer;
    const portal = uncommentedPortal(text);
    expect(dataMount(importer)).toBe('importer-data:/app/data');
    expect(dataMount(portal)).toBe(dataMount(importer));
    expect(portal.volumes?.find((entry) => entry.includes(DATA_TARGET))).not.toMatch(/:ro$/);
  });
});
