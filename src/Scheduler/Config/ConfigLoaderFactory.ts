/**
 * Thin factory wrapper around ConfigLoader.loadRaw().
 *
 * Keeps the `new ConfigLoader()` instantiation off of
 * {@link ConfigBootstrap.loadFullConfig}, narrowing its decoupling footprint
 * and making the loader trivially replaceable in unit tests via vi.mock.
 */

import { ConfigLoader } from '../../Config/ConfigLoader.js';
import type { IImporterConfig, Procedure } from '../../Types/Index.js';

/**
 * Loads and deep-merges the raw importer config via {@link ConfigLoader}.
 *
 * @returns Procedure with the merged IImporterConfig, or failure if absent.
 */
export default function loadRaw(): Procedure<IImporterConfig> {
  return new ConfigLoader().loadRaw();
}
