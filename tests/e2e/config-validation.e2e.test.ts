/**
 * Config Validation E2E Tests
 *
 * Cross-cutting cases (invalid syncId, conflicting dates) stay one-off
 * because they aren't bank-specific. All bank-specific scenarios are
 * driven from CREDENTIAL_SPECS via `describe.each` so every spec'd bank
 * exercises the same Docker pipeline — adding a new bank with a spec
 * automatically extends E2E coverage.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import { runImporterDocker, getFixturesDir, writeTempConfig, createTempFileTracker, hasDockerImage } from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';
import {
  fakeValidBankConfigFor,
  fakeBankConfigMissingField,
  BANK_SPEC_CASES,
} from '../helpers/factories.js';

const FIXTURES = getFixturesDir();
const E2E_TARGET = { actualAccountId: 'e2e00000-0000-0000-0000-000000000001', reconcile: false, accounts: 'all' as const };
const E2E_BUDGET = 'e2e-test-budget-dummy';
const temp = createTempFileTracker();

afterAll(() => { temp.cleanup(); });

describe.runIf(hasDockerImage())('Config Validation E2E', () => {
  describe('happy path — cross-cutting', () => {
    it('default e2eTestBank config loads without ConfigurationError', () => {
      const configPath = writeTempConfig('valid', createBaseConfig());
      temp.track(configPath);

      const result = runImporterDocker({
        configPath,
        mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
        budgetId: E2E_BUDGET,
        env: { E2E_LOCAL_BUDGET_ID: E2E_BUDGET },
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain('ConfigurationError');
      expect(result.output).toContain('Starting Israeli Bank Importer');
    });
  });

  describe('error handling — cross-cutting', () => {
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
  });

  // Spec-driven cross-bank E2E. Each iteration runs two real Docker
  // invocations (happy + failure) so every bank's full pipeline is exercised.
  describe.each(BANK_SPEC_CASES)('bank pipeline E2E — $bankId', ({ bankId, spec }) => {
    it(`accepts a valid ${bankId} config end-to-end`, () => {
      const config = createBaseConfig({
        banks: {
          [bankId]: { ...fakeValidBankConfigFor(bankId, { targets: [E2E_TARGET] }) },
        },
      });
      const configPath = writeTempConfig(`valid-${bankId}`, config);
      temp.track(configPath);

      const result = runImporterDocker({
        configPath,
        mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
        budgetId: E2E_BUDGET,
        env: { E2E_LOCAL_BUDGET_ID: E2E_BUDGET },
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain('ConfigurationError');
      expect(result.output).toContain('Starting Israeli Bank Importer');
    });

    it(`rejects ${bankId} when required field "${String(spec.required[0])}" is missing`, () => {
      const missingField = spec.required[0];
      const config = createBaseConfig({
        banks: {
          [bankId]: {
            ...fakeBankConfigMissingField(bankId, missingField),
            targets: [E2E_TARGET],
          },
        },
      });
      const configPath = writeTempConfig(`no-creds-${bankId}`, config);
      temp.track(configPath);

      const result = runImporterDocker({ configPath });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('requires');
      expect(result.output).toContain(spec.displayName);
      expect(result.output).toContain(String(missingField));
    });
  });
});
