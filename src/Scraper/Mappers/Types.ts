/**
 * Shared type aliases for the Mappers/ cluster. Keeps the
 * provider-account shape in a single source of truth so the 4 modules
 * (Sign, ToCanonical, FromLegacy, ToLegacy) stay synchronized.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

/**
 * Legacy provider account record extracted from IScraperScrapingResult.
 * Used by every mapper that crosses the provider <-> canonical boundary.
 */
export type ProviderAccount = NonNullable<IScraperScrapingResult['accounts']>[number];
