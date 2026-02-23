import { describe, it, expect } from 'vitest';
import { buildChromeArgs, getStealthScript } from '../../src/scraper/ScraperOptionsBuilder.js';

describe('buildChromeArgs', () => {
  it('includes base args without proxy or stealth', () => {
    const args = buildChromeArgs();
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
    expect(args).toContain('--disable-dev-shm-usage');
    expect(args.some(a => a.startsWith('--user-data-dir='))).toBe(true);
  });

  it('does not include proxy or stealth args by default', () => {
    const args = buildChromeArgs();
    expect(args.some(a => a.startsWith('--proxy-server='))).toBe(false);
    expect(args).not.toContain('--disable-blink-features=AutomationControlled');
  });

  it('includes proxy-server arg when proxy configured', () => {
    const args = buildChromeArgs({ server: 'socks5://localhost:1080' });
    expect(args).toContain('--proxy-server=socks5://localhost:1080');
  });

  it('includes stealth args when stealth enabled', () => {
    const args = buildChromeArgs(undefined, true);
    expect(args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('includes both proxy and stealth args together', () => {
    const args = buildChromeArgs({ server: 'http://proxy:8080' }, true);
    expect(args).toContain('--proxy-server=http://proxy:8080');
    expect(args).toContain('--disable-blink-features=AutomationControlled');
  });

  it('supports socks4 proxy', () => {
    const args = buildChromeArgs({ server: 'socks4://proxy:1080' });
    expect(args).toContain('--proxy-server=socks4://proxy:1080');
  });
});

describe('getStealthScript', () => {
  it('contains navigator.webdriver override', () => {
    const script = getStealthScript();
    expect(script).toContain('webdriver');
    expect(script).toContain('undefined');
  });

  it('contains languages override with Hebrew', () => {
    const script = getStealthScript();
    expect(script).toContain('he-IL');
  });

  it('contains plugins override', () => {
    const script = getStealthScript();
    expect(script).toContain('plugins');
  });

  it('contains chrome.runtime injection', () => {
    const script = getStealthScript();
    expect(script).toContain('chrome');
    expect(script).toContain('runtime');
  });
});
