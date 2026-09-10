import { afterEach, describe, expect, it, vi } from 'vitest';

import { ACCEPTED_ADVISORIES, classifyAdvisories } from '../config/audit-policy.mjs';

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
 * Packages known to reach the published image, tracked here independently of
 * the waiver entries.
 *
 * This deliberately does not read `entry.productionReachable`. A waiver that
 * dropped that flag would then be graded against the weaker development bar
 * and keep passing, leaving the production evidence path untested. Holding the
 * expectation outside the data under test means removing the flag fails.
 */
const PRODUCTION_TREE_PACKAGES = new Set(['adm-zip']);

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
    const entries = [
      { ...fullEvidence, added: isoDaysFromToday(-1), expires: isoDaysFromToday(60) },
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

describe('classifyAdvisories, the entries that actually ship', () => {
  // Every other case supplies synthetic entries, which proves the rules but
  // never the data. These two load ACCEPTED_ADVISORIES itself.

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
      if (PRODUCTION_TREE_PACKAGES.has(entry.package)) {
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
      // passed. A package absent from the fixture is development-only, which
      // the classifier is deliberately designed to allow.
      const productionPackages = PRODUCTION_TREE_PACKAGES.has(entry.package)
        ? new Set([entry.package])
        : new Set<string>();

      // No third argument, so the default ACCEPTED_ADVISORIES path is exercised.
      const { violations, accepted } = classifyAdvisories([live], productionPackages);

      expect(violations, `${entry.package} must not block the build`).toEqual([]);
      expect(accepted).toHaveLength(1);
    }
  });
});
