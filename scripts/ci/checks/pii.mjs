#!/usr/bin/env node
/**
 * PII-interpolation grep gate.
 *
 * Scans `src/` for template-literal interpolations that risk leaking
 * sensitive values into error messages or logs. Replicates the inline
 * bash logic that lived in `.husky/pre-commit` gate 16 so the same
 * check runs locally and in CI.
 *
 * Patterns flagged:
 *   1. `${password|token|otp|secret|digits|creditCard}` near
 *      `throw|Error|fail(` constructs.
 *   2. `${...proxy...}` near logger emission.
 *   3. logger.info with `${...merchant|amount|payee|customerName|payeeName}`.
 *
 * Exits 0 when clean, 1 with the offending lines printed when not.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const SRC_DIR = path.resolve(process.cwd(), 'src');

/** Pattern 1: sensitive value in throw/Error/fail() construct. */
const SECRET_NAMES = /\$\{(password|token|otp|secret|digits|creditCard)\}/;
const THROW_CONTEXT = /throw|Error|fail\(/i;

/** Pattern 2: proxy interpolation in a logger call. */
const PROXY_INTERP = /\$\{[^}]*proxy[^}]*\}/i;
const LOGGER_CONTEXT = /logger|\.info|\.warn|\.error/i;

/** Pattern 3: PII fields in logger.info. */
const LOGGER_PII = /getLogger\(\)\.info[^\n]*\$\{[^}]*\.(merchant|amount|payee|customerName|payeeName)/;

/**
 * Recursively yields every `*.ts` file under `dir`.
 *
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkTsFiles(dir) {
  /** @type {Array<import('node:fs').Dirent>} */
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walkTsFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

/**
 * Returns the offending lines in `content` for the supplied file path.
 *
 * @param {string} file
 * @param {string} content
 * @returns {ReadonlyArray<string>}
 */
function findHits(file, content) {
  const hits = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    if (SECRET_NAMES.test(line) && THROW_CONTEXT.test(line)) {
      hits.push(`${file}:${lineNo}: ${line.trim()}`);
    } else if (PROXY_INTERP.test(line) && LOGGER_CONTEXT.test(line)) {
      hits.push(`${file}:${lineNo}: ${line.trim()}`);
    } else if (LOGGER_PII.test(line)) {
      hits.push(`${file}:${lineNo}: ${line.trim()}`);
    }
  }
  return hits;
}

/**
 * Entry point. Scans src/ and reports.
 */
async function main() {
  /** @type {string[]} */
  const allHits = [];
  for await (const file of walkTsFiles(SRC_DIR)) {
    const content = await readFile(file, 'utf8');
    allHits.push(...findHits(file, content));
  }
  if (allHits.length > 0) {
    process.stderr.write('PII variable interpolation detected:\n');
    for (const hit of allHits) process.stderr.write(`  ${hit}\n`);
    process.exit(1);
  }
  process.stdout.write('No PII detected in error messages or info logs\n');
  process.exit(0);
}

await main();
