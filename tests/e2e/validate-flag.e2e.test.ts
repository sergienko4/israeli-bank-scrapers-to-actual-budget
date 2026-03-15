/**
 * E2E tests for --validate CLI flag
 * Verifies config validation report output from Docker
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  runImporterDocker, getFixturesDir, writeTempConfig,
  createTempFileTracker, hasDockerImage,
} from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const FIXTURES = getFixturesDir();
const temp = createTempFileTracker();

afterAll(() => { temp.cleanup(); });

const VALID_UUID = 'e2e00000-0000-0000-0000-000000000001';

function makeValidateConfig(banks: Record<string, unknown>) {
  return {
    actual: {
      init: { serverURL: 'http://localhost:5006', password: TEST_CREDENTIAL, dataDir: '/app/data' },
      budget: { syncId: '00000000-0000-0000-0000-000000000000', password: null },
    },
    banks,
    notifications: { enabled: false },
  };
}

describe.runIf(hasDockerImage())('--validate flag E2E', () => {
  it('exits 0 and shows [PASS] for all offline checks with valid config', () => {
    const config = makeValidateConfig({
      discount: {
        id: '123', password: TEST_CREDENTIAL, num: 'ABC', daysBack: 7,
        targets: [{ actualAccountId: VALID_UUID, reconcile: false, accounts: 'all' }],
      },
    });
    const configPath = writeTempConfig('validate-valid', config);
    temp.track(configPath);

    const result = runImporterDocker({ configPath, nodeArgs: ['--validate'] });

    expect(result.output).toContain('Config Validation Report');
    expect(result.output).toContain('[PASS]');
    expect(result.output).toContain('Bank "discount" — known institution');
    // Online check for Actual server will fail (no server in E2E), but offline passes
    expect(result.output).not.toContain('[FAIL] Bank');
  });

  it('exits 1 and shows "Did you mean?" for typo bank name', () => {
    const config = makeValidateConfig({
      disount: {
        id: '123', password: TEST_CREDENTIAL, num: 'ABC', daysBack: 7,
        targets: [{ actualAccountId: VALID_UUID, reconcile: false, accounts: 'all' }],
      },
    });
    const configPath = writeTempConfig('validate-typo', config);
    temp.track(configPath);

    const result = runImporterDocker({ configPath, nodeArgs: ['--validate'] });

    expect(result.output).toContain('[FAIL]');
    expect(result.output).toContain('unknown institution');
    expect(result.output).toContain('discount');
    expect(result.exitCode).toBe(1);
  });

  it('exits 1 and reports invalid syncId UUID', () => {
    const config = makeValidateConfig({
      discount: {
        id: '123', password: TEST_CREDENTIAL, num: 'ABC', daysBack: 7,
        targets: [{ actualAccountId: VALID_UUID, reconcile: false, accounts: 'all' }],
      },
    });
    config.actual.budget.syncId = 'not-a-uuid';
    const configPath = writeTempConfig('validate-bad-uuid', config);
    temp.track(configPath);

    const result = runImporterDocker({ configPath, nodeArgs: ['--validate'] });

    expect(result.output).toContain('[FAIL]');
    expect(result.output).toContain('syncId');
    expect(result.exitCode).toBe(1);
  });

  it('shows warning when no daysBack/startDate set', () => {
    const config = makeValidateConfig({
      leumi: {
        username: 'user', password: TEST_CREDENTIAL,
        targets: [{ actualAccountId: VALID_UUID, reconcile: false, accounts: 'all' }],
      },
    });
    const configPath = writeTempConfig('validate-warn-dates', config);
    temp.track(configPath);

    const result = runImporterDocker({ configPath, nodeArgs: ['--validate'] });

    expect(result.output).toContain('[WARN]');
    expect(result.output).toContain('~1 year');
  });

  it('does not start full import when --validate is passed', () => {
    const config = createBaseConfig();
    const configPath = writeTempConfig('validate-no-import', config);
    temp.track(configPath);

    const result = runImporterDocker({
      configPath,
      nodeArgs: ['--validate'],
    });

    expect(result.output).toContain('Config Validation Report');
    expect(result.output).not.toContain('Starting Israeli Bank Importer');
    expect(result.output).not.toContain('Processing');
  });
});
