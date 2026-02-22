/**
 * Config Validation E2E Tests
 * - Happy path: valid config loads and starts import
 * - Error handling: bad configs produce clear errors and exit code 1
 */

import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { runImporterDocker, getFixturesDir, writeTempConfig, createTempFileTracker } from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';

const FIXTURES = getFixturesDir();
const temp = createTempFileTracker();

afterAll(() => { temp.cleanup(); });

describe('Config Validation E2E', () => {
  describe('happy path', () => {
    it('valid config loads without ConfigurationError', () => {
      const configPath = writeTempConfig('valid', createBaseConfig());
      temp.track(configPath);

      const result = runImporterDocker({
        configPath,
        mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
        budgetId: 'e2e-test-budget-dummy',
        env: { E2E_LOCAL_BUDGET_ID: 'e2e-test-budget-dummy' },
      });

      expect(result.output).not.toContain('ConfigurationError');
      expect(result.output).toContain('Starting Israeli Bank Importer');
    });
  });

  describe('error handling', () => {
    it('rejects invalid syncId — exits 1 with UUID format error', () => {
      const config = createBaseConfig();
      config.actual.budget.syncId = 'not-a-uuid';
      const configPath = writeTempConfig('bad-uuid', config);
      temp.track(configPath);

      const result = runImporterDocker({ configPath });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('Invalid ACTUAL_BUDGET_SYNC_ID');
      expect(result.output).toContain('not-a-uuid');
    });

    it('rejects conflicting date config — exits 1 with "cannot use both"', () => {
      const config = createBaseConfig();
      (config.banks.e2eTestBank as Record<string, unknown>).startDate = '2026-01-01';
      const configPath = writeTempConfig('both-dates', config);
      temp.track(configPath);

      const result = runImporterDocker({ configPath });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('cannot use both');
      expect(result.output).toContain('startDate');
      expect(result.output).toContain('daysBack');
    });

    it('rejects missing credentials for known bank — exits 1 with required fields', () => {
      const config = createBaseConfig({
        banks: {
          discount: {
            password: 'test', daysBack: 7,
            targets: [{ actualAccountId: 'e2e00000-0000-0000-0000-000000000001', reconcile: false, accounts: 'all' }],
          },
        },
      });
      const configPath = writeTempConfig('no-creds', config);
      temp.track(configPath);

      const result = runImporterDocker({ configPath });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('requires');
      expect(result.output).toContain('Discount');
    });
  });
});
