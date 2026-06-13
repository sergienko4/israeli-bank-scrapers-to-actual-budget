/**
 * Israeli Bank Importer for Actual Budget — barrel + entry point.
 *
 * Re-exports the public Importer surface (consumed by tests and any
 * downstream tooling) and optionally boots the importer when the file
 * is executed directly as a Node entry point.
 *
 * The actual implementation lives in src/Importer/*.ts:
 *   - ConfigBootstrap.ts      — config load + logger init + --validate
 *   - ResilienceWiring.ts     — shutdown handler + retry/timeout + error formatter
 *   - CoreServicesWiring.ts   — services + 2FA + AccountImporter
 *   - PipelineComposition.ts  — strategy selection + ChainBuilder + watch service
 *   - ImporterWiring.ts       — top-level buildImporter() orchestrator
 *   - ProcessLifecycle.ts     — shutdown / fatal-error / pipeline-failure handlers
 *   - ImporterBootstrap.ts    — composition + single process.exit site
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootImporter } from './Importer/ImporterBootstrap.js';

export { bootConfigAndLogger, handleValidateMode } from './Importer/ConfigBootstrap.js';
export { bootImporter, buildImporterBootHandle } from './Importer/ImporterBootstrap.js';
export { buildImporter } from './Importer/ImporterWiring.js';
export { buildProcessLifecycle } from './Importer/ProcessLifecycle.js';
export { buildResilienceComponents } from './Importer/ResilienceWiring.js';

const CURRENT_PATH = fileURLToPath(import.meta.url);
const CURRENT_FILE = resolve(CURRENT_PATH);
const INVOKED_ARG = process.argv[1];
const INVOKED_FILE = INVOKED_ARG ? resolve(INVOKED_ARG) : undefined;
if (INVOKED_FILE && CURRENT_FILE === INVOKED_FILE) {
  await bootImporter();
}