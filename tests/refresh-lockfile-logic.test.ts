import { describe, expect, it } from 'vitest';

import {
  auditLockfile,
  CANONICAL_REGISTRY,
  canonicalizeRegistryUrls,
  findForeignRegistryEntries,
  findWeakIntegrities,
  formatLockfileReport,
  formatRefreshBody,
  formatRepairSummary,
  summarizeRefresh,
} from '../scripts/refresh-lockfile-logic.mjs';

/** Builds a minimal lockfile document around the supplied package entries. */
function lockfile(packages: Record<string, unknown>): string {
  return JSON.stringify(
    { name: 'israeli-bank-actual-importer', lockfileVersion: 3, packages },
    null,
    2,
  );
}

const CLEAN = lockfile({
  '': { name: 'israeli-bank-actual-importer' },
  'node_modules/browserslist': {
    version: '4.28.8',
    resolved: 'https://registry.npmjs.org/browserslist/-/browserslist-4.28.8.tgz',
    integrity: 'sha512-abc',
  },
});

// The two rewrites observed from the corporate mirror. Both must be caught.
const AZURE =
  'https://ms-feed-1.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/browserslist/-/browserslist-4.28.8.tgz';
const PROXY = 'https://packagefeedproxy.microsoft.io/npm/nanoid/-/nanoid-3.3.18.tgz';

// A scoped package behind the same mirror. Scoped names are the case most
// likely to break: the `@scope/` prefix is part of the registry path, so
// dropping it would yield a URL that 404s instead of one that merely looks odd.
const AZURE_SCOPED =
  'https://ms-feed-1.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry/@actual-app/api/-/api-26.9.0.tgz';

describe('CANONICAL_REGISTRY', () => {
  it('is the public npm registry', () => {
    expect(CANONICAL_REGISTRY).toBe('https://registry.npmjs.org/');
  });
});

describe('findForeignRegistryEntries', () => {
  it('returns nothing for a canonical lockfile', () => {
    expect(findForeignRegistryEntries(CLEAN)).toEqual([]);
  });

  it('flags an Azure Artifacts rewrite', () => {
    const found = findForeignRegistryEntries(
      lockfile({ 'node_modules/browserslist': { version: '4.28.8', resolved: AZURE } }),
    );
    expect(found).toEqual([{ path: 'node_modules/browserslist', resolved: AZURE }]);
  });

  it('flags a packagefeedproxy rewrite', () => {
    const found = findForeignRegistryEntries(
      lockfile({ 'node_modules/nanoid': { version: '3.3.18', resolved: PROXY } }),
    );
    expect(found).toHaveLength(1);
  });

  it('ignores entries with no resolved URL, such as the root and link targets', () => {
    const text = lockfile({
      '': { name: 'root' },
      'node_modules/local': { resolved: 'file:../local', link: true },
    });
    expect(findForeignRegistryEntries(text)).toEqual([]);
  });

  it('ignores git-sourced dependencies, which never carry a registry URL', () => {
    const text = lockfile({
      'node_modules/forked': { resolved: 'git+ssh://git@github.com/o/r.git#abc' },
    });
    expect(findForeignRegistryEntries(text)).toEqual([]);
  });

  it('rejects a lookalike host that merely embeds the registry name', () => {
    const text = lockfile({
      'node_modules/evil': { resolved: 'https://registry.npmjs.org.evil.com/evil/-/evil-1.0.0.tgz' },
    });
    expect(findForeignRegistryEntries(text)).toHaveLength(1);
  });
});

describe('findWeakIntegrities', () => {
  it('returns nothing when every integrity is sha512', () => {
    expect(findWeakIntegrities(CLEAN)).toEqual([]);
  });

  it('flags a legacy sha1 integrity, which the mirror substitutes', () => {
    const text = lockfile({
      'node_modules/escalade': { version: '3.2.0', integrity: 'sha1-deadbeef' },
    });
    expect(findWeakIntegrities(text)).toEqual([
      { path: 'node_modules/escalade', integrity: 'sha1-deadbeef' },
    ]);
  });

  it('accepts sha384 as well, since npm treats it as strong', () => {
    const text = lockfile({ 'node_modules/x': { integrity: 'sha384-zzz' } });
    expect(findWeakIntegrities(text)).toEqual([]);
  });

  it('ignores entries with no integrity field', () => {
    expect(findWeakIntegrities(lockfile({ 'node_modules/x': { version: '1.0.0' } }))).toEqual([]);
  });
});

describe('canonicalizeRegistryUrls', () => {
  it('rewrites an Azure Artifacts URL back to the public registry', () => {
    const { text, replaced } = canonicalizeRegistryUrls(
      lockfile({ 'node_modules/browserslist': { resolved: AZURE } }),
    );
    expect(replaced).toBe(1);
    expect(text).toContain(
      'https://registry.npmjs.org/browserslist/-/browserslist-4.28.8.tgz',
    );
    expect(text).not.toContain('visualstudio.com');
  });

  it('rewrites a packagefeedproxy URL back to the public registry', () => {
    const { text } = canonicalizeRegistryUrls(lockfile({ 'node_modules/nanoid': { resolved: PROXY } }));
    expect(text).toContain('https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz');
  });

  it('leaves a canonical lockfile byte-identical', () => {
    const { text, replaced } = canonicalizeRegistryUrls(CLEAN);
    expect(replaced).toBe(0);
    expect(text).toBe(CLEAN);
  });

  it('preserves formatting so npm does not rewrite the whole file', () => {
    const original = lockfile({ 'node_modules/browserslist': { resolved: AZURE } });
    const { text } = canonicalizeRegistryUrls(original);
    expect(text.split('\n')).toHaveLength(original.split('\n').length);
  });

  it('does not touch git URLs', () => {
    const git = lockfile({ 'node_modules/f': { resolved: 'git+ssh://git@github.com/o/r.git#a' } });
    expect(canonicalizeRegistryUrls(git).text).toBe(git);
  });

  it('keeps the scope prefix when rewriting a scoped package', () => {
    const { text, replaced } = canonicalizeRegistryUrls(
      lockfile({ 'node_modules/@actual-app/api': { resolved: AZURE_SCOPED } }),
    );
    expect(replaced).toBe(1);
    expect(text).toContain('https://registry.npmjs.org/@actual-app/api/-/api-26.9.0.tgz');
    expect(text).not.toContain('visualstudio.com');
  });

  it('recovers a scoped name from a nested install path', () => {
    const nested = lockfile({
      'node_modules/parent/node_modules/@scope/child': {
        resolved: 'https://packagefeedproxy.microsoft.io/npm/@scope/child/-/child-1.0.0.tgz',
      },
    });
    expect(canonicalizeRegistryUrls(nested).text).toContain(
      'https://registry.npmjs.org/@scope/child/-/child-1.0.0.tgz',
    );
  });

  it('drops a mirror query string rather than carrying it to the registry', () => {
    const withQuery = lockfile({ 'node_modules/nanoid': { resolved: `${PROXY}?resolve=true` } });
    const { text } = canonicalizeRegistryUrls(withQuery);
    expect(text).toContain('https://registry.npmjs.org/nanoid/-/nanoid-3.3.18.tgz');
    expect(text).not.toContain('resolve=true');
  });
});

describe('formatRepairSummary', () => {
  it('reports how many URLs were rewritten', () => {
    expect(formatRepairSummary(3)).toContain('Rewrote 3 mirror-sourced registry URL(s).');
  });

  it('warns that the carried-over integrity hashes are unverified', () => {
    const summary = formatRepairSummary(1);
    expect(summary).toContain('NOT verified here');
    expect(summary).toContain('npm ci');
  });

  it('explains why the hashes are not regenerated from the registry', () => {
    expect(formatRepairSummary(1)).toContain('erase the evidence');
  });

  it('stays quiet about integrity when nothing was rewritten', () => {
    expect(formatRepairSummary(0)).toBe('Rewrote 0 mirror-sourced registry URL(s).');
  });
});

describe('auditLockfile', () => {
  it('approves a canonical lockfile', () => {
    expect(auditLockfile(CLEAN)).toEqual({
      ok: true,
      foreignRegistries: [],
      weakIntegrities: [],
    });
  });

  it('rejects a lockfile carrying a mirror URL', () => {
    expect(auditLockfile(lockfile({ 'node_modules/b': { resolved: AZURE } })).ok).toBe(false);
  });

  it('rejects a lockfile carrying a sha1 integrity', () => {
    expect(auditLockfile(lockfile({ 'node_modules/b': { integrity: 'sha1-x' } })).ok).toBe(false);
  });

  it('reports both defect classes at once', () => {
    const audit = auditLockfile(
      lockfile({ 'node_modules/b': { resolved: AZURE, integrity: 'sha1-x' } }),
    );
    expect(audit.foreignRegistries).toHaveLength(1);
    expect(audit.weakIntegrities).toHaveLength(1);
  });

  it('throws a clear error on malformed JSON rather than passing silently', () => {
    expect(() => auditLockfile('{ not json')).toThrow('package-lock.json is not valid JSON');
  });

  it('treats a lockfile with no packages section as clean', () => {
    expect(auditLockfile('{"lockfileVersion":3}').ok).toBe(true);
  });
});

describe('formatLockfileReport', () => {
  it('confirms success when the lockfile is canonical', () => {
    expect(formatLockfileReport(auditLockfile(CLEAN))).toContain('canonical');
  });

  it('names the offending package so the operator can act', () => {
    const report = formatLockfileReport(auditLockfile(lockfile({ 'node_modules/b': { resolved: AZURE } })));
    expect(report).toContain('node_modules/b');
  });

  it('explains how to repair a mirror-rewritten lockfile', () => {
    const report = formatLockfileReport(auditLockfile(lockfile({ 'node_modules/b': { resolved: AZURE } })));
    expect(report).toContain('refresh-lockfile');
  });

  it('does not offer the local repair for an integrity downgrade it cannot fix', () => {
    // Recomputing a hash locally would trust the mirror-served tarball, so
    // pointing the operator at the local command here would be actively wrong.
    const report = formatLockfileReport(auditLockfile(lockfile({ 'node_modules/b': { integrity: 'sha1-x' } })));
    expect(report).not.toContain('npm run refresh-lockfile');
    expect(report).toContain('Lockfile refresh');
  });

  it('offers both remedies when both defect classes are present', () => {
    const report = formatLockfileReport(
      auditLockfile(lockfile({ 'node_modules/b': { resolved: AZURE, integrity: 'sha1-x' } })),
    );
    expect(report).toContain('npm run refresh-lockfile');
    expect(report).toContain('Lockfile refresh');
  });
});

describe('summarizeRefresh', () => {
  const before = lockfile({
    'node_modules/runtime-pkg': { version: '1.0.0' },
    'node_modules/dev-pkg': { version: '2.0.0', dev: true },
  });

  it('reports no change when the lockfile is untouched', () => {
    const summary = summarizeRefresh(before, before);
    expect(summary.hasChanges).toBe(false);
    expect(summary.runtimeChanges).toEqual([]);
    expect(summary.devChanges).toEqual([]);
  });

  it('classifies a dev-only bump as non-release-triggering', () => {
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.0.0' },
      'node_modules/dev-pkg': { version: '2.1.0', dev: true },
    });
    const summary = summarizeRefresh(before, after);
    expect(summary.commitType).toBe('chore');
    expect(summary.devChanges).toEqual([
      { path: 'node_modules/dev-pkg', from: '2.0.0', to: '2.1.0' },
    ]);
    expect(summary.runtimeChanges).toEqual([]);
  });

  it('classifies a runtime bump as release-triggering', () => {
    // A transitive runtime pin ships inside the published Docker image, so it
    // has to reach users through a release — the same rule the release-signal
    // guard applies to direct dependencies.
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.1.0' },
      'node_modules/dev-pkg': { version: '2.0.0', dev: true },
    });
    const summary = summarizeRefresh(before, after);
    expect(summary.commitType).toBe('fix');
    expect(summary.runtimeChanges).toHaveLength(1);
  });

  it('prefers the release-triggering type when both kinds change together', () => {
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.1.0' },
      'node_modules/dev-pkg': { version: '2.1.0', dev: true },
    });
    expect(summarizeRefresh(before, after).commitType).toBe('fix');
  });

  it('treats a newly added runtime package as a runtime change', () => {
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.0.0' },
      'node_modules/dev-pkg': { version: '2.0.0', dev: true },
      'node_modules/added': { version: '0.1.0' },
    });
    expect(summarizeRefresh(before, after).runtimeChanges).toEqual([
      { path: 'node_modules/added', from: undefined, to: '0.1.0' },
    ]);
  });

  it('treats a removed runtime package as a runtime change', () => {
    const after = lockfile({ 'node_modules/dev-pkg': { version: '2.0.0', dev: true } });
    expect(summarizeRefresh(before, after).runtimeChanges).toEqual([
      { path: 'node_modules/runtime-pkg', from: '1.0.0', to: undefined },
    ]);
  });

  it('ignores the root entry, which has no version of its own to drift', () => {
    const withRoot = lockfile({ '': { name: 'root' }, 'node_modules/runtime-pkg': { version: '1.0.0' } });
    const rootRenamed = lockfile({ '': { name: 'other' }, 'node_modules/runtime-pkg': { version: '1.0.0' } });
    expect(summarizeRefresh(withRoot, rootRenamed).hasChanges).toBe(false);
  });

  it('builds a conventional-commit title CI can parse', () => {
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.1.0' },
      'node_modules/dev-pkg': { version: '2.0.0', dev: true },
    });
    expect(summarizeRefresh(before, after).title).toBe(
      'fix(deps): refresh 1 runtime and 0 dev lockfile pins',
    );
  });

  it('titles a dev-only refresh without claiming a runtime change', () => {
    const after = lockfile({
      'node_modules/runtime-pkg': { version: '1.0.0' },
      'node_modules/dev-pkg': { version: '2.1.0', dev: true },
    });
    expect(summarizeRefresh(before, after).title).toBe(
      'chore(deps): refresh 0 runtime and 1 dev lockfile pins',
    );
  });
});

describe('formatRefreshBody', () => {
  const runtimeMove = lockfile({
    'node_modules/browserslist': { version: '4.28.2' },
    'node_modules/vitest': { version: '3.0.0', dev: true },
  });

  it('names the command that produced the change, so a reviewer can reproduce it', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.8' },
      'node_modules/vitest': { version: '3.0.0', dev: true },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('npm update --package-lock-only');
  });

  it('reports a moved runtime pin by package name, not lockfile path', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.8' },
      'node_modules/vitest': { version: '3.0.0', dev: true },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('`browserslist` 4.28.2 → 4.28.8');
    expect(body).not.toContain('node_modules/browserslist');
  });

  it('describes an added package as added rather than as a version move', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.2' },
      'node_modules/vitest': { version: '3.0.0', dev: true },
      'node_modules/caniuse-lite': { version: '1.0.30001810' },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('`caniuse-lite` added at 1.0.30001810');
  });

  it('describes a removed package as removed, keeping the version it had', () => {
    const after = lockfile({ 'node_modules/vitest': { version: '3.0.0', dev: true } });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('`browserslist` removed (was 4.28.2)');
  });

  it('explains that a runtime change has to reach users through a release', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.8' },
      'node_modules/vitest': { version: '3.0.0', dev: true },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('fix(deps)');
    expect(body).toContain('published Docker image');
  });

  it('states that a dev-only refresh ships no release', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.2' },
      'node_modules/vitest': { version: '3.1.0', dev: true },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('chore(deps)');
    expect(body).toContain('no release');
  });

  it('omits a section heading for a dependency kind that did not change', () => {
    const after = lockfile({
      'node_modules/browserslist': { version: '4.28.2' },
      'node_modules/vitest': { version: '3.1.0', dev: true },
    });
    const body = formatRefreshBody(summarizeRefresh(runtimeMove, after));
    expect(body).toContain('Development pins (1)');
    expect(body).not.toContain('Runtime pins');
  });
});
