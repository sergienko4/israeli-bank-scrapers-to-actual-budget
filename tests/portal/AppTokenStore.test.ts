import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAppTokenRecord, TokenGrant } from '../../src/Portal/AppTokenStore.js';
import {
  AppTokenStore, DEFAULT_REFRESH_TTL_DAYS, resolveAppTokensPath, ROTATION_OVERLAP_MS,
} from '../../src/Portal/AppTokenStore.js';
import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';
import { isFail, isSuccess } from '../../src/Types/Index.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A moment after the overlap of a rotation made at `NOW + 1000`. */
const PAST_OVERLAP = NOW + 1000 + ROTATION_OVERLAP_MS + 1;

const GRANT: TokenGrant = {
  deviceName: 'Pixel 8',
  email: 'operator@example.com',
  factors: { google: true, password: true },
  fingerprint: 'fp',
};

describe('AppTokenStore', () => {
  let dir: string;
  let file: string;
  let store: AppTokenStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-tokens-'));
    file = join(dir, 'app-tokens.json');
    store = new AppTokenStore(createNodeFileSystem(), file);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('resolveAppTokensPath', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('falls back to the shared data volume when unset', () => {
      vi.stubEnv('APP_TOKENS_PATH', undefined);
      expect(resolveAppTokensPath()).toBe('/app/data/app-tokens.json');
    });

    it('honours an explicit override', () => {
      vi.stubEnv('APP_TOKENS_PATH', '/custom/tokens.json');
      expect(resolveAppTokensPath()).toBe('/custom/tokens.json');
    });
  });

  describe('issue', () => {
    it('returns a base64url token and a loggable record id', () => {
      const issued = store.issue(GRANT, NOW);
      expect(issued.token).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      expect(issued.record.id).toMatch(/^[A-Za-z0-9\-_]{22}$/);
      expect(issued.record.deviceName).toBe('Pixel 8');
    });

    it('expires the token after the configured lifetime', () => {
      const issued = store.issue(GRANT, NOW);
      expect(issued.record.expiresAt).toBe(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS);
    });

    it('honours a shorter configured lifetime', () => {
      const short = new AppTokenStore(createNodeFileSystem(), file, 7);
      expect(short.issue(GRANT, NOW).record.expiresAt).toBe(NOW + 7 * DAY_MS);
    });

    it('never writes the plaintext token to disk', () => {
      const issued = store.issue(GRANT, NOW);
      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain(issued.token);
      expect(raw).toContain(issued.record.tokenHash);
    });

    it('gives each device its own family', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.issue({ ...GRANT, deviceName: 'iPhone' }, NOW);
      expect(first.record.familyId).not.toBe(second.record.familyId);
      expect(store.list(NOW)).toHaveLength(2);
    });
  });

  describe('findByToken', () => {
    it('finds a live record by its plaintext token', () => {
      const issued = store.issue(GRANT, NOW);
      expect(store.findByToken(issued.token, NOW)?.id).toBe(issued.record.id);
    });

    it('does not find an unknown token', () => {
      store.issue(GRANT, NOW);
      expect(store.findByToken('not-a-token', NOW)).toBeUndefined();
    });
  });

  describe('rotate', () => {
    it('replaces the token and keeps the family', () => {
      const issued = store.issue(GRANT, NOW);
      const result = store.rotate(issued.token, NOW + 1000);
      expect(isSuccess(result)).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.token).not.toBe(issued.token);
      expect(result.data.record.familyId).toBe(issued.record.familyId);
      expect(result.data.record.deviceName).toBe('Pixel 8');
    });

    it('carries the authorization context forward', () => {
      const issued = store.issue(GRANT, NOW);
      const result = store.rotate(issued.token, NOW + 1000);
      if (!isSuccess(result)) throw new Error('expected rotation to succeed');
      expect(result.data.record.factors).toEqual({ google: true, password: true });
      expect(result.data.record.email).toBe('operator@example.com');
      expect(result.data.record.fingerprint).toBe('fp');
    });

    it('retires the presented token', () => {
      const issued = store.issue(GRANT, NOW);
      store.rotate(issued.token, NOW + 1000);
      expect(store.list(NOW + 1000)).toHaveLength(1);
    });

    it('rejects an unknown token', () => {
      const result = store.rotate('not-a-token', NOW);
      expect(isFail(result) && result.message).toBe('Unknown refresh token');
    });

    it('treats an expired token as one it has never heard of', () => {
      const issued = store.issue(GRANT, NOW);
      const later = NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1;
      const result = store.rotate(issued.token, later);
      expect(isFail(result) && result.message).toBe('Unknown refresh token');
    });

    it('revokes the whole family when a retired token is replayed', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      const replay = store.rotate(first.token, PAST_OVERLAP);
      expect(isFail(replay)).toBe(true);
      if (!isFail(replay)) return;
      expect(replay.status).toBe('reused');
      expect(replay.details).toContain(`id=${first.record.id}`);
      expect(store.list(PAST_OVERLAP)).toHaveLength(0);
    });

    it('locks out the thief and the victim alike after a replay', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      store.rotate(first.token, PAST_OVERLAP);
      expect(isFail(store.rotate(second.data.token, PAST_OVERLAP + 1))).toBe(true);
    });
  });

  describe('rotation overlap', () => {
    /**
     * Issues a token and rotates it once, as a phone whose reply was lost would.
     * @returns The spent token and the successor it bought.
     */
    function rotatedOnce(): { spent: string; successor: string } {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      return { spent: first.token, successor: second.data.token };
    }

    /**
     * A record as the file holds it, for a token whose plaintext is its name.
     * @param name - The plaintext token, also the start of the record id.
     * @param issuedAt - When the token was issued.
     * @param fields - What a rotation or another sign-in changes.
     * @returns The stored record.
     */
    function storedToken(
      name: string, issuedAt: number, fields: Partial<IAppTokenRecord> = {},
    ): IAppTokenRecord {
      return {
        id: name.padEnd(22, 'A'), familyId: '0f0e0d0c-0b0a-4908-8706-050403020100',
        tokenHash: createHash('sha256').update(name).digest('hex'),
        deviceName: 'Pixel 8', factors: { ...GRANT.factors }, fingerprint: 'fp',
        issuedAt, lastUsedAt: fields.revokedAt ?? issuedAt, expiresAt: issuedAt + DAY_MS,
        ...fields,
      };
    }

    it('re-grants a spent token presented again within the overlap', () => {
      const { spent, successor } = rotatedOnce();
      const again = store.rotate(spent, NOW + 1000 + ROTATION_OVERLAP_MS);
      if (!isSuccess(again)) throw new Error('expected a re-grant');
      expect(again.data.token).not.toBe(spent);
      expect(again.data.token).not.toBe(successor);
      expect(store.list(NOW + 1000 + ROTATION_OVERLAP_MS)).toHaveLength(1);
    });

    it('revokes the family once the overlap has passed', () => {
      const { spent } = rotatedOnce();
      const late = store.rotate(spent, NOW + 1000 + ROTATION_OVERLAP_MS + 1);
      expect(isFail(late) && late.status).toBe('reused');
      expect(store.list(NOW + 1000 + ROTATION_OVERLAP_MS + 1)).toHaveLength(0);
    });

    it('retires the successor it replaced, so presenting that one is a replay', () => {
      const { spent, successor } = rotatedOnce();
      const again = store.rotate(spent, NOW + 2000);
      if (!isSuccess(again)) throw new Error('expected a re-grant');
      const stale = store.rotate(successor, NOW + 3000);
      expect(isFail(stale) && stale.status).toBe('reused');
      expect(isFail(store.rotate(again.data.token, NOW + 4000))).toBe(true);
    });

    it('re-grants again within the same overlap, which never extends', () => {
      const { spent } = rotatedOnce();
      const second = store.rotate(spent, NOW + 2000);
      const third = store.rotate(spent, NOW + 1000 + ROTATION_OVERLAP_MS);
      if (!isSuccess(second) || !isSuccess(third)) throw new Error('expected re-grants');
      expect(third.data.token).not.toBe(second.data.token);
      expect(isFail(store.rotate(second.data.token, NOW + 3000))).toBe(true);
    });

    it('anchors the overlap at the first rotation, not at the last re-grant', () => {
      const { spent } = rotatedOnce();
      store.rotate(spent, NOW + 1000 + ROTATION_OVERLAP_MS);
      const late = store.rotate(spent, NOW + 1000 + ROTATION_OVERLAP_MS + 1);
      expect(isFail(late) && late.status).toBe('reused');
    });

    it('treats a spent token whose successor was already used as a replay', () => {
      const { spent, successor } = rotatedOnce();
      const third = store.rotate(successor, NOW + 2000);
      if (!isSuccess(third)) throw new Error('expected rotation to succeed');
      const replay = store.rotate(spent, NOW + 3000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 3000)).toHaveLength(0);
    });

    it('treats the second-to-last token as a replay within the overlap', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      store.rotate(second.data.token, NOW + 2000);
      const replay = store.rotate(first.token, NOW + 3000);
      expect(isFail(replay) && replay.status).toBe('reused');
    });

    it('cannot bring back a family that was signed out', () => {
      const { spent, successor } = rotatedOnce();
      store.revokeByToken(successor, NOW + 2000);
      const again = store.rotate(spent, NOW + 3000);
      expect(isFail(again) && again.status).toBe('reused');
      expect(store.list(NOW + 3000)).toHaveLength(0);
    });

    it('never takes the replaced successor for a predecessor, even within one millisecond', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      const again = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(again)) throw new Error('expected a re-grant');
      const stale = store.rotate(second.data.token, NOW + 1000);
      expect(isFail(stale) && stale.status).toBe('reused');
    });

    it('treats a spent token as a replay when its successor was used in the same millisecond', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      store.rotate(second.data.token, NOW + 1000);
      const replay = store.rotate(first.token, NOW + 1000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 1000)).toHaveLength(0);
    });

    it('treats a re-granted spent token as a replay once its new successor was used', () => {
      const { spent } = rotatedOnce();
      const again = store.rotate(spent, NOW + 1000);
      if (!isSuccess(again)) throw new Error('expected a re-grant');
      store.rotate(again.data.token, NOW + 1000);
      const replay = store.rotate(spent, NOW + 1000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 1000)).toHaveLength(0);
    });

    it('records the successor on the spent token only, so a rollback keeps live sign-ins', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { tokens: IAppTokenRecord[] };
      expect(stored.tokens.map((record) => record.successorId)).toEqual([second.data.record.id, undefined]);
    });

    it('never re-grants into another sign-in, even when the file names its token', () => {
      writeFileSync(file, JSON.stringify({
        tokens: [
          storedToken('spent', NOW, { revokedAt: NOW + 1000, successorId: 'other'.padEnd(22, 'A') }),
          storedToken('other', NOW + 1000, { familyId: '1f1e1d1c-1b1a-4918-8716-151413121110' }),
        ],
      }));
      const replay = store.rotate('spent', NOW + 2000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 2000).map((record) => record.id)).toEqual(['other'.padEnd(22, 'A')]);
    });

    it('fails closed on a chain an earlier release wrote within one millisecond', () => {
      writeFileSync(file, JSON.stringify({
        tokens: [
          storedToken('first', NOW, { revokedAt: NOW + 1000 }),
          storedToken('second', NOW + 1000, { revokedAt: NOW + 1000 }),
          storedToken('third', NOW + 1000),
        ],
      }));
      const replay = store.rotate('first', NOW + 2000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 2000)).toHaveLength(0);
    });

    it('never re-grants a token an earlier release spent, which named no successor', () => {
      writeFileSync(file, JSON.stringify({
        tokens: [
          storedToken('first', NOW, { revokedAt: NOW + 1000 }),
          storedToken('second', NOW + 1000),
        ],
      }));
      const replay = store.rotate('first', NOW + 2000);
      expect(isFail(replay) && replay.status).toBe('reused');
      expect(store.list(NOW + 2000)).toHaveLength(0);
    });

    it('keeps the device name and factors on the re-granted token', () => {
      const { spent } = rotatedOnce();
      const again = store.rotate(spent, NOW + 2000);
      if (!isSuccess(again)) throw new Error('expected a re-grant');
      expect(again.data.record).toMatchObject({
        deviceName: 'Pixel 8', factors: GRANT.factors, fingerprint: 'fp', issuedAt: NOW + 2000,
      });
    });
  });

  describe('rotation overlap against a reference model', () => {
    /** A token as the model sees it: who replaced it, never when. */
    interface IModelToken {
      token: string;
      live: boolean;
      successor?: IModelToken;
    }

    type Outcome = 'rotated' | 'regranted' | 'reused';

    /**
     * What presenting a token must do within the overlap, decided only from
     * which token replaced which.
     * @param presented - The token presented.
     * @returns The outcome the overlap rule requires.
     */
    function expectedOutcome(presented: IModelToken): Outcome {
      if (presented.live) return 'rotated';
      if (presented.successor?.live === true) return 'regranted';
      return 'reused';
    }

    /**
     * Every way to present tokens `length` times, where step `n` picks one
     * of at most `n + 1` tokens issued so far.
     * @param length - How many presentations each sequence makes.
     * @returns The picks of every sequence.
     */
    function pickSequences(length: number): number[][] {
      let sequences: number[][] = [[]];
      for (let step = 0; step < length; step += 1) {
        sequences = sequences.flatMap(
          (picks) => Array.from({ length: step + 1 }, (_unused, pick) => [...picks, pick]),
        );
      }
      return sequences;
    }

    /**
     * Plays one sequence against a fresh store and the model side by side.
     * The store sits on the in-memory filesystem, so hundreds of sequences
     * stay fast.
     * @param picks - Which issued token each step presents.
     * @param clock - The time each step presents its token at.
     * @returns The first step where the store and the model disagree, or none.
     */
    function firstDisagreement(
      picks: readonly number[], clock: (step: number) => number,
    ): string | undefined {
      const subject = new AppTokenStore(new FakeFileSystem(), '/data/app-tokens.json');
      const tokens: IModelToken[] = [{ token: subject.issue(GRANT, NOW).token, live: true }];
      for (const [step, pick] of picks.entries()) {
        const presented = tokens[pick % tokens.length];
        const expected = expectedOutcome(presented);
        const actual = subject.rotate(presented.token, clock(step));
        const outcome = isSuccess(actual) ? 'granted' : actual.status;
        if (outcome !== (expected === 'reused' ? 'reused' : 'granted')) {
          return `picks ${picks.join(',')}: step ${String(step)} expected ${expected}`;
        }
        if (isSuccess(actual)) {
          const issued: IModelToken = { token: actual.data.token, live: true };
          if (expected === 'regranted' && presented.successor) presented.successor.live = false;
          presented.live = false;
          presented.successor = issued;
          tokens.push(issued);
        } else {
          for (const token of tokens) token.live = false;
        }
        const live = tokens.filter((token) => token.live).length;
        if (subject.list(clock(step)).length !== live) {
          return `picks ${picks.join(',')}: step ${String(step)} live count`;
        }
      }
      return undefined;
    }

    it.each([
      ['all in one millisecond', (): number => NOW + 1000],
      ['a millisecond apart', (step: number): number => NOW + 1000 + step],
      ['stepping back and forth', (step: number): number => NOW + 1000 + (step % 2 === 0 ? 1 : 0)],
    ])('re-grants exactly when the successor was never presented, %s', (_label, clock) => {
      const disagreements = pickSequences(5)
        .map((picks) => firstDisagreement(picks, clock))
        .filter((found): found is string => found !== undefined);
      expect(disagreements).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('signs a device out and kills its replacements', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      expect(store.revoke(second.data.record.id, NOW + 2000)).toBe(true);
      expect(store.list(NOW + 2000)).toHaveLength(0);
    });

    it('leaves other devices signed in', () => {
      const phone = store.issue(GRANT, NOW);
      store.issue({ ...GRANT, deviceName: 'iPhone' }, NOW);
      store.revoke(phone.record.id, NOW);
      expect(store.list(NOW).map((record) => record.deviceName)).toEqual(['iPhone']);
    });

    it('reports an unknown id', () => {
      expect(store.revoke('nope', NOW)).toBe(false);
    });

    it('reports a record that was already revoked as unknown', () => {
      const first = store.issue(GRANT, NOW);
      store.rotate(first.token, NOW + 1000);
      expect(store.revoke(first.record.id, NOW + 2000)).toBe(false);
      expect(store.list(NOW + 2000)).toHaveLength(1);
    });

    it('revokes a family by one of its refresh tokens', () => {
      const first = store.issue(GRANT, NOW);
      const other = store.issue({ ...GRANT, deviceName: 'iPhone' }, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      expect(store.revokeByToken(first.token, NOW + 2000)).toBe(true);
      expect(store.list(NOW + 2000).map((record) => record.id)).toEqual([other.record.id]);
    });

    it('reports a refresh token it does not hold', () => {
      store.issue(GRANT, NOW);
      expect(store.revokeByToken('never-issued', NOW)).toBe(false);
      expect(store.list(NOW)).toHaveLength(1);
    });

    it('does not revoke by an expired refresh token', () => {
      const issued = store.issue(GRANT, NOW);
      const later = NOW + 61 * 24 * 60 * 60 * 1000;
      expect(store.revokeByToken(issued.token, later)).toBe(false);
    });

    it('counts only the records it actually revoked', () => {
      const issued = store.issue(GRANT, NOW);
      expect(store.revokeFamily(issued.record.familyId, NOW)).toBe(1);
      expect(store.revokeFamily(issued.record.familyId, NOW)).toBe(0);
    });
  });

  describe('list', () => {
    it('is empty before anything is issued', () => {
      expect(store.list(NOW)).toEqual([]);
    });

    it('omits expired records', () => {
      store.issue(GRANT, NOW);
      expect(store.list(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1)).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('survives a restart', () => {
      const issued = store.issue(GRANT, NOW);
      const reopened = new AppTokenStore(createNodeFileSystem(), file);
      expect(reopened.findByToken(issued.token, NOW)?.id).toBe(issued.record.id);
    });

    it('treats a corrupt file as no sessions rather than crashing', () => {
      writeFileSync(file, 'not json at all');
      expect(store.list(NOW)).toEqual([]);
      expect(() => store.issue(GRANT, NOW)).not.toThrow();
    });

    it('drops hand-edited entries that are missing fields', () => {
      writeFileSync(file, JSON.stringify([{ id: 'x' }, 12, null]));
      expect(store.list(NOW)).toEqual([]);
    });

    it('prunes expired records from the file', () => {
      store.issue(GRANT, NOW);
      store.prune(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ tokens: [] });
    });

    it('leaves the file alone when nothing expired', () => {
      store.issue(GRANT, NOW);
      const before = readFileSync(file, 'utf8');
      store.prune(NOW + 1000);
      expect(readFileSync(file, 'utf8')).toBe(before);
    });
  });
});
