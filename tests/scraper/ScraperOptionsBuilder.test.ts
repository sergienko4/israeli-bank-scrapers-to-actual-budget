import { describe, it, expect, afterEach } from 'vitest';
import { buildChromeArgs, getChromeDataDir } from '../../src/scraper/ScraperOptionsBuilder.js';

describe('buildChromeArgs', () => {
  it('includes base args without proxy', () => {
    const args = buildChromeArgs();
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
    expect(args).toContain('--disable-dev-shm-usage');
  });

  it('does not include proxy args by default', () => {
    const args = buildChromeArgs();
    expect(args.some(a => a.startsWith('--proxy-server='))).toBe(false);
  });

  it('includes proxy-server arg when proxy configured', () => {
    const args = buildChromeArgs({ server: 'socks5://localhost:1080' });
    expect(args).toContain('--proxy-server=socks5://localhost:1080');
  });

  it('supports socks4 proxy', () => {
    const args = buildChromeArgs({ server: 'socks4://proxy:1080' });
    expect(args).toContain('--proxy-server=socks4://proxy:1080');
  });
});

describe('getChromeDataDir', () => {
  afterEach(() => {
    delete process.env.CHROME_DATA_DIR;
  });

  it('returns default base dir when CHROME_DATA_DIR is not set', () => {
    delete process.env.CHROME_DATA_DIR;
    expect(getChromeDataDir()).toBe('/app/chrome-data');
  });

  it('appends bankName when provided', () => {
    expect(getChromeDataDir('leumi')).toBe('/app/chrome-data/leumi');
  });

  it('uses CHROME_DATA_DIR env var when set', () => {
    process.env.CHROME_DATA_DIR = '/custom/chrome';
    expect(getChromeDataDir()).toBe('/custom/chrome');
  });

  it('appends bankName to custom CHROME_DATA_DIR', () => {
    process.env.CHROME_DATA_DIR = '/custom/chrome';
    expect(getChromeDataDir('discount')).toBe('/custom/chrome/discount');
  });
});
