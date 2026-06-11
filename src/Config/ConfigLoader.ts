/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type {
  IImporterConfig, Procedure} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import {
validateActualConfig, validateBank,
validateServerUrl} from './ConfigLoaderValidator.js';
import deepMerge from './Loaders/ConfigMerger.js';
import loadFromEnvironment from './Loaders/EnvLoader.js';
import readJsonFile from './Loaders/JsonFileReader.js';
import OPTIONAL_SECTION_VALIDATORS from './Validators/OptionalSectionValidators.js';

export interface IConfigLoader {
  load(): Procedure<IImporterConfig>;
}


/** Loads IImporterConfig from config.json, credentials.json, or environment variables. */
export class ConfigLoader implements IConfigLoader {
  private readonly _configPath: string;

  /**
   * Creates a ConfigLoader pointing at the given config file path.
   * @param configPath - Absolute path to config.json; defaults to /app/config.json.
   */
  constructor(configPath?: string) {
    this._configPath = configPath || '/app/config.json';
  }

  /**
   * Loads, merges, and validates the full importer configuration.
   * @returns Procedure containing the validated IImporterConfig or a failure message.
   */
  public load(): Procedure<IImporterConfig> {
    const fileResult = this.loadFromFile();
    if (isFail(fileResult) && fileResult.status !== 'not-found') return fileResult;
    const config = isFail(fileResult) ? loadFromEnvironment() : fileResult.data;
    ConfigLoader.applyEnvOverrides(config);
    return ConfigLoader.validate(config);
  }

  /**
   * Loads and merges config without running validation — used by --validate mode.
   * @returns Procedure containing the merged IImporterConfig or a failure message.
   */
  public loadRaw(): Procedure<IImporterConfig> {
    const fileResult = this.loadFromFile();
    if (isFail(fileResult) && fileResult.status !== 'not-found') return fileResult;
    const config = isFail(fileResult) ? loadFromEnvironment() : fileResult.data;
    ConfigLoader.applyEnvOverrides(config);
    return succeed(config);
  }

  /**
   * Applies environment-variable overrides onto an already-loaded config.
   * @param config - The config object to mutate with env-var values.
   */
  private static applyEnvOverrides(config: IImporterConfig): void {
    if (process.env.PROXY_SERVER) config.proxy = { server: process.env.PROXY_SERVER };
  }

  /**
   * Attempts to load configuration from config.json (and optional credentials.json).
   * @returns Procedure containing the parsed IImporterConfig, or failure if absent/unreadable.
   */
  private loadFromFile(): Procedure<IImporterConfig> {
    if (!existsSync(this._configPath)) {
      getLogger().info('📄 config.json not found, using environment variables');
      return fail('config.json not found', { status: 'not-found' });
    }
    try {
      getLogger().info('📄 Loading configuration from config.json');
      const config = readJsonFile(this._configPath);
      const credResult = this.loadCredentials();
      const merged = credResult.success
        ? deepMerge(config, credResult.data) : config;
      return succeed(merged);
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) {
        return fail(error.message, { error, status: 'config-error' });
      }
      getLogger().warn(`⚠️  Failed to parse ${this._configPath}`);
      return fail(`Failed to parse ${this._configPath}`, { status: 'parse-error' });
    }
  }

  /**
   * Loads a separate credentials.json from the same directory as config.json.
   * @returns Procedure containing the parsed credentials config, or failure if not found.
   */
  private loadCredentials(): Procedure<IImporterConfig> {
    const configDir = dirname(this._configPath);
    const credPath = join(configDir, 'credentials.json');
    if (!existsSync(credPath)) {
      return fail('credentials.json not found');
    }
    getLogger().info('🔑 Loading credentials from credentials.json');
    const credentials = readJsonFile(credPath);
    return succeed(credentials);
  }

  // ─── Validation ───

  /**
   * Validates the fully merged config, returning a Procedure with the config or failure.
   * @param config - The merged IImporterConfig to validate.
   * @returns Procedure containing the validated config on success, or failure message.
   */
  private static validate(config: IImporterConfig): Procedure<IImporterConfig> {
    const actualResult = validateActualConfig(config);
    if (isFail(actualResult)) return fail(actualResult.message, { status: 'config-error' });
    const urlResult = validateServerUrl(config.actual.init.serverURL);
    if (isFail(urlResult)) return fail(urlResult.message, { status: 'config-error' });
    if (Object.keys(config.banks).length === 0) {
      return fail(
        'No bank credentials configured. Please set environment variables or use config.json',
        { status: 'config-error' }
      );
    }
    const bankValidation = ConfigLoader.validateAllBanks(config);
    if (isFail(bankValidation)) return bankValidation;
    const optionalResult = ConfigLoader.validateOptionalSections(config);
    if (isFail(optionalResult)) return optionalResult;
    return succeed(config);
  }

  /**
   * Validates all bank entries in the config.
   * @param config - The IImporterConfig whose banks to validate.
   * @returns Procedure success or first bank validation failure.
   */
  private static validateAllBanks(config: IImporterConfig): Procedure<{ valid: true }> {
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      const bankResult = validateBank(bankName, bankConfig);
      if (isFail(bankResult)) return fail(bankResult.message, { status: 'config-error' });
    }
    return succeed({ valid: true as const });
  }

  /**
   * Validates optional config sections (notifications, spending watch, proxy).
   *
   * Iterates {@link OPTIONAL_SECTION_VALIDATORS} instead of an if-chain so
   * adding a new optional section does not modify this dispatcher.
   *
   * @param config - The IImporterConfig whose optional sections to validate.
   * @returns Procedure success or first section failure (wrapped as config-error).
   */
  private static validateOptionalSections(config: IImporterConfig): Procedure<{ valid: true }> {
    for (const section of OPTIONAL_SECTION_VALIDATORS) {
      if (!section.applies(config)) continue;
      const result = section.validate(config);
      if (isFail(result)) return fail(result.message, { status: 'config-error' });
    }
    return succeed({ valid: true as const });
  }

}
