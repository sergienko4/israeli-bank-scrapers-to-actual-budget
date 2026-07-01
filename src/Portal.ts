/**
 * Config portal entry point. Re-exports the public surface for tests and boots
 * the server when run directly (e.g. `node dist/Portal.js`).
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import bootPortal from './Portal/PortalBootstrap.js';

export { default as bootPortal } from './Portal/PortalBootstrap.js';
export { buildPortal, startPortal } from './Portal/PortalServer.js';

const CURRENT_PATH = fileURLToPath(import.meta.url);
const CURRENT_FILE = resolve(CURRENT_PATH);
const INVOKED_ARG = process.argv[1];
const INVOKED_FILE = INVOKED_ARG ? resolve(INVOKED_ARG) : undefined;
if (INVOKED_FILE && CURRENT_FILE === INVOKED_FILE) {
  await bootPortal();
}
