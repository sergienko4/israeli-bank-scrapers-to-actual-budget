/**
 * Bank registry — maps user-facing bank aliases to canonical entries.
 *
 * Replaces the hardcoded COMPANY_TYPE_MAP previously embedded in
 * BankScraper. The supported-bank entries come from the shared BANK_CATALOG
 * (Types/BankCatalog), so adding a new bank is one catalog entry; no
 * orchestration code needs to change (OCP — open for extension,
 * closed for modification).
 */

import type { IBankCatalogEntry } from '../Types/BankCatalog.js';
import { BANK_CATALOG } from '../Types/BankCatalog.js';
import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

/** Canonical entry for a single supported bank (sourced from the catalog). */
export type IBankRegistryEntry = IBankCatalogEntry;

/** Read-only lookup surface exposed to collaborators. */
export interface IBankRegistry {
  resolve(name: string): Procedure<IBankRegistryEntry>;
  list(): readonly IBankRegistryEntry[];
}

/** In-memory IBankRegistry implementation backed by a frozen alias map. */
class DefaultBankRegistry implements IBankRegistry {
  private readonly _aliasMap: ReadonlyMap<string, IBankRegistryEntry>;

  /**
   * Creates a registry from a frozen list of canonical entries.
   * @param entries - Canonical registry entries to index by alias.
   */
  constructor(private readonly entries: readonly IBankRegistryEntry[]) {
    this._aliasMap = DefaultBankRegistry.buildAliasMap(entries);
  }

  /**
   * Resolves a bank alias (case-insensitive) to its canonical entry.
   * @param name - User-facing bank alias or canonical id.
   * @returns Procedure success with the entry, or failure for unknown banks.
   */
  public resolve(name: string): Procedure<IBankRegistryEntry> {
    const key = name.trim().toLowerCase();
    const found = this._aliasMap.get(key);
    if (!found) return fail(`Unknown bank: ${key}`, { status: 'unknown-bank' });
    return succeed(found, 'resolved');
  }

  /**
   * Returns the registry's canonical entries in registration order.
   * @returns Read-only array of canonical bank entries.
   */
  public list(): readonly IBankRegistryEntry[] {
    return this.entries;
  }

  /**
   * Builds the alias→entry map (lowercased) from a list of entries.
   * @param entries - Canonical registry entries to index.
   * @returns Frozen Map of lowercased alias to canonical entry.
   */
  private static buildAliasMap(
    entries: readonly IBankRegistryEntry[],
  ): ReadonlyMap<string, IBankRegistryEntry> {
    const map = new Map<string, IBankRegistryEntry>();
    for (const item of entries) {
      for (const alias of item.aliases) {
        const aliasKey = alias.toLowerCase();
        map.set(aliasKey, item);
      }
    }
    return map;
  }
}

/**
 * Builds the default bank registry shipped with the importer.
 * @returns Frozen IBankRegistry seeded with every supported bank alias.
 */
export function createBankRegistry(): IBankRegistry {
  return new DefaultBankRegistry(BANK_CATALOG);
}

/** Frozen default registry exposed for read-only inspection. */
export const DEFAULT_BANK_REGISTRY: IBankRegistry = createBankRegistry();
