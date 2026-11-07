import { describe, expect, it } from 'vitest';

import {
  approvedPins,
  diffPins,
  dropOrphanPins,
  type ILockfile,
  rebuildAllowScripts,
  requiredPins,
  verifyOrphanPinDrop,
  withdrawableOrphans,
} from '../scripts/allow-scripts-logic.mjs';

/** better-sqlite3 as the tree holds it: a nested copy with a script, and a top-level one. */
const NESTED = 'node_modules/@hieutran094/camoufox-js/node_modules/better-sqlite3';

/**
 * Builds a lockfile whose top-level better-sqlite3 may or may not claim an install script.
 * @param topLevelScript - Whether the top-level copy is flagged `hasInstallScript`.
 * @returns The lockfile.
 */
function sqliteTree(topLevelScript: boolean): ILockfile {
  return {
    packages: {
      '': {},
      [NESTED]: { version: '12.11.1', hasInstallScript: true },
      'node_modules/better-sqlite3': { version: '13.0.3', hasInstallScript: topLevelScript },
      'node_modules/fsevents': { version: '2.3.3', hasInstallScript: true, optional: true },
    },
  };
}

describe('requiredPins', () => {
  it('requires a pin for every version of a package that runs a script', () => {
    expect([...requiredPins(sqliteTree(true))].sort()).toEqual(['better-sqlite3@12.11.1', 'better-sqlite3@13.0.3']);
  });
});

describe('approvedPins', () => {
  it.each([
    { label: 'a pinned denial', allowScripts: { 'better-sqlite3@13.0.3': false } },
    { label: 'a name-only denial', allowScripts: { 'better-sqlite3': false } },
    { label: 'a bare scoped approval', allowScripts: { '@scope/name': true } },
    { label: 'an empty version', allowScripts: { 'better-sqlite3@': true } },
    { label: 'a dist-tag', allowScripts: { 'better-sqlite3@latest': true } },
    { label: 'a range', allowScripts: { 'better-sqlite3@^13.0.0': true } },
    { label: 'a leading zero', allowScripts: { 'better-sqlite3@01.2.3': true } },
    { label: 'a numeric prerelease with a leading zero', allowScripts: { 'better-sqlite3@1.2.3-01': true } },
    { label: 'an empty prerelease part', allowScripts: { 'better-sqlite3@1.2.3-a..b': true } },
    { label: 'a non-ASCII letter that folds to ASCII', allowScripts: { 'better-sqlite3@1.2.3-\u017F': true } },
    { label: 'the Kelvin sign', allowScripts: { 'better-sqlite3@1.2.3+\u212A': true } },
  ])('refuses $label rather than reading it as an approval', ({ allowScripts }) => {
    expect(() => approvedPins(allowScripts)).toThrow(/is not an approval pinned to <name>@<version>/u);
  });

  it('accepts an exact prerelease and build version', () => {
    expect([...approvedPins({ 'camoufox@0.1.0-beta.36+build.1': true })]).toEqual(['camoufox@0.1.0-beta.36+build.1']);
  });
});

describe('diffPins and rebuildAllowScripts', () => {
  it('reports a second scripted version beside an approved one as missing, never as a rotation', () => {
    const required = requiredPins(sqliteTree(true));
    const allowScripts = { 'better-sqlite3@12.11.1': true };
    const findings = diffPins(required, approvedPins(allowScripts));
    expect(findings).toEqual({ stale: [], missing: [{ name: 'better-sqlite3', version: '13.0.3' }], orphan: [] });
    expect(rebuildAllowScripts(allowScripts, required, findings.stale)).toEqual(allowScripts);
  });

  it('flags the nested copy when only the top-level one is approved', () => {
    const findings = diffPins(requiredPins(sqliteTree(true)), new Set(['better-sqlite3@13.0.3']));
    expect(findings.missing).toEqual([{ name: 'better-sqlite3', version: '12.11.1' }]);
  });

  it('rotates a one-for-one version swap in place and drops pins the tree no longer needs', () => {
    const required = new Set(['a@2.0.0', 'b@1.0.0']);
    const allowScripts = { 'a@1.0.0': true, 'b@1.0.0': true, 'gone@1.0.0': true };
    const findings = diffPins(required, approvedPins(allowScripts));
    expect(findings).toEqual({
      stale: [{ name: 'a', version: '2.0.0', was: '1.0.0' }],
      missing: [],
      orphan: [{ name: 'gone', was: '1.0.0' }],
    });
    expect(Object.keys(rebuildAllowScripts(allowScripts, required, findings.stale))).toEqual(['a@2.0.0', 'b@1.0.0']);
  });

  it('accepts the tree when every scripted version is approved', () => {
    const required = requiredPins(sqliteTree(false));
    expect(diffPins(required, new Set(['better-sqlite3@12.11.1']))).toEqual({ stale: [], missing: [], orphan: [] });
  });
});

describe('dropOrphanPins', () => {
  it('removes only the orphaned approvals and keeps the key order of the rest', () => {
    const allowScripts = { 'a@1.0.0': true, 'gone@2.0.0': true, 'b@1.0.0': true };
    const result = dropOrphanPins(allowScripts, [{ name: 'gone', was: '2.0.0' }]);
    expect(Object.entries(result)).toEqual([
      ['a@1.0.0', true],
      ['b@1.0.0', true],
    ]);
  });

  it('keeps a scoped package pin whose name merely contains the orphan name', () => {
    const allowScripts = { '@scope/gone@1.0.0': true, 'gone@1.0.0': true };
    expect(dropOrphanPins(allowScripts, [{ name: 'gone', was: '1.0.0' }])).toEqual({ '@scope/gone@1.0.0': true });
  });

  it('leaves a stale pin in place, since rotating it is a human decision', () => {
    const required = new Set(['a@2.0.0']);
    const allowScripts = { 'a@1.0.0': true };
    const { orphan } = diffPins(required, approvedPins(allowScripts));
    expect(dropOrphanPins(allowScripts, orphan)).toEqual(allowScripts);
  });

  it('returns an empty allowlist when there is none to edit', () => {
    expect(dropOrphanPins(undefined, [{ name: 'gone', was: '1.0.0' }])).toEqual({});
  });
});

describe('withdrawableOrphans', () => {
  /**
   * Runs the diff the CLI runs, then filters its orphans.
   * @param required - Pins the lockfile requires.
   * @param approved - The allowlist entries.
   * @returns The orphans a refresh may withdraw.
   */
  function withdrawable(required: string[], approved: string[]) {
    const allowScripts = Object.fromEntries(approved.map((pin) => [pin, true]));
    return withdrawableOrphans(diffPins(new Set(required), approvedPins(allowScripts)));
  }

  it('withdraws every orphan of a package that left the tree', () => {
    expect(withdrawable(['kept@1.0.0'], ['kept@1.0.0', 'gone@1.0.0', 'gone@2.0.0'])).toEqual([
      { name: 'gone', was: '1.0.0' },
      { name: 'gone', was: '2.0.0' },
    ]);
  });

  it('keeps the approvals of a package that still has an unapproved scripted version', () => {
    const findings = diffPins(new Set(['a@1.0.1', 'a@2.0.0']), new Set(['a@1.0.0']));
    expect(findings.orphan).toEqual([{ name: 'a', was: '1.0.0' }]);
    expect(withdrawableOrphans(findings)).toEqual([]);
  });

  it('keeps both approvals when two copies each moved to an unapproved version', () => {
    expect(withdrawable(['b@12.1.0', 'b@13.1.0'], ['b@12.0.0', 'b@13.0.0'])).toEqual([]);
  });

  it('keeps a rotated package out of the withdrawal but still withdraws an unrelated orphan', () => {
    expect(withdrawable(['a@2.0.0'], ['a@1.0.0', 'gone@1.0.0'])).toEqual([{ name: 'gone', was: '1.0.0' }]);
  });

  it('does not match a scoped package by the tail of its name', () => {
    expect(withdrawable(['@scope/gone@1.0.0'], ['gone@1.0.0'])).toEqual([{ name: 'gone', was: '1.0.0' }]);
  });
});

describe('verifyOrphanPinDrop', () => {
  const required = new Set(['kept@1.0.0']);

  it.each([
    { label: 'nothing changed', before: { 'kept@1.0.0': true }, after: { 'kept@1.0.0': true } },
    { label: 'an orphaned approval removed', before: { 'kept@1.0.0': true, 'gone@1.0.0': true }, after: { 'kept@1.0.0': true } },
    { label: 'the same pins in another order', before: { 'kept@1.0.0': true, 'gone@1.0.0': true }, after: { 'gone@1.0.0': true, 'kept@1.0.0': true } },
    { label: 'no allowlist on either side', before: undefined, after: undefined },
  ])('accepts $label', ({ before, after }) => {
    expect(verifyOrphanPinDrop(before, after, required)).toEqual({ ok: true });
  });

  it.each([
    { label: 'a pin added', before: { 'kept@1.0.0': true }, after: { 'kept@1.0.0': true, 'new@1.0.0': true } },
    { label: 'a pin rotated to a new version', before: { 'kept@1.0.0': true, 'a@1.0.0': true }, after: { 'kept@1.0.0': true, 'a@2.0.0': true } },
    { label: 'an approval flipped to a denial', before: { 'kept@1.0.0': true }, after: { 'kept@1.0.0': false } },
  ])('rejects $label as a change beyond dropping orphans', ({ before, after }) => {
    const verdict = verifyOrphanPinDrop(before, after, required);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringMatching(/gained or changed/u) });
  });

  it.each([
    { label: 'true, which npm could read as approving everything', after: true },
    { label: 'an array', after: [] },
    { label: 'a string', after: 'kept@1.0.0' },
    { label: 'null', after: null },
  ])('rejects an allowlist rewritten to $label even when no entry was added', ({ after }) => {
    for (const before of [undefined, {}, { 'gone@1.0.0': true }]) {
      expect(verifyOrphanPinDrop(before, after, required)).toEqual({ ok: false, reason: 'allowScripts is not an object' });
    }
  });

  it('rejects a committed allowlist that was not an object to begin with', () => {
    expect(verifyOrphanPinDrop(true, {}, required)).toEqual({ ok: false, reason: 'allowScripts is not an object' });
  });

  it.each([
    { label: 'created from nothing', before: undefined, after: { 'new@1.0.0': true } },
    { label: 'created empty', before: undefined, after: {} },
    { label: 'deleted whole', before: { 'gone@1.0.0': true }, after: undefined },
  ])('rejects an allowlist $label, since dropping pins never adds or removes the field', ({ before, after }) => {
    expect(verifyOrphanPinDrop(before, after, required)).toEqual({
      ok: false,
      reason: 'allowScripts was added or removed as a whole',
    });
  });

  it.each([
    { label: 'a pin the tree still requires', before: { 'kept@1.0.0': true }, after: {} },
    { label: 'a denial', before: { 'kept@1.0.0': true, 'gone@1.0.0': false }, after: { 'kept@1.0.0': true } },
    { label: 'a name-only entry', before: { kept: true, 'kept@1.0.0': true }, after: { 'kept@1.0.0': true } },
  ])('rejects dropping $label', ({ before, after }) => {
    const verdict = verifyOrphanPinDrop(before, after, required);
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringMatching(/not an orphaned approval/u) });
  });

  it('names every offending entry in sorted order', () => {
    const before = { 'kept@1.0.0': true, 'b@1.0.0': false, 'a@1.0.0': false };
    expect(verifyOrphanPinDrop(before, {}, required)).toMatchObject({ reason: expect.stringContaining('a@1.0.0, b@1.0.0, kept@1.0.0') });
  });
});
