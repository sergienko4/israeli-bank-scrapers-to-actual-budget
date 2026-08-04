/**
 * BrowserVersion tests — pins the forensic reporting of the bundled browser.
 *
 * The browser binary is fetched at image build time and is not pinned by
 * version, so the running build must be visible in the logs. Without it,
 * diagnosing a regression means guessing which browser the image shipped.
 */

import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import describeBrowserVersion from '../../src/Scraper/BrowserVersion.js';

vi.mock('node:fs');

describe('describeBrowserVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the version and release recorded by the browser fetch', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ version: '152.0.4', release: 'beta.28' }));

    const result = describeBrowserVersion();

    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe('152.0.4 (beta.28)');
  });

  it('reports the version alone when no release is recorded', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '152.0.4' }));

    const result = describeBrowserVersion();

    expect(result.success && result.data).toBe('152.0.4');
  });

  it('reads the manifest the browser fetch writes beside the binary', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '152.0.4' }));

    describeBrowserVersion();

    const [readPath] = vi.mocked(fs.readFileSync).mock.calls[0] ?? [];
    expect(String(readPath).replace(/\\/gu, '/')).toContain('.cache/camoufox/version.json');
  });

  it('fails when the version file is missing', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(describeBrowserVersion().success).toBe(false);
  });

  it('fails when the version file is not valid JSON', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not json');

    expect(describeBrowserVersion().success).toBe(false);
  });

  it('fails when the version field is absent', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ release: 'beta.28' }));

    expect(describeBrowserVersion().success).toBe(false);
  });

  it('fails when the version field is not a string', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: 152 }));

    expect(describeBrowserVersion().success).toBe(false);
  });

  it('ignores a non-string release rather than reporting it', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ version: '152.0.4', release: 28 }));

    const result = describeBrowserVersion();

    expect(result.success && result.data).toBe('152.0.4');
  });

  it('never throws, so a broken manifest cannot block startup', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => describeBrowserVersion()).not.toThrow();
  });
});
