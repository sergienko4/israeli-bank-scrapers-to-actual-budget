import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCKERS,
  type IAutoExtend,
  type LockPackages,
  resolveAutoExtensions,
} from '../config/audit-blockers.mjs';
import {
  ACCEPTED_ADVISORIES,
  auditWarnings,
  classifyAdvisories,
  classifyCommittedAudit,
  expiringSoon,
  EXPIRY_WARNING_DAYS,
  type IRawAcceptedAdvisory,
  unusedEntries,
} from '../config/audit-policy.mjs';
import { readLockPackages } from '../config/audit-report.mjs';
import { autoExtendingEntries, pastExpiryMs } from './helpers/autoExtendClock.js';

/** The repository root, so the committed lockfile is read whatever the cwd. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Anchors every fixture date to one UTC instant.
 *
 * Each call used to read the clock independently, so a run that crossed UTC
 * midnight between two calls in the same fixture produced a window one day
 * wider than intended -- enough to push a 30-day case over the cap and fail a
 * valid test. Capturing the instant once removes that race.
 */
const CLOCK_ANCHOR = new Date();

/**
 * Builds an ISO date string offset from today, so the fixtures below never
 * rot: an entry that is "valid for another week" stays valid tomorrow.
 *
 * @param days Offset in whole days from today, negative for the past.
 * @returns The date as `YYYY-MM-DD`, matching the format entries use.
 */
function isoDaysFromToday(days: number): string {
  const date = new Date(CLOCK_ANCHOR.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const advisory = {
  ghsa: 'GHSA-test-0000-0000',
  package: 'demo-pkg',
  severity: 'high',
  title: 'Demo advisory',
};

const inProductionTree = new Set(['demo-pkg']);
const notInProductionTree = new Set<string>();

/**
 * How each shipped acceptance reaches the published image, tracked here
 * independently of the waiver entries.
 *
 * This deliberately does not read `entry.productionReachable`. A waiver that
 * dropped that flag would then be graded against the weaker development bar
 * and keep passing, leaving the production evidence path untested. Holding the
 * expectation outside the data under test means removing the flag fails.
 *
 * Lookups fail closed: a shipped package missing from this map is a test
 * failure rather than a silent downgrade to development rules. Treating an
 * unlisted package as development-only meant a new production waiver could be
 * added without `productionReachable`, `noUpstreamFix`, `upstream`, or `added`
 * and still pass, because nothing forced the fixture to be updated with it.
 */
const PACKAGE_TREE: Readonly<Record<string, 'production' | 'development' | undefined>> = {
  minimatch: 'development',
};

/**
 * Resolves which tree a shipped package sits in, failing if it is unclassified.
 *
 * @param packageName Package named by an entry in `ACCEPTED_ADVISORIES`.
 * @returns The tree the package belongs to.
 */
function treeFor(packageName: string): 'production' | 'development' {
  const tree = PACKAGE_TREE[packageName];
  expect(
    tree,
    `${packageName} is not classified in PACKAGE_TREE; add it as 'production' or 'development' so it is graded against the right bar`,
  ).toBeDefined();
  return tree as 'production' | 'development';
}

describe('classifyAdvisories, development-tree advisories', () => {
  it('accepts an unexpired entry for a package outside the production tree', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: isoDaysFromToday(7),
        reason: 'Dev-only tooling; upstream fix pending.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(violations).toEqual([]);
    expect(accepted).toHaveLength(1);
  });

  it('blocks an entry whose expiry has passed', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: isoDaysFromToday(-1),
        reason: 'Dev-only tooling; upstream fix pending.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('expired');
  });

  it('blocks an entry on its stated expiry date, not the day after', () => {
    // The comparison is `expires <= today`, so the waiver is already spent on
    // the date it advertises. Only a past date was covered before, which left
    // `<=` free to weaken to `<`: the entry would then survive the whole of its
    // expiry day, and the date in `ACCEPTED_ADVISORIES` would mean something
    // other than what it says. Graded on the development path so the cap rules
    // cannot be what produces the block.
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: isoDaysFromToday(0),
        reason: 'Dev-only tooling; upstream fix pending.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('expired');
  });

  it('blocks an entry that omits the rationale entirely', () => {
    // Without this the waiver is honoured and check-audit.mjs reports
    // `undefined` as the reason, so the build passes with no stated grounds.
    const entries = [
      { ghsa: advisory.ghsa, package: advisory.package, expires: isoDaysFromToday(7) },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('rationale');
  });

  it('blocks an entry whose rationale is only whitespace', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: isoDaysFromToday(7),
        reason: '   ',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('rationale');
  });

  it('blocks an entry whose expiry is not a real calendar date', () => {
    // A date comparison done on strings ranks '9999-99-99' after today, so a
    // malformed value would read as "not expired yet" forever.
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: '9999-99-99',
        reason: 'Malformed expiry.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('invalid expires date');
  });

  it('blocks an entry whose expiry rolls over into another month', () => {
    // Date.parse quietly turns 2026-02-31 into 2026-03-03, silently granting
    // days nobody reviewed.
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: '2026-02-31',
        reason: 'Rolled-over expiry.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('invalid expires date');
  });

  it('blocks an entry that omits the expiry entirely', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        reason: 'No expiry supplied.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('invalid expires date');
  });
});

describe('classifyAdvisories, production-tree advisories without evidence', () => {
  it('blocks an advisory that has no entry at all', () => {
    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, []);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toBe('no accepted-advisory entry');
  });

  it('blocks a development-shaped entry, so the production wall still stands', () => {
    // This entry would be honoured for a dev-tree package. Reaching production
    // demands strictly more evidence than "someone wrote a reason".
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        expires: isoDaysFromToday(7),
        reason: 'Looks harmless to me.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations).toHaveLength(1);
  });

  it('blocks an entry that omits the upstream tracking link', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        added: isoDaysFromToday(-1),
        expires: isoDaysFromToday(29),
        productionReachable: true,
        noUpstreamFix: true,
        reason: 'No upstream link supplied.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations).toHaveLength(1);
  });

  it('blocks an entry that does not assert the absence of an upstream fix', () => {
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        added: isoDaysFromToday(-1),
        expires: isoDaysFromToday(29),
        productionReachable: true,
        upstream: 'https://github.com/example/repo/issues/1',
        reason: 'Author never confirmed a fix is unavailable.',
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations).toHaveLength(1);
  });
});

describe('classifyAdvisories, production-tree advisories with full evidence', () => {
  const fullEvidence = {
    ghsa: advisory.ghsa,
    package: advisory.package,
    productionReachable: true,
    noUpstreamFix: true,
    upstream: 'https://github.com/example/repo/issues/1',
    reason: 'Reachable during image build; no patched release exists.',
  };

  it('accepts a time-boxed acceptance that is still inside its window', () => {
    const entries = [
      { ...fullEvidence, added: isoDaysFromToday(-1), expires: isoDaysFromToday(29) },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(violations).toEqual([]);
    expect(accepted).toHaveLength(1);
  });

  it('blocks the same acceptance once its expiry has passed', () => {
    const entries = [
      { ...fullEvidence, added: isoDaysFromToday(-31), expires: isoDaysFromToday(-1) },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('expired');
  });

  it('blocks an acceptance whose window exceeds the 30-day cap', () => {
    // A long window is how a "temporary" waiver quietly becomes permanent.
    // Pinned at 31 days, the first window over the cap, so the boundary itself
    // is what fails. A far-over window such as 61 days only catches a change to
    // MAX_PRODUCTION_ACCEPTANCE_DAYS, because the assertion below reads the
    // constant back out of the message; it survives a boundary that slips by
    // one while the constant stays 30, which is exactly how a 31-day waiver
    // would become legal unnoticed.
    const entries = [
      { ...fullEvidence, added: isoDaysFromToday(-1), expires: isoDaysFromToday(30) },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('30 days');
  });

  it('blocks an acceptance dated in the future, which would widen the cap', () => {
    // The window is measured from `added`, so a start date next week keeps the
    // window 30 days wide while pushing the expiry past 30 days from today.
    const entries = [
      { ...fullEvidence, added: isoDaysFromToday(7), expires: isoDaysFromToday(37) },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations).toHaveLength(1);
  });

  it('blocks an acceptance whose upstream is not a usable link', () => {
    // A placeholder satisfies "non-empty" while giving a reviewer nothing to open.
    const entries = [
      {
        ...fullEvidence,
        upstream: 'pending',
        added: isoDaysFromToday(-1),
        expires: isoDaysFromToday(29),
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations).toHaveLength(1);
  });

  it('blocks a fully-evidenced acceptance that still omits the rationale', () => {
    // Evidence and a rationale are separate requirements: satisfying the
    // stricter production bar does not excuse leaving the grounds unstated.
    // Written out rather than spread from fullEvidence, which carries a reason.
    const entries = [
      {
        ghsa: advisory.ghsa,
        package: advisory.package,
        productionReachable: true,
        noUpstreamFix: true,
        upstream: 'https://github.com/example/repo/issues/1',
        added: isoDaysFromToday(-1),
        expires: isoDaysFromToday(29),
      },
    ];

    const { violations, accepted } = classifyAdvisories([advisory], inProductionTree, entries);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toContain('rationale');
  });
});

describe('classifyAdvisories, severity scope', () => {
  it('ignores an advisory below the enforced severity floor', () => {
    const low = { ...advisory, severity: 'low' };

    const { violations, accepted } = classifyAdvisories([low], inProductionTree, []);

    expect(violations).toEqual([]);
    expect(accepted).toEqual([]);
  });
});

describe('classifyAdvisories, policy-date consistency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('judges every advisory in one run against a single policy date', () => {
    // The clock used to be read once per advisory, so a run crossing UTC
    // midnight could accept one entry and reject an identical one as expired.
    // This clock advances a day between reads to force that split if it can
    // still occur; a single read makes the advance unobservable.
    const RealDate = Date;
    let reads = 0;

    class AdvancingDate extends RealDate {
      public constructor(value?: number) {
        if (value === undefined) {
          const offset = reads === 0 ? 0 : 1;
          reads += 1;
          super(RealDate.parse(`${isoDaysFromToday(offset)}T00:00:00Z`));
          return;
        }
        super(value);
      }
    }

    vi.stubGlobal('Date', AdvancingDate);

    const expires = isoDaysFromToday(1); // valid on day 0, expired on day 1
    const first = { ...advisory, ghsa: 'GHSA-aaaa-bbbb-cccc', package: 'dev-a' };
    const second = { ...advisory, ghsa: 'GHSA-dddd-eeee-ffff', package: 'dev-b' };
    const entries = [
      { ghsa: first.ghsa, package: first.package, expires, reason: 'Dev-only.' },
      { ghsa: second.ghsa, package: second.package, expires, reason: 'Dev-only.' },
    ];

    const { violations, accepted } = classifyAdvisories(
      [first, second],
      notInProductionTree,
      entries,
    );

    expect(violations).toEqual([]);
    expect(accepted).toHaveLength(2);
  });
});

/** First demo-pkg version that fixes the demo advisory. */
const DEMO_FIXED_IN = '2.0.0';

/** A committed tree in which `holder` pins demo-pkg below its fix. */
const DEMO_BLOCKING_LOCK: LockPackages = {
  '': { version: '1.0.0', dependencies: { holder: '^1.0.0' } },
  'node_modules/holder': { version: '1.0.0', dependencies: { 'demo-pkg': '^1.0.0' } },
  'node_modules/demo-pkg': { version: '1.4.0' },
};

/**
 * The same tree after `holder` widened its range to admit the fix.
 *
 * demo-pkg is still on the vulnerable version, so npm audit keeps reporting the
 * advisory, but nothing stops the fix from being installed any more.
 */
const DEMO_UNBLOCKED_LOCK: LockPackages = {
  '': { version: '1.0.0', dependencies: { holder: '^1.1.0' } },
  'node_modules/holder': { version: '1.1.0', dependencies: { 'demo-pkg': '^1.0.0 || ^2.0.0' } },
  'node_modules/demo-pkg': { version: '1.4.0' },
};

/** The demo advisory with the vulnerable range npm reports for it. */
const DEMO_ADVISORY = { ...advisory, range: '<2.0.0' };

/** A committed-tree audit that reports the demo advisory outside the production tree. */
const DEV_AUDIT = { advisories: [DEMO_ADVISORY], productionPackages: notInProductionTree };

/**
 * Builds a development-tree entry for the demo advisory that opts into auto-extension.
 *
 * @param expiresInDays Offset of the expiry from today, negative for the past.
 * @param autoExtend The opt-in under test; a usable one by default.
 * @returns The entry.
 */
function autoExtendingEntry(
  expiresInDays: number,
  autoExtend: IAutoExtend = { fixedIn: DEMO_FIXED_IN },
): IRawAcceptedAdvisory {
  return {
    ghsa: advisory.ghsa,
    package: advisory.package,
    expires: isoDaysFromToday(expiresInDays),
    reason: 'Dev-only; holder pins demo-pkg below its fix.',
    autoExtend,
  };
}

/**
 * Pins the clock the policy reads to the instant the fixtures are anchored to.
 *
 * The fixtures derive their dates from CLOCK_ANCHOR while the policy reads the
 * clock itself, so a run crossing UTC midnight could otherwise move a boundary
 * case, such as an entry that expires today, by one day.
 */
function freezeClockAtAnchor(): void {
  vi.useFakeTimers({ toFake: ['Date'], now: CLOCK_ANCHOR });
}

describe('classifyCommittedAudit, auto-extending development entries', () => {
  beforeEach(freezeClockAtAnchor);
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps an expired entry working while a locked package still blocks the fix', () => {
    const entry = autoExtendingEntry(-1);

    const { violations, accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [entry]);

    expect(violations).toEqual([]);
    expect(accepted).toStrictEqual([
      {
        ...DEMO_ADVISORY,
        expires: entry.expires,
        reason: entry.reason,
        fixedIn: DEMO_FIXED_IN,
        blockers: ['holder@1.0.0'],
        extended: true,
      },
    ]);
  });

  it('counts the expiry day itself as running on an extension', () => {
    // An entry stops working on its expiry date, so on that day it already
    // stands only because of the blocker, and the warning has to say so.
    const { accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [
      autoExtendingEntry(0),
    ]);

    expect(accepted[0]?.extended).toBe(true);
  });

  it('reports an unexpired entry as not yet extended', () => {
    const { accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [
      autoExtendingEntry(7),
    ]);

    expect(accepted[0]).toMatchObject({ extended: false, blockers: ['holder@1.0.0'] });
  });

  it('honours an unexpired entry even when nothing blocks the fix', () => {
    // Opting in only ever lengthens an entry's life; before its date it stands
    // like any other entry.
    const { violations, accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_UNBLOCKED_LOCK, [
      autoExtendingEntry(7),
    ]);

    expect(violations).toEqual([]);
    expect(accepted[0]).toMatchObject({ extended: false, blockers: [] });
  });

  it('expires the entry once no locked package blocks the fix', () => {
    const entry = autoExtendingEntry(-1);

    const { violations, accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_UNBLOCKED_LOCK, [entry]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toBe(
      `exception expired on ${entry.expires}; it auto-extends only while a locked package blocks demo-pkg ${DEMO_FIXED_IN}, and none does`,
    );
  });

  it('expires an entry that was never resolved against a lockfile', () => {
    // A caller that skips resolution has to lose the extension, not keep it.
    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, [
      autoExtendingEntry(-1),
    ]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toMatch(/^exception expired on /);
  });

  it.each([null, true, {}, { fixedIn: 'bogus' }, { fixedIn: '^2.0.0' }, { fixedIn: 2 }])(
    'rejects the unusable autoExtend %j even before the expiry',
    (shape) => {
      const entry = autoExtendingEntry(7, shape as unknown as IAutoExtend);

      const { violations, accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [
        entry,
      ]);

      expect(accepted).toEqual([]);
      expect(violations[0]?.why).toBe('exception has an invalid autoExtend.fixedIn version');
    },
  );

  it('rejects an explicit undefined autoExtend instead of reading it as absent', () => {
    const entry = { ...autoExtendingEntry(7), autoExtend: undefined };

    const { violations, accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [entry]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toBe('exception has an invalid autoExtend.fixedIn version');
  });

  it('refuses an auto-extending entry for the production tree, whatever its evidence', () => {
    // Shipping a known vulnerability has to stay capped and dated, so the
    // production evidence that would otherwise carry this entry does not help.
    const entry = {
      ...autoExtendingEntry(7),
      productionReachable: true,
      noUpstreamFix: true,
      upstream: 'https://github.com/example/repo/issues/1',
      added: isoDaysFromToday(-1),
    };
    const audit = { advisories: [advisory], productionPackages: inProductionTree };

    const { violations, accepted } = classifyCommittedAudit(audit, DEMO_BLOCKING_LOCK, [entry]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toBe(
      'reaches the production tree; an auto-extending exception is development-only',
    );
  });

  it('ignores a blockers list written into the policy data', () => {
    // Only resolution may record blockers. A plain field is something anyone
    // editing the policy file could type, so it must not extend anything.
    const forged = { ...autoExtendingEntry(-1), blockers: ['holder@1.0.0'] };

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, [forged]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toMatch(/^exception expired on /);
  });

  it('does not extend an ordinary entry that carries resolved blockers', () => {
    // Blockers alone extend nothing; the entry must also opt in.
    const entry = {
      ghsa: advisory.ghsa,
      package: advisory.package,
      expires: isoDaysFromToday(-1),
      reason: 'Dev-only.',
      [BLOCKERS]: ['holder@1.0.0'],
    };

    const { violations, accepted } = classifyAdvisories([advisory], notInProductionTree, [entry]);

    expect(accepted).toEqual([]);
    expect(violations[0]?.why).toBe(`exception expired on ${entry.expires}`);
  });

  it('keeps the exact record shape for an ordinary accepted entry', () => {
    // Existing readers of `accepted` must see no new fields, not even
    // undefined ones, for an entry that never opted in.
    const entry = {
      ghsa: advisory.ghsa,
      package: advisory.package,
      expires: isoDaysFromToday(7),
      reason: 'Dev-only.',
    };

    const { accepted } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [entry]);

    expect(accepted).toStrictEqual([{ ...DEMO_ADVISORY, expires: entry.expires, reason: entry.reason }]);
  });

  it('returns the resolved entries and leaves the policy data untouched', () => {
    const optedIn = autoExtendingEntry(7);
    const ordinary = {
      ghsa: 'GHSA-aaaa-bbbb-cccc',
      package: advisory.package,
      expires: isoDaysFromToday(7),
      reason: 'Dev-only.',
    };

    const { resolvedEntries } = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [
      optedIn,
      ordinary,
    ]);

    expect(resolvedEntries[0]?.[BLOCKERS]).toEqual(['holder@1.0.0']);
    expect(resolvedEntries[1]?.[BLOCKERS]).toBeUndefined();
    // ACCEPTED_ADVISORIES is module state, so resolution writing into it would
    // carry one run's blockers into the next.
    expect(Object.getOwnPropertySymbols(optedIn)).toEqual([]);
  });
});

describe('expiringSoon, the pre-expiry warning', () => {
  beforeEach(freezeClockAtAnchor);
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Builds an ordinary entry that expires a given number of days from today.
   *
   * @param days Offset of the expiry from today, negative for the past.
   * @returns The entry.
   */
  function expiringIn(days: number): IRawAcceptedAdvisory {
    return {
      ghsa: advisory.ghsa,
      package: advisory.package,
      expires: isoDaysFromToday(days),
      reason: 'Dev-only.',
    };
  }

  it('warns about an entry inside the window, through its last day', () => {
    const entries = [expiringIn(5), expiringIn(EXPIRY_WARNING_DAYS)];

    expect(expiringSoon(entries)).toEqual(entries);
  });

  it('stays quiet beyond the window, on the expiry day, and after it', () => {
    // From its expiry day on, the gate already rejects the entry, so a warning
    // would only repeat the failure.
    const entries = [expiringIn(EXPIRY_WARNING_DAYS + 1), expiringIn(0), expiringIn(-3)];

    expect(expiringSoon(entries)).toEqual([]);
  });

  it('skips an auto-extending entry whose fix is still blocked', () => {
    // It will not lapse on its date; once past it, it reports as extended.
    const resolved = resolveAutoExtensions([autoExtendingEntry(5)], DEMO_BLOCKING_LOCK, DEV_AUDIT.advisories);

    expect(expiringSoon(resolved)).toEqual([]);
  });

  it('warns about an auto-extending entry that nothing blocks', () => {
    const resolved = resolveAutoExtensions([autoExtendingEntry(5)], DEMO_UNBLOCKED_LOCK, DEV_AUDIT.advisories);

    expect(expiringSoon(resolved)).toEqual(resolved);
  });

  it('skips an entry whose expiry is not a valid date', () => {
    // The gate rejects such an entry outright, so there is nothing to warn about.
    const entries = [
      { ...expiringIn(5), expires: '2026-02-31' },
      { ghsa: advisory.ghsa, package: advisory.package, reason: 'Dev-only.' },
    ];

    expect(expiringSoon(entries)).toEqual([]);
  });

  it('honours a narrower window', () => {
    const entry = expiringIn(5);

    expect(expiringSoon([entry], 4)).toEqual([]);
    expect(expiringSoon([entry], 5)).toEqual([entry]);
  });
});

describe('unusedEntries, acceptances npm audit no longer needs', () => {
  const kept = { ghsa: 'GHSA-aaaa-bbbb-cccc', package: 'dev-a' };
  const stale = { ghsa: 'GHSA-dddd-eeee-ffff', package: 'dev-b' };

  it('flags an entry whose advisory npm audit no longer reports', () => {
    const advisories = [{ ...advisory, ...kept }];

    expect(unusedEntries([kept, stale], advisories)).toEqual([stale]);
  });

  it('counts an advisory below the severity floor as still in use', () => {
    // npm audit still reports the advisory, so the entry names a live one even
    // though the gate ignores that severity today.
    const advisories = [{ ...advisory, ...kept, severity: 'low' }];

    expect(unusedEntries([kept], advisories)).toEqual([]);
  });

  it('needs both the GHSA id and the package to match', () => {
    const advisories = [
      { ...advisory, ghsa: kept.ghsa, package: 'other-pkg' },
      { ...advisory, ghsa: 'GHSA-zzzz-zzzz-zzzz', package: kept.package },
    ];

    expect(unusedEntries([kept], advisories)).toEqual([kept]);
  });
});

describe('auditWarnings, non-blocking annotations for the gate', () => {
  beforeEach(freezeClockAtAnchor);
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A second reported development advisory, for the ordering case. */
  const soonAdvisory = { ...advisory, ghsa: 'GHSA-soon-0000-0000', package: 'soon-pkg' };

  /**
   * Builds an ordinary development-tree entry for an advisory.
   *
   * @param target The advisory the entry covers.
   * @param expiresInDays Offset of the expiry from today.
   * @returns The entry.
   */
  function plainEntry(target: { ghsa: string; package: string }, expiresInDays: number): IRawAcceptedAdvisory {
    return { ghsa: target.ghsa, package: target.package, expires: isoDaysFromToday(expiresInDays), reason: 'Dev-only.' };
  }

  it('stays quiet for an acceptance in use and outside the warning window', () => {
    const classification = classifyCommittedAudit(DEV_AUDIT, {}, [plainEntry(advisory, EXPIRY_WARNING_DAYS + 1)]);

    expect(classification.accepted).toHaveLength(1);
    expect(auditWarnings(classification, DEV_AUDIT.advisories)).toEqual([]);
  });

  it('names the blockers of an acceptance running past its expiry', () => {
    const entry = autoExtendingEntry(-1);
    const classification = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [entry]);

    expect(auditWarnings(classification, DEV_AUDIT.advisories)).toEqual([
      `::warning::${advisory.ghsa} (demo-pkg) acceptance expired on ${entry.expires}; `
        + 'auto-extended while holder@1.0.0 cannot take demo-pkg 2.0.0.',
    ]);
  });

  it('warns about an acceptance inside the expiry window', () => {
    const entry = plainEntry(advisory, 5);
    const classification = classifyCommittedAudit(DEV_AUDIT, {}, [entry]);

    expect(auditWarnings(classification, DEV_AUDIT.advisories)).toEqual([
      `::warning::${advisory.ghsa} (demo-pkg) acceptance expires on ${entry.expires}; `
        + 'fix the advisory, or renew or remove the entry, before then.',
    ]);
  });

  // A still-blocked entry will extend rather than lapse, so warning before its
  // expiry would only ask for a renewal the policy no longer needs.
  it('stays quiet inside the expiry window while the fix is still blocked', () => {
    const classification = classifyCommittedAudit(DEV_AUDIT, DEMO_BLOCKING_LOCK, [autoExtendingEntry(5)]);

    expect(classification.accepted).toHaveLength(1);
    expect(auditWarnings(classification, DEV_AUDIT.advisories)).toEqual([]);
  });

  it('asks for the removal of an entry npm audit no longer reports', () => {
    const cleanAudit = { advisories: [], productionPackages: notInProductionTree };
    const classification = classifyCommittedAudit(cleanAudit, {}, [plainEntry(advisory, EXPIRY_WARNING_DAYS + 1)]);

    expect(auditWarnings(classification, cleanAudit.advisories)).toEqual([
      `::warning::${advisory.ghsa} (demo-pkg) is no longer reported by npm audit; `
        + 'remove its entry from config/audit-policy.mjs.',
    ]);
  });

  it('lists extended, then expiring, then unused, whatever the entry order', () => {
    const unused = plainEntry({ ghsa: 'GHSA-gone-0000-0000', package: 'gone-pkg' }, EXPIRY_WARNING_DAYS + 1);
    const audit = { advisories: [DEMO_ADVISORY, soonAdvisory], productionPackages: notInProductionTree };
    const classification = classifyCommittedAudit(audit, DEMO_BLOCKING_LOCK, [
      unused,
      plainEntry(soonAdvisory, 5),
      autoExtendingEntry(-1),
    ]);

    const warnings = auditWarnings(classification, audit.advisories);

    expect(warnings.map(line => line.split(' ')[0])).toEqual([
      `::warning::${advisory.ghsa}`,
      `::warning::${soonAdvisory.ghsa}`,
      '::warning::GHSA-gone-0000-0000',
    ]);
  });
});

describe('classifyCommittedAudit, the entries that actually ship', () => {
  // Every other case supplies synthetic entries, which proves the rules but
  // never the data. These load ACCEPTED_ADVISORIES itself and classify it the
  // way `npm run audit` does: against the committed lockfile.
  //
  // The lockfile matters once an auto-extending entry is past its expiry: it
  // then survives only while a locked package still blocks the fix. When the
  // last blocker goes, these tests fail and force the entry's removal.
  const shippedLock = readLockPackages(REPO_ROOT);

  /**
   * npm's vulnerable range for each auto-extending acceptance, as `npm audit` reports it.
   *
   * Pinned beside the opt-in list below and updated with it. A range wider
   * than npm's would count blockers the gate never sees.
   */
  const REPORTED_RANGES: Readonly<Record<string, string>> = { minimatch: '>=7.0.0 <11.0.1' };

  it('gives every shipped entry a well-formed identity and rationale', () => {
    for (const entry of ACCEPTED_ADVISORIES) {
      // Checked against a fixed shape rather than against the entry itself.
      // The acceptance case below derives its fixture from the entry, so a
      // typo there would be mirrored into the advisory and agree with itself;
      // only an independent expectation can catch a malformed identity.
      expect(entry.ghsa, `${entry.package} needs a well-formed GHSA id`).toMatch(
        /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/,
      );
      expect(entry.package.trim(), 'package must be named').not.toBe('');
      expect(entry.reason.trim(), `${entry.package} must carry a rationale`).not.toBe('');

      // Guards the production evidence path against silent downgrade. Without
      // this, deleting `productionReachable: true` would reclassify the entry
      // as development-only and every remaining assertion would still pass.
      // `treeFor` fails on an unclassified package rather than defaulting it
      // to development, so a new production waiver cannot skip this check by
      // being absent from the fixture.
      if (treeFor(entry.package) === 'production') {
        expect(
          entry.productionReachable,
          `${entry.package} reaches the published image, so its entry must say so`,
        ).toBe(true);
      }
    }
  });

  it('accepts each shipped entry against the live policy', () => {
    for (const entry of ACCEPTED_ADVISORIES) {
      const live = {
        ghsa: entry.ghsa,
        package: entry.package,
        severity: 'high',
        title: `Shipped acceptance for ${entry.package}`,
      };

      // The tree comes from the fixture above, never from the entry under
      // test. Deriving it from `entry.productionReachable` meant a waiver that
      // lost that flag was graded against the weaker development bar and still
      // passed. `treeFor` fails on an unclassified package, so adding a
      // production waiver without listing it here is a test failure rather
      // than a silent downgrade to the development rules.
      const productionPackages =
        treeFor(entry.package) === 'production' ? new Set([entry.package]) : new Set<string>();

      // No third argument, so the default ACCEPTED_ADVISORIES path is
      // exercised, against the committed lockfile and today's date.
      const { violations, accepted } = classifyCommittedAudit({ advisories: [live], productionPackages }, shippedLock);

      expect(violations, `${entry.package} must not block the build`).toEqual([]);
      expect(accepted).toHaveLength(1);
    }
  });

  it('honours the minimatch acceptance only while minimatch stays out of the production tree', () => {
    // The entry is a development-tree deferral because the glob override fixes
    // the production copy. If minimatch ever returns to the published image,
    // the gate has to stop honouring the entry instead of shipping the advisory.
    const live = {
      ghsa: 'GHSA-g3hv-75wg-m249',
      package: 'minimatch',
      severity: 'moderate',
      title: 'Shipped acceptance for minimatch',
    };

    const development = classifyCommittedAudit({ advisories: [live], productionPackages: notInProductionTree }, shippedLock);
    expect(development.violations).toEqual([]);
    expect(development.accepted).toHaveLength(1);

    const production = classifyCommittedAudit({ advisories: [live], productionPackages: new Set(['minimatch']) }, shippedLock);
    expect(production.accepted).toEqual([]);
    expect(production.violations).toHaveLength(1);
    expect(production.violations[0]?.why).toContain('reaches the production tree');
  });

  it('lets only the reviewed acceptances auto-extend', () => {
    // Auto-extension removes the expiry date's forcing function, so opting an
    // entry in is a reviewed decision. Adding one, or moving its fix version,
    // has to update this pin in the same change.
    const optedIn = ACCEPTED_ADVISORIES
      .filter(entry => Object.hasOwn(entry, 'autoExtend'))
      .map(entry => [entry.package, entry.autoExtend?.fixedIn]);

    expect(optedIn).toEqual([['minimatch', '11.0.1']]);
  });

  it('ships no entry with blockers already attached', () => {
    // Only resolveAutoExtensions may attach blockers, computed from the
    // lockfile. An entry shipped with its own would vouch for itself whenever
    // a caller classifies without resolving.
    for (const entry of ACCEPTED_ADVISORIES) {
      expect(Object.getOwnPropertySymbols(entry), `${entry.package} must not carry symbol keys`).toEqual([]);
    }
  });

  it('keeps each auto-extending entry past its expiry only while a locked package blocks the fix', () => {
    const extending = autoExtendingEntries();
    expect(extending, 'at least one shipped entry must auto-extend').not.toEqual([]);

    for (const entry of extending) {
      const { fixedIn } = entry.autoExtend;
      const audit = {
        advisories: [{
          ghsa: entry.ghsa,
          package: entry.package,
          severity: 'moderate',
          title: `Expired acceptance for ${entry.package}`,
          range: `<${fixedIn}`,
        }],
        productionPackages: notInProductionTree,
      };
      const holder: LockPackages = {
        [`node_modules/holds-${entry.package}`]: { version: '1.0.0', dependencies: { [entry.package]: `<${fixedIn}` } },
        // The copy the holder resolves to. A declared range alone blocks
        // nothing; the holder counts only while the copy it loads is below
        // the fix.
        [`node_modules/${entry.package}`]: { version: '0.0.0' },
      };

      vi.useFakeTimers({ toFake: ['Date'], now: pastExpiryMs(entry.expires) });
      try {
        const blocked = classifyCommittedAudit(audit, holder);
        expect(blocked.violations, `${entry.package} must extend while held`).toEqual([]);
        expect(blocked.accepted[0]?.extended).toBe(true);

        const unblocked = classifyCommittedAudit(audit, {});
        expect(unblocked.accepted, `${entry.package} must lapse once nothing holds it`).toEqual([]);
        expect(unblocked.violations[0]?.why).toContain('and none does');
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it('keeps each auto-extending entry alive past its expiry against the committed lockfile', () => {
    // The synthetic holder above proves the rule; this proves the data. It
    // runs the date the gate will face after the expiry, against the lockfile
    // that ships and the range npm reports. A failure means no locked package
    // blocks the fix any more, so the entry must be removed before the gate
    // starts failing builds.
    for (const entry of autoExtendingEntries()) {
      const range = REPORTED_RANGES[entry.package];
      expect(range, `pin npm's reported range for ${entry.package} in REPORTED_RANGES`).toBeDefined();
      const audit = {
        advisories: [{
          ghsa: entry.ghsa,
          package: entry.package,
          severity: 'moderate',
          title: `Shipped acceptance for ${entry.package}`,
          range,
        }],
        productionPackages: notInProductionTree,
      };

      vi.useFakeTimers({ toFake: ['Date'], now: pastExpiryMs(entry.expires) });
      try {
        const { violations, accepted } = classifyCommittedAudit(audit, shippedLock);
        expect(violations, `${entry.package} has no blocker left; remove its entry`).toEqual([]);
        expect(accepted[0]?.extended).toBe(true);
        expect(accepted[0]?.blockers).not.toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    }
  });
});
