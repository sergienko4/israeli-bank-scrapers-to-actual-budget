import { describe, expect, it } from 'vitest';

import {
  BLOCKERS,
  compareTriples,
  findBlockers,
  type LockPackages,
  parseTriple,
  rangeHoldsBelow,
  resolveAutoExtensions,
  satisfies,
} from '../config/audit-blockers.mjs';

/** The version that fixes the advisory in the vectors below. */
const FIXED_IN = '11.0.1';

/** npm's vulnerable range for the advisory in the vectors below. */
const RANGE = '>=7.0.0 <11.0.1';

/** The advisory the vectors below look for blockers of. */
const MINIMATCH = { package: 'minimatch', range: RANGE };

/** The audit's advisories, as the policy hands them to resolveAutoExtensions. */
const ADVISORIES = [{ ghsa: 'GHSA-auto', ...MINIMATCH }];

describe('parseTriple', () => {
  it('reads a plain MAJOR.MINOR.PATCH version', () => {
    expect(parseTriple('11.0.1')).toEqual([11, 0, 1]);
    expect(parseTriple('0.0.0')).toEqual([0, 0, 0]);
  });

  it.each([
    '11.0',
    '11.0.1-beta',
    'v11.0.1',
    ' 11.0.1',
    '11.0.1 ',
    '',
    'latest',
    '011.0.1',
    '11.00.1',
    '11.0.01',
    '9007199254740992.0.0',
  ])('rejects %j', (text) => {
    expect(parseTriple(text)).toBeNull();
  });

  // An array of one version string reads as that string once coerced, so it
  // is the case that only an explicit type check turns away.
  it.each([undefined, null, 11, {}, ['11.0.1']])('rejects the non-string %j', (value) => {
    expect(parseTriple(value)).toBeNull();
  });
});

describe('compareTriples', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareTriples([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareTriples([1, 2, 3], [1, 3, 0])).toBeLessThan(0);
    expect(compareTriples([2, 0, 0], [1, 9, 9])).toBeGreaterThan(0);
  });
});

describe('rangeHoldsBelow', () => {
  it.each([
    '^10.2.2',
    '^9.0.3 || ^10.1.2',
    '^9.0.3  ||  ^10.1.2',
    '<11.0.1',
    '<=11.0.0',
    '~10.2.0',
    '10.2.6',
    '=10.2.6',
    '11.0.0',
    '>=1.0.0 <11.0.1',
    '  ^10.2.2  ',
  ])('holds %j below 11.0.1', (range) => {
    expect(rangeHoldsBelow(range, FIXED_IN)).toBe(true);
  });

  it.each([
    '^11.0.0',
    '~11.0.0',
    '11.0.1',
    '>=10.0.0',
    '>11.0.0',
    '<=11.0.1',
    '^9.0.3 || >=10.0.0',
    '>=1.0.0 <11.0.1 || ^11.0.0',
  ])('lets %j reach 11.0.1', (range) => {
    expect(rangeHoldsBelow(range, FIXED_IN)).toBe(false);
  });

  it.each([
    '',
    '1.x',
    '*',
    'latest',
    '^10.2.2-beta',
    '1.0.0 - 2.0.0',
    '>= 1.0.0',
    '^10.2.2 ||',
    'npm:minimatch@^10.2.2',
    'workspace:*',
    '^010.2.2',
    '<11.0.01',
    '<9007199254740992.0.0',
  ])('never counts the unreadable range %j as holding back', (range) => {
    expect(rangeHoldsBelow(range, FIXED_IN)).toBe(false);
  });

  it.each([undefined, null, 10, ['^10.2.2']])('never counts the non-string range %j as holding back', (range) => {
    expect(rangeHoldsBelow(range, FIXED_IN)).toBe(false);
  });

  it.each([undefined, '11.0', '11.0.1-beta', '', '011.0.1', '9007199254740992.0.0'])(
    'never holds back against the unreadable fix %j',
    (fixedIn) => {
      expect(rangeHoldsBelow('^10.2.2', fixedIn)).toBe(false);
    },
  );

  it('tightens a caret range below 1.0.0 the way npm does', () => {
    expect(rangeHoldsBelow('^0.2.3', '0.3.0')).toBe(true);
    expect(rangeHoldsBelow('^0.2.3', '0.2.9')).toBe(false);
    expect(rangeHoldsBelow('^0.0.3', '0.0.4')).toBe(true);
    expect(rangeHoldsBelow('^0.0.3', '0.0.3')).toBe(false);
  });

  it('stops a tilde range at the next minor, not the next major', () => {
    // From 1.0.0 on a caret range runs to the next major and a tilde range
    // does not, so ~10.2.0 cannot take 10.3.0 while ^10.2.0 can.
    expect(rangeHoldsBelow('~10.2.0', '10.3.0')).toBe(true);
    expect(rangeHoldsBelow('~10.2.0', '10.2.9')).toBe(false);
    expect(rangeHoldsBelow('^10.2.0', '10.3.0')).toBe(false);
  });

  it('ends a tilde range at the next minor whatever its patch', () => {
    // The ceiling is 10.3.0 for ~10.2.3 as for ~10.2.0. A ceiling that kept
    // the patch would sit at 10.3.3 and let the range reach 10.3.0 and 10.3.1.
    expect(rangeHoldsBelow('~10.2.3', '10.3.0')).toBe(true);
    expect(rangeHoldsBelow('~10.2.3', '10.3.1')).toBe(true);
    expect(rangeHoldsBelow('~10.2.3', '10.2.9')).toBe(false);
  });
});

describe('satisfies', () => {
  it.each([
    '>=7.0.0 <11.0.1',
    '^10.2.5',
    '~10.2.0',
    '10.2.6',
    '=10.2.6',
    '<=10.2.6',
    '>10.2.5',
    '^9.0.3 || ^10.1.2',
    '  ^10.2.2  ',
  ])('admits 10.2.6 in %j', (range) => {
    expect(satisfies([10, 2, 6], range)).toBe(true);
  });

  it.each(['^11.0.0', '~10.1.0', '<10.2.6', '>10.2.6', '>=7.0.0 <10.0.0', '^9.0.3 || ^11.0.0'])(
    'shuts 10.2.6 out of %j',
    (range) => {
      expect(satisfies([10, 2, 6], range)).toBe(false);
    },
  );

  it.each([
    [[7, 0, 0], '>=7.0.0 <11.0.1'],
    [[11, 0, 0], '>=7.0.0 <11.0.1'],
    [[10, 2, 0], '~10.2.0'],
    [[10, 2, 9], '~10.2.0'],
    [[10, 2, 3], '~10.2.3'],
    [[10, 2, 9], '~10.2.3'],
    [[10, 2, 5], '^10.2.5'],
    [[10, 2, 6], '>=10.2.6'],
    [[10, 2, 6], '<=10.2.6'],
    [[10, 2, 6], '10.2.6'],
    [[10, 2, 6], '=10.2.6'],
  ])('admits %j at the edge of %j', (version, range) => {
    expect(satisfies(version, range)).toBe(true);
  });

  it.each([
    [[6, 9, 9], '>=7.0.0 <11.0.1'],
    [[11, 0, 1], '>=7.0.0 <11.0.1'],
    [[10, 1, 9], '~10.2.0'],
    [[10, 3, 0], '~10.2.0'],
    [[10, 2, 2], '~10.2.3'],
    [[10, 3, 0], '~10.2.3'],
    [[10, 3, 1], '~10.2.3'],
    [[10, 2, 4], '^10.2.5'],
    [[11, 0, 0], '^10.2.5'],
    [[10, 2, 5], '>=10.2.6'],
    [[10, 2, 5], '>10.2.5'],
    [[10, 2, 7], '<=10.2.6'],
    [[10, 2, 5], '10.2.6'],
    [[10, 2, 7], '10.2.6'],
    [[10, 2, 5], '=10.2.6'],
    [[10, 2, 7], '=10.2.6'],
  ])('shuts %j out of %j, just past its bound', (version, range) => {
    expect(satisfies(version, range)).toBe(false);
  });

  it.each(['', '*', '1.x', '>= 7.0.0', '^10.2.6-beta', '^10.2.2 ||', '^10.2.2 || 1.x', null, undefined, 10])(
    'admits nothing in the unreadable range %j',
    (range) => {
      expect(satisfies([10, 2, 6], range)).toBe(false);
    },
  );

  it('tightens a caret range below 1.0.0 the way npm does', () => {
    expect(satisfies([0, 2, 9], '^0.2.3')).toBe(true);
    expect(satisfies([0, 3, 0], '^0.2.3')).toBe(false);
    expect(satisfies([0, 0, 3], '^0.0.3')).toBe(true);
    expect(satisfies([0, 0, 4], '^0.0.3')).toBe(false);
  });
});

/**
 * A lockfile `packages` map with every record shape findBlockers must handle,
 * including malformed ones a hand-edited or truncated lockfile could carry.
 */
const LOCK = {
  '': { name: 'root', version: '1.0.0', devDependencies: { minimatch: '^10.2.2' } },
  'node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } },
  'node_modules/typedoc': { version: '0.28.0', peerDependencies: { minimatch: '^10.2.5' } },
  'node_modules/@scope/tool': { version: '2.0.0', optionalDependencies: { minimatch: '^9.0.3 || ^10.1.2' } },
  'node_modules/a/node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '~10.2.0' } },
  'node_modules/glob': { version: '14.0.2', dependencies: { minimatch: '^11.0.1' } },
  'node_modules/linked': { link: true, dependencies: { minimatch: '^10.0.0' } },
  'node_modules/minimatch': { version: '10.2.6' },
  'node_modules/odd-field': { version: '1.0.0', dependencies: 'not-an-object' },
  'node_modules/null-field': { version: '1.0.0', dependencies: null },
  'node_modules/null-record': null,
} as unknown as LockPackages;

describe('findBlockers', () => {
  it('lists every installed package whose range cannot take the fix, sorted and de-duplicated', () => {
    expect(findBlockers(MINIMATCH, FIXED_IN, LOCK)).toEqual([
      '@scope/tool@2.0.0',
      'eslint@10.2.0',
      'typedoc@0.28.0',
    ]);
  });

  it('ignores the root manifest, which this repository can always bump itself', () => {
    // The copy is installed, inside the range the manifest declares, and
    // covered by the advisory, so only the root check keeps the manifest out.
    // The same record counts when an installed package declares it, which
    // shows the fixture is not vacuous.
    const manifest = { version: '1.0.0', dependencies: { minimatch: '^10.2.2' } };
    const copy = { version: '10.2.6' };
    const asRoot: LockPackages = { '': manifest, 'node_modules/minimatch': copy };
    const asHolder: LockPackages = { 'node_modules/holder': manifest, 'node_modules/minimatch': copy };

    expect(findBlockers(MINIMATCH, FIXED_IN, asRoot)).toEqual([]);
    expect(findBlockers(MINIMATCH, FIXED_IN, asHolder)).toEqual(['holder@1.0.0']);
  });

  it('finds nothing once every dependent can take the fix', () => {
    const lock = { 'node_modules/glob': { version: '14.0.2', dependencies: { minimatch: '^11.0.1' } } };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('finds nothing in an empty lockfile', () => {
    expect(findBlockers(MINIMATCH, FIXED_IN, {})).toEqual([]);
  });

  it('skips records outside node_modules, whose manifests this repository controls', () => {
    const lock: LockPackages = {
      'packages/tool': { version: '1.0.0', dependencies: { minimatch: '^10.2.2' } },
      'node_modules/minimatch': { version: '10.2.6' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('skips a linked dependent even when it carries a version', () => {
    const lock: LockPackages = {
      'node_modules/tool': { version: '1.0.0', link: true, dependencies: { minimatch: '^10.2.2' } },
      'node_modules/minimatch': { version: '10.2.6' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it.each([false, 'true', null])('treats any link key, even %j, as not installed', (link) => {
    const lock = {
      'node_modules/tool': { version: '1.0.0', link, dependencies: { minimatch: '^10.2.2' } },
      'node_modules/other': { version: '2.0.0', dependencies: { minimatch: '^10.2.2' } },
      'node_modules/other/node_modules/minimatch': { version: '10.2.6', link },
      'node_modules/minimatch': { version: '10.2.6' },
    } as unknown as LockPackages;

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('skips a copy the advisory does not cover', () => {
    const lock: LockPackages = {
      'node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } },
      'node_modules/minimatch': { version: '10.2.6' },
    };

    expect(findBlockers({ package: 'minimatch', range: '>=7.0.0 <10.2.6' }, FIXED_IN, lock)).toEqual([]);
    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual(['eslint@10.2.0']);
  });

  it('skips a copy that predates the advisory range', () => {
    // 3.1.2 lies below the first affected version, so it is not vulnerable and
    // its dependent holds nothing back. The same lock counts the dependent once
    // the advisory reaches back far enough to cover 3.1.2.
    const lock: LockPackages = {
      'node_modules/old-tool': { version: '1.0.0', dependencies: { minimatch: '^3.1.2' } },
      'node_modules/minimatch': { version: '3.1.2' },
    };
    const reachingBack = { package: 'minimatch', range: '>=3.0.0 <11.0.1' };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
    expect(findBlockers(reachingBack, FIXED_IN, lock)).toEqual(['old-tool@1.0.0']);
  });

  it.each([null, undefined, '', '1.x', '>=7.0.0 <11.0.1 ||'])(
    'finds nothing when the advisory range is the unreadable %j',
    (range) => {
      expect(findBlockers({ package: 'minimatch', range }, FIXED_IN, LOCK)).toEqual([]);
    },
  );

  it('skips a dependent whose copy lies outside its own declared range', () => {
    const lock: LockPackages = {
      'node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } },
      'node_modules/minimatch': { version: '10.2.0' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('skips a copy that is an alias for another package', () => {
    // npm records a `name` when the package's own name differs from the one in
    // its install path, as it does for an `npm:` alias, so a copy named
    // otherwise is not the package that the path names.
    const holder = { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } };
    const aliased: LockPackages = {
      'node_modules/eslint': holder,
      'node_modules/minimatch': { name: 'minimatch-fork', version: '10.2.6' },
    };
    const named: LockPackages = {
      'node_modules/eslint': holder,
      'node_modules/minimatch': { name: 'minimatch', version: '10.2.6' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, aliased)).toEqual([]);
    expect(findBlockers(MINIMATCH, FIXED_IN, named)).toEqual(['eslint@10.2.0']);
  });

  it.each([null, '', 5, {}])('treats the unreadable copy name %j as an alias', (name) => {
    const lock = {
      'node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } },
      'node_modules/minimatch': { name, version: '10.2.6' },
    } as unknown as LockPackages;

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it.each([
    ['is not installed', {}],
    ['already carries the fix', { 'node_modules/minimatch': { version: '11.0.1' } }],
    ['is a link', { 'node_modules/minimatch': { version: '10.2.6', link: true } }],
    ['has a prerelease version', { 'node_modules/minimatch': { version: '10.2.6-beta' } }],
    ['is a malformed record', { 'node_modules/minimatch': null }],
  ])('skips a dependent whose copy of the package %s', (_case, copies) => {
    const lock = {
      'node_modules/eslint': { version: '10.2.0', dependencies: { minimatch: '^10.2.5' } },
      ...copies,
    } as unknown as LockPackages;

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('counts a dependent whose nearest copy is vulnerable, even when the top-level copy is fixed', () => {
    const lock: LockPackages = {
      'node_modules/a': { version: '1.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/a/node_modules/minimatch': { version: '10.2.6' },
      'node_modules/b': { version: '2.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/@s/c': { version: '3.0.0' },
      'node_modules/@s/c/node_modules/minimatch': { version: '10.2.6' },
      'node_modules/@s/c/node_modules/d': { version: '4.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/minimatch': { version: '11.0.1' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual(['a@1.0.0', 'd@4.0.0']);
  });

  it('skips a dependent whose nearest copy is fixed, even when the top-level copy is vulnerable', () => {
    const lock: LockPackages = {
      'node_modules/a': { version: '1.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/a/node_modules/minimatch': { version: '11.0.1' },
      'node_modules/b': { version: '2.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/minimatch': { version: '10.2.6' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual(['b@2.0.0']);
  });

  it('skips a dependent whose copy lies outside its own declared tilde range', () => {
    // ~10.2.3 stops short of 10.3.0, so a 10.3.1 copy, pinned there by an
    // override, is not the copy the dependent asked for and holds nothing
    // back. The same dependent counts while its copy sits inside the range.
    const holder = { version: '1.0.0', dependencies: { minimatch: '~10.2.3' } };
    const pinnedPastIt: LockPackages = {
      'node_modules/holder': holder,
      'node_modules/minimatch': { version: '10.3.1' },
    };
    const insideIt: LockPackages = {
      'node_modules/holder': holder,
      'node_modules/minimatch': { version: '10.2.9' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, pinnedPastIt)).toEqual([]);
    expect(findBlockers(MINIMATCH, FIXED_IN, insideIt)).toEqual(['holder@1.0.0']);
  });

  it('resolves a dependent three levels deep to the nearest copy, not the outermost nested one', () => {
    // c sits under a and b; the copy it loads is the one beside it under b,
    // which is fixed. The vulnerable copy under a is farther away, so it must
    // not make c a blocker.
    const lock: LockPackages = {
      'node_modules/a': { version: '1.0.0' },
      'node_modules/a/node_modules/minimatch': { version: '10.2.6' },
      'node_modules/a/node_modules/b': { version: '1.0.0' },
      'node_modules/a/node_modules/b/node_modules/minimatch': { version: '11.0.1' },
      'node_modules/a/node_modules/b/node_modules/c': { version: '2.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/minimatch': { version: '11.0.1' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
  });

  it('names a deeply nested blocker by its own package, not by its install path', () => {
    const lock: LockPackages = {
      'node_modules/a': { version: '1.0.0' },
      'node_modules/a/node_modules/b': { version: '1.0.0' },
      'node_modules/a/node_modules/b/node_modules/minimatch': { version: '10.2.6' },
      'node_modules/a/node_modules/b/node_modules/c': { version: '2.0.0', dependencies: { minimatch: '^10.2.0' } },
      'node_modules/minimatch': { version: '11.0.1' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual(['c@2.0.0']);
  });

  it.each([1, null, {}, ['1.0.0']])('skips a dependent whose record carries the unreadable version %j', (version) => {
    // A record without a string version is not an installed package, so what
    // it declares says nothing about what the tree can take.
    const declared = { dependencies: { minimatch: '^10.2.0' } };
    const lock = {
      'node_modules/holder': { version, ...declared },
      'node_modules/minimatch': { version: '10.2.6' },
    } as unknown as LockPackages;
    const control = { ...lock, 'node_modules/holder': { version: '1.0.0', ...declared } } as unknown as LockPackages;

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
    expect(findBlockers(MINIMATCH, FIXED_IN, control)).toEqual(['holder@1.0.0']);
  });

  it.each([{ resolved: 'https://registry.example.invalid/minimatch.tgz' }, { version: 10 }, null])(
    'lets a malformed nested copy %j shadow the top-level one, which then holds nothing back',
    (nested) => {
      // The nested record is the nearest copy npm would load, so the
      // vulnerable top-level copy beyond it is not the one holder resolves to.
      // A damaged record is no reason to look past it and count a copy the
      // holder never loads.
      const holder = { version: '1.0.0', dependencies: { minimatch: '^10.2.0' } };
      const lock = {
        'node_modules/holder': holder,
        'node_modules/holder/node_modules/minimatch': nested,
        'node_modules/minimatch': { version: '10.2.6' },
      } as unknown as LockPackages;
      const control = {
        ...lock,
        'node_modules/holder/node_modules/minimatch': { version: '10.2.6' },
      } as unknown as LockPackages;

      expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual([]);
      expect(findBlockers(MINIMATCH, FIXED_IN, control)).toEqual(['holder@1.0.0']);
    },
  );

  it('reads the range npm uses when a package declares the dependency twice', () => {
    const lock: LockPackages = {
      'node_modules/optional-holds': {
        version: '1.0.0',
        dependencies: { minimatch: '^11.0.1' },
        optionalDependencies: { minimatch: '^10.2.0' },
      },
      'node_modules/optional-frees': {
        version: '1.0.0',
        dependencies: { minimatch: '^10.2.0' },
        optionalDependencies: { minimatch: '^11.0.1' },
      },
      'node_modules/regular-frees': {
        version: '1.0.0',
        dependencies: { minimatch: '^11.0.1' },
        peerDependencies: { minimatch: '^10.2.0' },
      },
      'node_modules/minimatch': { version: '10.2.6' },
    };

    expect(findBlockers(MINIMATCH, FIXED_IN, lock)).toEqual(['optional-holds@1.0.0']);
  });

  it.each(['__proto__', 'constructor', 'toString'])('treats the prototype name %j as an ordinary package', (name) => {
    expect(findBlockers({ package: name, range: RANGE }, FIXED_IN, LOCK)).toEqual([]);
  });
});

describe('resolveAutoExtensions', () => {
  const autoExtending = { ghsa: 'GHSA-auto', package: 'minimatch', autoExtend: { fixedIn: FIXED_IN } };
  const plain = { ghsa: 'GHSA-plain', package: 'minimatch' };
  const unreadable = { ghsa: 'GHSA-bad', package: 'minimatch', autoExtend: { fixedIn: '11.0' } };
  const empty = { ghsa: 'GHSA-empty', package: 'minimatch', autoExtend: {} as { fixedIn: string } };

  it('attaches the current blockers to an entry that opts in', () => {
    const [resolved] = resolveAutoExtensions([autoExtending], LOCK, ADVISORIES);

    expect(resolved?.[BLOCKERS]).toEqual(['@scope/tool@2.0.0', 'eslint@10.2.0', 'typedoc@0.28.0']);
    expect(resolved).toMatchObject(autoExtending);
  });

  it('returns entries without a readable autoExtend.fixedIn unchanged', () => {
    const resolved = resolveAutoExtensions([plain, unreadable, empty], LOCK, ADVISORIES);

    expect(resolved[0]).toBe(plain);
    expect(resolved[1]).toBe(unreadable);
    expect(resolved[2]).toBe(empty);
  });

  it('leaves its input untouched', () => {
    const entries = [autoExtending, plain];

    const resolved = resolveAutoExtensions(entries, LOCK, ADVISORIES);

    expect(resolved).not.toBe(entries);
    expect(resolved[0]).not.toBe(autoExtending);
    expect(Object.getOwnPropertySymbols(autoExtending)).toEqual([]);
  });

  it('replaces blockers that were already on the entry', () => {
    const forged = { ...autoExtending, [BLOCKERS]: ['forged@1.0.0'] };

    const [resolved] = resolveAutoExtensions([forged], { 'node_modules/glob': { version: '14.0.2' } }, ADVISORIES);

    expect(resolved?.[BLOCKERS]).toEqual([]);
  });

  it.each([
    ['the audit reports no advisories', []],
    ['only another GHSA ID is reported', [{ ...ADVISORIES[0], ghsa: 'GHSA-other' }]],
  ])('attaches no blockers when %s', (_case, advisories) => {
    const [resolved] = resolveAutoExtensions([autoExtending], LOCK, advisories);

    expect(resolved?.[BLOCKERS]).toEqual([]);
  });

  it('attaches no blockers when the GHSA ID is reported for another package', () => {
    // glob is held back here. An entry matched on its GHSA ID alone would
    // pick up glob's blockers for the wrong package, which LOCK cannot show
    // because nothing in it depends on glob.
    const lock: LockPackages = {
      'node_modules/holder': { version: '1.0.0', dependencies: { glob: '^10.0.0' } },
      'node_modules/glob': { version: '10.4.0' },
    };
    const other = { ...ADVISORIES[0], package: 'glob' };

    expect(findBlockers(other, FIXED_IN, lock)).toEqual(['holder@1.0.0']);
    expect(resolveAutoExtensions([autoExtending], lock, [other])[0]?.[BLOCKERS]).toEqual([]);
  });
});
