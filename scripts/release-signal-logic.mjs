/**
 * Release-signal policy — pure, testable logic behind the CI guard that stops
 * a shipped dependency change from merging silently.
 *
 * Background: release-please only cuts a version bump, a tag and a Docker
 * image publish for release-triggering conventional-commit types. Dependabot
 * used to title every npm bump `chore(deps)(deps): …`, which is both hidden
 * from the changelog and unparseable (the doubled scope breaks the
 * conventional-commit grammar). A runtime bump therefore merged with no
 * release at all, and scraper updates had to be retitled by hand.
 *
 * `.github/dependabot.yml` now emits the correct prefixes, but configuration
 * alone is not a guarantee: a human PR, or a future config regression, can
 * still land a runtime bump under a non-triggering type. This module is the
 * enforcement half — it answers "does this PR change what users run, and if
 * so does its title actually produce a release?".
 */

/**
 * Conventional-commit types that make release-please cut a release.
 *
 * Mirrors `config/release-please/config.json`: `feat` bumps the minor,
 * `fix`/`perf`/`refactor` bump the patch. Every other type (`chore`, `docs`,
 * `ci`, `test`, `build`, `style`) is non-triggering.
 */
export const RELEASE_TRIGGERING_TYPES = Object.freeze([
  'feat',
  'fix',
  'perf',
  'refactor',
]);

/**
 * `package.json` fields whose contents are installed into the published
 * Docker image. `overrides` counts because it pins transitive runtime
 * versions — that is how security advisories are patched here.
 */
export const SHIPPED_MANIFEST_FIELDS = Object.freeze(['dependencies', 'overrides']);

/**
 * Matches every `FROM <image>` instruction in a Dockerfile.
 *
 * The base image is shipped just as literally as a runtime dependency — it
 * carries the Node runtime and every OS package users execute — so a bump to
 * it has to reach them through a release. Dependabot's `docker` ecosystem
 * edits this line and nothing in `package.json`, so the manifest fields above
 * cannot see the change at all.
 */
const FROM_PATTERN = /^[ \t]*FROM[ \t]+(?<image>\S+)/gim;

/**
 * Lists the base images a Dockerfile builds on, in build order.
 *
 * @param {string} [dockerfile] The Dockerfile contents.
 * @returns {string[]} One entry per `FROM` instruction; empty when there is no Dockerfile.
 */
export function parseBaseImages(dockerfile) {
  const matches = String(dockerfile ?? '').matchAll(FROM_PATTERN);
  return [...matches].map((match) => match.groups.image);
}

/**
 * Lists every base-image change that reaches the published image.
 *
 * Stages are compared positionally so a multi-stage Dockerfile reports which
 * stage moved rather than collapsing to a single yes/no.
 *
 * @param {string} [baseDockerfile] The Dockerfile on the base branch.
 * @param {string} [headDockerfile] The Dockerfile on the head branch.
 * @returns {Array<{ field: string, name: string, from: string | undefined, to: string | undefined }>} One entry per changed stage.
 */
export function findShippedBaseImageChanges(baseDockerfile, headDockerfile) {
  const before = parseBaseImages(baseDockerfile);
  const after = parseBaseImages(headDockerfile);
  const stages = Math.max(before.length, after.length);
  const singleStage = stages === 1;
  return Array.from({ length: stages }, (_unused, index) => index)
    .filter((index) => before[index] !== after[index])
    .map((index) => ({
      field: 'Dockerfile',
      name: singleStage ? 'FROM' : `FROM[${index}]`,
      from: before[index],
      to: after[index],
    }));
}

const TITLE_PATTERN = /^(?<type>[a-z]+)(?<scope>\([^()]*\))?(?<breaking>!)?:\s+\S/;

/**
 * Parses the conventional-commit header of a pull request title.
 *
 * @param {string} [title] The pull request title, used verbatim as the squash subject.
 * @returns {{ type: string, scope: string | undefined, breaking: boolean } | undefined} The parsed header, or `undefined` when the title is not conventional.
 */
export function parseCommitHeader(title) {
  const match = TITLE_PATTERN.exec((title ?? '').trim());
  if (!match?.groups) return undefined;
  const { type, scope, breaking } = match.groups;
  return { type, scope: scope?.slice(1, -1), breaking: Boolean(breaking) };
}

/**
 * Reports whether a pull request title makes release-please cut a release.
 *
 * @param {string} [title] The pull request title.
 * @returns {boolean} True when merging the title produces a version bump.
 */
export function isReleaseTriggering(title) {
  const header = parseCommitHeader(title);
  if (!header) return false;
  return header.breaking || RELEASE_TRIGGERING_TYPES.includes(header.type);
}

/**
 * Compares one manifest field across two `package.json` revisions.
 *
 * @param {string} field The manifest field to compare.
 * @param {Record<string, string>} before The field contents on the base branch.
 * @param {Record<string, string>} after The field contents on the head branch.
 * @returns {Array<{ field: string, name: string, from: string | undefined, to: string | undefined }>} One entry per added, removed or re-ranged package.
 */
function diffField(field, before, after) {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names]
    .filter((name) => before[name] !== after[name])
    .map((name) => ({ field, name, from: before[name], to: after[name] }));
}

/**
 * Lists every dependency change that reaches the published image.
 *
 * @param {Record<string, unknown>} [basePackage] The `package.json` on the base branch.
 * @param {Record<string, unknown>} [headPackage] The `package.json` on the head branch.
 * @returns {Array<{ field: string, name: string, from: string | undefined, to: string | undefined }>} The shipped changes, sorted by field then name.
 */
export function findShippedDependencyChanges(basePackage, headPackage) {
  const changes = SHIPPED_MANIFEST_FIELDS.flatMap((field) =>
    diffField(field, basePackage?.[field] ?? {}, headPackage?.[field] ?? {}),
  );
  return changes.sort((a, b) => a.field.localeCompare(b.field) || a.name.localeCompare(b.name));
}

/**
 * Decides whether a pull request may merge under the release-signal policy.
 *
 * A pull request passes when it ships no dependency or base-image change, or
 * when its title is release-triggering. It fails only when a shipped change
 * would merge without producing a release.
 *
 * @param {{ title?: string, basePackage?: Record<string, unknown>, headPackage?: Record<string, unknown>, baseDockerfile?: string, headDockerfile?: string }} input The pull request title, both manifest revisions and both Dockerfile revisions.
 * @returns {{ ok: boolean, releaseTriggering: boolean, shippedChanges: Array<{ field: string, name: string, from: string | undefined, to: string | undefined }> }} The verdict and the evidence behind it.
 */
export function evaluateReleaseSignal(input) {
  const shippedChanges = [
    ...findShippedDependencyChanges(input?.basePackage, input?.headPackage),
    ...findShippedBaseImageChanges(input?.baseDockerfile, input?.headDockerfile),
  ];
  const releaseTriggering = isReleaseTriggering(input?.title);
  return { ok: shippedChanges.length === 0 || releaseTriggering, releaseTriggering, shippedChanges };
}

/**
 * Renders the guard verdict as operator-facing console output.
 *
 * @param {{ ok: boolean, releaseTriggering: boolean, shippedChanges: Array<{ field: string, name: string, from: string | undefined, to: string | undefined }> }} verdict The result of {@link evaluateReleaseSignal}.
 * @param {string} [title] The pull request title, echoed back for context.
 * @returns {string} The message to print.
 */
export function formatReleaseSignalReport(verdict, title) {
  if (verdict.shippedChanges.length === 0) {
    return '✅ No shipped dependency or base-image changes — release signal not required';
  }
  const listed = verdict.shippedChanges
    .map((change) => `   • ${change.field}.${change.name}: ${change.from ?? '—'} → ${change.to ?? '—'}`)
    .join('\n');
  if (verdict.ok) {
    return `✅ Shipped change carries a release signal:\n${listed}`;
  }
  return [
    '❌ Shipped change would merge without cutting a release:',
    listed,
    '',
    `   PR title: ${title ?? '(none)'}`,
    `   Retitle using a release-triggering type (${RELEASE_TRIGGERING_TYPES.join(', ')}),`,
    '   e.g. "fix(deps): bump @sergienko4/israeli-bank-scrapers to 8.7.0".',
    '   These packages and the base image ship inside the published Docker',
    '   image, so users must receive a tagged release rather than a silent',
    '   update.',
  ].join('\n');
}
