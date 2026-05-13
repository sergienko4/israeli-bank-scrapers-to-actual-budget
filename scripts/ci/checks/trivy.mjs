#!/usr/bin/env node
/**
 * Trivy container scan gate.
 *
 * Mirrors `.husky/pre-commit` gate 12 and the trivy job in pr.yml.
 * Requires the `israeli-bank-importer:pre-commit` image built by the
 * sibling `docker-image` gate. Honors `config/trivy/secret.yaml` for
 * secret-scan configuration.
 *
 * Exit code: 1 when CRITICAL or HIGH unfixed vulnerabilities are found;
 *            0 otherwise (Trivy is invoked with `--exit-code 1`).
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const TRIVY_IMAGE =
  'aquasec/trivy@sha256:bcc376de8d77cfe086a917230e818dc9f8528e3c852f7b1aff648949b6258d1c';
const TARGET_IMAGE = 'israeli-bank-importer:pre-commit';

/**
 * Entry point.
 */
async function main() {
  const args = [
    'run', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${process.cwd()}/config/trivy:/trivy-config`,
    TRIVY_IMAGE,
    'image',
    '--exit-code', '1',
    '--severity', 'CRITICAL,HIGH',
    '--ignore-unfixed',
    '--scanners', 'vuln,secret',
    '--secret-config', '/trivy-config/secret.yaml',
    '--pkg-types', 'os,library',
    '--skip-dirs', 'root/.npm',
    TARGET_IMAGE,
  ];

  const code = await new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: 'inherit', shell: false });
    child.once('exit', (c) => resolve(c ?? 1));
    child.once('error', () => resolve(1));
  });
  process.exit(code);
}

await main();
