import { describe, expect, it } from 'vitest';

import {
  AUTO_MERGE_ACTIONS,
  decide,
  MAJOR_UPDATE_TYPE,
  parseUpdatedDependencies,
  SAFE_UPDATE_TYPES_BY_ECOSYSTEM,
  SUPPORTED_ECOSYSTEMS,
  toGithubOutput,
} from '../scripts/dependabot-automerge-logic.mjs';

const PATCH = 'version-update:semver-patch';
const MINOR = 'version-update:semver-minor';
const SIGNED_OFF = 'Signed-off-by: dependabot[bot] <support@github.com>';
const ROTATED = 'allowScripts pins rotated; human review required';
const UNKNOWN_PIN = 'repinned state unknown; failing closed';
const NO_METADATA = 'no parseable updated-dependencies metadata';
const ALL_SAFE = 'every update is a patch, minor or digest refresh';

/**
 * Renders one `updated-dependencies` entry the way Dependabot writes it.
 *
 * @param name - Dependency name.
 * @param updateType - Update type; omitted from the entry when undefined.
 * @returns The entry lines joined with LF.
 */
const entry = (name: string, updateType?: string): string =>
  [
    `- dependency-name: ${name}`,
    '  dependency-version: 1.2.3',
    '  dependency-type: direct:production',
    ...(updateType === undefined ? [] : [`  update-type: ${updateType}`]),
  ].join('\n');

/**
 * Wraps metadata lines in a Dependabot commit message.
 *
 * @param lines - The lines that go inside the `updated-dependencies` block.
 * @returns A full commit message with one terminated metadata block.
 */
const message = (...lines: string[]): string =>
  ['Bumps things.', '', '---', 'updated-dependencies:', ...lines, '...', '', SIGNED_OFF].join('\n');

/**
 * Runs the policy for a PR whose allowScripts pins were not rotated.
 *
 * @param commitMessage - The first Dependabot-authored commit message.
 * @param ecosystem - Ecosystem from the branch prefix.
 * @returns The policy verdict.
 */
const verdictFor = (commitMessage: string, ecosystem = 'npm_and_yarn') =>
  decide({ commitMessage, repinned: false, ecosystem });

// Real commit message of PR #785 (grouped npm update holding one major).
const PR_785 = [
  'chore(deps): bump the dev-dependencies group with 4 updates',
  '',
  'Bumps the dev-dependencies group with 4 updates.',
  '',
  '---',
  'updated-dependencies:',
  '- dependency-name: "@vitest/coverage-v8"',
  '  dependency-version: 5.0.5',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-patch',
  '  dependency-group: dev-dependencies',
  '- dependency-name: eslint-plugin-jsdoc',
  '  dependency-version: 65.3.6',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-patch',
  '  dependency-group: dev-dependencies',
  '- dependency-name: eslint-plugin-unicorn',
  '  dependency-version: 78.0.0',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-major',
  '  dependency-group: dev-dependencies',
  '- dependency-name: vitest',
  '  dependency-version: 5.0.5',
  '  dependency-type: direct:development',
  '  update-type: version-update:semver-patch',
  '  dependency-group: dev-dependencies',
  '...',
  '',
  SIGNED_OFF,
].join('\n');

// Real commit message of PR #778 (single GitHub Actions patch).
const PR_778 = [
  'chore(ci): bump github/codeql-action from 4.38.2 to 4.38.3',
  '',
  'Bumps [github/codeql-action](https://github.com/github/codeql-action) from 4.38.2 to 4.38.3.',
  '',
  '---',
  'updated-dependencies:',
  '- dependency-name: github/codeql-action',
  '  dependency-version: 4.38.3',
  '  dependency-type: direct:production',
  '  update-type: version-update:semver-patch',
  '...',
  '',
  SIGNED_OFF,
].join('\n');

/**
 * Builds a Docker commit message with no `update-type`, as Dependabot emits
 * for both tag changes and same-tag digest refreshes.
 *
 * @param bumpLine - The `Bumps …` body line describing the change.
 * @returns A full Docker commit message for `node`.
 */
const dockerMessage = (bumpLine: string): string =>
  [
    'chore(docker): bump node',
    '',
    bumpLine,
    '',
    '---',
    'updated-dependencies:',
    '- dependency-name: node',
    '  dependency-version: 26-slim',
    '  dependency-type: direct:production',
    '...',
    '',
    SIGNED_OFF,
  ].join('\n');

// Real commit message shape of PR #339 (Docker major tag change, no update-type).
const PR_339 = dockerMessage('Bumps node from 22-slim to 26-slim.');

// Real same-tag Docker digest refresh body.
const DOCKER_DIGEST = dockerMessage('Bumps node from `ec7758e` to `193fe51`.');

describe('policy constants', () => {
  it('opts exactly npm, GitHub Actions and Docker into auto-merge', () => {
    expect(SUPPORTED_ECOSYSTEMS).toEqual(['npm_and_yarn', 'github_actions', 'docker']);
  });

  it('allows only Docker patches, but npm and Actions patches and minors', () => {
    expect(SAFE_UPDATE_TYPES_BY_ECOSYSTEM).toEqual({
      npm_and_yarn: [PATCH, MINOR],
      github_actions: [PATCH, MINOR],
      docker: [PATCH],
    });
    expect(Object.isFrozen(SAFE_UPDATE_TYPES_BY_ECOSYSTEM)).toBe(true);
  });

  it('exposes the three verdicts', () => {
    expect(AUTO_MERGE_ACTIONS).toEqual({ merge: 'merge', label: 'label', skip: 'skip' });
    expect(MAJOR_UPDATE_TYPE).toBe('version-update:semver-major');
  });
});

describe('parseUpdatedDependencies', () => {
  it('parses every field of a real grouped update and unquotes scoped names', () => {
    const entries = parseUpdatedDependencies(PR_785);
    expect(entries.map((parsed) => parsed.name)).toEqual([
      '@vitest/coverage-v8',
      'eslint-plugin-jsdoc',
      'eslint-plugin-unicorn',
      'vitest',
    ]);
    expect(entries[0]).toEqual({
      name: '@vitest/coverage-v8',
      version: '5.0.5',
      dependencyType: 'direct:development',
      updateType: PATCH,
      group: 'dev-dependencies',
    });
  });

  it('parses CRLF messages identically to LF ones', () => {
    expect(parseUpdatedDependencies(PR_778.replaceAll('\n', '\r\n'))).toEqual(parseUpdatedDependencies(PR_778));
  });

  it('ignores keys it does not know', () => {
    const parsed = parseUpdatedDependencies(message(entry('lodash', PATCH), '  future-field: anything'));
    expect(parsed).toEqual([
      { name: 'lodash', version: '1.2.3', dependencyType: 'direct:production', updateType: PATCH },
    ]);
  });

  it('returns nothing for a non-string message', () => {
    expect(parseUpdatedDependencies(undefined)).toEqual([]);
    expect(parseUpdatedDependencies()).toEqual([]);
  });

  it.each([
    ['no metadata block', 'Bumps lodash from 1.0.0 to 1.0.1.'],
    ['an unterminated block', message(entry('lodash', PATCH)).replace('\n...\n', '\n')],
    ['two blocks', `${message(entry('lodash', PATCH))}\n${message(entry('react', PATCH))}`],
    ['a malformed line', message(entry('lodash', PATCH), 'update-type: version-update:semver-major')],
    ['an over-indented line', message(entry('lodash', PATCH), '    update-type: version-update:semver-major')],
    ['a duplicated key', message(entry('lodash', PATCH), `  update-type: ${PATCH}`)],
    ['a continuation before the first entry', message('  dependency-name: lodash', entry('react', PATCH))],
    ['an entry without a name', message(entry('lodash', PATCH), '- dependency-version: 2.0.0')],
    ['a prototype-polluting key', message(entry('lodash', PATCH), '  __proto__: polluted')],
  ])('fails closed on %s', (_case, commitMessage) => {
    expect(parseUpdatedDependencies(commitMessage)).toEqual([]);
  });
});

describe('decide — preconditions', () => {
  it('skips when the allowScripts pins were rotated', () => {
    expect(decide({ commitMessage: PR_778, repinned: true, ecosystem: 'github_actions' })).toEqual({
      action: 'skip',
      reason: ROTATED,
      entries: [],
    });
  });

  it.each([
    ['an undefined repinned flag', { commitMessage: PR_778, ecosystem: 'github_actions' }],
    ['a null input', null],
    ['no input', undefined],
  ])('fails closed on %s', (_case, input) => {
    expect(decide(input)).toEqual({ action: 'skip', reason: UNKNOWN_PIN, entries: [] });
  });

  it.each([
    ['x', 'unsupported ecosystem: x'],
    ['pip', 'unsupported ecosystem: pip'],
    ['', 'unsupported ecosystem: (none)'],
    [undefined, 'unsupported ecosystem: (none)'],
  ])('skips the unsupported ecosystem %j', (ecosystem, reason) => {
    expect(decide({ commitMessage: PR_778, repinned: false, ecosystem })).toEqual({
      action: 'skip',
      reason,
      entries: [],
    });
  });

  it('skips when the metadata cannot be parsed', () => {
    expect(verdictFor('Bumps lodash from 1.0.0 to 1.0.1.')).toEqual({
      action: 'skip',
      reason: NO_METADATA,
      entries: [],
    });
  });
});

describe('decide — npm', () => {
  it.each([PATCH, MINOR])('merges a single %s', (updateType) => {
    expect(verdictFor(message(entry('lodash', updateType))).action).toBe('merge');
  });

  it('labels a single major', () => {
    expect(verdictFor(message(entry('react', MAJOR_UPDATE_TYPE)))).toMatchObject({
      action: 'label',
      reason: 'semver-major update: react',
    });
  });

  it('merges a group in which every update is safe', () => {
    const result = verdictFor(message(entry('lodash', PATCH), entry('pino', MINOR)));
    expect(result).toMatchObject({ action: 'merge', reason: ALL_SAFE });
    expect(result.entries.map((classified) => classified.classification)).toEqual(['safe', 'safe']);
  });

  it('labels the real PR #785 group because it holds a major', () => {
    const result = verdictFor(PR_785);
    expect(result).toMatchObject({ action: 'label', reason: 'semver-major update: eslint-plugin-unicorn' });
    expect(result.entries.map((classified) => classified.classification)).toEqual([
      'safe',
      'safe',
      'major',
      'safe',
    ]);
  });

  it('skips rather than labels when a major sits beside an unclassified update', () => {
    expect(verdictFor(message(entry('react', MAJOR_UPDATE_TYPE), entry('lodash')))).toMatchObject({
      action: 'skip',
      reason: 'unclassified update type: lodash',
    });
  });

  it('skips an update with no update-type, even beside a digest-looking line', () => {
    const commitMessage = message(entry('lodash')).replace('Bumps things.', 'Bumps lodash from `abc1234` to `def5678`.');
    expect(verdictFor(commitMessage)).toMatchObject({ action: 'skip', reason: 'unclassified update type: lodash' });
  });
});

describe('decide — GitHub Actions', () => {
  it('merges the real PR #778 patch', () => {
    expect(verdictFor(PR_778, 'github_actions')).toMatchObject({ action: 'merge', reason: ALL_SAFE });
  });

  it('merges a minor', () => {
    expect(verdictFor(message(entry('actions/checkout', MINOR)), 'github_actions').action).toBe('merge');
  });

  it('labels a major', () => {
    expect(verdictFor(message(entry('actions/checkout', MAJOR_UPDATE_TYPE)), 'github_actions').action).toBe('label');
  });
});

describe('decide — Docker', () => {
  it('merges a patch', () => {
    expect(verdictFor(message(entry('node', PATCH)), 'docker').action).toBe('merge');
  });

  it('labels a minor, which Docker may not merge on its own', () => {
    expect(verdictFor(message(entry('node', MINOR)), 'docker')).toMatchObject({
      action: 'label',
      reason: 'update type not auto-merged here: node',
    });
  });

  it('skips a minor that sits beside an unclassified update', () => {
    expect(verdictFor(message(entry('node', MINOR), entry('python')), 'docker')).toMatchObject({
      action: 'skip',
      reason: 'unclassified update type: python',
    });
  });

  it('merges a same-tag digest refresh', () => {
    const result = verdictFor(DOCKER_DIGEST, 'docker');
    expect(result).toMatchObject({ action: 'merge', reason: ALL_SAFE });
    expect(result.entries[0]?.classification).toBe('digest');
  });

  it('labels the real PR #339 tag change as a major, despite no update-type', () => {
    const result = verdictFor(PR_339, 'docker');
    expect(result).toMatchObject({ action: 'label', reason: 'semver-major update: node' });
    expect(result.entries[0]?.classification).toBe('major');
  });

  it('merges a patch-level tag change of the same variant', () => {
    const result = verdictFor(dockerMessage('Bumps node from 26.1.0-slim to 26.1.1-slim.'), 'docker');
    expect(result).toMatchObject({ action: 'merge', reason: ALL_SAFE });
    expect(result.entries[0]?.classification).toBe('safe');
  });

  it('labels a minor-level tag change, which Docker may not merge on its own', () => {
    expect(verdictFor(dockerMessage('Bumps node from 26.1-slim to 26.2-slim.'), 'docker')).toMatchObject({
      action: 'label',
      reason: 'update type not auto-merged here: node',
    });
  });

  it('reads the grouped "Updates `name`" bump line too', () => {
    const commitMessage = dockerMessage('Updates `node` from 22-slim to 26-slim');
    expect(verdictFor(commitMessage, 'docker')).toMatchObject({ action: 'label', reason: 'semver-major update: node' });
  });

  it.each([
    ['a variant change', 'Bumps node from 26-slim to 26-alpine.'],
    ['a precision change', 'Bumps node from 26-slim to 26.1-slim.'],
    ['a downgrade', 'Bumps node from 26-slim to 22-slim.'],
    ['an unchanged tag', 'Bumps node from 26-slim to 26-slim.'],
    ['named tags with no version order', 'Bumps node from lts-slim to latest.'],
    ['a tag change that names a different image', 'Bumps python from 22-slim to 26-slim.'],
    ['a digest on only one side', 'Bumps node from 26-slim to `193fe51`.'],
  ])('skips %s', (_case, bumpLine) => {
    expect(verdictFor(dockerMessage(bumpLine), 'docker')).toMatchObject({
      action: 'skip',
      reason: 'unclassified update type: node',
    });
  });

  it('skips a digest line that names a different image', () => {
    const commitMessage = dockerMessage('Bumps python from `ec7758e` to `193fe51`.');
    expect(verdictFor(commitMessage, 'docker').action).toBe('skip');
  });

  it('skips a digest-shaped update outside the Docker ecosystem', () => {
    expect(verdictFor(DOCKER_DIGEST, 'npm_and_yarn').action).toBe('skip');
  });
});

describe('toGithubOutput', () => {
  it('renders the action and reason as step outputs', () => {
    expect(toGithubOutput({ action: 'merge', reason: ALL_SAFE })).toBe(`action=merge\nreason=${ALL_SAFE}\n`);
  });

  it('collapses line breaks so a reason cannot inject another output', () => {
    expect(toGithubOutput({ action: 'skip', reason: 'a\r\nb\n\naction=merge' })).toBe(
      'action=skip\nreason=a b action=merge\n',
    );
  });
});
