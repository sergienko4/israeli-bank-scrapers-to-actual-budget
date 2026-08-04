/**
 * Guards the shipped container memory ceiling.
 *
 * A runaway scrape once consumed 22 GB RSS on a self-hoster's machine because
 * the reference compose files declared no memory limit: the kernel could not
 * reclaim fast enough and the whole host had to be power-cycled. The limit is
 * the single control that keeps a runaway importer from taking the host with
 * it, so it must never silently disappear from a shipped compose file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** Compose files published to users as the reference deployment. */
const SHIPPED_COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.vm.yml'] as const;

/** Upper bound for the importer ceiling; larger values stop protecting a small VM. */
const MAX_REASONABLE_LIMIT_BYTES = 4 * 1024 ** 3;

/** Minimum ceiling that still fits Node plus one bank browser plus receipt OCR. */
const MIN_REASONABLE_LIMIT_BYTES = 1024 ** 3;

/** Compose byte-size suffix multipliers. */
const SIZE_MULTIPLIERS: Record<string, number> = {
  '': 1, b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3,
};

/** Shape of the compose fields this suite asserts on. */
interface IComposeService {
  readonly mem_limit?: string;
  readonly memswap_limit?: string;
}

/**
 * Reads a shipped compose file and returns its importer service definition.
 * @param file - Compose file name relative to the repository root.
 * @returns The parsed importer service block.
 */
function readImporterService(file: string): IComposeService {
  const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
  const doc = parse(readFileSync(path, 'utf8')) as {
    services: Record<string, IComposeService>;
  };
  const entry = Object.entries(doc.services).find(
    ([name]) => name.includes('import'),
  );
  if (!entry) throw new Error(`no importer service found in ${file}`);
  return entry[1];
}

/**
 * Converts a compose byte-size string such as `2g` into bytes.
 * @param size - Compose size string with an optional b/k/m/g suffix.
 * @returns The size in bytes.
 */
function toBytes(size: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([bkmg]?)$/i.exec(size.trim());
  if (!match) throw new Error(`unparseable compose size: ${size}`);
  return Number(match[1]) * SIZE_MULTIPLIERS[match[2].toLowerCase()];
}

/**
 * Reads the declared memory ceiling of a compose file in bytes.
 * @param file - Compose file name relative to the repository root.
 * @returns The ceiling in bytes.
 */
function ceilingBytes(file: string): number {
  const limit = readImporterService(file).mem_limit;
  if (limit === undefined) throw new Error(`${file} declares no mem_limit`);
  return toBytes(limit);
}

describe.each(SHIPPED_COMPOSE_FILES)('%s memory ceiling', (file) => {
  it('declares a memory limit', () => {
    expect(readImporterService(file).mem_limit).toBeDefined();
  });

  it('declares a swap limit so the container cannot swap past its ceiling', () => {
    expect(readImporterService(file).memswap_limit).toBeDefined();
  });

  it('pins swap to the memory limit, leaving no unbounded swap headroom', () => {
    const service = readImporterService(file);
    expect(service.memswap_limit).toBe(service.mem_limit);
  });

  it('sets a ceiling large enough to complete a bank import', () => {
    expect(ceilingBytes(file)).toBeGreaterThanOrEqual(MIN_REASONABLE_LIMIT_BYTES);
  });

  it('keeps the ceiling small enough to protect a modest host', () => {
    expect(ceilingBytes(file)).toBeLessThanOrEqual(MAX_REASONABLE_LIMIT_BYTES);
  });
});
