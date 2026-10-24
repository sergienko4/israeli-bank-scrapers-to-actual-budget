import { describe, expect, it } from 'vitest';

import { refusedTokensPathOf } from '../../src/Scraper/Tokens/BankTokenPath.js';
import type RefusedTokens from '../../src/Scraper/Tokens/RefusedTokens.js';
import { REFUSALS_PER_ENTRY } from '../../src/Scraper/Tokens/RefusedTokens.js';
import tokenDigest from '../../src/Scraper/Tokens/TokenDigest.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import {
  fakeToken, makeRefusals, OWNER_ONLY, REFUSED_PATH,
} from './BankTokenStoreFixture.js';

const ENTRY = 'oneZero:oneZero';
const OTHER_ENTRY = 'oneZero:second';

/** A refusal registry under test and the filesystem behind it. */
interface IRegistryUnderTest {
  readonly refusals: RefusedTokens;
  readonly fileSystem: FakeFileSystem;
}

/**
 * Builds a registry over an in-memory data volume.
 * @returns The registry and its filesystem.
 */
function makeRegistry(): IRegistryUnderTest {
  const fileSystem = new FakeFileSystem();
  return { refusals: makeRefusals(fileSystem), fileSystem };
}

/**
 * Refuses a digest, failing the case when the registry cannot save it.
 * @param refusals - Registry under test.
 * @param storeKey - Entry the digest is refused for.
 * @param digest - Digest to refuse.
 * @returns Nothing.
 */
function refuseOrThrow(refusals: RefusedTokens, storeKey: string, digest: string): void {
  const refused = refusals.refuse(storeKey, digest);
  if (!refused.success) throw new Error(`refuse failed: ${refused.message}`);
}

/**
 * Asks whether a digest is refused, failing the case when the registry is unreadable.
 * @param refusals - Registry under test.
 * @param digest - Digest to look up.
 * @returns True when any entry refused the digest.
 */
function isRefused(refusals: RefusedTokens, digest: string): boolean {
  const view = refusals.read();
  if (!view.success) throw new Error(`read failed: ${view.message}`);
  return view.data.has(digest);
}

/**
 * Lists the files the registry set aside as damaged.
 * @param fileSystem - Filesystem behind the registry.
 * @returns Names of the quarantined copies.
 */
function quarantined(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => name.startsWith(`${REFUSED_PATH}.quarantined-`));
}

describe('refusedTokensPathOf', () => {
  it('names a sibling of the token file, never the token file itself', () => {
    expect(refusedTokensPathOf('/app/data/bank-tokens.json'))
      .toBe('/app/data/bank-tokens.refused.json');
    expect(refusedTokensPathOf('/srv/tokens')).toBe('/srv/tokens.refused.json');
  });
});

describe('RefusedTokens', () => {
  it('names a refused digest whichever entry refused it, and no other digest', () => {
    const { refusals } = makeRegistry();
    const digest = tokenDigest(fakeToken());
    refuseOrThrow(refusals, OTHER_ENTRY, digest);

    expect({
      refused: isRefused(refusals, digest),
      otherDigest: isRefused(refusals, tokenDigest(fakeToken())),
    }).toEqual({ refused: true, otherDigest: false });
  });

  it('writes only digests, owner-only, never the token', () => {
    const { refusals, fileSystem } = makeRegistry();
    const token = fakeToken();
    refuseOrThrow(refusals, ENTRY, tokenDigest(token));

    expect(fileSystem.contentsOf(REFUSED_PATH)).not.toContain(token);
    expect(JSON.parse(fileSystem.contentsOf(REFUSED_PATH))).toEqual({
      [ENTRY]: [tokenDigest(token)],
    });
    expect(fileSystem.modeOf(REFUSED_PATH)).toBe(OWNER_ONLY);
  });

  it('moves a digest refused again to the newest place instead of repeating it', () => {
    const { refusals, fileSystem } = makeRegistry();
    const [first, second] = [tokenDigest(fakeToken()), tokenDigest(fakeToken())];
    refuseOrThrow(refusals, ENTRY, first);
    refuseOrThrow(refusals, ENTRY, second);
    refuseOrThrow(refusals, ENTRY, first);

    expect(JSON.parse(fileSystem.contentsOf(REFUSED_PATH))).toEqual({ [ENTRY]: [second, first] });
  });

  it('keeps the newest refusals per entry, evicting the oldest past the cap', () => {
    const { refusals } = makeRegistry();
    const digests = Array.from({ length: REFUSALS_PER_ENTRY + 1 }, () => tokenDigest(fakeToken()));
    for (const digest of digests) refuseOrThrow(refusals, ENTRY, digest);

    const kept = digests.map((digest) => isRefused(refusals, digest));
    expect(kept).toEqual([false, ...Array<boolean>(REFUSALS_PER_ENTRY).fill(true)]);
  });

  it('keeps other entries when one entry refuses a token', () => {
    const { refusals, fileSystem } = makeRegistry();
    const [mine, theirs] = [tokenDigest(fakeToken()), tokenDigest(fakeToken())];
    refuseOrThrow(refusals, OTHER_ENTRY, theirs);
    refuseOrThrow(refusals, ENTRY, mine);

    expect(JSON.parse(fileSystem.contentsOf(REFUSED_PATH))).toEqual({
      [OTHER_ENTRY]: [theirs], [ENTRY]: [mine],
    });
  });

  it('refuses to record something that is not a digest, so no token is ever written', () => {
    const { refusals, fileSystem } = makeRegistry();
    const token = fakeToken();

    expect(refusals.refuse(ENTRY, token)).toMatchObject({ success: false });
    expect(fileSystem.hasEntry(REFUSED_PATH)).toBe(false);
  });

  describe('when the file is absent', () => {
    it('reads as an intact, empty registry', () => {
      const { refusals } = makeRegistry();
      const view = refusals.read();

      expect(view.success && view.data.isIntact).toBe(true);
      expect(isRefused(refusals, tokenDigest(fakeToken()))).toBe(false);
    });
  });

  describe('when the file is damaged', () => {
    it('reads as an empty registry that is not intact', () => {
      const { refusals, fileSystem } = makeRegistry();
      fileSystem.seedFile(REFUSED_PATH, '{ not json', OWNER_ONLY);
      const view = refusals.read();

      expect(view.success && view.data.isIntact).toBe(false);
      expect(isRefused(refusals, tokenDigest(fakeToken()))).toBe(false);
    });

    it('sets the damaged file aside before saving a refusal over it', () => {
      const { refusals, fileSystem } = makeRegistry();
      fileSystem.seedFile(REFUSED_PATH, '{ not json', OWNER_ONLY);
      const digest = tokenDigest(fakeToken());
      refuseOrThrow(refusals, ENTRY, digest);

      expect(quarantined(fileSystem)).toHaveLength(1);
      expect(isRefused(refusals, digest)).toBe(true);
    });

    it('honours the valid digests of an entry that also holds junk, and rewrites it clean', () => {
      const { refusals, fileSystem } = makeRegistry();
      const kept = tokenDigest(fakeToken());
      const contents = JSON.stringify({ [ENTRY]: [kept, 'junk', 7], [OTHER_ENTRY]: 'junk' });
      fileSystem.seedFile(REFUSED_PATH, contents, OWNER_ONLY);
      const view = refusals.read();
      const added = tokenDigest(fakeToken());
      refuseOrThrow(refusals, ENTRY, added);

      expect(view.success && view.data.isIntact).toBe(false);
      expect(view.success && view.data.has(kept)).toBe(true);
      expect(quarantined(fileSystem)).toHaveLength(1);
      expect(JSON.parse(fileSystem.contentsOf(REFUSED_PATH))).toEqual({ [ENTRY]: [kept, added] });
    });
  });

  describe('when the file cannot be read', () => {
    it('reports the read as a failure', () => {
      const { refusals, fileSystem } = makeRegistry();
      fileSystem.seedFile(REFUSED_PATH, '{}', OWNER_ONLY);
      fileSystem.forcedFailures.set('openForRead', 'EACCES');

      expect(refusals.read()).toMatchObject({ success: false, status: 'EACCES' });
    });

    it('never replaces the file it could not read', () => {
      const { refusals, fileSystem } = makeRegistry();
      fileSystem.seedFile(REFUSED_PATH, '{}', OWNER_ONLY);
      fileSystem.forcedFailures.set('openForRead', 'EACCES');
      const refused = refusals.refuse(ENTRY, tokenDigest(fakeToken()));

      expect(refused).toMatchObject({ success: false });
      expect(fileSystem.contentsOf(REFUSED_PATH)).toBe('{}');
    });
  });

  it('sweeps staged files a killed write left beside the registry', () => {
    const { refusals, fileSystem } = makeRegistry();
    const staged = `${REFUSED_PATH}.00000000-0000-4000-8000-000000000000.tmp`;
    fileSystem.seedFile(staged, '{}', OWNER_ONLY);
    fileSystem.setModifiedAt(staged, 0);
    const swept = refusals.sweepStagedLeftovers();

    expect(swept).toMatchObject({ success: true, data: { removedCount: 1 } });
    expect(fileSystem.hasEntry(staged)).toBe(false);
  });
});
