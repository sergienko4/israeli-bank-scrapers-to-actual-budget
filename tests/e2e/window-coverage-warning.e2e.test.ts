/**
 * Window-coverage warning E2E.
 *
 * Exercises provider coverage metadata through the Docker entry point and
 * confirms that degraded coverage remains a non-blocking import condition.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  createTempFileTracker,
  findBudgetId,
  getFixturesDir,
  hasDockerImage,
  runImporterDocker,
  writeTempConfig,
} from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';

const FIXTURES = getFixturesDir();
const E2E_BUDGET = 'e2e-test-budget-dummy';
const temp = createTempFileTracker();

afterAll(
  /**
   * Removes temporary configuration files created by this suite.
   * @returns Nothing.
   */
  () => { temp.cleanup(); },
);

describe.runIf(hasDockerImage())(
  'window coverage warning E2E',
  /**
   * Registers the degraded-coverage Docker scenario.
   * @returns Nothing.
   */
  () => {
    it(
      'warns about unproven coverage and completes a dry run',
      /**
       * Verifies degraded coverage remains visible and non-blocking.
       * @returns Nothing.
       */
      () => {
        const configPath = writeTempConfig('window-coverage', createBaseConfig());
        const budgetId = findBudgetId() ?? E2E_BUDGET;
        temp.track(configPath);

        const result = runImporterDocker({
          configPath,
          mockScraperFile: join(FIXTURES, 'mock-scraper-window-unproven.json'),
          budgetId,
          env: { E2E_LOCAL_BUDGET_ID: budgetId, DRY_RUN: 'true' },
        });

        expect(result.output).toContain('Scraper window coverage is incomplete');
        expect(result.output).toContain('no changes made to Actual Budget');
        expect(result.exitCode).toBe(0);
      },
    );
  },
);
