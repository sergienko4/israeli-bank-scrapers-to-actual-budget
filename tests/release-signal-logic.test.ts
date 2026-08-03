import { describe, expect, it } from 'vitest';

import {
  evaluateReleaseSignal,
  findShippedBaseImageChanges,
  findShippedDependencyChanges,
  formatReleaseSignalReport,
  isReleaseTriggering,
  parseBaseImages,
  parseCommitHeader,
  RELEASE_TRIGGERING_TYPES,
  SHIPPED_MANIFEST_FIELDS,
} from '../scripts/release-signal-logic.mjs';

const SCRAPER = '@sergienko4/israeli-bank-scrapers';
const NODE_24 = 'node:24-slim@sha256:aaaa';
const NODE_26 = 'node:26-slim@sha256:bbbb';

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
      'No shipped dependency or base-image changes',
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

describe('parseBaseImages', () => {
  it('reads the base image of a single-stage Dockerfile', () => {
    expect(parseBaseImages(`# comment\nFROM ${NODE_24}\nRUN echo hi\n`)).toEqual([NODE_24]);
  });

  it('reads every stage of a multi-stage Dockerfile in build order', () => {
    const dockerfile = `FROM ${NODE_24} AS builder\nFROM ${NODE_26}\n`;
    expect(parseBaseImages(dockerfile)).toEqual([NODE_24, NODE_26]);
  });

  it('ignores a FROM appearing inside a comment or mid-line', () => {
    expect(parseBaseImages(`# FROM node:1-slim\nRUN echo FROM node:2-slim\n`)).toEqual([]);
  });

  it('returns an empty list when there is no Dockerfile', () => {
    expect(parseBaseImages(undefined)).toEqual([]);
  });

  it('skips a --platform flag and captures the image behind it', () => {
    expect(parseBaseImages(`FROM --platform=$BUILDPLATFORM ${NODE_26}\n`)).toEqual([NODE_26]);
  });

  it('skips several flags before the image', () => {
    const dockerfile = `FROM --platform=linux/amd64 --foo=bar ${NODE_26} AS builder\n`;
    expect(parseBaseImages(dockerfile)).toEqual([NODE_26]);
  });

  it('ignores a FROM that declares a flag but no image', () => {
    expect(parseBaseImages('FROM --platform=$BUILDPLATFORM\n')).toEqual([]);
  });
});

describe('findShippedBaseImageChanges', () => {
  it('reports a base-image bump', () => {
    const changes = findShippedBaseImageChanges(`FROM ${NODE_24}\n`, `FROM ${NODE_26}\n`);
    expect(changes).toEqual([
      { field: 'Dockerfile', name: 'FROM', from: NODE_24, to: NODE_26 },
    ]);
  });

  it('reports nothing when the base image is unchanged', () => {
    expect(findShippedBaseImageChanges(`FROM ${NODE_24}\n`, `FROM ${NODE_24}\nRUN echo hi\n`)).toEqual([]);
  });

  it('names the stage that moved in a multi-stage build', () => {
    const before = `FROM ${NODE_24} AS builder\nFROM ${NODE_24}\n`;
    const after = `FROM ${NODE_24} AS builder\nFROM ${NODE_26}\n`;
    expect(findShippedBaseImageChanges(before, after)).toEqual([
      { field: 'Dockerfile', name: 'FROM[1]', from: NODE_24, to: NODE_26 },
    ]);
  });

  it('treats an added Dockerfile as a shipped change', () => {
    expect(findShippedBaseImageChanges('', `FROM ${NODE_26}\n`)).toEqual([
      { field: 'Dockerfile', name: 'FROM', from: undefined, to: NODE_26 },
    ]);
  });

  it('still sees a bump when the image sits behind a --platform flag', () => {
    const before = `FROM --platform=$BUILDPLATFORM ${NODE_24}\n`;
    const after = `FROM --platform=$BUILDPLATFORM ${NODE_26}\n`;
    expect(findShippedBaseImageChanges(before, after)).toEqual([
      { field: 'Dockerfile', name: 'FROM', from: NODE_24, to: NODE_26 },
    ]);
  });
});

describe('evaluateReleaseSignal — base image', () => {
  it('rejects a base-image bump under a non-release title', () => {
    const verdict = evaluateReleaseSignal({
      title: 'chore(docker): bump base image',
      baseDockerfile: `FROM ${NODE_24}\n`,
      headDockerfile: `FROM ${NODE_26}\n`,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.shippedChanges).toHaveLength(1);
  });

  it('accepts a base-image bump under a release title', () => {
    const verdict = evaluateReleaseSignal({
      title: 'fix(docker): bump base image to node 26',
      baseDockerfile: `FROM ${NODE_24}\n`,
      headDockerfile: `FROM ${NODE_26}\n`,
    });
    expect(verdict.ok).toBe(true);
  });

  it('passes a Dockerfile edit that leaves the base image alone', () => {
    const verdict = evaluateReleaseSignal({
      title: 'chore(docker): tidy layers',
      baseDockerfile: `FROM ${NODE_24}\nRUN echo a\n`,
      headDockerfile: `FROM ${NODE_24}\nRUN echo b\n`,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.shippedChanges).toEqual([]);
  });

  it('lists manifest and base-image changes together', () => {
    const verdict = evaluateReleaseSignal({
      title: 'chore(deps): bump everything',
      basePackage: { dependencies: { [SCRAPER]: '^8.6.1' } },
      headPackage: { dependencies: { [SCRAPER]: '^8.7.0' } },
      baseDockerfile: `FROM ${NODE_24}\n`,
      headDockerfile: `FROM ${NODE_26}\n`,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.shippedChanges.map((change) => change.field)).toEqual([
      'dependencies',
      'Dockerfile',
    ]);
  });
});
