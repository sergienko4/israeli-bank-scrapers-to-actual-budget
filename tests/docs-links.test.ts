/**
 * Keeps the links in docs/ absolute and pointing at real pages.
 *
 * The review rule for docs/**\/*.md in .coderabbit.yaml asks for absolute
 * GitHub URLs. Nothing else checks those URLs: lychee skips this
 * repository's blob/main and tree/main URLs, since a page added on a branch
 * is not on main yet, and MkDocs checks only relative links. So this test
 * parses every page with markdownlint's Markdown parser and fails on a
 * relative or empty link, on a blob/main or tree/main link into this
 * repository whose file does not exist, and on a fragment that names no
 * heading of the Markdown file it points at.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MicromarkToken, Rule } from 'markdownlint-cli2/markdownlint';
import { lint } from 'markdownlint-cli2/markdownlint/promise';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF_URL =
  /^https:\/\/github\.com\/sergienko4\/israeli-bank-scrapers-to-actual-budget\/(?:blob|tree)\/main\/([^?#]*)(\?[^#]*)?(?:#(.*))?$/;
const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const BACKSLASH_ESCAPE = /\\([!-/:-@[-`{-~])/g;
const CONTAINER = /^(?:!!!|\?\?\?\+?|===[+!]?) /;
const HTML_TARGET = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const HTML_ANCHOR = /\s(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const DESTINATIONS = new Set(['resourceDestinationString', 'definitionDestinationString']);
const DESTINATION_HOLDERS = new Set(['resource', 'definition']);
const AUTOLINKS = new Set(['autolinkProtocol', 'literalAutolinkHttp']);
const INDENT = /^(?: {0,3}\t| {1,4})/;
const HEADINGS = new Set(['atxHeadingText', 'setextHeadingText']);
const HEADING_TEXT = new Set(['characterEscapeValue', 'codeTextData', 'data', 'mathTextData']);
const NOT_HEADING_TEXT = new Set(['image', 'reference', 'resource']);
const BETWEEN_BLOCKS = new Set(['lineEnding', 'lineEndingBlank']);
const PROSE = new Set(['content', 'paragraph']);

/** A link target and the line it is on. */
interface ILink {
  readonly page: string;
  readonly line: number;
  readonly target: string;
}

/** A link into this repository, split into its path, query and fragment. */
interface ISelfLink extends ILink {
  readonly path: string;
  readonly query?: string;
  readonly fragment?: string;
}

/** An HTML attribute value and the line it is on. */
interface IAttribute {
  readonly line: number;
  readonly value: string;
}

/**
 * Reads a repository file as text.
 * @param relPath - Path relative to the repository root.
 * @returns File content.
 */
const readRepoFile = (relPath: string): string => readFileSync(join(ROOT, relPath), 'utf8');

/**
 * Lists every Markdown page under docs/.
 * @returns Repository-relative POSIX paths, sorted.
 */
function docsPages(): string[] {
  const entries = readdirSync(join(ROOT, 'docs'), { recursive: true, encoding: 'utf8' });
  const pages = entries.filter((entry) => entry.endsWith('.md'));
  return pages.map((entry) => `docs/${entry.split(sep).join('/')}`).sort((a, b) => a.localeCompare(b));
}

/**
 * Parses Markdown with markdownlint's micromark parser, which knows
 * CommonMark and GitHub's extensions, through markdownlint-cli2.
 * @param markdown - Markdown source.
 * @returns The top-level tokens.
 */
async function parse(markdown: string): Promise<readonly MicromarkToken[]> {
  let tokens: readonly MicromarkToken[] = [];
  const capture: Rule = {
    names: ['capture-tokens'],
    description: 'Hands the parsed tokens to this test',
    tags: ['test'],
    parser: 'micromark',
    function: (params) => {
      tokens = params.parsers.micromark.tokens;
    },
  };
  const config = { default: false, 'capture-tokens': true };
  await lint({ strings: { page: markdown }, config, customRules: [capture] });
  return tokens;
}

/**
 * Lists tokens and every token under them, in document order.
 * @param tokens - Parsed tokens.
 * @returns The tokens, flattened.
 */
const allOf = (tokens: readonly MicromarkToken[]): MicromarkToken[] =>
  tokens.flatMap((token) => [token, ...allOf(token.children)]);

/**
 * Tells whether a token is the body of an MkDocs admonition, collapsible
 * block or content tab. MkDocs renders an indented body after a blank line
 * as Markdown, while CommonMark reads it as indented code.
 * @param token - A token.
 * @param siblings - The tokens beside it, it included.
 * @returns True for a container body read as code.
 */
function isContainerBody(token: MicromarkToken, siblings: readonly MicromarkToken[]): boolean {
  if (token.type !== 'codeIndented') return false;
  const before = siblings.slice(0, siblings.indexOf(token));
  const opener = before.filter((sibling) => !BETWEEN_BLOCKS.has(sibling.type)).at(-1);
  return opener !== undefined && PROSE.has(opener.type) && CONTAINER.test(opener.text);
}

/**
 * Finds the container bodies read as code, at any depth.
 * @param tokens - Sibling tokens.
 * @returns The bodies.
 */
function containerBodies(tokens: readonly MicromarkToken[]): MicromarkToken[] {
  const here = tokens.filter((token) => isContainerBody(token, tokens));
  return [...here, ...tokens.flatMap((token) => containerBodies(token.children))];
}

/**
 * Moves container bodies four columns left, as MkDocs does, which reads a
 * tab as four columns.
 * @param markdown - Markdown source.
 * @param bodies - The container bodies in it.
 * @returns The source, with every line where it was.
 */
function dedent(markdown: string, bodies: readonly MicromarkToken[]): string {
  const inBody = (line: number): boolean =>
    bodies.some((body) => line >= body.startLine && line <= body.endLine);
  const lines = markdown.split('\n');
  return lines.map((text, index) => (inBody(index + 1) ? text.replace(INDENT, '') : text)).join('\n');
}

/**
 * Parses a page as MkDocs renders it, container bodies included.
 * @param markdown - Markdown source.
 * @returns Every token of the page.
 */
async function renderedTokens(markdown: string): Promise<MicromarkToken[]> {
  const tokens = await parse(markdown);
  const bodies = containerBodies(tokens);
  if (bodies.length === 0) return allOf(tokens);
  const dedented = dedent(markdown, bodies);
  if (dedented === markdown) {
    throw new Error(`Cannot dedent the MkDocs container body at line ${String(bodies[0].startLine)}`);
  }
  return renderedTokens(dedented);
}

/**
 * Tells whether a token is an HTML tag, not a comment or declaration.
 * @param token - A token.
 * @returns True for a tag.
 */
const isTag = (token: MicromarkToken): boolean => token.type === 'htmlText' && !token.text.startsWith('<!');

/**
 * Lists the values a tag gives the attributes a pattern matches.
 * @param tag - An HTML tag token.
 * @param pattern - Attribute pattern, values in groups 1 to 3.
 * @returns The values with their lines.
 */
function attributeValues(tag: MicromarkToken, pattern: RegExp): IAttribute[] {
  return [...tag.text.matchAll(pattern)].map((match) => ({
    line: tag.startLine + tag.text.slice(0, match.index).split('\n').length - 1,
    value: match[1] ?? match[2] ?? match[3] ?? '',
  }));
}

/**
 * Tells whether a link, image or reference definition has an empty
 * destination, as `[text]()` does, which points at the page itself.
 * @param token - A token.
 * @returns True for an empty destination.
 */
const isEmptyDestination = (token: MicromarkToken): boolean =>
  DESTINATION_HOLDERS.has(token.type) && !allOf(token.children).some((child) => DESTINATIONS.has(child.type));

/**
 * Lists the targets one token carries, with their lines.
 * @param token - A token.
 * @returns The targets, an empty one for an empty destination.
 */
function targetsOf(token: MicromarkToken): IAttribute[] {
  const at = (value: string): IAttribute[] => [{ line: token.startLine, value }];
  if (DESTINATIONS.has(token.type)) return at(token.text.replace(BACKSLASH_ESCAPE, '$1'));
  if (AUTOLINKS.has(token.type)) return at(token.text);
  if (isEmptyDestination(token)) return at('');
  return isTag(token) ? attributeValues(token, HTML_TARGET) : [];
}

/**
 * Lists the link targets among a page's tokens: inline links and images,
 * reference definitions, autolinks and bare URLs, and HTML href and src
 * values.
 * @param tokens - Every token of the page.
 * @param page - The page, for failure messages.
 * @returns The links in document order.
 */
function linksIn(tokens: readonly MicromarkToken[], page: string): ILink[] {
  return tokens.flatMap((token) => targetsOf(token).map(({ line, value }) => ({ page, line, target: value })));
}

/**
 * Joins the text a heading shows, leaving out markup, link targets and
 * images.
 * @param tokens - The tokens inside the heading text.
 * @returns The plain text.
 */
const shownText = (tokens: readonly MicromarkToken[]): string =>
  tokens
    .map((token) => {
      if (HEADING_TEXT.has(token.type)) return token.text;
      return NOT_HEADING_TEXT.has(token.type) ? '' : shownText(token.children);
    })
    .join('');

/**
 * Turns heading text into GitHub's anchor for it: lower case, without
 * punctuation or symbols, with spaces as hyphens.
 * @param text - Heading text as shown.
 * @returns The anchor before any repeat suffix.
 */
const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replaceAll(' ', '-');

/**
 * Picks a heading's anchor as GitHub does: a repeat gets -1, -2 and so on,
 * skipping any anchor an earlier heading already has.
 * @param base - The heading's anchor before any suffix.
 * @param taken - Anchors given so far, with the last suffix each used.
 * @returns The anchor.
 */
function uniqueAnchor(base: string, taken: Map<string, number>): string {
  let anchor = base;
  while (taken.has(anchor)) {
    const count = (taken.get(base) ?? 0) + 1;
    taken.set(base, count);
    anchor = `${base}-${String(count)}`;
  }
  taken.set(anchor, 0);
  return anchor;
}

/**
 * Lists the anchors GitHub gives a page: one per heading plus any HTML id
 * or name. MkDocs container bodies stay code, as GitHub shows them.
 * @param markdown - Markdown source.
 * @returns The anchors.
 */
async function anchorsIn(markdown: string): Promise<Set<string>> {
  const tokens = allOf(await parse(markdown));
  const taken = new Map<string, number>();
  const headings = tokens.filter((token) => HEADINGS.has(token.type));
  const fromHeadings = headings.map((heading) => uniqueAnchor(slugOf(shownText(heading.children)), taken));
  const fromHtml = tokens.filter(isTag).flatMap((tag) => attributeValues(tag, HTML_ANCHOR));
  return new Set([...fromHeadings, ...fromHtml.map((attribute) => attribute.value)]);
}

/**
 * Splits a link into this repository into its parts.
 * @param link - Any link.
 * @returns The parts, or an empty list for a link elsewhere.
 */
function selfLinkOf(link: ILink): ISelfLink[] {
  const match = SELF_URL.exec(link.target);
  if (match === null) return [];
  const path = decodeURIComponent(match[1]).replace(/\/$/, '');
  return [{ ...link, path, query: match[2], fragment: match[3] }];
}

/**
 * Tells whether a link's fragment names a heading that can be checked:
 * one in an existing Markdown file, without a query such as `?plain=1#L10`,
 * which addresses lines.
 * @param link - A link into this repository.
 * @returns True when the fragment should name a heading.
 */
function namesHeading(link: ISelfLink): link is ISelfLink & { readonly fragment: string } {
  if (link.fragment === undefined || link.query !== undefined) return false;
  return link.path.endsWith('.md') && existsSync(join(ROOT, link.path));
}

/**
 * Reads the anchors of every Markdown file the links name a heading in.
 * @param links - Links into this repository.
 * @returns The anchors by repository-relative path.
 */
async function anchorsByPath(links: readonly ISelfLink[]): Promise<Map<string, Set<string>>> {
  const paths = [...new Set(links.filter(namesHeading).map((link) => link.path))];
  const read = async (path: string): Promise<[string, Set<string>]> => [path, await anchorsIn(readRepoFile(path))];
  return new Map(await Promise.all(paths.map(read)));
}

/**
 * Lists the link targets the scan finds in a Markdown snippet.
 * @param markdown - Markdown source.
 * @returns The targets in document order.
 */
const targetsIn = async (markdown: string): Promise<string[]> =>
  linksIn(await renderedTokens(markdown), 'snippet').map((link) => link.target);

/**
 * Formats a link for a failure message.
 * @param link - The link.
 * @returns `page:line target`.
 */
const where = (link: ILink): string => `${link.page}:${String(link.line)} ${link.target}`;

const PAGE_LINKS = docsPages().map(async (page) => linksIn(await renderedTokens(readRepoFile(page)), page));
const LINKS = (await Promise.all(PAGE_LINKS)).flat();
const SELF_LINKS = LINKS.flatMap(selfLinkOf);
const ANCHORS = await anchorsByPath(SELF_LINKS);

/**
 * Tells whether a link names a heading its Markdown file does not have.
 * @param link - A link into this repository.
 * @returns True when the fragment matches no anchor.
 */
const hasBrokenAnchor = (link: ISelfLink): boolean =>
  namesHeading(link) && ANCHORS.get(link.path)?.has(decodeURIComponent(link.fragment)) !== true;

describe('the link scan', () => {
  it.each([
    ['a same-page anchor', 'See [Replay](#replay).', ['#replay']],
    ['a path beside the page', 'See [Banks](configuration/banks.md).', ['configuration/banks.md']],
    ['a path with a title', '[Notes](../UPGRADING.md#notes "Upgrade notes")', ['../UPGRADING.md#notes']],
    ['a path with a single-quoted title', "[Notes](notes.md 'Notes')", ['notes.md']],
    ['a path with a title in parentheses', '[Notes](notes.md (Notes))', ['notes.md']],
    ['a path in angle brackets', '[Notes](<release notes.md>)', ['release notes.md']],
    ['a path with parentheses', '[Notes](notes(2).md)', ['notes(2).md']],
    ['an image', '![Logo](logo.png)', ['logo.png']],
    ['an empty destination', '[Here]()', ['']],
    ['an empty image destination', '![Logo](<>)', ['']],
    ['an autolink', 'See <https://example.com/a>.', ['https://example.com/a']],
    ['a bare URL', 'See https://example.com/a.', ['https://example.com/a']],
    ['a reference definition', '[upgrading]: ../UPGRADING.md', ['../UPGRADING.md']],
    ['a reference definition over lines', '[upgrading]:\n  ../UPGRADING.md\n  "Upgrading"', ['../UPGRADING.md']],
    ['an HTML link', '<a href="#top">Back to top</a>', ['#top']],
    ['an upper-case HTML link', "<A HREF='notes.md'>Notes</A>", ['notes.md']],
    ['an HTML image without quotes', '<img src=logo.png alt="Logo">', ['logo.png']],
    ['a link in an admonition', '!!! note "Note"\n    First.\n\n    See [Notes](notes.md).', ['notes.md']],
    ['a link in a content tab', '=== "Tab"\n\n    See [Notes](notes.md).', ['notes.md']],
    ['a link in a tab-indented admonition', '!!! note\n\n\tSee [Notes](notes.md).', ['notes.md']],
  ])('finds %s', async (_form, markdown, targets) => {
    expect(await targetsIn(markdown)).toEqual(targets);
  });

  it.each([
    ['inline code', 'Write `[Replay](#replay)` for a same-page link.'],
    ['inline code over two lines', 'Write `a\n[Replay](#replay)` for a same-page link.'],
    ['a fenced block', '```md\n[Replay](#replay)\n```'],
    ['a tilde fence around a backtick fence', '~~~md\n```\n```\n[Replay](#replay)\n~~~'],
    ['a fenced block in a list item', '- Item\n\n    ```md\n    [Replay](#replay)\n    ```'],
    ['an HTML comment', '<!-- <a href="notes.md">Notes</a> -->'],
  ])('ignores a link inside %s', async (_form, markdown) => {
    expect(await targetsIn(markdown)).toEqual([]);
  });

  it('gives an HTML attribute the line it is on', async () => {
    const links = linksIn(await renderedTokens('<img\n  src="logo.png">'), 'snippet');
    expect(links.map(where)).toEqual(['snippet:2 logo.png']);
  });
});

describe('heading anchors', () => {
  it.each([
    ['## "out-of-sync-migrations" from Actual Budget', 'out-of-sync-migrations-from-actual-budget'],
    ['## The error notification says `all-banks-failed`', 'the-error-notification-says-all-banks-failed'],
    ['### Least privilege: importer reads, portal writes', 'least-privilege-importer-reads-portal-writes'],
    ['## See [Pepper device state](https://example.com) ##', 'see-pepper-device-state'],
    ['## _Emphasised_ setup', 'emphasised-setup'],
    ['Setext heading\n---', 'setext-heading'],
    ['<div class="note" ID=\'custom\'></div>', 'custom'],
    ['<a name="legacy"></a>', 'legacy'],
  ])('gives %s the anchor %s', async (markdown, anchor) => {
    expect(await anchorsIn(markdown)).toEqual(new Set([anchor]));
  });

  it('suffixes a repeat as GitHub does, skipping anchors already taken', async () => {
    const anchors = await anchorsIn('## Setup\n## Setup\n## Setup-1\n## Setup');
    expect([...anchors]).toEqual(['setup', 'setup-1', 'setup-1-1', 'setup-2']);
  });

  it('skips a heading in an MkDocs container body, which GitHub shows as code', async () => {
    expect(await anchorsIn('!!! note\n\n    ## Inside')).toEqual(new Set());
  });
});

describe('links in docs/**/*.md', () => {
  it('include links into this repository, so the checks below have input', () => {
    expect(SELF_LINKS.length).toBeGreaterThan(0);
  });

  it('are absolute URLs', () => {
    expect(LINKS.filter((link) => !SCHEME.test(link.target)).map(where)).toEqual([]);
  });

  it('into this repository name a file that exists', () => {
    const missing = SELF_LINKS.filter((link) => !existsSync(join(ROOT, link.path)));
    expect(missing.map(where)).toEqual([]);
  });

  it('into a Markdown file of this repository name one of its headings', () => {
    expect(SELF_LINKS.filter(hasBrokenAnchor).map(where)).toEqual([]);
  });
});
