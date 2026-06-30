/**
 * Generates a draft-2020-12 JSON Schema from the Config Manifest — the single
 * source of truth. A future jedison (germanbisurgi/jedison) form renders from
 * the generated schema, so the committed `config/portal/config.schema.json` is
 * ALWAYS produced by this module: zero manual schema edits. The mapping is pure
 * and deterministic (key order follows manifest order) so the schema only ever
 * changes when the manifest changes.
 */

import { BANK_REQUIREMENTS, CONFIG_MANIFEST } from '../ConfigManifest.js';
import type {
  FieldKind, IManifestField, IManifestSection, SectionKind,
} from '../Manifest/ManifestTypes.js';

/** A pragmatic JSON Schema node (only the keywords this generator emits). */
export interface IJsonSchema {
  /** Dialect URI; set only on the document root. */
  $schema?: string;
  /** JSON type keyword (object, array, string, number, boolean). */
  type?: string;
  /** Human-readable title (derived from a manifest label). */
  title?: string;
  /** Field help text (derived from a manifest `help`). */
  description?: string;
  /** Object property schemas, keyed by config key. */
  properties?: Record<string, IJsonSchema>;
  /** Required object property keys. */
  required?: string[];
  /** Array item schema. */
  items?: IJsonSchema;
  /** Allowed values for `select` fields. */
  enum?: readonly string[];
  /** Inclusive numeric lower bound. */
  minimum?: number;
  /** Inclusive numeric upper bound. */
  maximum?: number;
  /** Minimum string length (1 for required strings). */
  minLength?: number;
  /** String semantic format (e.g. `date`). */
  format?: string;
  /** Additional-property schema or gate. */
  additionalProperties?: IJsonSchema | boolean;
  /** Default value. */
  default?: unknown;
  /** Conditional subschemas. */
  allOf?: IJsonSchema[];
  /** Vendor extension hints (jedison/UI), e.g. `x-secret`, `x-show-when`. */
  [key: `x-${string}`]: unknown;
}

/** JSON Schema dialect emitted on the document root. */
const SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Document-root title. */
const SCHEMA_TITLE = 'Israeli Bank Importer Config';

/**
 * Maps a required `string` field to a schema, adding a non-empty constraint.
 * @param field - Manifest field.
 * @returns A `string` schema (with `minLength` when the field is required).
 */
function stringSchema(field: IManifestField): IJsonSchema {
  const schema: IJsonSchema = { type: 'string' };
  if (field.required) schema.minLength = 1;
  return schema;
}

/**
 * Maps a `number` field to a schema, carrying any min/max bounds.
 * @param field - Manifest field.
 * @returns A `number` schema with optional `minimum`/`maximum`.
 */
function numberSchema(field: IManifestField): IJsonSchema {
  const schema: IJsonSchema = { type: 'number' };
  if (field.min !== undefined) schema.minimum = field.min;
  if (field.max !== undefined) schema.maximum = field.max;
  return schema;
}

/**
 * Maps a `boolean` field to a checkbox-rendered schema.
 * @returns A `boolean` schema with a checkbox UI hint.
 */
function booleanSchema(): IJsonSchema {
  return { type: 'boolean', 'x-format': 'checkbox' };
}

/**
 * Maps a `secret` field to a masked password-rendered string schema.
 * @returns A `string` schema flagged as a password secret.
 */
function secretSchema(): IJsonSchema {
  return { type: 'string', 'x-format': 'password', 'x-secret': true };
}

/**
 * Maps a `select` field to an enum-constrained string schema.
 * @param field - Manifest field carrying `options`.
 * @returns A `string` schema whose `enum` is the field options.
 */
function selectSchema(field: IManifestField): IJsonSchema {
  return { type: 'string', enum: field.options ?? [] };
}

/**
 * Maps a `date` field to a date-formatted string schema.
 * @returns A `string` schema with `format: 'date'`.
 */
function dateSchema(): IJsonSchema {
  return { type: 'string', format: 'date' };
}

/**
 * Collects the keys of every field flagged `required: true`.
 * @param fields - Fields to scan.
 * @returns The required field keys, in declaration order.
 */
function requiredKeys(fields: readonly IManifestField[]): string[] {
  const keys: string[] = [];
  for (const field of fields) {
    if (field.required) keys.push(field.key);
  }
  return keys;
}

/**
 * Builds a closed object schema from a list of fields (recurses per field).
 * @param fields - Fields that become object properties.
 * @returns An `object` schema with properties, required keys, and no extras.
 */
function objectSchema(fields: readonly IManifestField[]): IJsonSchema {
  return {
    type: 'object',
    properties: fieldsToProperties(fields),
    required: requiredKeys(fields),
    additionalProperties: false,
  };
}

/**
 * Builds the item schema for an array: an object for typed lists, else string.
 * @param fields - Item fields, or undefined for a scalar string list.
 * @returns The array item schema.
 */
function listItemSchema(fields?: readonly IManifestField[]): IJsonSchema {
  if (!fields || fields.length === 0) return { type: 'string' };
  return objectSchema(fields);
}

/**
 * Maps a `group` field to a nested closed object schema.
 * @param field - Manifest group field.
 * @returns An `object` schema built from the group's nested fields.
 */
function groupSchema(field: IManifestField): IJsonSchema {
  const fields = field.fields ?? [];
  return objectSchema(fields);
}

/**
 * Maps a `list` field to an array schema (object or scalar items).
 * @param field - Manifest list field.
 * @returns An `array` schema with the appropriate item schema.
 */
function listFieldSchema(field: IManifestField): IJsonSchema {
  const items = listItemSchema(field.fields);
  return { type: 'array', items };
}

/** Dispatch table mapping each field kind to its schema builder. */
const FIELD_MAPPERS: Readonly<Record<FieldKind, (field: IManifestField) => IJsonSchema>> = {
  string: stringSchema,
  number: numberSchema,
  boolean: booleanSchema,
  secret: secretSchema,
  select: selectSchema,
  date: dateSchema,
  group: groupSchema,
  list: listFieldSchema,
};

/**
 * Builds the kind-specific base schema for a field.
 * @param field - Manifest field.
 * @returns The base schema before metadata decoration.
 */
function baseFieldSchema(field: IManifestField): IJsonSchema {
  const mapper = FIELD_MAPPERS[field.kind];
  return mapper(field);
}

/**
 * Decorates a base schema with a field's title, help, and showWhen hint.
 * @param schema - Base schema to decorate.
 * @param field - Manifest field supplying the metadata.
 * @returns The decorated schema (new object).
 */
function withFieldMeta(schema: IJsonSchema, field: IManifestField): IJsonSchema {
  const decorated: IJsonSchema = { ...schema, title: field.label };
  if (field.help !== undefined) decorated.description = field.help;
  if (field.showWhen) decorated['x-show-when'] = field.showWhen;
  return decorated;
}

/**
 * Converts one manifest field into its decorated JSON Schema node.
 * @param field - Manifest field.
 * @returns The field's JSON Schema node.
 */
function fieldToSchema(field: IManifestField): IJsonSchema {
  const base = baseFieldSchema(field);
  return withFieldMeta(base, field);
}

/**
 * Converts a list of fields into a `properties` map (key order preserved).
 * @param fields - Fields to convert.
 * @returns A map of config key to field schema.
 */
function fieldsToProperties(fields: readonly IManifestField[]): Record<string, IJsonSchema> {
  const properties: Record<string, IJsonSchema> = {};
  for (const field of fields) properties[field.key] = fieldToSchema(field);
  return properties;
}

/**
 * Builds the `targets` array schema for a bank entry from its target fields.
 * @param targetFields - Per-target fields, or undefined.
 * @returns An `array` schema whose items come from the target fields.
 */
function targetsSchema(targetFields?: readonly IManifestField[]): IJsonSchema {
  const items = listItemSchema(targetFields);
  return { type: 'array', items };
}

/**
 * Builds the per-bank entry object schema (bank fields plus a `targets` array).
 * @param bankFields - Editable per-bank fields.
 * @param targetFields - Per-target fields.
 * @returns A closed `object` schema describing one bank entry.
 */
function bankEntrySchema(
  bankFields: readonly IManifestField[], targetFields?: readonly IManifestField[],
): IJsonSchema {
  const properties = fieldsToProperties(bankFields);
  properties.targets = targetsSchema(targetFields);
  return {
    type: 'object', properties, required: requiredKeys(bankFields), additionalProperties: false,
  };
}

/**
 * Lists every supported bank id (BANK_REQUIREMENTS keys), sorted for stability.
 * @returns The sorted supported bank ids for an add-bank dropdown.
 */
function bankOptions(): readonly string[] {
  const ids = Object.keys(BANK_REQUIREMENTS);
  return ids.sort((left, right) => left.localeCompare(right));
}

/**
 * Maps a `bankMap` section to an open object keyed by bank id.
 * @param section - Banks section carrying bank/target fields.
 * @returns An `object` schema whose `additionalProperties` is a bank entry.
 */
function bankMapSchema(section: IManifestSection): IJsonSchema {
  const bankFields = section.bankFields ?? [];
  const entry = bankEntrySchema(bankFields, section.targetFields);
  return {
    type: 'object', additionalProperties: entry,
    'x-bank-map': true, 'x-bank-options': bankOptions(),
  };
}

/**
 * Maps an `object` section to a closed object schema from its fields.
 * @param section - Object section.
 * @returns An `object` schema built from the section fields.
 */
function objectSectionSchema(section: IManifestSection): IJsonSchema {
  const fields = section.fields ?? [];
  return objectSchema(fields);
}

/**
 * Maps a `list` section (e.g. spendingWatch) to an array schema.
 * @param section - List section carrying `itemFields`.
 * @returns An `array` schema whose items come from the item fields.
 */
function listSectionSchema(section: IManifestSection): IJsonSchema {
  const items = listItemSchema(section.itemFields);
  return { type: 'array', items };
}

/** Dispatch table mapping each section kind to its schema builder. */
const SECTION_MAPPERS: Readonly<Record<SectionKind, (section: IManifestSection) => IJsonSchema>> = {
  object: objectSectionSchema,
  bankMap: bankMapSchema,
  list: listSectionSchema,
};

/**
 * Decorates a section schema with its title and documentation hint.
 * @param schema - Base section schema.
 * @param section - Manifest section supplying the metadata.
 * @returns The decorated section schema (new object).
 */
function withSectionMeta(schema: IJsonSchema, section: IManifestSection): IJsonSchema {
  const decorated: IJsonSchema = { ...schema, title: section.label };
  if (section.doc !== undefined) decorated['x-doc'] = section.doc;
  return decorated;
}

/**
 * Converts one manifest section into its decorated JSON Schema node.
 * @param section - Manifest section.
 * @returns The section's JSON Schema node.
 */
function sectionToSchema(section: IManifestSection): IJsonSchema {
  const mapper = SECTION_MAPPERS[section.kind];
  const base = mapper(section);
  return withSectionMeta(base, section);
}

/**
 * Produces the top-level property entries a section contributes. The root
 * section (key `''`) hoists its fields directly onto the document root.
 * @param section - Manifest section.
 * @returns A property map keyed by config key.
 */
function sectionEntries(section: IManifestSection): Record<string, IJsonSchema> {
  if (section.key === '') return fieldsToProperties(section.fields ?? []);
  return { [section.key]: sectionToSchema(section) };
}

/**
 * Builds the document-root `properties` map from every manifest section.
 * @param manifest - Sections in nav order.
 * @returns The root property map (manifest order preserved).
 */
function sectionProperties(manifest: readonly IManifestSection[]): Record<string, IJsonSchema> {
  const properties: Record<string, IJsonSchema> = {};
  for (const section of manifest) {
    const entries = sectionEntries(section);
    Object.assign(properties, entries);
  }
  return properties;
}

/**
 * Computes the document-root required keys from the root (`''`) section.
 * @param manifest - Sections in nav order.
 * @returns Required root field keys, or an empty list when none.
 */
function rootRequiredKeys(manifest: readonly IManifestSection[]): string[] {
  const root = manifest.find(section => section.key === '');
  if (!root) return [];
  return requiredKeys(root.fields ?? []);
}

/**
 * Builds the full draft-2020-12 config schema from the Config Manifest. Pure
 * and deterministic: the same manifest always yields byte-identical output.
 * @param manifest - Sections to derive from (defaults to CONFIG_MANIFEST).
 * @returns The document-root JSON Schema.
 */
export function buildConfigSchema(
  manifest: readonly IManifestSection[] = CONFIG_MANIFEST,
): IJsonSchema {
  return {
    $schema: SCHEMA_DIALECT,
    type: 'object',
    title: SCHEMA_TITLE,
    properties: sectionProperties(manifest),
    required: rootRequiredKeys(manifest),
    additionalProperties: false,
  };
}
