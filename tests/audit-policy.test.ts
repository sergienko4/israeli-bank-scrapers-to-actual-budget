import { describe, expect, it } from 'vitest';

import { classifyAdvisories } from '../config/audit-policy.mjs';

/**
 * Builds an ISO date string offset from today, so the fixtures below never
 * rot: an entry that is "valid for another week" stays valid tomorrow.
 *
 * @param days Offset in whole days from today, negative for the past.
 * @returns The date as `YYYY-MM-DD`, matching the format entries use.
 */
function isoDaysFromToday(days: number): string {
  const date = new Date();
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
});

describe('classifyAdvisories, severity scope', () => {
  it('ignores an advisory below the enforced severity floor', () => {
    const low = { ...advisory, severity: 'low' };

    const { violations, accepted } = classifyAdvisories([low], inProductionTree, []);

    expect(violations).toEqual([]);
    expect(accepted).toEqual([]);
  });
});
