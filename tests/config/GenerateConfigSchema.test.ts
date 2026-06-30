import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONFIG_MANIFEST } from '../../src/Config/ConfigManifest.js';
import type { IManifestSection } from '../../src/Config/Manifest/ManifestTypes.js';
import { buildConfigSchema, type IJsonSchema } from '../../src/Config/Schema/GenerateConfigSchema.js';

/**
 * Generates a schema for a single-field object section and returns that
 * field's property node.
 * @param section - A section to build and read one property from.
 * @param key - The property key to extract.
 * @returns The property schema node.
 */
function propOf(section: IManifestSection, key: string): IJsonSchema {
  const schema = buildConfigSchema([section]);
  return schema.properties?.[key] as IJsonSchema;
}

/**
 * Wraps a list of fields in an object section keyed `s`.
 * @param fields - Fields for the section.
 * @returns The object section.
 */
function objectSection(fields: IManifestSection['fields']): IManifestSection {
  return { key: 's', label: 'S', kind: 'object', fields };
}

describe('GenerateConfigSchema field-kind mapping', () => {
  it('maps a required string to a string schema with minLength', () => {
    const section = objectSection([
      { key: 'a', label: 'A', kind: 'string', required: true },
    ]);
    expect(propOf(section, 's')).toMatchObject({
      type: 'object',
      properties: { a: { type: 'string', minLength: 1, title: 'A' } },
      required: ['a'],
    });
  });

  it('omits minLength for an optional string', () => {
    const section = objectSection([{ key: 'a', label: 'A', kind: 'string' }]);
    const prop = propOf(section, 's').properties?.a;
    expect(prop).toEqual({ type: 'string', title: 'A' });
  });

  it('maps a number with min and max bounds', () => {
    const section = objectSection([
      { key: 'n', label: 'N', kind: 'number', min: 1, max: 25 },
    ]);
    expect(propOf(section, 's').properties?.n).toEqual({
      type: 'number', minimum: 1, maximum: 25, title: 'N',
    });
  });

  it('maps a boolean to a checkbox schema', () => {
    const section = objectSection([{ key: 'b', label: 'B', kind: 'boolean' }]);
    expect(propOf(section, 's').properties?.b).toEqual({
      type: 'boolean', 'x-format': 'checkbox', title: 'B',
    });
  });

  it('maps a secret to a masked password string schema', () => {
    const section = objectSection([{ key: 'p', label: 'P', kind: 'secret' }]);
    expect(propOf(section, 's').properties?.p).toEqual({
      type: 'string', 'x-format': 'password', 'x-secret': true, title: 'P',
    });
  });

  it('maps a select to an enum-constrained string schema', () => {
    const section = objectSection([
      { key: 'm', label: 'M', kind: 'select', options: ['x', 'y'] },
    ]);
    expect(propOf(section, 's').properties?.m).toEqual({
      type: 'string', enum: ['x', 'y'], title: 'M',
    });
  });

  it('maps a date to a date-formatted string schema', () => {
    const section = objectSection([{ key: 'd', label: 'D', kind: 'date' }]);
    expect(propOf(section, 's').properties?.d).toEqual({
      type: 'string', format: 'date', title: 'D',
    });
  });

  it('maps a group to a nested closed object with required keys', () => {
    const section = objectSection([{
      key: 'g', label: 'G', kind: 'group',
      fields: [
        { key: 'r', label: 'R', kind: 'string', required: true },
        { key: 'o', label: 'O', kind: 'string' },
      ],
    }]);
    expect(propOf(section, 's').properties?.g).toEqual({
      type: 'object',
      properties: {
        r: { type: 'string', minLength: 1, title: 'R' },
        o: { type: 'string', title: 'O' },
      },
      required: ['r'],
      additionalProperties: false,
      title: 'G',
    });
  });

  it('maps a typed list to an array of objects', () => {
    const section = objectSection([{
      key: 'l', label: 'L', kind: 'list',
      fields: [{ key: 'from', label: 'From', kind: 'string' }],
    }]);
    expect(propOf(section, 's').properties?.l).toMatchObject({
      type: 'array',
      items: { type: 'object', properties: { from: { type: 'string' } } },
      title: 'L',
    });
  });

  it('maps a scalar list (no fields) to an array of strings', () => {
    const section = objectSection([{ key: 'l', label: 'L', kind: 'list' }]);
    expect(propOf(section, 's').properties?.l).toEqual({
      type: 'array', items: { type: 'string' }, title: 'L',
    });
  });

  it('emits an x-show-when hint for conditional fields', () => {
    const section = objectSection([{
      key: 'g', label: 'G', kind: 'group', fields: [],
      showWhen: { field: 'authMode', in: ['google', 'both'] },
    }]);
    expect(propOf(section, 's').properties?.g?.['x-show-when']).toEqual({
      field: 'authMode', in: ['google', 'both'],
    });
  });

  it('carries help text into description and label into title', () => {
    const section = objectSection([
      { key: 'a', label: 'A label', kind: 'string', help: 'Some help' },
    ]);
    expect(propOf(section, 's').properties?.a).toEqual({
      type: 'string', title: 'A label', description: 'Some help',
    });
  });
});

describe('GenerateConfigSchema section mapping', () => {
  it('hoists the root section fields onto the document root', () => {
    const root: IManifestSection = {
      key: '', label: 'General', kind: 'object',
      fields: [{ key: 'delayBetweenBanks', label: 'Delay', kind: 'number', min: 0 }],
    };
    const schema = buildConfigSchema([root]);
    expect(schema.properties?.delayBetweenBanks).toMatchObject({ type: 'number', minimum: 0 });
    expect(schema.properties?.['']).toBeUndefined();
  });

  it('maps a list section to an array of item objects', () => {
    const section: IManifestSection = {
      key: 'watch', label: 'Watch', kind: 'list',
      itemFields: [{ key: 'amount', label: 'Amount', kind: 'number', required: true }],
    };
    expect(propOf(section, 'watch')).toMatchObject({
      type: 'array',
      items: { type: 'object', required: ['amount'], additionalProperties: false },
      title: 'Watch',
    });
  });

  it('maps a bankMap section to an open object with bank entries and options', () => {
    const section: IManifestSection = {
      key: 'banks', label: 'Banks', kind: 'bankMap',
      bankFields: [{ key: 'password', label: 'Password', kind: 'secret' }],
      targetFields: [
        { key: 'actualAccountId', label: 'Acct', kind: 'string', required: true },
      ],
    };
    const banks = propOf(section, 'banks');
    expect(banks).toMatchObject({ type: 'object', 'x-bank-map': true });
    const entry = banks.additionalProperties as IJsonSchema;
    expect(entry.type).toBe('object');
    expect(entry.properties?.password).toMatchObject({ 'x-secret': true });
    expect(entry.properties?.targets).toMatchObject({
      type: 'array',
      items: { type: 'object', required: ['actualAccountId'] },
    });
  });

  it('surfaces sorted supported bank ids from BANK_REQUIREMENTS', () => {
    const banks = buildConfigSchema().properties?.banks as IJsonSchema;
    const options = banks['x-bank-options'] as readonly string[];
    expect(options.length).toBeGreaterThan(0);
    const sorted = [...options].sort((left, right) => left.localeCompare(right));
    expect(options).toEqual(sorted);
    expect(options).toContain('discount');
  });

  it('attaches x-doc from a section doc path', () => {
    const section: IManifestSection = {
      key: 'proxy', label: 'Proxy', kind: 'object', doc: 'configuration/proxy.md', fields: [],
    };
    expect(propOf(section, 'proxy')?.['x-doc']).toBe('configuration/proxy.md');
  });
});

describe('GenerateConfigSchema document shape and determinism', () => {
  it('produces a draft-2020-12 closed object root', () => {
    const schema = buildConfigSchema();
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(typeof schema.title).toBe('string');
  });

  it('exposes every non-root section key as a top-level property', () => {
    const schema = buildConfigSchema();
    const keys = Object.keys(schema.properties ?? {});
    for (const section of CONFIG_MANIFEST) {
      if (section.key !== '') expect(keys).toContain(section.key);
    }
  });

  it('is deterministic — two builds deep-equal', () => {
    expect(buildConfigSchema()).toEqual(buildConfigSchema());
  });

  it('matches the committed config/portal/config.schema.json (no drift)', () => {
    const committedUrl = new URL('../../config/portal/config.schema.json', import.meta.url);
    const committed: unknown = JSON.parse(readFileSync(committedUrl, 'utf8'));
    expect(committed).toEqual(buildConfigSchema());
  });
});
