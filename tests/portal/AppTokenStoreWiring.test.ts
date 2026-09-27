/**
 * The app-token wiring opens the store at `APP_TOKENS_PATH` on the real
 * filesystem, issuing tokens with the lifetime it is given.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import openAppTokenStore from '../../src/Portal/AppTokenStoreWiring.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRANT = { deviceName: 'Pixel', factors: { google: false, password: true }, fingerprint: 'fp' };

const originalPath = process.env.APP_TOKENS_PATH;
let dir: string;

describe('openAppTokenStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-token-wiring-'));
    process.env.APP_TOKENS_PATH = join(dir, 'app-tokens.json');
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.APP_TOKENS_PATH;
    else process.env.APP_TOKENS_PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it('issues tokens at APP_TOKENS_PATH with the lifetime it was given', () => {
    const issued = openAppTokenStore(7).issue(GRANT);
    expect(issued.record.expiresAt - issued.record.issuedAt).toBe(7 * DAY_MS);
    expect(existsSync(join(dir, 'app-tokens.json'))).toBe(true);
  });
});
