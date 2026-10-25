/**
 * Guards the Node versions the importer declares and ships.
 *
 * `engines.node` tells source and VM installs which Node runs the importer,
 * and npm only warns when a dependency asks for more. Provider 9.0.0 raised
 * its floor to Node 24.11 while ours said 22.14, so a host on our floor would
 * install a provider that cannot run. These checks fail such an update: every
 * runtime package in the lockfile must accept our floor and the Node major the
 * image and `.nvmrc` pin, and our range must accept that major.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import semver from 'semver';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The lockfile fields this check reads for one installed package. */
interface ILockPackage {
  readonly dev?: boolean;
  readonly optional?: boolean;
  readonly devOptional?: boolean;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly engines?: { readonly node?: string };
}

/** Platforms the image and documented installs run on. */
const SHIPPED_OS = ['linux', 'darwin'] as const;
const SHIPPED_CPU = ['x64', 'arm64'] as const;

/**
 * Reads one repository file.
 * @param file - Path from the repository root.
 * @returns The file's text.
 */
function repoText(file: string): string {
  return readFileSync(`${ROOT}${file}`, 'utf8');
}

/**
 * Tells whether an npm `os` or `cpu` list admits one value.
 * @param list - The list, absent when the package runs anywhere.
 * @param value - The platform or architecture.
 * @returns True when npm would install the package there.
 */
function admits(list: readonly string[] | undefined, value: string): boolean {
  if (list === undefined || list.includes(value)) return true;
  return !list.includes(`!${value}`) && list.every((entry) => entry.startsWith('!'));
}

/**
 * Tells whether a package installs with the runtime tree on a shipped platform.
 * @param entry - The package's lockfile entry.
 * @returns True for a package a production install can hold.
 */
function shipsAtRuntime(entry: ILockPackage): boolean {
  if (entry.dev === true) return false;
  return SHIPPED_OS.some((os) => admits(entry.os, os)) && SHIPPED_CPU.some((cpu) => admits(entry.cpu, cpu));
}

/**
 * Lists the runtime packages whose Node range refuses one Node version.
 * @param packages - The lockfile's `packages` map.
 * @param node - The Node version to check.
 * @returns One line per refusing package; empty when all accept it.
 */
function refusingPackages(packages: Readonly<Record<string, ILockPackage>>, node: string): string[] {
  return Object.entries(packages).flatMap(([path, entry]) => {
    const range = entry.engines?.node;
    if (path === '' || range === undefined || !shipsAtRuntime(entry)) return [];
    return semver.satisfies(node, range) ? [] : [`${path} needs Node ${range}`];
  });
}

/**
 * Reads the lowest Node version our `engines.node` admits.
 * @returns The floor, as a full version.
 */
function declaredFloor(): string {
  const range = (JSON.parse(repoText('package.json')) as { engines: { node: string } }).engines.node;
  const floor = semver.minVersion(range);
  if (floor === null) throw new Error(`package.json engines.node admits no version: ${range}`);
  return floor.version;
}

/**
 * Lists the Node majors the image stages and `.nvmrc` pin.
 * @returns Each distinct major, as the lowest version in it.
 */
function pinnedMajors(): string[] {
  const images = [...repoText('Dockerfile').matchAll(/^FROM node:(?<major>\d+)-/gmu)];
  if (images.length === 0) throw new Error('Dockerfile has no `FROM node:<major>-` stage');
  const majors = [...images.map((match) => match.groups?.major ?? ''), repoText('.nvmrc').trim()];
  return [...new Set(majors)].map((major) => `${major}.0.0`);
}

/** A runtime package at one path, as the oracle cases build it. */
const LOCKED = (entry: ILockPackage): Record<string, ILockPackage> => ({ 'node_modules/pkg': entry });

/** Lockfile shapes, and whether a Node 22.14 floor is refused by them. */
const ORACLE_CASES = [
  { label: 'a runtime floor above ours', entry: { engines: { node: '>= 24.11.0' } }, refused: true },
  { label: 'a range with a gap at our floor', entry: { engines: { node: '^20.19.0 || >=24.0.0' } }, refused: true },
  { label: 'a range npm cannot parse', entry: { engines: { node: 'node twenty-four' } }, refused: true },
  { label: 'an optional package', entry: { optional: true, engines: { node: '>=24' } }, refused: true },
  { label: 'a package both trees may hold', entry: { devOptional: true, engines: { node: '>=24' } }, refused: true },
  { label: 'a dev-only package', entry: { dev: true, engines: { node: '>=24' } }, refused: false },
  { label: 'a Windows-only package', entry: { os: ['win32'], engines: { node: '>=24' } }, refused: false },
  { label: 'a range that admits our floor', entry: { engines: { node: '>=20.19.0' } }, refused: false },
] as const;

describe('the Node versions the importer declares', () => {
  const { packages } = JSON.parse(repoText('package-lock.json')) as { packages: Record<string, ILockPackage> };

  it('runs every runtime package on the declared floor', () => {
    expect(refusingPackages(packages, declaredFloor())).toEqual([]);
  });

  it.each(pinnedMajors())('runs every runtime package on the pinned Node %s', (node) => {
    expect(refusingPackages(packages, node)).toEqual([]);
  });

  it.each(pinnedMajors())('declares a range that admits the pinned Node %s', (node) => {
    const range = (JSON.parse(repoText('package.json')) as { engines: { node: string } }).engines.node;
    expect(semver.satisfies(node, range)).toBe(true);
  });

  it.each(ORACLE_CASES)('reads $label as refused=$refused', ({ entry, refused }) => {
    expect(refusingPackages(LOCKED(entry), '22.14.0').length > 0).toBe(refused);
  });
});
