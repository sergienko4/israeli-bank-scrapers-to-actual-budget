/**
 * Contract for GET /api/manifest — the description of every config section and
 * field, from which both clients render their config UI.
 *
 * The manifest is the only payload whose shape is itself recursive: a `group`
 * field carries nested fields of the same shape, to arbitrary depth.
 */

import { type Static, type TThis, Type } from '@sinclair/typebox';

/** How a field is edited and how its value is coerced. */
export const FIELD_KIND = Type.Union([
  Type.Literal('string'), Type.Literal('number'), Type.Literal('boolean'),
  Type.Literal('secret'), Type.Literal('select'), Type.Literal('date'),
  Type.Literal('group'), Type.Literal('list'),
], { description: 'Edit/render kind for a field.' });

/** Gates a field's visibility on a sibling field's current value. */
export const SHOW_WHEN = Type.Object({
  field: Type.String({ description: 'Sibling field key whose value is tested.' }),
  in: Type.Array(Type.String(), { description: 'Sibling values that reveal this field.' }),
});

/**
 * Builds the body of the recursive field schema.
 * @param self - Reference to the field schema being defined, for nesting.
 * @returns The object schema describing one manifest field.
 */
function fieldBody(self: TThis): ReturnType<typeof Type.Object> {
  return Type.Object({
    key: Type.String({ description: 'Object key exactly as it appears in config.json.' }),
    label: Type.String({ description: 'Human-readable label.' }),
    kind: FIELD_KIND,
    required: Type.Optional(Type.Boolean({ description: 'Whether a valid config must set it.' })),
    options: Type.Optional(Type.Array(Type.String(), { description: 'Allowed `select` values.' })),
    help: Type.Optional(Type.String({ description: 'Short inline help text.' })),
    min: Type.Optional(Type.Number({ description: 'Minimum, for numeric fields.' })),
    max: Type.Optional(Type.Number({ description: 'Maximum, for numeric fields.' })),
    fields: Type.Optional(Type.Array(self, {
      description: 'Nested fields for `group` kinds, or the item shape for object `list` kinds.',
    })),
    showWhen: Type.Optional(SHOW_WHEN),
  });
}

/** One configuration field: a leaf, a nested group, or a list. */
export const MANIFEST_FIELD = Type.Recursive(fieldBody, { $id: 'ManifestField' });

/** How a whole section is structured for rendering. */
export const SECTION_KIND = Type.Union([
  Type.Literal('object'), Type.Literal('bankMap'), Type.Literal('list'),
], { description: 'Structural kind of a section.' });

/** One top-level config section, mapping to a key of the config object. */
export const MANIFEST_SECTION = Type.Object({
  key: Type.String({ description: "Top-level config key; '' targets the root." }),
  label: Type.String({ description: 'Human-readable section label.' }),
  kind: SECTION_KIND,
  icon: Type.Optional(Type.String({ description: 'Emoji or icon for the nav.' })),
  doc: Type.Optional(Type.String({ description: 'Section documentation path under docs/.' })),
  fields: Type.Optional(Type.Array(MANIFEST_FIELD, { description: 'Fields for `object` kinds.' })),
  itemFields: Type.Optional(Type.Array(MANIFEST_FIELD, {
    description: 'Item shape for `list` sections.',
  })),
  bankFields: Type.Optional(Type.Array(MANIFEST_FIELD, {
    description: 'Per-bank-entry fields for `bankMap` sections.',
  })),
  targetFields: Type.Optional(Type.Array(MANIFEST_FIELD, {
    description: 'Per-target fields for `bankMap` sections.',
  })),
});

/** What one bank needs before it can be scraped. */
export const BANK_REQUIREMENT = Type.Object({
  displayName: Type.String({ description: 'Bank name used in validation messages.' }),
  required: Type.Array(Type.String(), {
    description: 'Credential field keys this bank cannot be configured without.',
  }),
  optional: Type.Optional(Type.Array(Type.String(), {
    description:
      "The bank's own optional credential keys. Reserved: this importer does not "
      + 'populate it, so a client must scope to `required` when it is absent.',
  })),
});

/** The GET /api/manifest 200 body. */
export const MANIFEST_BODY = Type.Object({
  sections: Type.Array(MANIFEST_SECTION, { description: 'Every section, in portal nav order.' }),
  banks: Type.Array(Type.String(), { description: 'Bank ids this importer supports.' }),
  bankRequirements: Type.Record(Type.String(), BANK_REQUIREMENT, {
    description: 'Per-bank credential requirements, keyed by bank id.',
  }),
});

/** How a field is edited and how its value is coerced. */
export type FieldKind = Static<typeof FIELD_KIND>;

/** Gates a field's visibility on a sibling field's current value. */
export type ShowWhen = Static<typeof SHOW_WHEN>;

/** One configuration field: a leaf, a nested group, or a list. */
export type ManifestField = Static<typeof MANIFEST_FIELD>;

/** How a whole section is structured for rendering. */
export type SectionKind = Static<typeof SECTION_KIND>;

/** One top-level config section, mapping to a key of the config object. */
export type ManifestSection = Static<typeof MANIFEST_SECTION>;

/** What one bank needs before it can be scraped. */
export type BankRequirement = Static<typeof BANK_REQUIREMENT>;

/** The GET /api/manifest 200 body. */
export type ManifestBody = Static<typeof MANIFEST_BODY>;
