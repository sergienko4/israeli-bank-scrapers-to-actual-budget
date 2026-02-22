/**
 * Encrypted Config E2E Tests
 * - Happy path: decrypts with correct password, starts import
 * - Error handling: wrong password, missing password → clear errors
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { encryptConfig } from '../../src/config/ConfigEncryption.js';
import { runImporterDocker, getFixturesDir, findBudgetId, createTempFileTracker, hasDockerImage } from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';
import { writeFileSync } from 'fs';

const FIXTURES = getFixturesDir();
const ENCRYPTION_PASSWORD = 'e2e-test-encryption-key-2026';
const temp = createTempFileTracker();
const HAS_BUDGET = !!findBudgetId();

let encryptedConfigPath: string;

beforeAll(() => {
  const plainJson = JSON.stringify(createBaseConfig(), null, 2);
  encryptedConfigPath = join(FIXTURES, 'config-encrypted.json');
  writeFileSync(encryptedConfigPath, encryptConfig(plainJson, ENCRYPTION_PASSWORD));
  temp.track(encryptedConfigPath);
});

afterAll(() => { temp.cleanup(); });

describe.runIf(HAS_BUDGET && hasDockerImage())('Encrypted Config E2E', () => {
  const budgetId = findBudgetId()!;

  describe('happy path', () => {
    it('decrypts config with correct password and starts import', () => {
      const result = runImporterDocker({
        configPath: encryptedConfigPath,
        budgetId,
        mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
        env: { CREDENTIALS_ENCRYPTION_PASSWORD: ENCRYPTION_PASSWORD },
      });

      expect(result.output).toContain('Decrypting');
      expect(result.output).toContain('Starting Israeli Bank Importer');
      expect(result.output).not.toContain('ConfigurationError');
    });
  });

  describe('error handling', () => {
    it('rejects wrong password — falls back to env vars and fails', () => {
      const result = runImporterDocker({
        configPath: encryptedConfigPath,
        env: { CREDENTIALS_ENCRYPTION_PASSWORD: 'wrong-password' },
      });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('Failed to parse config');
    });

    it('rejects encrypted config without password env var', () => {
      const result = runImporterDocker({ configPath: encryptedConfigPath });

      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.output).toContain('CREDENTIALS_ENCRYPTION_PASSWORD');
    });
  });
});
