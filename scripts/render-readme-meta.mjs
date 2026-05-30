/**
 * scripts/render-readme-meta.mjs
 *
 * Narrow marker-fragment renderer. Reads central CI config from
 *   .github/config/ci-config.yml
 * plus npm metadata from package.json, and rewrites ONLY the content
 * between matching <!-- meta:NAME:start --> ... <!-- meta:NAME:end --> pairs
 * in the target files. Bytes outside marker pairs are NEVER modified.
 *
 * Targets (file → managed marker names):
 *   README.md             → badges, supported-banks, tech-stack, docker-image, dockerhub-tags
 *   README.docker-hub.md  → badges, supported-banks, dockerhub-tags
 *   docs/index.md         → (none managed — file owns its content)
 *
 * package.json is managed differently: strict JSON has no comment syntax, so
 * the renderer rewrites specific top-level keys whole — never partial markers.
 *
 * Modes:
 *   default:    write changes to disk if drift is detected, exit 0
 *   --check:    print diff to stderr, exit 1 if any file would change
 *   --dry-run:  print diff, do not write, exit 0
 *
 * Contract:
 *   - Idempotent: running twice produces identical bytes
 *   - Refuses to run if any marker has no matching :end (or vice-versa)
 *   - Refuses to write into a marker block whose name is not in the config's
 *     readme.markers allow-list
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(REPO_ROOT, '.github/config/ci-config.yml');
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, 'package.json');

const MARKER_RE = /<!--\s*meta:([a-z][a-z0-9-]*):(start|end)\s*-->/g;

/**
 * Targets per file: which marker names are managed in which file.
 */
const TARGETS = [
  {
    path: resolve(REPO_ROOT, 'README.md'),
    markers: ['badges', 'supported-banks', 'tech-stack', 'docker-image', 'dockerhub-tags'],
  },
  {
    path: resolve(REPO_ROOT, 'README.docker-hub.md'),
    markers: ['badges', 'supported-banks', 'dockerhub-tags'],
  },
];

function loadConfig() {
  const text = readFileSync(CONFIG_PATH, 'utf8');
  return parseYaml(text);
}

function loadPackageJson() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

/**
 * Parse marker pairs from text. Returns array of
 *   { name, startIdx, endIdx, contentStart, contentEnd }
 * Throws if any pair is malformed (unmatched, nested, or duplicate).
 */
function parseMarkers(text, filePath) {
  const matches = [];
  for (const m of text.matchAll(MARKER_RE)) {
    matches.push({ name: m[1].toLowerCase(), kind: m[2].toLowerCase(), index: m.index, length: m[0].length });
  }
  const pairs = [];
  const stack = [];
  for (const m of matches) {
    if (m.kind === 'start') {
      if (stack.length > 0) {
        const open = stack[stack.length - 1];
        throw new Error(
          `${filePath}: nested :start marker '${m.name}' at byte ${m.index} ` +
            `inside still-open '${open.name}' (opened at byte ${open.index})`,
        );
      }
      stack.push(m);
    } else {
      const open = stack.pop();
      if (!open) throw new Error(`${filePath}: unmatched :end marker '${m.name}' at byte ${m.index}`);
      if (open.name !== m.name) {
        throw new Error(`${filePath}: marker mismatch — :start '${open.name}' closed by :end '${m.name}'`);
      }
      pairs.push({
        name: m.name,
        startIdx: open.index,
        endIdx: m.index + m.length,
        contentStart: open.index + open.length,
        contentEnd: m.index,
      });
    }
  }
  if (stack.length > 0) {
    const orphans = stack.map(s => s.name).join(', ');
    throw new Error(`${filePath}: unmatched :start markers: ${orphans}`);
  }
  const seen = new Set();
  for (const p of pairs) {
    if (seen.has(p.name)) throw new Error(`${filePath}: duplicate marker '${p.name}'`);
    seen.add(p.name);
  }
  return pairs;
}

function renderBadges(config) {
  const b = config.badges;
  const owner = config.project.owner;
  const repo = config.project.repo;
  return [
    `[![PR Pipeline](${b.pr_pipeline})](https://github.com/${owner}/${repo}/actions/workflows/pr.yml)`,
    `[![Release](${b.release})](https://github.com/${owner}/${repo}/actions/workflows/release.yml)`,
    `[![License: ${config.project.license}](https://img.shields.io/badge/License-${config.project.license}-yellow.svg)](${b.license_url})`,
    `[![Docker Pulls](${b.docker_pulls})](https://hub.docker.com/r/${config.docker.image})`,
    `[![Node.js](${b.node})](https://nodejs.org/)`,
    `[![TypeScript](${b.typescript})](https://www.typescriptlang.org/)`,
    `[![Tests](https://img.shields.io/endpoint?url=${encodeURIComponent(b.test_count_gist)})](#contributing)`,
    `[![E2E](https://img.shields.io/endpoint?url=${encodeURIComponent(b.e2e_count_gist)})](#contributing)`,
  ].join('\n');
}

function renderSupportedBanks(config) {
  const banks = config.readme.banks;
  const lines = [
    '| # | Institution | Config key | Login fields |',
    '|---|-------------|-----------|--------------|',
  ];
  banks.forEach((bank, idx) => {
    lines.push(`| ${idx + 1} | ${bank.name} | \`${bank.key}\` | ${bank.login} |`);
  });
  return lines.join('\n');
}

function renderTechStack(config, pkg) {
  const nodeEng = pkg.engines?.node ?? config.runtime.node_engines;
  const tsVer = pkg.devDependencies?.typescript ?? 'unknown';
  const vitestVer = pkg.devDependencies?.vitest ?? 'unknown';
  const scraperVer = pkg.dependencies?.['@sergienko4/israeli-bank-scrapers'] ?? 'unknown';
  return [
    `- **Node.js** ${nodeEng} (Docker base: \`node:24-slim\`)`,
    `- **TypeScript** ${tsVer} (strict mode, ES2022)`,
    `- **Vitest** ${vitestVer} (v8 coverage)`,
    `- **Scraper** [\`@sergienko4/israeli-bank-scrapers\`](https://github.com/sergienko4/israeli-bank-scrapers) ${scraperVer}`,
    '- **Browser** Camoufox (Firefox + C++-level fingerprint masking)',
    `- **Actual Budget API** \`@actual-app/api\` ${pkg.dependencies?.['@actual-app/api'] ?? 'unknown'}`,
  ].join('\n');
}

function renderDockerImage(config) {
  const image = config.docker.image;
  const ghcrImage = config.docker.ghcr_image;
  const lines = [
    'Images are published to two registries (multi-arch: `linux/amd64`, `linux/arm64`).',
    '',
    '**GHCR (primary, always available):**',
    '',
    '```bash',
    `docker pull ${ghcrImage}:latest`,
    '# or pin a specific version',
    `docker pull ${ghcrImage}:v1.x.x`,
    '```',
    '',
    '**Docker Hub (mirror, best-effort):**',
    '',
    '```bash',
    `docker pull ${image}:latest`,
    '# or pin a specific version',
    `docker pull ${image}:v1.x.x`,
    '```',
    '',
    `See available tags on [GHCR](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/pkgs/container/israeli-bank-importer) or [Docker Hub](https://hub.docker.com/r/${image}/tags).`,
  ];
  return lines.join('\n');
}

function renderDockerHubTags(config) {
  const image = config.docker.image;
  const archList = config.docker.platforms_release.join(', ');
  return [
    `**Image:** \`${image}\``,
    '',
    `**Architectures:** ${archList}`,
    '',
    '**Tags:**',
    `- \`latest\` — latest stable release (multi-arch)`,
    `- \`vX.Y.Z\` — pinned semver release`,
    `- \`vX\` / \`vX.Y\` — major / minor floating tag`,
  ].join('\n');
}

function getRenderer(name) {
  const renderers = {
    'badges': renderBadges,
    'supported-banks': renderSupportedBanks,
    'tech-stack': renderTechStack,
    'docker-image': renderDockerImage,
    'dockerhub-tags': renderDockerHubTags,
  };
  return renderers[name];
}

/**
 * Render fragments for one target file. Returns updated text (or original if
 * no markers / no changes). Throws on malformed markers or unknown names.
 */
export function renderFile(originalText, allowedMarkers, config, pkg, filePath) {
  const pairs = parseMarkers(originalText, filePath);
  if (pairs.length === 0) return originalText;
  pairs.sort((a, b) => a.contentStart - b.contentStart);
  let out = '';
  let cursor = 0;
  for (const p of pairs) {
    if (!allowedMarkers.includes(p.name)) {
      throw new Error(`${filePath}: marker '${p.name}' is not in the allow-list for this file`);
    }
    const renderer = getRenderer(p.name);
    if (!renderer) {
      throw new Error(`${filePath}: no renderer registered for marker '${p.name}'`);
    }
    const rendered = renderer(config, pkg);
    out += originalText.slice(cursor, p.contentStart);
    out += '\n' + rendered + '\n';
    cursor = p.contentEnd;
  }
  out += originalText.slice(cursor);
  return out;
}

function runRenderer({ check = false, dryRun = false } = {}) {
  const config = loadConfig();
  const pkg = loadPackageJson();
  let drift = false;
  for (const target of TARGETS) {
    if (!existsSync(target.path)) {
      continue;
    }
    const original = readFileSync(target.path, 'utf8');
    const updated = renderFile(original, target.markers, config, pkg, target.path);
    if (updated === original) {
      continue;
    }
    drift = true;
    const rel = relative(REPO_ROOT, target.path);
    if (check) {
      process.stderr.write(`drift: ${rel}\n`);
    } else if (dryRun) {
      process.stdout.write(`would update: ${rel}\n`);
    } else {
      writeFileSync(target.path, updated);
      process.stdout.write(`updated: ${rel}\n`);
    }
  }
  if (check && drift) {
    process.stderr.write('\nMarker fragments are out of sync. Run `npm run meta:render` and commit the result.\n');
    process.exit(1);
  }
  if (!check && !dryRun && !drift) {
    process.stdout.write('No changes — all marker fragments are in sync.\n');
  }
}

const args = new Set(process.argv.slice(2));
const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : '';
const isMain = thisFile === invokedFile;
if (isMain) {
  try {
    runRenderer({ check: args.has('--check'), dryRun: args.has('--dry-run') });
  } catch (err) {
    process.stderr.write(`render-readme-meta: ${err.message}\n`);
    process.exit(2);
  }
}
