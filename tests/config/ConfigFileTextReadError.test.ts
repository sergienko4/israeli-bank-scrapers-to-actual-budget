import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import readConfigText from '../../src/Config/Loaders/ConfigFileText.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readSync: vi.fn(actual.readSync), closeSync: vi.fn(actual.closeSync) };
});

let dir: string;
let path: string;

describe('readConfigText when the read fails after the open', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cfgtext-err-'));
    path = join(dir, 'config.json');
    writeFileSync(path, '{}');
  });
  afterEach(() => {
    vi.mocked(fs.readSync).mockClear();
    vi.mocked(fs.closeSync).mockClear();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the errno and closes the descriptor', () => {
    const ioError = Object.assign(new Error('input/output error'), { code: 'EIO' });
    vi.mocked(fs.readSync).mockImplementationOnce(() => { throw ioError; });
    const read = readConfigText(path);
    expect(read).toMatchObject({
      success: false, status: 'EIO', message: `Could not read ${path}: EIO`,
    });
    expect(fs.closeSync).toHaveBeenCalledTimes(1);
  });

  it('reports EUNKNOWN, never the thrown text, when the error has no errno', () => {
    vi.mocked(fs.readSync).mockImplementationOnce(() => { throw new Error('secret-ish text'); });
    const read = readConfigText(path);
    expect(read).toMatchObject({
      success: false, status: 'EUNKNOWN', message: `Could not read ${path}: EUNKNOWN`,
    });
  });
});
