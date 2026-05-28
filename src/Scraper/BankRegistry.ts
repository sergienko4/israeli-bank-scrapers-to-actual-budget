/**
 * Bank registry — maps user-facing bank aliases to canonical entries.
 *
 * Replaces the hardcoded COMPANY_TYPE_MAP previously embedded in
 * BankScraper. Adding a new bank is now additive registration; no
 * orchestration code needs to change (OCP — open for extension,
 * closed for modification).
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ISignPolicy, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

/** Canonical entry for a single supported bank. */
export interface IBankRegistryEntry {
  readonly bankId: string;
  readonly companyType: CompanyTypes;
  readonly aliases: readonly string[];
  readonly signPolicy: ISignPolicy;
}

/** Read-only lookup surface exposed to collaborators. */
export interface IBankRegistry {
  resolve(name: string): Procedure<IBankRegistryEntry>;
  list(): readonly IBankRegistryEntry[];
}

const DEFAULT_REGISTRY_ENTRIES: readonly IBankRegistryEntry[] = Object.freeze([
  entry({ bankId: 'hapoalim',         companyType: CompanyTypes.Hapoalim,         aliases: ['hapoalim'],                              signPolicy: 'preserve' }),
  entry({ bankId: 'leumi',            companyType: CompanyTypes.Leumi,            aliases: ['leumi'],                                 signPolicy: 'preserve' }),
  entry({ bankId: 'discount',         companyType: CompanyTypes.Discount,         aliases: ['discount'],                              signPolicy: 'preserve' }),
  entry({ bankId: 'mizrahi',          companyType: CompanyTypes.Mizrahi,          aliases: ['mizrahi'],                               signPolicy: 'preserve' }),
  entry({ bankId: 'mercantile',       companyType: CompanyTypes.Mercantile,       aliases: ['mercantile'],                            signPolicy: 'preserve' }),
  entry({ bankId: 'otsarhahayal',     companyType: CompanyTypes.OtsarHahayal,     aliases: ['otsarHahayal', 'otsarhahayal'],          signPolicy: 'preserve' }),
  entry({ bankId: 'beinleumi',        companyType: CompanyTypes.Beinleumi,        aliases: ['beinleumi'],                             signPolicy: 'preserve' }),
  entry({ bankId: 'massad',           companyType: CompanyTypes.Massad,           aliases: ['massad'],                                signPolicy: 'preserve' }),
  entry({ bankId: 'yahav',            companyType: CompanyTypes.Yahav,            aliases: ['yahav'],                                 signPolicy: 'preserve' }),
  entry({ bankId: 'visacal',          companyType: CompanyTypes.VisaCal,          aliases: ['visaCal', 'visacal'],                    signPolicy: 'flip-credit' }),
  entry({ bankId: 'max',              companyType: CompanyTypes.Max,              aliases: ['max'],                                   signPolicy: 'flip-credit' }),
  entry({ bankId: 'isracard',         companyType: CompanyTypes.Isracard,         aliases: ['isracard'],                              signPolicy: 'flip-credit' }),
  entry({ bankId: 'amex',             companyType: CompanyTypes.Amex,             aliases: ['amex'],                                  signPolicy: 'flip-credit' }),
  entry({ bankId: 'beyahadbishvilha', companyType: CompanyTypes.BeyahadBishvilha, aliases: ['beyahadBishvilha', 'beyahadbishvilha'],  signPolicy: 'preserve' }),
  entry({ bankId: 'behatsdaa',        companyType: CompanyTypes.Behatsdaa,        aliases: ['behatsdaa'],                             signPolicy: 'preserve' }),
  entry({ bankId: 'pagi',             companyType: CompanyTypes.Pagi,             aliases: ['pagi'],                                  signPolicy: 'preserve' }),
  entry({ bankId: 'onezero',          companyType: CompanyTypes.OneZero,          aliases: ['oneZero', 'onezero'],                    signPolicy: 'preserve' }),
  entry({ bankId: 'paybox',           companyType: CompanyTypes.PayBox,           aliases: ['payBox', 'paybox'],                      signPolicy: 'preserve' }),
  entry({ bankId: 'pepper',           companyType: CompanyTypes.Pepper,           aliases: ['pepper'],                                signPolicy: 'preserve' }),
]);

/**
 * Builds a frozen registry entry from its component parts.
 * @param spec - All fields of the IBankRegistryEntry to freeze.
 * @returns Frozen IBankRegistryEntry ready for inclusion in the registry.
 */
function entry(spec: IBankRegistryEntry): IBankRegistryEntry {
  return Object.freeze(spec);
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
  return new DefaultBankRegistry(DEFAULT_REGISTRY_ENTRIES);
}

/** Frozen default registry exposed for read-only inspection. */
export const DEFAULT_BANK_REGISTRY: IBankRegistry = createBankRegistry();
