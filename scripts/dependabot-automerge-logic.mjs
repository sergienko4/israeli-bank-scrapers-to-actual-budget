/**
 * Dependabot auto-merge policy — pure, testable logic behind the workflow
 * that approves and auto-merges safe Dependabot pull requests.
 *
 * Background: every Dependabot patch and minor bump used to wait for a manual
 * approve-and-merge, so security fixes sat open for days and were often
 * re-done by hand as separate bump PRs. Grouping alone was not safe either: a
 * grouped dev-dependency PR once carried a semver-major
 * (`eslint-plugin-unicorn` 77 → 78) under a title that hid it.
 *
 * The workflow can only tell that a pull request came from Dependabot. This
 * module answers the real question — "is every update in this PR safe to land
 * without a human?" — from the `updated-dependencies` metadata Dependabot
 * writes into its own commit message.
 *
 * The policy fails closed. Anything it cannot positively classify as an
 * update its ecosystem may merge alone — a patch or minor for npm and Actions,
 * a patch (by update type or by tag) or digest refresh for the Docker base
 * image — is left for a human.
 * There are three outcomes: `merge` (approve and enable auto-merge), `label`
 * (flag a semver-major, or an update type the ecosystem is held back from, for
 * manual review) and `skip` (touch nothing).
 */

/** Every verdict the policy can return. */
export const AUTO_MERGE_ACTIONS = Object.freeze({
  merge: 'merge',
  label: 'label',
  skip: 'skip',
});

/** Dependabot's patch update type. */
const PATCH_UPDATE_TYPE = 'version-update:semver-patch';

/** Dependabot's minor update type. */
const MINOR_UPDATE_TYPE = 'version-update:semver-minor';

/** The update type that always needs a human. */
export const MAJOR_UPDATE_TYPE = 'version-update:semver-major';

/**
 * Update types each ecosystem may merge without review, keyed by the
 * `dependabot/<ecosystem>/…` branch prefix. The base image is held to patches
 * (plus digest refreshes and patch-level tag changes, see
 * {@link classifyDockerBump}) because a new Node minor changes the runtime of
 * every scheduled import.
 */
export const SAFE_UPDATE_TYPES_BY_ECOSYSTEM = Object.freeze({
  npm_and_yarn: Object.freeze([PATCH_UPDATE_TYPE, MINOR_UPDATE_TYPE]),
  github_actions: Object.freeze([PATCH_UPDATE_TYPE, MINOR_UPDATE_TYPE]),
  docker: Object.freeze([PATCH_UPDATE_TYPE]),
});

/**
 * Ecosystems the maintainer has opted into auto-merge. A new ecosystem added
 * to `.github/dependabot.yml` stays manual until it is listed above.
 */
export const SUPPORTED_ECOSYSTEMS = Object.freeze(Object.keys(SAFE_UPDATE_TYPES_BY_ECOSYSTEM));

/** Every semver update type Dependabot reports. */
const SEMVER_UPDATE_TYPES = Object.freeze([PATCH_UPDATE_TYPE, MINOR_UPDATE_TYPE, MAJOR_UPDATE_TYPE]);

/**
 * Matches the YAML front-matter block Dependabot appends to its commit
 * message: a `---` line, `updated-dependencies:`, the entries, then `...`.
 * A block without its `...` terminator does not match, so a truncated message
 * yields no entries instead of a partial list.
 */
const METADATA_BLOCKS = /^---\nupdated-dependencies:\n(?<body>(?:.*\n)*?)\.\.\.$/gm;

/**
 * Matches one line of an entry. `- ` opens a new entry and two spaces continue
 * the current one; anything else makes the block malformed. Keys are lowercase
 * and hyphenated, so a hostile key such as `__proto__` can never match.
 */
const ENTRY_LINE = /^(?<lead>- | {2})(?<key>[a-z][a-z-]*):[ \t]*(?<value>.*)$/;

/** Strips one pair of matching surrounding quotes from a YAML scalar. */
const QUOTED_VALUE = /^(?<quote>["'])(?<inner>.*)\k<quote>$/;

/** Abbreviated or full hex digest, as Dependabot prints it in backticks. */
const DIGEST_TOKEN = /^`[0-9a-f]{7,64}`$/;

/**
 * A numeric Docker tag with an optional variant suffix, such as `26`,
 * `26.1-slim` or `26.1.1-bookworm-slim`. Named tags like `latest` or
 * `lts-slim` carry no version order and never match.
 */
const DOCKER_TAG = /^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?(?<suffix>-[a-z0-9][a-z0-9.-]*)?$/;

/**
 * Classification of a Docker tag change, indexed by the first tag component
 * that moved: the major, the minor, then the patch.
 */
const TAG_CHANGE_CLASSES = Object.freeze(['major', 'restricted', 'safe']);

/**
 * Maps Dependabot's metadata keys to entry fields. Unknown keys are ignored
 * so a future Dependabot field does not break parsing.
 */
const FIELD_NAMES = new Map([
  ['dependency-name', 'name'],
  ['dependency-version', 'version'],
  ['dependency-type', 'dependencyType'],
  ['update-type', 'updateType'],
  ['dependency-group', 'group'],
]);

/**
 * Normalises a commit message to LF line endings.
 *
 * @param {string | undefined} commitMessage The raw commit message.
 * @returns {string} The message with CRLF and CR converted to LF.
 */
function normaliseLineEndings(commitMessage) {
  return typeof commitMessage === 'string' ? commitMessage.replace(/\r\n?/g, '\n') : '';
}

/**
 * Removes one pair of matching surrounding quotes from a YAML scalar.
 *
 * Dependabot quotes scoped npm names (`"@vitest/coverage-v8"`) and leaves
 * others bare, so both forms must resolve to the same name.
 *
 * @param {string} value The raw scalar text.
 * @returns {string} The scalar without its surrounding quotes.
 */
function unquote(value) {
  const trimmed = value.trim();
  return QUOTED_VALUE.exec(trimmed)?.groups?.inner ?? trimmed;
}

/**
 * Records one metadata field on an entry.
 *
 * A repeated key makes the entry ambiguous, so it is rejected rather than
 * letting the last value silently win.
 *
 * @param {Record<string, string>} entry The entry being built.
 * @param {{ key: string, value: string }} groups The matched line groups.
 * @returns {boolean} False when the key was already set on the entry.
 */
function applyField(entry, groups) {
  const field = FIELD_NAMES.get(groups.key);
  if (field === undefined) return true;
  if (Object.hasOwn(entry, field)) return false;
  entry[field] = unquote(groups.value);
  return true;
}

/**
 * Turns the lines of a metadata block into entries.
 *
 * @param {string[]} lines The block body, one line per element.
 * @returns {Record<string, string>[]} The entries, or none if malformed.
 */
function parseEntryLines(lines) {
  const entries = [];
  for (const line of lines.filter((candidate) => candidate.trim() !== '')) {
    const groups = ENTRY_LINE.exec(line)?.groups;
    if (groups === undefined) return [];
    if (groups.lead === '- ') entries.push({});
    const current = entries.at(-1);
    if (current === undefined || !applyField(current, groups)) return [];
  }
  return entries;
}

/**
 * Extracts the dependency updates Dependabot recorded in its commit message.
 *
 * Fails closed: a missing, truncated, duplicated or malformed block, or any
 * entry without a `dependency-name`, yields an empty list.
 *
 * @param {string | undefined} commitMessage The Dependabot commit message.
 * @returns {Record<string, string>[]} One entry per updated dependency.
 */
export function parseUpdatedDependencies(commitMessage) {
  const blocks = [...normaliseLineEndings(commitMessage).matchAll(METADATA_BLOCKS)];
  if (blocks.length !== 1) return [];
  const entries = parseEntryLines(blocks[0].groups.body.split('\n'));
  return entries.every((entry) => Boolean(entry.name)) ? entries : [];
}

/**
 * Escapes a string for literal use inside a regular expression.
 *
 * @param {string} text The literal text.
 * @returns {string} The text with every regex metacharacter escaped.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds the body line in which Dependabot names the old and new reference of
 * one Docker image.
 *
 * A single-image PR writes `Bumps <name> from <old> to <new>.`; a grouped PR
 * writes ``Updates `<name>` from <old> to <new>``. Each reference is either a
 * backticked digest or a tag.
 *
 * @param {Record<string, string>} entry The parsed update entry.
 * @param {{ message: string, ecosystem: string }} context The PR context.
 * @returns {{ from: string, to: string } | undefined} Both references, or
 *   `undefined` when no line names this image.
 */
function findDockerBump(entry, context) {
  const name = escapeRegExp(entry.name);
  const prefix = `(?:Bumps ${name}|Updates \`${name}\`)`;
  const line = new RegExp(`^${prefix} from (?<from>\\S+) to (?<to>\\S+?)\\.?$`, 'm');
  return line.exec(context.message)?.groups;
}

/**
 * Parses a numeric Docker tag into its version components and variant suffix.
 *
 * @param {string} tag The tag as Dependabot prints it, such as `26.1-slim`.
 * @returns {{ parts: number[], suffix: string } | undefined} The components
 *   that are present, or `undefined` for a tag with no version order.
 */
function parseDockerTag(tag) {
  const groups = DOCKER_TAG.exec(tag)?.groups;
  if (groups === undefined) return undefined;
  const present = [groups.major, groups.minor, groups.patch].filter((part) => part !== undefined);
  return { parts: present.map(Number), suffix: groups.suffix ?? '' };
}

/**
 * Classifies a Docker tag change by the first version component that moved.
 *
 * Only an upgrade between tags of the same variant and the same precision is
 * comparable. `26-slim → 26-alpine`, `26-slim → 26.1-slim`, a downgrade, an
 * unchanged tag and a named tag such as `latest` all stay `unknown`.
 *
 * @param {{ parts: number[], suffix: string } | undefined} from The old tag.
 * @param {{ parts: number[], suffix: string } | undefined} to The new tag.
 * @returns {'safe' | 'major' | 'restricted' | 'unknown'} The classification.
 */
function classifyTagChange(from, to) {
  if (from === undefined || to === undefined) return 'unknown';
  if (from.suffix !== to.suffix || from.parts.length !== to.parts.length) return 'unknown';
  const moved = from.parts.findIndex((part, position) => part !== to.parts[position]);
  if (moved === -1 || to.parts[moved] < from.parts[moved]) return 'unknown';
  return TAG_CHANGE_CLASSES[moved];
}

/**
 * Classifies a Docker update that carries no `update-type`.
 *
 * Dependabot omits `update-type` both for a same-tag digest refresh and for a
 * tag change such as `22-slim → 26-slim`, so the bump line is the only proof
 * of what changed. Two digests mean a digest refresh; two tags are compared
 * by {@link classifyTagChange}; anything else stays `unknown`.
 *
 * @param {{ from: string, to: string } | undefined} bump The bump line references.
 * @returns {'safe' | 'digest' | 'major' | 'restricted' | 'unknown'} The classification.
 */
function classifyDockerBump(bump) {
  if (bump === undefined) return 'unknown';
  if (DIGEST_TOKEN.test(bump.from) && DIGEST_TOKEN.test(bump.to)) return 'digest';
  return classifyTagChange(parseDockerTag(bump.from), parseDockerTag(bump.to));
}

/**
 * Classifies one update as `safe`, `digest`, `major`, `restricted` or
 * `unknown`.
 *
 * `restricted` is a recognised non-major update the ecosystem is not allowed
 * to merge on its own, such as a Docker minor.
 *
 * @param {Record<string, string>} entry The parsed update entry.
 * @param {{ message: string, ecosystem: string }} context The PR context.
 * @returns {'safe' | 'digest' | 'major' | 'restricted' | 'unknown'} The classification.
 */
function classifyEntry(entry, context) {
  if (SAFE_UPDATE_TYPES_BY_ECOSYSTEM[context.ecosystem].includes(entry.updateType)) return 'safe';
  if (entry.updateType === MAJOR_UPDATE_TYPE) return 'major';
  if (SEMVER_UPDATE_TYPES.includes(entry.updateType)) return 'restricted';
  if (entry.updateType !== undefined || context.ecosystem !== 'docker') return 'unknown';
  return classifyDockerBump(findDockerBump(entry, context));
}

/**
 * Builds a verdict object.
 *
 * @param {string} action One of {@link AUTO_MERGE_ACTIONS}.
 * @param {string} reason A single-line, operator-facing explanation.
 * @param {object[]} entries The classified updates behind the verdict.
 * @returns {{ action: string, reason: string, entries: object[] }} The verdict.
 */
function verdict(action, reason, entries) {
  return { action, reason, entries };
}

/**
 * Renders a value for a reason string without leaking `undefined`/`null`.
 *
 * @param {unknown} value The value to describe.
 * @returns {string} The value, or `(none)` when it is not a non-empty string.
 */
function describeValue(value) {
  return typeof value === 'string' && value !== '' ? value : '(none)';
}

/**
 * Checks the inputs that must hold before the metadata is even read.
 *
 * `repinned` must be exactly `false`: a missing flag is treated like a
 * rotation because the caller failed to prove there was none.
 *
 * @param {{ repinned?: boolean, ecosystem?: string }} input The policy input.
 * @returns {object | undefined} A skip verdict, or undefined to continue.
 */
function checkPreconditions(input) {
  if (input.repinned === true) {
    return verdict(AUTO_MERGE_ACTIONS.skip, 'allowScripts pins rotated; human review required', []);
  }
  if (input.repinned !== false) {
    return verdict(AUTO_MERGE_ACTIONS.skip, 'repinned state unknown; failing closed', []);
  }
  if (!SUPPORTED_ECOSYSTEMS.includes(input.ecosystem)) {
    return verdict(AUTO_MERGE_ACTIONS.skip, `unsupported ecosystem: ${describeValue(input.ecosystem)}`, []);
  }
  return undefined;
}

/**
 * Lists the names of every entry with a given classification.
 *
 * @param {{ name: string, classification: string }[]} entries The entries.
 * @param {string} classification The classification to select.
 * @returns {string[]} The matching dependency names.
 */
function namesClassifiedAs(entries, classification) {
  return entries.filter((entry) => entry.classification === classification).map((entry) => entry.name);
}

/**
 * Turns classified entries into a verdict.
 *
 * Every "cannot judge" verdict comes before any judgement: an update the
 * policy cannot classify skips the whole PR, even when the group also holds
 * a major, so a label never claims a reading of metadata the policy could
 * only partly read. Neither path merges, and both withdraw any arming.
 *
 * @param {{ name: string, classification: string }[]} entries The entries.
 * @returns {object} The verdict for those entries.
 */
function judgeEntries(entries) {
  if (entries.length === 0) {
    return verdict(AUTO_MERGE_ACTIONS.skip, 'no parseable updated-dependencies metadata', entries);
  }
  const unknown = namesClassifiedAs(entries, 'unknown');
  if (unknown.length > 0) {
    return verdict(AUTO_MERGE_ACTIONS.skip, `unclassified update type: ${unknown.join(', ')}`, entries);
  }
  const majors = namesClassifiedAs(entries, 'major');
  if (majors.length > 0) {
    return verdict(AUTO_MERGE_ACTIONS.label, `semver-major update: ${majors.join(', ')}`, entries);
  }
  const restricted = namesClassifiedAs(entries, 'restricted');
  if (restricted.length > 0) {
    return verdict(AUTO_MERGE_ACTIONS.label, `update type not auto-merged here: ${restricted.join(', ')}`, entries);
  }
  return verdict(AUTO_MERGE_ACTIONS.merge, 'every update is a patch, minor or digest refresh', entries);
}

/**
 * Decides whether a Dependabot pull request may auto-merge.
 *
 * Rules, first match wins: rotated or unknown `allowScripts` pins → skip;
 * unsupported ecosystem → skip; no parseable metadata → skip; any update the
 * policy cannot classify → skip; any semver-major → label; any update type
 * the ecosystem may not merge alone → label; otherwise merge.
 *
 * @param {{ commitMessage?: string, repinned?: boolean, ecosystem?: string } | null} [input]
 *   The first Dependabot-authored commit message, whether the allowScripts
 *   pins were rotated on the PR, and the ecosystem from the branch prefix.
 * @returns {{ action: string, reason: string, entries: object[] }} The verdict.
 */
export function decide(input) {
  const policyInput = input ?? {};
  const blocked = checkPreconditions(policyInput);
  if (blocked !== undefined) return blocked;
  const context = { message: normaliseLineEndings(policyInput.commitMessage), ecosystem: policyInput.ecosystem };
  const entries = parseUpdatedDependencies(context.message).map((entry) => ({
    ...entry,
    classification: classifyEntry(entry, context),
  }));
  return judgeEntries(entries);
}

/**
 * Renders a verdict as `GITHUB_OUTPUT` step outputs.
 *
 * Line breaks in the reason are collapsed so a value can never start a new
 * output key.
 *
 * @param {{ action: string, reason: string }} result The verdict to render.
 * @returns {string} `action=…` and `reason=…` lines, newline-terminated.
 */
export function toGithubOutput(result) {
  const reason = String(result.reason).replace(/[\r\n]+/g, ' ');
  return `action=${result.action}\nreason=${reason}\n`;
}
