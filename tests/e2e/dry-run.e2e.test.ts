/**
 * E2E tests for DRY_RUN=true mode
 * Verifies scraping happens but no writes to Actual Budget
 */

import { describe, it, expect, afterAll } from 'vitest';
import { join } from 'path';
import {
  runImporterDocker, getFixturesDir, writeTempConfig,
  createTempFileTracker, hasDockerImage, findBudgetId,
} from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';

const FIXTURES = getFixturesDir();
const temp = createTempFileTracker();

afterAll(() => { temp.cleanup(); });

describe.runIf(hasDockerImage())('DRY_RUN mode E2E', () => {
  it('exits 0 and shows DRY RUN banner', () => {
    const configPath = writeTempConfig('dry-run-basic', createBaseConfig());
    temp.track(configPath);
    const budgetId = findBudgetId() ?? 'e2e-test-budget-dummy';

    const result = runImporterDocker({
      configPath,
      mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
      budgetId,
      env: { E2E_LOCAL_BUDGET_ID: budgetId, DRY_RUN: 'true' },
    });

    expect(result.output).toContain('DRY RUN');
    expect(result.exitCode).toBe(0);
  });

  it('shows account info — bank name, transaction count, date range', () => {
    const configPath = writeTempConfig('dry-run-preview', createBaseConfig());
    temp.track(configPath);
    const budgetId = findBudgetId() ?? 'e2e-test-budget-dummy';

    const result = runImporterDocker({
      configPath,
      mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
      budgetId,
      env: { E2E_LOCAL_BUDGET_ID: budgetId, DRY_RUN: 'true' },
    });

    expect(result.output).toContain('e2eTestBank');
    expect(result.output).toMatch(/Transactions:\s+\d+/);
    expect(result.output).toContain('No changes made to Actual Budget');
  });

  it('does not log "Importing transactions" in dry-run mode', () => {
    const configPath = writeTempConfig('dry-run-no-import', createBaseConfig());
    temp.track(configPath);
    const budgetId = findBudgetId() ?? 'e2e-test-budget-dummy';

    const result = runImporterDocker({
      configPath,
      mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
      budgetId,
      env: { E2E_LOCAL_BUDGET_ID: budgetId, DRY_RUN: 'true' },
    });

    expect(result.output).not.toContain('Importing transactions');
    expect(result.output).not.toContain('🎉 Import process completed');
  });

  it('normal run (no DRY_RUN) still imports transactions', () => {
    const configPath = writeTempConfig('dry-run-normal', createBaseConfig());
    temp.track(configPath);
    const budgetId = findBudgetId();
    if (!budgetId) return; // skip if no real budget

    const result = runImporterDocker({
      configPath,
      mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
      budgetId,
      env: { E2E_LOCAL_BUDGET_ID: budgetId },
    });

    expect(result.output).not.toContain('DRY RUN');
    expect(result.output).toContain('Import process completed');
  });
});
