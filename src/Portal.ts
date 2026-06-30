/**
 * Config portal entry point. Re-exports the public surface for tests and boots
 * the server when run directly (e.g. `node dist/Portal.js`).
 */

import bootPortal from './Portal/PortalBootstrap.js';

export { default as bootPortal } from './Portal/PortalBootstrap.js';
export { buildPortal, startPortal } from './Portal/PortalServer.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  await bootPortal();
}
