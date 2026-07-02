import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BANK_REQUIREMENTS, deriveSecretKeys } from '../../src/Config/ConfigManifest.js';
import { BANKS_SECTION } from '../../src/Config/Manifest/BankManifest.js';
import type { IManifestSection } from '../../src/Config/Manifest/ManifestTypes.js';
import {
  checkManifest, enumCoverageErrors, listSecretErrors,
  registryCoverageErrors, sectionListSecrets,
} from '../../src/Config/ManifestGate.js';
import { flattenConfigPaths, manifestKnownPaths } from '../../src/Config/ManifestPaths.js';
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

  it('covers every registry bank with a credential requirement (no drift)', () => {
    expect(registryCoverageErrors()).toEqual([]);
    for (const item of DEFAULT_BANK_REGISTRY.list()) {
      const requirement = BANK_REQUIREMENTS[item.bankId];
      expect(requirement).toBeDefined();
      expect(requirement?.required.length).toBeGreaterThan(0);
    }
  });

  it('derives requirements for banks beyond the original eight', () => {
    expect(BANK_REQUIREMENTS.isracard?.required).toEqual(['id', 'card6Digits', 'password']);
    expect(BANK_REQUIREMENTS.mizrahi?.required).toEqual(['username', 'password']);
    expect(BANK_REQUIREMENTS.visacal?.displayName).toBe('Visa Cal');
  });

  it('declares no secret field inside any list/array container', () => {
    expect(listSecretErrors()).toEqual([]);
  });

  it('caps the daysBack manifest bound at the offline validator maximum (1-30)', () => {
    const daysBack = BANKS_SECTION.bankFields?.find((field) => field.key === 'daysBack');
    expect(daysBack?.min).toBe(1);
    expect(daysBack?.max).toBe(30);
  });

  it('flags a secret declared in a list section, a target, or a nested list', () => {
    const listSection: IManifestSection = {
      key: 'rules', label: 'Rules', kind: 'list',
      itemFields: [{ key: 'token', label: 'Token', kind: 'secret' }],
    };
    const targetSection: IManifestSection = {
      key: 'banks', label: 'Banks', kind: 'bankMap',
      targetFields: [{ key: 'apiKey', label: 'API key', kind: 'secret' }],
    };
    const nestedListSection: IManifestSection = {
      key: 'c', label: 'C', kind: 'object',
      fields: [{
        key: 'items', label: 'Items', kind: 'list',
        fields: [{ key: 'pw', label: 'Pw', kind: 'secret' }],
      }],
    };
    expect(sectionListSecrets(listSection)).toEqual(['rules.token']);
    expect(sectionListSecrets(targetSection)).toEqual(['banks.*.targets.apiKey']);
    expect(sectionListSecrets(nestedListSection)).toEqual(['c.items.pw']);
  });

  it('does not flag secrets in object groups or bank fields', () => {
    const groupSection: IManifestSection = {
      key: 'notifications', label: 'Alerts', kind: 'object',
      fields: [{
        key: 'telegram', label: 'Telegram', kind: 'group',
        fields: [{ key: 'botToken', label: 'Bot token', kind: 'secret' }],
      }],
    };
    const bankSection: IManifestSection = {
      key: 'banks', label: 'Banks', kind: 'bankMap',
      bankFields: [{ key: 'password', label: 'Password', kind: 'secret' }],
    };
    expect(sectionListSecrets(groupSection)).toEqual([]);
    expect(sectionListSecrets(bankSection)).toEqual([]);
  });

  it('derives the expected secret keys', () => {
    expect(deriveSecretKeys()).toEqual([
      'botToken', 'card6Digits', 'clientSecret', 'email', 'id', 'nationalID',
      'num', 'otpLongTermToken', 'password', 'passwordHash', 'phoneNumber',
      'sessionSecret', 'url', 'userCode', 'username',
    ]);
  });

  it('flattens bank instances into a single banks.* namespace', () => {
    const paths = flattenConfigPaths(examples.config);
    expect(paths).toContain('banks.*.daysBack');
    expect(paths).toContain('banks.*.targets.actualAccountId');
    expect(paths).not.toContain('banks.discount.daysBack');
  });
});
