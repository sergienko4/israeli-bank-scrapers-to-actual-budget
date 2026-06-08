/**
 * Self-contained coupling scanner for src/.
 *
 * Walks every production .ts file under src/, parses imports via regex,
 * classifies each file into one of six architecture layers, and produces
 * a deterministic JSON report with a per-file decoupling score.
 *
 * Why a scanner exists:
 *   The decoupling initiative (plans/decoupling-2026-06/) needs an objective,
 *   reproducible metric for "how coupled is this file?" so we can prove each
 *   PR genuinely reduces coupling. A static walk that does NOT depend on the
 *   .understand-anything/ knowledge graph (which is gitignored and per-dev)
 *   guarantees CI portability.
 *
 * Scoring formula (intentionally simple — see decoupling-report.md §1):
 *   +2 per cross-layer value import     -- the dominant coupling signal
 *   +3 if file > 400 LoC                -- god-class smell
 *   +2 if file > 300 LoC
 *   +1 if file > 200 LoC
 *   +1 if file > 250 LoC                -- secondary size bump (was "complex" in KG)
 *   +2 if value-imports >= 10           -- fan-out smell
 *   +1 if value-imports >= 7
 *   +1 per OCP risk                     -- if(config.X) chains, big switches
 *   Critical threshold: score >= 8
 *
 * Usage:
 *   node scripts/coupling-scanner.cjs           # writes tests/coupling-baseline.json
 *   node scripts/coupling-scanner.cjs --check   # compares against baseline; exit 1 on regression
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(ROOT, 'tests', 'coupling-baseline.json');

const CHECK_MODE = process.argv.includes('--check');

const LAYER_RULES = [
  { prefix: 'src/Index.ts', layer: 'EP' },
  { prefix: 'src/Bootstrap/', layer: 'EP' },
  { prefix: 'src/Scraper/', layer: 'BP' },
  { prefix: 'src/Scrapers/', layer: 'BP' },
  { prefix: 'src/Services/', layer: 'IS' },
  { prefix: 'src/Scheduler/', layer: 'SC' },
  { prefix: 'src/Config/', layer: 'CC' },
  { prefix: 'src/Logger/', layer: 'CC' },
  { prefix: 'src/Resilience/', layer: 'CC' },
  { prefix: 'src/Shared/', layer: 'ST' },
  { prefix: 'src/Types/', layer: 'ST' },
  { prefix: 'src/Utils/', layer: 'ST' },
  { prefix: 'src/Errors/', layer: 'ST' },
  { prefix: 'src/Helpers/', layer: 'ST' },
];

/**
 * Resolves the architecture layer of a source file from its relative path.
 *
 * @param {string} relPath - POSIX-style path relative to repo root (e.g. "src/Index.ts").
 * @returns {string} Layer code (EP|BP|IS|SC|CC|ST) or "(none)" for unmapped paths.
 */
function layerOf(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  for (const rule of LAYER_RULES) {
    if (normalized === rule.prefix || normalized.startsWith(rule.prefix)) {
      return rule.layer;
    }
  }
  return '(none)';
}

/**
 * Recursively collects every production TypeScript file under `dir`.
 *
 * Excludes test files (*.test.ts, *.spec.ts) and ambient declarations (*.d.ts)
 * so coupling scores reflect runtime architecture, not test/type-only artifacts.
 *
 * @param {string} dir - Absolute directory path to walk.
 * @param {string[]} [acc=[]] - Accumulator for recursive calls; callers pass nothing.
 * @returns {string[]} Absolute paths of every matched .ts file.
 */
function walkTs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTs(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.ts') &&
               !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.spec.ts') &&
               !entry.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Extracts every import (static + dynamic) from a TypeScript source string.
 *
 * Uses regex (not a real TS parser) because the scanner must stay zero-deps
 * for portability and to avoid coupling the infra layer to the typescript
 * compiler version. The `isType` flag distinguishes `import type` (which does
 * NOT contribute to runtime coupling) from value imports.
 *
 * @param {string} src - Raw TypeScript source.
 * @returns {Array<{isType: boolean, spec: string, dynamic: boolean}>} Parsed imports.
 */
function parseImports(src) {
  const out = [];
  const re = /^[\t ]*import[\t ]+(?:(type)[\t ]+)?(?:[\s\S]+?from[\t ]+)?['"]([^'"]+)['"];?/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ isType: !!m[1], spec: m[2], dynamic: false });
  }
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(src)) !== null) {
    out.push({ isType: false, spec: m[1], dynamic: true });
  }
  return out;
}

/**
 * Resolves a relative import specifier to a repo-relative .ts path.
 *
 * Returns null for non-relative specs (e.g. "node:fs", "lodash") because
 * external packages do not contribute to the cross-layer coupling metric.
 *
 * @param {string} fromRelPath - POSIX-style path of the importing file.
 * @param {string} spec - The literal string inside `import '...'`.
 * @returns {string|null} Resolved POSIX-style .ts path, or null if external.
 */
function resolveImport(fromRelPath, spec) {
  if (!spec.startsWith('.')) return null;
  const dir = path.dirname(fromRelPath);
  let resolved = path.normalize(path.join(dir, spec)).replace(/\\/g, '/');
  resolved = resolved.replace(/\.js$/, '.ts');
  if (!resolved.endsWith('.ts')) {
    resolved = `${resolved}.ts`;
  }
  return resolved;
}

/**
 * Counts every `new ClassName(...)` expression by class name.
 *
 * Used by the decoupling report to surface concrete-class instantiations
 * across layer boundaries (a Pattern D seam-extraction signal).
 *
 * @param {string} src - Raw TypeScript source.
 * @returns {Map<string, number>} Class-name → count map.
 */
function countNewExpressions(src) {
  const re = /\bnew\s+([A-Z][A-Za-z0-9_]+)\b/g;
  const counts = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  return counts;
}

/**
 * Detects Open/Closed Principle violation patterns in source.
 *
 * Two patterns scored as risks:
 *   1. Two or more `if (config.X)` branches in the same file (suggests a
 *      Strategy/Registry refactor would close the file to modification).
 *   2. A `switch` with 4+ string `case` labels (same smell as above).
 *
 * @param {string} src - Raw TypeScript source.
 * @returns {string[]} Human-readable risk labels (empty when no risks found).
 */
function detectOcpRisks(src) {
  const risks = [];
  const ifChain = /if\s*\(\s*config\.[A-Za-z_][A-Za-z0-9_]*\s*\)/g;
  const matches = [...src.matchAll(ifChain)];
  if (matches.length >= 2) {
    risks.push(`if(config.X) chain x${matches.length}`);
  }
  const switchRe = /switch\s*\([^)]+\)\s*\{([^}]+)\}/g;
  let sm;
  while ((sm = switchRe.exec(src)) !== null) {
    const cases = (sm[1].match(/\bcase\s+['"]/g) || []).length;
    if (cases >= 4) risks.push(`switch with ${cases} string cases`);
  }
  return risks;
}

/**
 * Computes the decoupling score for one file record.
 *
 * Score is intentionally simple-and-stable so changes are obvious in diff.
 * See the file-level JSDoc "Scoring formula" block for the exact weights;
 * this function is the single source of truth for those weights at runtime.
 *
 * @param {{crossLayerValueDeps: Array<unknown>, lines: number, valueImports: number, ocpRisks: string[]}} r - File record.
 * @returns {number} Integer score (0 = clean, ≥8 = critical).
 */
function scoreFile(r) {
  let s = 0;
  s += r.crossLayerValueDeps.length * 2;
  if (r.lines > 400) s += 3;
  else if (r.lines > 300) s += 2;
  else if (r.lines > 200) s += 1;
  if (r.lines > 250) s += 1;
  if (r.valueImports >= 10) s += 2;
  else if (r.valueImports >= 7) s += 1;
  s += r.ocpRisks.length;
  return s;
}

/**
 * Reads one TS file and builds its full coupling record (including score).
 *
 * @param {string} absPath - Absolute path to the source file.
 * @returns {{path: string, layer: string, lines: number, valueImports: number, typeImports: number, crossLayerValueDeps: Array<unknown>, newClasses: string[], newCount: number, ocpRisks: string[], score: number}} Full file record.
 */
function scanFile(absPath) {
  const relPath = path.relative(ROOT, absPath).replace(/\\/g, '/');
  const src = fs.readFileSync(absPath, 'utf8');
  const lines = src.split(/\r?\n/).length;
  const myLayer = layerOf(relPath);
  const imports = parseImports(src);
  let valueImports = 0;
  let typeImports = 0;
  const crossLayerValueDeps = [];
  for (const imp of imports) {
    if (imp.isType) {
      typeImports++;
      continue;
    }
    valueImports++;
    const resolved = resolveImport(relPath, imp.spec);
    if (!resolved) continue;
    const targetLayer = layerOf(resolved);
    if (targetLayer !== myLayer && myLayer !== '(none)' && targetLayer !== '(none)') {
      crossLayerValueDeps.push({ to: resolved, toLayer: targetLayer, dynamic: imp.dynamic });
    }
  }
  const newCounts = countNewExpressions(src);
  const ocpRisks = detectOcpRisks(src);
  const r = {
    path: relPath,
    layer: myLayer,
    lines,
    valueImports,
    typeImports,
    crossLayerValueDeps,
    newClasses: [...newCounts.keys()].sort(),
    newCount: [...newCounts.values()].reduce((a, v) => a + v, 0),
    ocpRisks,
  };
  r.score = scoreFile(r);
  return r;
}

/**
 * Buckets file records by score severity for the summary distribution.
 *
 * Buckets match the bands cited throughout the decoupling plan docs:
 *   critical8plus (PR targets), high5to7, medium3to4, low1to2, clean0.
 *
 * @param {Array<{score: number}>} files - Scored file records.
 * @returns {{critical8plus: number, high5to7: number, medium3to4: number, low1to2: number, clean0: number}} Per-bucket counts.
 */
function distribution(files) {
  const d = { critical8plus: 0, high5to7: 0, medium3to4: 0, low1to2: 0, clean0: 0 };
  for (const f of files) {
    if (f.score >= 8) d.critical8plus++;
    else if (f.score >= 5) d.high5to7++;
    else if (f.score >= 3) d.medium3to4++;
    else if (f.score >= 1) d.low1to2++;
    else d.clean0++;
  }
  return d;
}

/**
 * Entry point: writes a baseline JSON or verifies the current state against it.
 *
 * Modes:
 *   - default (`coupling:report`): scans src/, writes tests/coupling-baseline.json,
 *     prints the bucket summary.
 *   - --check  (`coupling:check` gate): scans src/, compares the critical-bucket
 *     count to the committed baseline; exits non-zero (printing the offending
 *     new criticals) when the critical count regresses.
 *
 * @returns {void} Process exit code communicates success/failure.
 */
function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`coupling-scanner: src/ not found at ${SRC_DIR}`);
    process.exit(2);
  }
  const files = walkTs(SRC_DIR);
  const report = files.map(scanFile);
  report.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const dist = distribution(report);
  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    totalFiles: report.length,
    scoreDistribution: dist,
    files: report,
  };

  if (CHECK_MODE) {
    if (!fs.existsSync(BASELINE_PATH)) {
      console.error(`coupling-scanner --check: baseline not found at ${BASELINE_PATH}`);
      process.exit(2);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    const baselineCrit = baseline.scoreDistribution.critical8plus;
    if (dist.critical8plus > baselineCrit) {
      console.error(`REGRESSION: critical-file count ${dist.critical8plus} > baseline ${baselineCrit}`);
      const baselineNames = new Set(
        baseline.files.filter((f) => f.score >= 8).map((f) => f.path),
      );
      const regressors = report.filter((f) => f.score >= 8 && !baselineNames.has(f.path));
      for (const r of regressors) {
        console.error(`  + ${r.path} (score=${r.score})`);
      }
      process.exit(1);
    }
    console.log(
      `coupling-scanner --check OK: critical=${dist.critical8plus} (baseline=${baselineCrit})`,
    );
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log('=== coupling-scanner summary ===');
  console.log(`total files: ${report.length}`);
  console.log(`  critical (>=8): ${dist.critical8plus}`);
  console.log(`  high (5-7):     ${dist.high5to7}`);
  console.log(`  medium (3-4):   ${dist.medium3to4}`);
  console.log(`  low (1-2):      ${dist.low1to2}`);
  console.log(`  clean (0):      ${dist.clean0}`);
  console.log(`baseline written: ${path.relative(ROOT, BASELINE_PATH)}`);
}

main();
