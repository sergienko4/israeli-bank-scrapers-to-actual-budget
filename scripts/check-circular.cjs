/**
 * Circular-dependency gate for src/.
 *
 * Self-contained Tarjan SCC implementation. Skips `import type` edges
 * because TypeScript erases them at runtime, so a cycle formed only by
 * type-only imports is not a real runtime cycle and must not block commits.
 *
 * Why not madge: madge 8 bundles `dependency-tree` whose nested typescript
 * peer conflict breaks Docker `npm prune` and produces an npm-11-only
 * lockfile that CI (npm 10) cannot consume. A 100-line scanner has zero
 * transitive deps and is auditable.
 *
 * Exits 0 when no runtime circular dependency is found in src/.
 * Exits 1 (with summary) when at least one real cycle exists.
 * Exits 2 on scanner failure (I/O, parse error).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Recursively collects every production .ts file under `dir`.
 *
 * Excludes test files (*.test.ts, *.spec.ts) and ambient declarations
 * so cycle detection reflects runtime code only.
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
 * Extracts only runtime (non-type-only) static imports from a TS source string.
 *
 * Returns just the import specifiers — sufficient for graph construction.
 * Type-only imports (`import type ...`) are filtered out because they are
 * erased at compile time and cannot form a runtime cycle.
 *
 * @param {string} src - Raw TypeScript source.
 * @returns {string[]} Specifier strings (e.g. "./Foo", "../Bar/Baz.js").
 */
function parseRuntimeImports(src) {
  const out = [];
  const re = /^[\t ]*import[\t ]+(?:(type)[\t ]+)?(?:[\s\S]+?from[\t ]+)?['"]([^'"]+)['"];?/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) continue;
    out.push(m[2]);
  }
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Resolves a relative import specifier to an absolute .ts path inside src/.
 *
 * Returns null for non-relative specs (external packages, node: builtins)
 * and for specs that do not resolve to a file inside src/. Both have no
 * bearing on intra-src cycle detection.
 *
 * @param {string} fromFile - Absolute path of the importing file.
 * @param {string} spec - The literal string inside `import '...'`.
 * @param {Set<string>} known - Set of every absolute .ts path under src/.
 * @returns {string|null} Resolved absolute .ts path, or null if external/unresolvable.
 */
function resolveImport(fromFile, spec, known) {
  if (!spec.startsWith('.')) return null;
  const baseDir = path.dirname(fromFile);
  const stripped = spec.replace(/\.js$/, '');
  const candidates = [
    `${stripped}.ts`,
    path.join(stripped, 'Index.ts'),
    path.join(stripped, 'index.ts'),
  ];
  for (const c of candidates) {
    const abs = path.normalize(path.join(baseDir, c));
    if (known.has(abs)) return abs;
  }
  return null;
}

/**
 * Builds the directed import graph for every .ts file under src/.
 *
 * @returns {{nodes: string[], edges: Map<string, string[]>}} Adjacency list.
 */
function buildGraph() {
  const files = walkTs(SRC_DIR);
  const known = new Set(files);
  const edges = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const specs = parseRuntimeImports(src);
    const targets = [];
    for (const s of specs) {
      const resolved = resolveImport(f, s, known);
      if (resolved && resolved !== f) targets.push(resolved);
    }
    edges.set(f, targets);
  }
  return { nodes: files, edges };
}

/**
 * Tarjan's strongly-connected-components algorithm.
 *
 * Iterative implementation to avoid stack overflow on large graphs.
 * Every SCC of size ≥ 2 represents a runtime circular dependency. A
 * self-loop (size 1 SCC where the node imports itself) is also reported.
 *
 * @param {string[]} nodes - All graph vertices.
 * @param {Map<string, string[]>} edges - Adjacency list (out-edges per node).
 * @returns {string[][]} Cycles as ordered node lists.
 */
function findCycles(nodes, edges) {
  let index = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  for (const start of nodes) {
    if (indices.has(start)) continue;
    const work = [{ node: start, iter: 0 }];
    indices.set(start, index);
    lowlinks.set(start, index);
    index += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const top = work[work.length - 1];
      const succs = edges.get(top.node) || [];
      if (top.iter < succs.length) {
        const w = succs[top.iter];
        top.iter += 1;
        if (!indices.has(w)) {
          indices.set(w, index);
          lowlinks.set(w, index);
          index += 1;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, iter: 0 });
        } else if (onStack.has(w)) {
          lowlinks.set(top.node, Math.min(lowlinks.get(top.node), indices.get(w)));
        }
      } else {
        if (lowlinks.get(top.node) === indices.get(top.node)) {
          const scc = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            scc.push(w);
          } while (w !== top.node);
          const hasSelfLoop = scc.length === 1 && (edges.get(scc[0]) || []).includes(scc[0]);
          if (scc.length >= 2 || hasSelfLoop) sccs.push(scc);
        }
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1];
          lowlinks.set(parent.node, Math.min(lowlinks.get(parent.node), lowlinks.get(top.node)));
        }
      }
    }
  }
  return sccs;
}

/**
 * Entry point: builds the import graph and reports any runtime cycles.
 *
 * @returns {void}
 */
function main() {
  const { nodes, edges } = buildGraph();
  const cycles = findCycles(nodes, edges);
  if (cycles.length === 0) {
    console.log(`check-circular: scanned ${nodes.length} files, no runtime circular dependencies in src/`);
    process.exit(0);
  }
  console.error(`check-circular: ${cycles.length} runtime circular dependency(ies) found:`);
  for (const scc of cycles) {
    const rel = scc.map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));
    console.error(`  ${rel.join(' > ')} > ${rel[0]}`);
  }
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`check-circular: scanner failed: ${err.message}`);
  process.exit(2);
}
