import { describe, expect, it } from 'vitest';

import {
  evaluateReleaseSignal,
  findShippedDependencyChanges,
  formatReleaseSignalReport,
  isReleaseTriggering,
  parseCommitHeader,
  RELEASE_TRIGGERING_TYPES,
  SHIPPED_MANIFEST_FIELDS,
} from '../scripts/release-signal-logic.mjs';

const SCRAPER = '@sergienko4/israeli-bank-scrapers';

describe('parseCommitHeader', () => {
  it('parses a scoped type', () => {
    expect(parseCommitHeader('fix(deps): bump x')).toEqual({
      type: 'fix',
      scope: 'deps',
      breaking: false,
    });
  });

  it('parses an unscoped type', () => {
    expect(parseCommitHeader('feat: add portal login')).toEqual({
      type: 'feat',
      scope: undefined,
      breaking: false,
    });
  });

  it('flags a breaking-change marker', () => {
    expect(parseCommitHeader('refactor!: drop node 20')?.breaking).toBe(true);
  });

  it('rejects the doubled scope Dependabot used to emit', () => {
    // `chore(deps)(deps):` is unparseable, so release-please dropped it
    // entirely — the exact failure this guard exists to catch.
    expect(parseCommitHeader('chore(deps)(deps): bump vite')).toBeUndefined();
  });

  it('rejects a non-conventional title', () => {
    expect(parseCommitHeader('bump the scraper')).toBeUndefined();
    expect(parseCommitHeader('fix:')).toBeUndefined();
    expect(parseCommitHeader('')).toBeUndefined();
    expect(parseCommitHeader(undefined)).toBeUndefined();
  });
});

describe('isReleaseTriggering', () => {
  it.each(RELEASE_TRIGGERING_TYPES)('treats %s as release-triggering', (type) => {
    expect(isReleaseTriggering(`${type}(deps): bump ${SCRAPER}`)).toBe(true);
  });

  it.each(['chore', 'docs', 'ci', 'test', 'build', 'style'])(
    'treats %s as non-triggering',
    (type) => {
      expect(isReleaseTriggering(`${type}(deps): bump ${SCRAPER}`)).toBe(false);
    },
  );

  it('treats any breaking change as release-triggering', () => {
    expect(isReleaseTriggering('chore(deps)!: drop node 20')).toBe(true);
  });
});

describe('findShippedDependencyChanges', () => {
  it('detects a production dependency bump', () => {
    const changes = findShippedDependencyChanges(
      { dependencies: { [SCRAPER]: '^8.6.1' } },
      { dependencies: { [SCRAPER]: '^8.7.0' } },
    );
    expect(changes).toEqual([
      { field: 'dependencies', name: SCRAPER, from: '^8.6.1', to: '^8.7.0' },
    ]);
  });

  it('detects an added and a removed production dependency', () => {
    const changes = findShippedDependencyChanges(
      { dependencies: { gone: '^1.0.0' } },
      { dependencies: { fresh: '^2.0.0' } },
    );
    expect(changes).toEqual([
      { field: 'dependencies', name: 'fresh', from: undefined, to: '^2.0.0' },
      { field: 'dependencies', name: 'gone', from: '^1.0.0', to: undefined },
    ]);
  });

  it('detects an overrides change, which pins shipped transitive versions', () => {
    const changes = findShippedDependencyChanges(
      { overrides: { 'brace-expansion': '^5.0.7' } },
      { overrides: { 'brace-expansion': '^5.0.9' } },
    );
    expect(changes).toEqual([
      { field: 'overrides', name: 'brace-expansion', from: '^5.0.7', to: '^5.0.9' },
    ]);
  });

  it('ignores devDependencies, which never reach the image', () => {
    const changes = findShippedDependencyChanges(
      { devDependencies: { vitest: '^4.0.0' } },
      { devDependencies: { vitest: '^4.1.0' } },
    );
    expect(changes).toEqual([]);
  });

  it('returns nothing when the manifests match', () => {
    const manifest = { dependencies: { [SCRAPER]: '^8.6.1' } };
    expect(findShippedDependencyChanges(manifest, structuredClone(manifest))).toEqual([]);
  });

  it('tolerates manifests missing the shipped fields entirely', () => {
    expect(findShippedDependencyChanges({}, {})).toEqual([]);
    expect(findShippedDependencyChanges(undefined, undefined)).toEqual([]);
  });

  it('watches exactly the fields that ship', () => {
    expect(SHIPPED_MANIFEST_FIELDS).toEqual(['dependencies', 'overrides']);
  });
});

describe('evaluateReleaseSignal', () => {
  const bumped = {
    basePackage: { dependencies: { [SCRAPER]: '^8.6.1' } },
    headPackage: { dependencies: { [SCRAPER]: '^8.7.0' } },
  };

  it('blocks a scraper bump titled chore', () => {
    const verdict = evaluateReleaseSignal({ ...bumped, title: 'chore(deps): bump scraper' });
    expect(verdict.ok).toBe(false);
    expect(verdict.releaseTriggering).toBe(false);
    expect(verdict.shippedChanges).toHaveLength(1);
  });

  it('allows the same bump titled fix', () => {
    const verdict = evaluateReleaseSignal({ ...bumped, title: 'fix(deps): bump scraper' });
    expect(verdict.ok).toBe(true);
    expect(verdict.releaseTriggering).toBe(true);
  });

  it('allows a dev-only bump titled chore', () => {
    const verdict = evaluateReleaseSignal({
      title: 'chore(deps-dev): bump vitest',
      basePackage: { devDependencies: { vitest: '^4.0.0' } },
      headPackage: { devDependencies: { vitest: '^4.1.0' } },
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.shippedChanges).toEqual([]);
  });

  it('allows a docs-only pull request', () => {
    const verdict = evaluateReleaseSignal({ title: 'docs: clarify setup' });
    expect(verdict.ok).toBe(true);
  });
});

describe('formatReleaseSignalReport', () => {
  it('explains how to unblock a failing pull request', () => {
    const verdict = evaluateReleaseSignal({
      title: 'chore(deps): bump scraper',
      basePackage: { dependencies: { [SCRAPER]: '^8.6.1' } },
      headPackage: { dependencies: { [SCRAPER]: '^8.7.0' } },
    });
    const report = formatReleaseSignalReport(verdict, 'chore(deps): bump scraper');
    expect(report).toContain('would merge without cutting a release');
    expect(report).toContain(`dependencies.${SCRAPER}: ^8.6.1 → ^8.7.0`);
    expect(report).toContain('fix, perf, refactor');
  });

  it('reports a clean pull request', () => {
    const verdict = evaluateReleaseSignal({ title: 'docs: tidy' });
    expect(formatReleaseSignalReport(verdict, 'docs: tidy')).toContain(
      'No shipped dependency changes',
    );
  });

  it('reports a correctly signalled bump', () => {
    const verdict = evaluateReleaseSignal({
      title: 'fix(deps): bump scraper',
      basePackage: { dependencies: { [SCRAPER]: '^8.6.1' } },
      headPackage: { dependencies: { [SCRAPER]: '^8.7.0' } },
    });
    expect(formatReleaseSignalReport(verdict, 'fix(deps): bump scraper')).toContain(
      'carries a release signal',
    );
  });
});
