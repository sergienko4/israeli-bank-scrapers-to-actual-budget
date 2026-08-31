/**
 * Blast-radius tests for the one-off `--cleanup-card-refunds` command.
 *
 * The command deletes rows, so the set of Actual accounts it is willing to
 * read is a safety boundary rather than a convenience.
 *
 * `findStaleRefundCandidates` pairs rows by (date, merchant, |amount|) and
 * assumes the NEGATIVE row of a pair is the stale artefact — true for the
 * scraper 8.6.6 card-refund defect it was written for. Scraper 8.6.10 fixes
 * a Hapoalim defect whose pair has the OPPOSITE polarity: there the positive
 * row is the stale one and the negative row is correct. A Hapoalim pair is
 * shape-identical to a card pair, so if Hapoalim rows are ever in scope the
 * matcher would delete the CORRECT row and keep the wrong one.
 *
 * Rows are queried by Actual account id alone, with no bank provenance
 * filter, and config validation checks only that each `actualAccountId` is a
 * well-formed UUID — nothing stops a card bank and Hapoalim from pointing at
 * the same Actual account. These tests pin that such a shared account is
 * excluded from the command's reach.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { cardAccountIds } from '../../../src/Services/Transaction/CardRefundCleanup.js';
import type { IImporterConfig } from '../../../src/Types/Index.js';
import { fakeBankConfig, fakeBankTarget, fakeImporterConfig, fakeUuid } from '../../helpers/factories.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const CARD_ONLY = fakeUuid();
const SHARED = fakeUuid();
const DEBIT_ONLY = fakeUuid();

/**
 * Builds a fully typed config whose banks target the given Actual accounts.
 * @param banks - Map of bank name to the Actual account ids it targets.
 * @returns A config object shaped for {@link cardAccountIds}.
 */
function configWith(banks: Record<string, readonly string[]>): IImporterConfig {
  const entries = Object.entries(banks).map(([name, ids]) => {
    const targets = ids.map((actualAccountId) => fakeBankTarget({ actualAccountId }));
    return [name, fakeBankConfig({ targets })];
  });
  const banksByName = Object.fromEntries(entries);
  return fakeImporterConfig({ banks: banksByName });
}

beforeEach(() => {
  mockLogger.warn.mockClear();
});

describe('cleanup-card-refunds account selection', () => {
  it('includes an account used only by a card issuer', () => {
    const config = configWith({ visacal: [CARD_ONLY] });
    expect(cardAccountIds(config)).toEqual([CARD_ONLY]);
  });

  it('ignores an account used only by a debit bank', () => {
    const config = configWith({ hapoalim: [DEBIT_ONLY] });
    expect(cardAccountIds(config)).toEqual([]);
  });

  it('excludes an account a card issuer shares with a debit bank', () => {
    const config = configWith({ visacal: [SHARED], hapoalim: [SHARED] });
    expect(cardAccountIds(config)).not.toContain(SHARED);
  });

  it('keeps unshared card accounts when a sibling target is shared', () => {
    const config = configWith({ visacal: [CARD_ONLY, SHARED], hapoalim: [SHARED] });
    expect(cardAccountIds(config)).toEqual([CARD_ONLY]);
  });

  it('still excludes a shared account when the debit bank is listed first', () => {
    const config = configWith({ hapoalim: [SHARED], max: [SHARED] });
    expect(cardAccountIds(config)).toEqual([]);
  });

  it('excludes a shared account when the two banks differ only in UUID casing', () => {
    const upper = SHARED.toUpperCase();
    const config = configWith({ visacal: [upper], hapoalim: [SHARED] });
    expect(cardAccountIds(config)).toEqual([]);
  });

  it('preserves the configured casing of an account it does sweep', () => {
    const upper = CARD_ONLY.toUpperCase();
    const config = configWith({ visacal: [upper] });
    expect(cardAccountIds(config)).toEqual([upper]);
  });
});

describe('cleanup-card-refunds operator warning', () => {
  it('names the skipped account and how to make it eligible', () => {
    const config = configWith({ visacal: [SHARED], hapoalim: [SHARED] });
    cardAccountIds(config);
    const [message] = mockLogger.warn.mock.calls[0] as [string];
    expect(message).toContain(SHARED);
    expect(message).toContain('its own Actual account');
  });

  it('stays silent when no account is shared', () => {
    const config = configWith({ visacal: [CARD_ONLY], hapoalim: [DEBIT_ONLY] });
    cardAccountIds(config);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
