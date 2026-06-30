/**
 * scripts/generate-config-schema.ts
 *
 * Derives the portal's JSON Schema from the Config Manifest (the single source
 * of truth) and writes it to `config/portal/config.schema.json`. A future
 * jedison form renders from this file, so it is ALWAYS generated — never edited
 * by hand. Run with `npx tsx scripts/generate-config-schema.ts`.
 *
 * Modes:
 *   default:  write the schema to disk (pretty, trailing newline), exit 0
 *   --check:  regenerate in memory and compare against the committed file;
 *             exit 1 (with a clear message) on drift or when the file is
 *             missing, exit 0 when they match
 *
 * Contract:
 *   - Idempotent: running the default mode twice produces identical bytes
 *   - Deterministic: output depends only on the manifest
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfigSchema } from '../src/Config/Schema/GenerateConfigSchema.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'config/portal/config.schema.json');
const REL_PATH = relative(REPO_ROOT, SCHEMA_PATH);

/**
 * Renders the generated schema as pretty JSON with a trailing newline.
 * @returns The schema serialized for committing.
 */
function renderSchema(): string {
  const schema = buildConfigSchema();
  const json = JSON.stringify(schema, null, 2);
  return `${json}\n`;
}

/**
 * Writes the generated schema to disk and reports the path.
 * @returns Always 0 (success exit code).
 */
function writeSchema(): number {
  const content = renderSchema();
  writeFileSync(SCHEMA_PATH, content);
  process.stdout.write(`wrote: ${REL_PATH}\n`);
  return 0;
}

/**
 * Compares the freshly generated schema against the committed file.
 * @returns 0 when they match; 1 on drift or when the file is missing.
 */
function checkSchema(): number {
  const expected = renderSchema();
  if (!existsSync(SCHEMA_PATH)) return reportDrift();
  const actual = readFileSync(SCHEMA_PATH, 'utf8');
  if (actual === expected) {
    process.stdout.write(`up to date: ${REL_PATH}\n`);
    return 0;
  }
  return reportDrift();
}

/**
 * Prints the stale-schema guidance to stderr.
 * @returns Always 1 (drift exit code).
 */
function reportDrift(): number {
  process.stderr.write(`${REL_PATH} is stale; run: npm run schema:generate\n`);
  return 1;
}

/**
 * Dispatches to check or write mode based on argv.
 * @returns The process exit code.
 */
function run(): number {
  const args = new Set(process.argv.slice(2));
  if (args.has('--check')) return checkSchema();
  return writeSchema();
}

process.exit(run());
