import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import readConfigText from '../../src/Config/Loaders/ConfigFileText.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    readSync: vi.fn(actual.readSync),
    closeSync: vi.fn(actual.closeSync),
  };
});

let dir: string;
let path: string;

/**
 * Makes the next close release the descriptor, then report a failure.
 * @param error - What the close throws.
 * @returns Nothing; the mock is armed for one call.
 */
async function refuseNextClose(error: Error): Promise<void> {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fs.closeSync).mockImplementationOnce((descriptor) => {
    actual.closeSync(descriptor);
    throw error;
  });
}

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

  it('reports a refused close by its errno instead of throwing', async () => {
    const ioError = Object.assign(new Error('input/output error'), { code: 'EIO' });
    await refuseNextClose(ioError);
    const read = readConfigText(path);
    expect(read).toMatchObject({
      success: false, status: 'EIO', message: `Could not read ${path}: EIO`,
    });
  });

  it('keeps the read failure when the close is refused as well', async () => {
    const readError = Object.assign(new Error('input/output error'), { code: 'EIO' });
    const closeError = Object.assign(new Error('bad file descriptor'), { code: 'EBADF' });
    vi.mocked(fs.readSync).mockImplementationOnce(() => { throw readError; });
    await refuseNextClose(closeError);
    const read = readConfigText(path);
    expect(read).toMatchObject({ success: false, status: 'EIO' });
  });

  it('reports a file that appears after an open found nothing as missing, not as a broken link', () => {
    const missing = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    vi.mocked(fs.openSync).mockImplementationOnce(() => { throw missing; });
    expect(readConfigText(path)).toMatchObject({ success: false, status: 'ENOENT' });
  });

  it('reports EUNKNOWN, never the thrown text, when the error has no errno', () => {
    vi.mocked(fs.readSync).mockImplementationOnce(() => { throw new Error('secret-ish text'); });
    const read = readConfigText(path);
    expect(read).toMatchObject({
      success: false, status: 'EUNKNOWN', message: `Could not read ${path}: EUNKNOWN`,
    });
  });
});
