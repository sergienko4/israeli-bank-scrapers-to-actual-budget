/**
 * Unit tests for scripts/override-floor-logic.mjs, the pure override-floor
 * planner.
 *
 * The named fixtures are the spec's acceptance table: `re2js-2026-10`
 * replays the incident that blocked Dependabot PR #825, and the rest pin one
 * rule each. Every input is explicit, so no test reads the clock or the
 * network.
 */

import { describe, expect, it } from 'vitest';

import type { IAuditAdvisory } from '../config/audit-report.mjs';
import {
  applyFloors,
  assertAllowedNpmArgs,
  compareVersions,
  isFloorOverride,
  parseRange,
  parseVersion,
  planOverrideFloors,
  sameLockedVersions,
  satisfies,
  verifyOverrideOnlyChange,
} from '../scripts/override-floor-logic.mjs';
import type { IParsedVersion, IPlannerInput } from '../scripts/override-floor-logic.mjs';

const NOW = '2026-10-29T04:07:00Z';
const OLD = '2026-01-01T00:00:00Z';
const GHSA_A = 'GHSA-gg6h-894w-4m9c';
const GHSA_B = 'GHSA-aaaa-bbbb-cccc';

/** What one fixture varies; everything else defaults to a single vulnerable `pkg`. */
interface IFixture {
  name?: string;
  locked?: Record<string, string>;
  ranges?: Array<string | null>;
  times?: Record<string, string>;
  manifest?: IPlannerInput['manifest'];
}

/**
 * Builds planner input for one vulnerable package.
 *
 * @param fixture The parts this case varies.
 * @returns Input whose violations are one GHSA per range.
 */
function plannerInput(fixture: IFixture): IPlannerInput {
  const name = fixture.name ?? 'pkg';
  const ghsas = [GHSA_A, GHSA_B];
  const advisories: IAuditAdvisory[] = (fixture.ranges ?? ['<1.2.4']).map((range, index) => ({
    ghsa: ghsas[index],
    package: name,
    severity: 'high',
    title: 'advisory',
    range,
  }));
  const locked = fixture.locked ?? { [`node_modules/${name}`]: '1.2.3' };
  return {
    violations: advisories,
    advisories,
    manifest: fixture.manifest ?? { name: 'root' },
    lockPackages: Object.fromEntries(Object.entries(locked).map(([path, version]) => [path, { version, dev: true }])),
    publishTimes: { [name]: fixture.times ?? { created: OLD, '1.2.3': OLD, '1.2.4': OLD } },
    now: NOW,
    minReleaseAgeDays: 3,
  };
}

/**
 * Parses a version the test knows is valid.
 *
 * @param text The version text.
 * @returns The parsed version.
 */
function version(text: string): IParsedVersion {
  const parsed = parseVersion(text);
  if (parsed === null) throw new Error(`fixture version ${text} does not parse`);
  return parsed;
}

describe('planOverrideFloors: spec fixtures', () => {
  it('re2js-2026-10: floors the exact-pinned transitive at the lowest aged same-line fix', () => {
    const plan = planOverrideFloors(
      plannerInput({
        name: 're2js',
        locked: { 'node_modules/markdownlint/node_modules/re2js': '2.8.6' },
        ranges: ['>=2.2.0 <2.8.7'],
        times: {
          created: OLD,
          modified: '2026-10-28T00:00:00Z',
          '2.8.6': OLD,
          '2.8.7': '2026-10-17T10:00:00Z',
          '2.8.8': '2026-10-17T12:00:00Z',
          '2.9.0': '2026-10-20T00:00:00Z',
          '2.9.1': '2026-10-28T00:00:00Z',
          '3.0.0-beta.1': '2026-10-01T00:00:00Z',
        },
      }),
    );

    expect(plan).toEqual({
      floors: [{ package: 're2js', floor: '^2.8.7', from: null, ghsas: [GHSA_A], kind: 'in-line', excludeFromAge: false }],
      rejections: [],
      requiresReview: false,
    });
  });

  it('katex-2026: a fix only on the next caret line is a breaking-line floor that needs review', () => {
    const plan = planOverrideFloors(
      plannerInput({ locked: { 'node_modules/katex': '0.16.47' }, name: 'katex', ranges: ['<0.18.2'], times: { '0.16.47': OLD, '0.18.2': OLD, '0.18.3': OLD } }),
    );

    expect(plan.floors).toMatchObject([{ package: 'katex', floor: '^0.18.2', kind: 'breaking-line', excludeFromAge: false }]);
    expect(plan.requiresReview).toBe(true);
  });

  it('fresh-only: a same-line fix younger than the age window is exempted from it and needs review', () => {
    const plan = planOverrideFloors(plannerInput({ times: { '1.2.3': OLD, '1.2.4': '2026-10-28T04:07:00Z' } }));

    expect(plan.floors).toMatchObject([{ floor: '^1.2.4', kind: 'fresh', excludeFromAge: true }]);
    expect(plan.requiresReview).toBe(true);
  });

  it('existing-lower: raises a caret override in place', () => {
    const plan = planOverrideFloors(plannerInput({ manifest: { overrides: { pkg: '^1.0.0' } } }));

    expect(plan.floors).toMatchObject([{ floor: '^1.2.4', from: '^1.0.0' }]);
  });

  it('existing-gte: keeps an open >= override open', () => {
    const plan = planOverrideFloors(plannerInput({ manifest: { overrides: { pkg: '>=1.0.1' } } }));

    expect(plan.floors).toMatchObject([{ floor: '>=1.2.4', from: '>=1.0.1' }]);
  });

  it.each<[string, IFixture, string]>([
    ['direct', { manifest: { devDependencies: { pkg: '^1.0.0' } } }, 'direct-dependency'],
    ['no-fix', { ranges: ['*'] }, 'no-fixed-release'],
    ['two-lines', { locked: { 'node_modules/pkg': '1.4.0', 'node_modules/a/node_modules/pkg': '2.1.0' } }, 'multiple-lines'],
    ['existing-object', { manifest: { overrides: { pkg: { '.': '1.0.0' } } } }, 'unsupported-override'],
    ['odd-range', { ranges: ['~1.2.0'] }, 'unparseable-range'],
    ['null-range', { ranges: [null] }, 'unparseable-range'],
    ['already-satisfied', { manifest: { overrides: { pkg: '^1.3.0' } } }, 'override-already-satisfies'],
    ['not-locked', { locked: { 'node_modules/other': '1.0.0' } }, 'not-in-lockfile'],
    ['no-times', { times: { created: OLD, '1.2.4': 'not a date' } }, 'missing-publish-times'],
  ])('%s: rejects as %s', (_name, fixture, reason) => {
    const plan = planOverrideFloors(plannerInput(fixture));

    expect(plan.floors).toEqual([]);
    expect(plan.rejections).toEqual([{ package: 'pkg', ghsas: expect.any(Array), reason }]);
    expect(plan.requiresReview).toBe(true);
  });
});

describe('planOverrideFloors: edge cases', () => {
  it('clears every advisory for the package with one floor, accepted ones included', () => {
    const input = plannerInput({ ranges: ['<1.2.5', '>=1.2.0 <1.2.7'], times: { '1.2.5': OLD, '1.2.6': OLD, '1.2.7': OLD, '1.2.9': OLD } });
    const accepted: IAuditAdvisory = { ghsa: 'GHSA-zzzz-zzzz-zzzz', package: 'pkg', severity: 'moderate', title: 'accepted', range: '<1.2.9' };

    const plan = planOverrideFloors({ ...input, advisories: [...input.advisories, accepted] });

    expect(plan.floors).toMatchObject([{ floor: '^1.2.9', ghsas: [GHSA_B, GHSA_A].sort() }]);
  });

  it('accepts an already-fixed highest copy as the floor instead of forcing a newer release', () => {
    const plan = planOverrideFloors(
      plannerInput({ locked: { 'node_modules/pkg': '1.3.0', 'node_modules/a/node_modules/pkg': '1.2.0' }, ranges: ['<1.3.0'], times: { '1.3.0': OLD, '1.4.0': OLD } }),
    );

    expect(plan.floors).toMatchObject([{ floor: '^1.3.0', kind: 'in-line' }]);
  });

  it('matches a scoped package by both name segments', () => {
    const plan = planOverrideFloors(plannerInput({ name: '@scope/pkg', locked: { 'node_modules/a/node_modules/@scope/pkg': '1.2.3' } }));

    expect(plan.floors).toMatchObject([{ package: '@scope/pkg', floor: '^1.2.4' }]);
  });
});

describe('range grammar', () => {
  it.each(['^1.2.0', '~1.2.0', '1.x', '1.2', '1.2.0 - 1.3.0', '>= 1.2.0', '', '01.2.3'])('refuses %j', range => {
    expect(parseRange(range)).toBeNull();
  });

  it('evaluates comparator sets joined by ||', () => {
    const range = parseRange('<1.0.0 || >=2.0.0 <2.1.0');
    if (range === null) throw new Error('range should parse');

    expect(['0.9.9', '1.0.0', '2.0.5', '2.1.0'].map(text => satisfies(version(text), range))).toEqual([true, false, true, false]);
  });

  it('orders prereleases per semver §11', () => {
    const ascending = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];

    const sorted = [...ascending].reverse().sort((a, b) => compareVersions(version(a), version(b)));

    expect(sorted).toEqual(ascending);
  });
});

describe('verifyOverrideOnlyChange', () => {
  const before = { name: 'root', scripts: { test: 'vitest' }, overrides: { katex: '^0.18.2' } };

  it('accepts planned override edits regardless of key order elsewhere', () => {
    const after = { scripts: { test: 'vitest' }, name: 'root', overrides: { katex: '^0.18.3', re2js: '^2.8.7' } };

    expect(verifyOverrideOnlyChange(before, after, ['katex', 're2js'])).toEqual({ ok: true });
  });

  it('refuses a change outside overrides', () => {
    const after = { ...before, scripts: { test: 'vitest', postinstall: 'curl evil' } };

    expect(verifyOverrideOnlyChange(before, after, ['katex'])).toEqual({ ok: false, reason: 'a field outside "overrides" changed' });
  });

  it('refuses an override the plan did not name, including a removal', () => {
    const after = { ...before, overrides: { re2js: '^2.8.7' } };

    expect(verifyOverrideOnlyChange(before, after, ['re2js'])).toEqual({ ok: false, reason: 'override(s) changed outside the plan: katex' });
  });
});

describe('sameLockedVersions', () => {
  const lock = { packages: { '': {}, 'node_modules/re2js': { version: '2.9.0' } } };

  it('ignores metadata and compares only path → version', () => {
    const reResolved = { packages: { '': {}, 'node_modules/re2js': { version: '2.9.0', integrity: 'sha512-x' } } };

    expect(sameLockedVersions(lock, reResolved)).toBe(true);
  });

  it.each([
    ['a moved version', { packages: { '': {}, 'node_modules/re2js': { version: '2.8.6' } } }],
    ['an added path', { packages: { ...lock.packages, 'node_modules/x': { version: '1.0.0' } } }],
  ])('detects %s', (_name, other) => {
    expect(sameLockedVersions(lock, other)).toBe(false);
  });
});

describe('applyFloors', () => {
  it('replaces existing keys in place and appends new ones', () => {
    const manifest = { name: 'root', overrides: { a: '^1.0.0', b: '^2.0.0' }, engines: { node: '>=24' } };

    const applied = applyFloors(manifest, [
      { package: 'c', floor: '^3.0.0' },
      { package: 'a', floor: '^1.1.0' },
    ]);

    expect(Object.keys(applied)).toEqual(['name', 'overrides', 'engines']);
    expect(Object.entries(applied.overrides ?? {})).toEqual([['a', '^1.1.0'], ['b', '^2.0.0'], ['c', '^3.0.0']]);
  });
});

describe('isFloorOverride', () => {
  it.each([
    ['^2.8.7', true],
    ['>=1.7.1', true],
    ['2.8.7', false],
    ['>=1.0.0 <2.0.0', false],
    ['~2.8.7', false],
    ['$re2js', false],
    [{ '.': '^1.0.0' }, false],
  ])('treats %j as a floor: %s', (spec, floor) => {
    expect(isFloorOverride(spec)).toBe(floor);
  });
});

describe('assertAllowedNpmArgs', () => {
  it.each([
    'audit --json --package-lock-only',
    'audit --json --package-lock-only --omit=dev',
    'view @scope/pkg time --json',
    'update re2js --package-lock-only --ignore-scripts',
    'update a b --package-lock-only --ignore-scripts --min-release-age=3 --min-release-age-exclude=@sergienko4/israeli-bank-scrapers --min-release-age-exclude=a',
  ])('allows %s', args => {
    expect(() => assertAllowedNpmArgs(args.split(' '))).not.toThrow();
  });

  it.each([
    'install re2js',
    'i re2js',
    'ci',
    'exec re2js',
    'x re2js',
    'audit --json',
    'audit fix --package-lock-only',
    'view re2js dist.tarball',
    'update re2js --package-lock-only',
    'update --package-lock-only --ignore-scripts',
    'update re2js --package-lock-only --ignore-scripts --save',
    'update re2js --package-lock-only --ignore-scripts --min-release-age-exclude=--foreground-scripts',
  ])('refuses %s', args => {
    expect(() => assertAllowedNpmArgs(args.split(' '))).toThrow('outside the override-floor allow-list');
  });
});
