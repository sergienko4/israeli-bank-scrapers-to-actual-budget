import { describe, expect, it } from 'vitest';

import {
  ALLOWED_DEPENDENCY_LICENSES,
  ALLOWED_PROJECT_LICENSES,
  EXCLUDED_PACKAGES,
  findLicenseViolations,
  isLicenseAllowed,
  isPackageExcluded,
} from '../config/license-policy.mjs';

describe('License policy allow-list', () => {
  it('keeps the allow-list free of AND/OR expressions', () => {
    // spdx-satisfies rejects compound approved licenses; a compound entry here
    // would make every evaluation throw and silently deny every package.
    const compound = ALLOWED_DEPENDENCY_LICENSES.filter(
      (license) => / (AND|OR) /.test(license) || license.includes('('),
    );
    expect(compound).toEqual([]);
  });

  it('publishes the project under MIT only', () => {
    expect(ALLOWED_PROJECT_LICENSES).toEqual(['MIT']);
  });
});

describe('isLicenseAllowed', () => {
  it('accepts a plain allowed identifier', () => {
    expect(isLicenseAllowed('MIT')).toBe(true);
  });

  it('rejects a plain identifier that is not allowed', () => {
    expect(isLicenseAllowed('GPL-2.0-only')).toBe(false);
  });

  it('accepts a conjunction when every operand is allowed', () => {
    // @bufbuild/protobuf, reached through @actual-app/api, declares exactly this.
    expect(isLicenseAllowed('(Apache-2.0 AND BSD-3-Clause)')).toBe(true);
  });

  it('is insensitive to the operand order of a conjunction', () => {
    expect(isLicenseAllowed('(BSD-3-Clause AND Apache-2.0)')).toBe(true);
  });

  it('rejects a conjunction when one operand is not allowed', () => {
    expect(isLicenseAllowed('(Apache-2.0 AND GPL-2.0-only)')).toBe(false);
  });

  it('accepts a disjunction when any operand is allowed', () => {
    expect(isLicenseAllowed('(MIT OR WTFPL)')).toBe(true);
  });

  it('rejects a disjunction when no operand is allowed', () => {
    expect(isLicenseAllowed('(WTFPL OR GPL-2.0-only)')).toBe(false);
  });

  it('rejects an undeclared license instead of passing it silently', () => {
    expect(isLicenseAllowed('UNKNOWN')).toBe(false);
    expect(isLicenseAllowed('CUSTOM')).toBe(false);
    expect(isLicenseAllowed(undefined)).toBe(false);
    expect(isLicenseAllowed('')).toBe(false);
    expect(isLicenseAllowed('   ')).toBe(false);
  });

  it('honours an explicit allow-list override', () => {
    expect(isLicenseAllowed('GPL-2.0-only', ['GPL-2.0-only'])).toBe(true);
    expect(isLicenseAllowed('MIT', ['ISC'])).toBe(false);
  });
});

describe('isPackageExcluded', () => {
  it('exempts absurd-sql, which declares no license field', () => {
    expect(isPackageExcluded('absurd-sql')).toBe(true);
    expect(EXCLUDED_PACKAGES).toContain('absurd-sql');
  });

  it('does not exempt any other package', () => {
    expect(isPackageExcluded('left-pad')).toBe(false);
    expect(isPackageExcluded(undefined)).toBe(false);
  });
});

describe('findLicenseViolations', () => {
  it('returns nothing when every package is compliant', () => {
    const packages = [
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'b', version: '2.0.0', license: '(Apache-2.0 AND BSD-3-Clause)' },
    ];
    expect(findLicenseViolations(packages)).toEqual([]);
  });

  it('reports a package whose license is not allowed', () => {
    const packages = [
      { name: 'a', version: '1.0.0', license: 'MIT' },
      { name: 'bad', version: '3.0.0', license: 'GPL-2.0-only' },
    ];
    expect(findLicenseViolations(packages)).toEqual([
      { name: 'bad', version: '3.0.0', license: 'GPL-2.0-only' },
    ]);
  });

  it('reports a package with no declared license', () => {
    const packages = [{ name: 'mystery', version: '1.0.0', license: 'UNKNOWN' }];
    expect(findLicenseViolations(packages)).toHaveLength(1);
  });

  it('skips excluded packages regardless of their reported license', () => {
    const packages = [{ name: 'absurd-sql', version: '1.0.0', license: 'UNKNOWN' }];
    expect(findLicenseViolations(packages)).toEqual([]);
  });

  it('treats a missing package list as compliant', () => {
    expect(findLicenseViolations(undefined)).toEqual([]);
    expect(findLicenseViolations([])).toEqual([]);
  });

  it('does not mutate the packages it is given', () => {
    const packages = [{ name: 'bad', version: '1.0.0', license: 'GPL-2.0-only' }];
    const snapshot = structuredClone(packages);
    findLicenseViolations(packages);
    expect(packages).toEqual(snapshot);
  });
});
