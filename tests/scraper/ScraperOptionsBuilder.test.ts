import { describe, it, expect } from 'vitest';
import { buildChromeArgs } from '../../src/scraper/ScraperOptionsBuilder.js';

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
