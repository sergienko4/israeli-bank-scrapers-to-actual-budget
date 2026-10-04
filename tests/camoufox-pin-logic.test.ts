import { describe, expect, it } from 'vitest';

import {
  assetKeyFor,
  launchFileFor,
  matchesAsset,
  matchesPin,
  parsePin,
  PIN_FILE,
  selectAsset,
} from '../scripts/camoufox-pin-logic.mjs';

const RELEASE_DOWNLOAD = 'https://github.com/daijro/camoufox/releases/download/font-bundle-v1';
const LINUX_X64_SHA = '3a7958c84c0c1962574bb177a10a247b614823557308ccb7cf2e2bc9ce406c55';
const LINUX_ARM_SHA = '98dbffa9b687d42693dd0abebc47737e651b9e4b6991ba8571c3c29062645c04';

/**
 * Builds the pin document shape committed in config/camoufox-pin.json.
 * @returns A fresh, valid pin document for the two Docker platforms.
 */
function validPinDocument(): Record<string, unknown> {
  return {
    version: '152.0.4',
    release: 'beta.31',
    assets: {
      'lin.x86_64': {
        url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.x86_64.zip`,
        sha256: LINUX_X64_SHA,
      },
      'lin.arm64': {
        url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.arm64.zip`,
        sha256: LINUX_ARM_SHA,
      },
    },
  };
}

/**
 * Builds a pin document whose linux x86_64 asset carries the given fields.
 * @param asset - Replacement asset entry.
 * @returns A pin document with only that asset.
 */
function pinWithAsset(asset: Record<string, unknown>): Record<string, unknown> {
  return { ...validPinDocument(), assets: { 'lin.x86_64': asset } };
}

describe('parsePin', () => {
  it('returns the version, release and assets of a valid pin', () => {
    const pin = parsePin(validPinDocument());

    expect(pin).toEqual(validPinDocument());
  });

  it('rejects a document that is not an object', () => {
    expect(() => parsePin(null)).toThrow(PIN_FILE);
  });

  it('rejects a version that is not three dotted numbers', () => {
    const doc = { ...validPinDocument(), version: '152.0' };

    expect(() => parsePin(doc)).toThrow(/version/);
  });

  it('rejects a release that is not alpha.N or beta.N', () => {
    const doc = { ...validPinDocument(), release: 'latest' };

    expect(() => parsePin(doc)).toThrow(/release/);
  });

  it('rejects a pin with no assets', () => {
    const doc = { ...validPinDocument(), assets: {} };

    expect(() => parsePin(doc)).toThrow(/assets/);
  });

  it('rejects an asset key camoufox-js cannot run', () => {
    const doc = {
      ...validPinDocument(),
      assets: { 'linux.x64': { url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.x86_64.zip`, sha256: LINUX_X64_SHA } },
    };

    expect(() => parsePin(doc)).toThrow(/linux\.x64/);
  });

  it('rejects an asset hosted outside the daijro/camoufox releases', () => {
    const doc = pinWithAsset({
      url: 'https://downloads.example.org/camoufox-152.0.4-beta.31-lin.x86_64.zip',
      sha256: LINUX_X64_SHA,
    });

    expect(() => parsePin(doc)).toThrow(/url/);
  });

  it('rejects an asset fetched over plain http', () => {
    const doc = pinWithAsset({
      url: 'http://github.com/daijro/camoufox/releases/download/font-bundle-v1/camoufox-152.0.4-beta.31-lin.x86_64.zip',
      sha256: LINUX_X64_SHA,
    });

    expect(() => parsePin(doc)).toThrow(/url/);
  });

  it('rejects an asset whose file is another Camoufox build', () => {
    const doc = pinWithAsset({
      url: 'https://github.com/daijro/camoufox/releases/download/v156.0.1-beta.34/camoufox-156.0.1-beta.34-lin.x86_64.zip',
      sha256: LINUX_X64_SHA,
    });

    expect(() => parsePin(doc)).toThrow(/152\.0\.4-beta\.31/);
  });

  it('rejects an asset whose file targets another platform', () => {
    const doc = pinWithAsset({
      url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.arm64.zip`,
      sha256: LINUX_X64_SHA,
    });

    expect(() => parsePin(doc)).toThrow(/lin\.x86_64/);
  });

  it('rejects a digest that is not 64 lowercase hex characters', () => {
    const doc = pinWithAsset({
      url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.x86_64.zip`,
      sha256: LINUX_X64_SHA.toUpperCase(),
    });

    expect(() => parsePin(doc)).toThrow(/sha256/);
  });
});

describe('assetKeyFor', () => {
  it.each([
    ['linux', 'x64', 'lin.x86_64'],
    ['linux', 'arm64', 'lin.arm64'],
    ['darwin', 'arm64', 'mac.arm64'],
    ['darwin', 'x64', 'mac.x86_64'],
    ['win32', 'x64', 'win.x86_64'],
    ['win32', 'ia32', 'win.i686'],
  ])('maps %s/%s to %s', (platform, arch, key) => {
    expect(assetKeyFor(platform, arch)).toBe(key);
  });

  it('refuses an operating system camoufox-js has no build for', () => {
    expect(() => assetKeyFor('freebsd', 'x64')).toThrow(/freebsd/);
  });

  it('refuses 32-bit ARM instead of installing the arm64 build', () => {
    expect(() => assetKeyFor('linux', 'arm')).toThrow(/arm/);
  });
});

describe('selectAsset', () => {
  it('returns the pinned asset for the running platform', () => {
    const pin = parsePin(validPinDocument());

    const asset = selectAsset(pin, 'linux', 'arm64');

    expect(asset).toEqual({
      key: 'lin.arm64',
      url: `${RELEASE_DOWNLOAD}/camoufox-152.0.4-beta.31-lin.arm64.zip`,
      sha256: LINUX_ARM_SHA,
    });
  });

  it('names the pin file when the platform has no pinned asset', () => {
    const pin = parsePin(validPinDocument());

    expect(() => selectAsset(pin, 'darwin', 'arm64')).toThrow(PIN_FILE);
  });
});

describe('matchesPin', () => {
  const pin = parsePin(validPinDocument());

  it('accepts an install of the pinned version and release', () => {
    expect(matchesPin(pin, { version: '152.0.4', release: 'beta.31' })).toBe(true);
  });

  it('rejects an install of another release', () => {
    expect(matchesPin(pin, { version: '152.0.4', release: 'beta.30' })).toBe(false);
  });

  it('rejects an install of another version', () => {
    expect(matchesPin(pin, { version: '156.0.1', release: 'beta.31' })).toBe(false);
  });

  it('rejects a missing install manifest', () => {
    expect(matchesPin(pin, undefined)).toBe(false);
  });

  it('rejects a manifest without a release', () => {
    expect(matchesPin(pin, { version: '152.0.4' })).toBe(false);
  });
});

describe('matchesAsset', () => {
  const asset = selectAsset(parsePin(validPinDocument()), 'linux', 'x64');

  it('accepts an install that recorded the selected asset', () => {
    expect(matchesAsset(asset, { key: 'lin.x86_64', sha256: LINUX_X64_SHA })).toBe(true);
  });

  it("rejects an install of another platform's asset", () => {
    expect(matchesAsset(asset, { key: 'lin.arm64', sha256: LINUX_ARM_SHA })).toBe(false);
  });

  it('rejects an install whose archive had another digest', () => {
    expect(matchesAsset(asset, { key: 'lin.x86_64', sha256: LINUX_ARM_SHA })).toBe(false);
  });

  it('rejects an install that recorded no asset', () => {
    expect(matchesAsset(asset, undefined)).toBe(false);
  });
});

describe('launchFileFor', () => {
  it.each([
    ['lin.x86_64', 'camoufox-bin'],
    ['lin.arm64', 'camoufox-bin'],
    ['mac.arm64', 'Camoufox.app/Contents/MacOS/camoufox'],
    ['mac.x86_64', 'Camoufox.app/Contents/MacOS/camoufox'],
    ['win.x86_64', 'camoufox.exe'],
  ])('names the executable camoufox-js launches for %s', (key, file) => {
    expect(launchFileFor(key)).toBe(file);
  });

  it('refuses a platform key camoufox-js cannot run', () => {
    expect(() => launchFileFor('bsd.x86_64')).toThrow(/bsd\.x86_64/);
  });
});
