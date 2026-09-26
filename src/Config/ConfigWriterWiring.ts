/**
 * Config writer wiring: the writer on the real filesystem.
 */

import createNodeFileSystem from '../Storage/NodeFileSystem.js';
import ConfigWriter from './ConfigWriter.js';

/**
 * Opens the writer for the config the portal saves.
 * Opening it touches no file.
 * @param configPath - Absolute path to config.json.
 * @returns A writer for that config and the credentials file beside it.
 */
export default function openConfigWriter(configPath: string): ConfigWriter {
  const fileSystem = createNodeFileSystem();
  return new ConfigWriter(fileSystem, configPath);
}
