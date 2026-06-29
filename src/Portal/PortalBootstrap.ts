/**
 * Portal entry composition: load config, bail out when disabled, otherwise
 * resolve runtime and start the server. Single boot site for the portal.
 */

import { ConfigLoader } from '../Config/ConfigLoader.js';
import { resolveConfigPath } from '../Config/ConfigPath.js';
import { getLogger } from '../Logger/Index.js';
import { isFail } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { isPortalEnabled, portalBootBlocker, resolvePortalRuntime } from './PortalRuntime.js';
import { startPortal } from './PortalServer.js';

const CONFIG_PATH = process.env.PORTAL_CONFIG_PATH ?? resolveConfigPath();

/**
 * Boots the portal when enabled; logs and returns false otherwise.
 * @returns True when the server started, false when disabled or on error.
 */
export default async function bootPortal(): Promise<boolean> {
  const loaded = new ConfigLoader(CONFIG_PATH).loadRaw();
  if (isFail(loaded)) { getLogger().error('Portal: cannot load config'); return false; }
  if (!isPortalEnabled(loaded.data)) { getLogger().info('🖥️  Config portal disabled'); return false; }
  try {
    const runtime = resolvePortalRuntime(loaded.data);
    const blocker = portalBootBlocker(runtime);
    if (blocker) { getLogger().error(`Portal: ${blocker}`); return false; }
    await startPortal(runtime, CONFIG_PATH);
    return true;
  } catch (error: unknown) {
    getLogger().error(`Portal failed to start: ${errorMessage(error)}`);
    return false;
  }
}
