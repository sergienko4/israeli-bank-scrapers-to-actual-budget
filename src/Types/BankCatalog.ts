/**
 * Canonical catalog of every supported bank — the single source of truth for
 * the bankId ↔ companyType mapping, aliases, and sign policy. Lives in the
 * shared-kernel Types layer so both the Scraper's BankRegistry and the Config
 * manifest derive the supported-bank list from one place without an outward
 * (Config → Scraper) dependency. Adding a bank = one entry here.
 *
 * Sign policy: every bank is `preserve` as of scraper 8.6.7. The four card
 * issuers (visacal/max/isracard/amex) carried `flip-credit` while the upstream
 * scraper emitted card charges as positive amounts; 8.6.7 (upstream PR #483)
 * negates them at the source, so flipping again would book every charge as
 * income. `flip-credit` is retained as an escape hatch should upstream regress.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { ISignPolicy } from './Index.js';

/** Canonical catalog entry for a single supported bank. */
export interface IBankCatalogEntry {
  readonly bankId: string;
  readonly companyType: CompanyTypes;
  readonly aliases: readonly string[];
  readonly signPolicy: ISignPolicy;
  /** True when this issuer's statements are card statements, not bank accounts. */
  readonly isCreditCard?: boolean;
}

/**
 * Freezes one catalog entry so the shared catalog stays fully immutable.
 *
 * Both the entry object and its nested `aliases` array are frozen, so no
 * consumer can mutate `BANK_CATALOG[n].aliases` and affect every other reader
 * of this shared source of truth.
 * @param spec - All fields of the IBankCatalogEntry to freeze.
 * @returns Deeply-frozen IBankCatalogEntry ready for inclusion in the catalog.
 */
function entry(spec: IBankCatalogEntry): IBankCatalogEntry {
  return Object.freeze({
    ...spec,
    aliases: Object.freeze([...spec.aliases]),
  });
}

/** Every supported bank, in registration order. */
export const BANK_CATALOG: readonly IBankCatalogEntry[] = Object.freeze([
  entry({ bankId: 'hapoalim',         companyType: CompanyTypes.Hapoalim,         aliases: ['hapoalim'],                              signPolicy: 'preserve' }),
  entry({ bankId: 'leumi',            companyType: CompanyTypes.Leumi,            aliases: ['leumi'],                                 signPolicy: 'preserve' }),
  entry({ bankId: 'discount',         companyType: CompanyTypes.Discount,         aliases: ['discount'],                              signPolicy: 'preserve' }),
  entry({ bankId: 'mizrahi',          companyType: CompanyTypes.Mizrahi,          aliases: ['mizrahi'],                               signPolicy: 'preserve' }),
  entry({ bankId: 'mercantile',       companyType: CompanyTypes.Mercantile,       aliases: ['mercantile'],                            signPolicy: 'preserve' }),
  entry({ bankId: 'otsarhahayal',     companyType: CompanyTypes.OtsarHahayal,     aliases: ['otsarHahayal', 'otsarhahayal'],          signPolicy: 'preserve' }),
  entry({ bankId: 'beinleumi',        companyType: CompanyTypes.Beinleumi,        aliases: ['beinleumi'],                             signPolicy: 'preserve' }),
  entry({ bankId: 'massad',           companyType: CompanyTypes.Massad,           aliases: ['massad'],                                signPolicy: 'preserve' }),
  entry({ bankId: 'yahav',            companyType: CompanyTypes.Yahav,            aliases: ['yahav'],                                 signPolicy: 'preserve' }),
  entry({ bankId: 'visacal',          companyType: CompanyTypes.VisaCal,          aliases: ['visaCal', 'visacal'],                    signPolicy: 'preserve', isCreditCard: true }),
  entry({ bankId: 'max',              companyType: CompanyTypes.Max,              aliases: ['max'],                                   signPolicy: 'preserve', isCreditCard: true }),
  entry({ bankId: 'isracard',         companyType: CompanyTypes.Isracard,         aliases: ['isracard'],                              signPolicy: 'preserve', isCreditCard: true }),
  entry({ bankId: 'amex',             companyType: CompanyTypes.Amex,             aliases: ['amex'],                                  signPolicy: 'preserve', isCreditCard: true }),
  entry({ bankId: 'beyahadbishvilha', companyType: CompanyTypes.BeyahadBishvilha, aliases: ['beyahadBishvilha', 'beyahadbishvilha'],  signPolicy: 'preserve' }),
  entry({ bankId: 'behatsdaa',        companyType: CompanyTypes.Behatsdaa,        aliases: ['behatsdaa'],                             signPolicy: 'preserve' }),
  entry({ bankId: 'pagi',             companyType: CompanyTypes.Pagi,             aliases: ['pagi'],                                  signPolicy: 'preserve' }),
  entry({ bankId: 'onezero',          companyType: CompanyTypes.OneZero,          aliases: ['oneZero', 'onezero'],                    signPolicy: 'preserve' }),
  entry({ bankId: 'paybox',           companyType: CompanyTypes.PayBox,           aliases: ['payBox', 'paybox'],                      signPolicy: 'preserve' }),
  entry({ bankId: 'pepper',           companyType: CompanyTypes.Pepper,           aliases: ['pepper'],                                signPolicy: 'preserve' }),
]);

/** Bank IDs of every catalog entry flagged {@link IBankCatalogEntry.isCreditCard}. */
const CARD_BANK_IDS: readonly string[] = BANK_CATALOG
  .filter((bank) => bank.isCreditCard === true)
  .map((bank) => bank.bankId);

/**
 * Bank IDs whose statements are credit-card statements rather than bank
 * accounts. Derived from the catalog itself — beside the sign policy it
 * explains — so both the Scraper's sign normalizer and the card-refund
 * cleanup command read one source of truth without either depending on the
 * other, and adding a card issuer stays a one-line catalog edit.
 */
export const CREDIT_CARD_BANKS: ReadonlySet<string> = new Set(CARD_BANK_IDS);
