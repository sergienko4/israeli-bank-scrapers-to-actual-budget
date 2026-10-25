import { describe, expect, it } from 'vitest';

import {
  approvedPins,
  diffPins,
  type ILockfile,
  rebuildAllowScripts,
  requiredPins,
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
