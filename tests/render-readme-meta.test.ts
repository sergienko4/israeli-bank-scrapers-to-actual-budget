/**
 * Unit tests for scripts/render-readme-meta.mjs
 * Covers marker parsing, rendering, drift detection, and error cases.
 */

import { describe, it, expect } from 'vitest';
import { renderFile } from '../scripts/render-readme-meta.mjs';

const CONFIG = {
  version: 1,
  project: {
    name: 'israeli-bank-importer',
    owner: 'sergienko4',
    repo: 'israeli-bank-scrapers-to-actual-budget',
    license: 'MIT',
  },
  docker: { image: 'sergienko4/israeli-bank-importer', platforms_release: ['linux/amd64'] },
  badges: {
    pr_pipeline: 'https://example.com/pr.svg',
    release: 'https://example.com/release.svg',
    license_url: 'https://opensource.org/licenses/MIT',
    docker_pulls: 'https://example.com/docker.svg',
    node: 'https://example.com/node.svg',
    typescript: 'https://example.com/ts.svg',
    test_count_gist: 'https://example.com/tests.json',
    e2e_count_gist: 'https://example.com/e2e.json',
  },
  readme: {
    markers: ['badges', 'supported-banks', 'tech-stack', 'docker-image', 'dockerhub-tags'],
    banks: [
      { id: 'hapoalim', name: 'Bank Hapoalim', key: 'hapoalim', login: 'userCode, password' },
      { id: 'leumi', name: 'Bank Leumi', key: 'leumi', login: 'username, password' },
    ],
  },
  runtime: { node_engines: '>=22.0.0' },
};

const PKG = {
  name: 'israeli-bank-importer',
  version: '1.0.0',
  engines: { node: '>=22.0.0' },
  dependencies: { '@actual-app/api': '^25.0.0', '@sergienko4/israeli-bank-scrapers': '^8.3.0' },
  devDependencies: { typescript: '^6.0.3', vitest: '^4.1.7' },
};

describe('render-readme-meta', () => {
  it('returns input unchanged when there are no markers', () => {
    const input = '# Hello\nNo markers here.\n';
    const out = renderFile(input, ['badges'], CONFIG, PKG, 'test.md');
    expect(out).toBe(input);
  });

  it('renders supported-banks marker content between marker pair', () => {
    const input = '# Top\n<!-- meta:supported-banks:start -->\nOLD\n<!-- meta:supported-banks:end -->\n# Bottom\n';
    const out = renderFile(input, ['supported-banks'], CONFIG, PKG, 'test.md');
    expect(out).toContain('| 1 | Bank Hapoalim');
    expect(out).toContain('| 2 | Bank Leumi');
    expect(out).not.toContain('OLD');
    expect(out.startsWith('# Top\n')).toBe(true);
    expect(out.endsWith('# Bottom\n')).toBe(true);
  });

  it('is idempotent — second render produces identical bytes', () => {
    const input = '<!-- meta:badges:start -->\nOLD\n<!-- meta:badges:end -->\n';
    const first = renderFile(input, ['badges'], CONFIG, PKG, 'test.md');
    const second = renderFile(first, ['badges'], CONFIG, PKG, 'test.md');
    expect(second).toBe(first);
  });

  it('throws on unmatched :start marker', () => {
    const input = '<!-- meta:badges:start -->\nno close\n';
    expect(() => renderFile(input, ['badges'], CONFIG, PKG, 'bad.md')).toThrow(/unmatched :start/);
  });

  it('throws on unmatched :end marker', () => {
    const input = '<!-- meta:badges:end -->\n';
    expect(() => renderFile(input, ['badges'], CONFIG, PKG, 'bad.md')).toThrow(/unmatched :end/);
  });

  it('throws when marker name is not in the allow-list for the file', () => {
    const input = '<!-- meta:tech-stack:start -->\n<!-- meta:tech-stack:end -->\n';
    expect(() => renderFile(input, ['badges'], CONFIG, PKG, 'denied.md')).toThrow(/not in the allow-list/);
  });

  it('renders multiple non-overlapping markers in one file', () => {
    const input = [
      '<!-- meta:badges:start -->',
      'A',
      '<!-- meta:badges:end -->',
      '',
      '<!-- meta:tech-stack:start -->',
      'B',
      '<!-- meta:tech-stack:end -->',
    ].join('\n');
    const out = renderFile(input, ['badges', 'tech-stack'], CONFIG, PKG, 'test.md');
    expect(out).toContain('[![PR Pipeline]');
    expect(out).toContain('TypeScript');
    expect(out).not.toContain('\nA\n');
    expect(out).not.toContain('\nB\n');
  });

  it('throws on duplicate marker name in same file', () => {
    const input = [
      '<!-- meta:badges:start -->',
      '<!-- meta:badges:end -->',
      '<!-- meta:badges:start -->',
      '<!-- meta:badges:end -->',
    ].join('\n');
    expect(() => renderFile(input, ['badges'], CONFIG, PKG, 'dup.md')).toThrow(/duplicate marker/);
  });

  it('throws on nested :start markers (no overlapping ranges allowed)', () => {
    const input = [
      '<!-- meta:badges:start -->',
      'outer',
      '<!-- meta:tech-stack:start -->',
      'inner',
      '<!-- meta:tech-stack:end -->',
      '<!-- meta:badges:end -->',
    ].join('\n');
    expect(() => renderFile(input, ['badges', 'tech-stack'], CONFIG, PKG, 'nested.md')).toThrow(
      /nested :start marker/,
    );
  });
});
