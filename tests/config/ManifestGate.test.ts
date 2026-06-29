import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BANK_REQUIREMENTS, deriveSecretKeys } from '../../src/Config/ConfigManifest.js';
import {
  checkManifest, enumCoverageErrors, flattenConfigPaths, manifestKnownPaths,
} from '../../src/Config/ManifestGate.js';
import { DEFAULT_BANK_REGISTRY } from '../../src/Scraper/BankRegistry.js';
import { isFail } from '../../src/Types/Index.js';

/**
 * Reads and parses a repo-root JSON example file.
 * @param name - File name relative to the repository root.
 * @returns The parsed JSON object.
 */
function readExample(name: string): Record<string, unknown> {
  const url = new URL(`../../${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

const examples = {
  config: readExample('config.json.example'),
  credentials: readExample('credentials.json.example'),
};

/**
 * Collects the bank catalog field keys declared by the manifest (no targets).
 * @returns The set of per-bank field keys.
 */
function bankCatalogKeys(): Set<string> {
  const keys = new Set<string>();
  for (const path of manifestKnownPaths()) {
    const match = /^banks\.\*\.([^.]+)$/.exec(path);
    if (match && match[1] !== 'targets') keys.add(match[1]);
  }
  return keys;
}

describe('Config manifest completeness gate', () => {
  it('covers every key in config.json.example and credentials.json.example', () => {
    expect(checkManifest(examples)).toEqual([]);
  });

  it('surfaces every enum through a manifest select', () => {
    expect(enumCoverageErrors()).toEqual([]);
  });

  it('fails when a top-level config key has no manifest entry', () => {
    const broken = {
      config: { ...examples.config, somethingBrandNew: true },
      credentials: examples.credentials,
    };
    const errors = checkManifest(broken);
    expect(errors.some(error => error.includes('somethingBrandNew'))).toBe(true);
  });

  it('fails when a nested bank field is not in the catalog', () => {
    const broken = {
      config: { banks: { discount: { mysteryField: 'x', targets: [] } } },
      credentials: examples.credentials,
    };
    const errors = checkManifest(broken);
    expect(errors.some(error => error.includes('banks.*.mysteryField'))).toBe(true);
  });

  it('keeps BANK_REQUIREMENTS consistent with the registry and field catalog', () => {
    const catalog = bankCatalogKeys();
    for (const [bankId, requirement] of Object.entries(BANK_REQUIREMENTS)) {
      expect(isFail(DEFAULT_BANK_REGISTRY.resolve(bankId))).toBe(false);
      for (const field of requirement.required) expect(catalog.has(String(field))).toBe(true);
    }
  });

  it('derives the expected secret keys', () => {
    expect(deriveSecretKeys()).toEqual([
      'botToken', 'clientSecret', 'otpLongTermToken', 'password',
      'passwordHash', 'sessionSecret', 'url',
    ]);
  });

  it('flattens bank instances into a single banks.* namespace', () => {
    const paths = flattenConfigPaths(examples.config);
    expect(paths).toContain('banks.*.daysBack');
    expect(paths).toContain('banks.*.targets.actualAccountId');
    expect(paths).not.toContain('banks.discount.daysBack');
  });
});
