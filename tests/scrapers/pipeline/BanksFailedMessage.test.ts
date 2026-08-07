import { describe, expect, it } from 'vitest';

import buildBanksFailedMessage from '../../../src/Scrapers/Pipeline/Steps/BanksFailedMessage.js';
import type { IBankResultsState } from '../../../src/Types/Pipeline/Index.js';
import { fakeBankQuarantineEntry } from '../../helpers/factories.js';

/**
 * Builds a zero-success partition from the supplied `name: message` pairs.
 * @param pairs - Bank name and error message pairs to quarantine.
 * @param totalBanks - Banks attempted; defaults to the number of pairs.
 * @returns IBankResultsState in which no bank succeeded.
 */
function failedPartition(
  pairs: readonly (readonly [string, string])[],
  totalBanks = pairs.length,
): IBankResultsState {
  return {
    successful: [],
    quarantined: pairs.map(([bankName, message]) => fakeBankQuarantineEntry({
      bankName, error: new Error(message),
    })),
    totalBanks,
  };
}

describe('buildBanksFailedMessage', () => {
  it('names the bank when a single-bank run failed', () => {
    const partition = failedPartition([['visacal', 'zero accounts resolved']]);

    const message = buildBanksFailedMessage(partition);

    expect(message).toBe('Import failed for visacal: zero accounts resolved');
  });

  it('never claims all banks failed for a single-bank run', () => {
    const partition = failedPartition([['paybox', 'timeout']]);

    const message = buildBanksFailedMessage(partition);

    expect(message).not.toContain('All');
    expect(message).not.toBe('all-banks-failed');
  });

  it('states the count and names every bank when several banks failed', () => {
    const partition = failedPartition([
      ['visacal', 'zero accounts'],
      ['max', 'login rejected'],
    ]);

    const message = buildBanksFailedMessage(partition);

    expect(message).toBe(
      'All 2 banks failed — visacal: zero accounts; max: login rejected',
    );
  });

  it('caps the listed banks at five and elides the rest', () => {
    const pairs = Array.from({ length: 8 }, (_unused, i): readonly [string, string] =>
      [`bank-${String(i)}`, `error-${String(i)}`]);

    const message = buildBanksFailedMessage(failedPartition(pairs));

    expect(message).toContain('bank-4: error-4');
    expect(message).not.toContain('bank-5');
    expect(message).toContain('...and 3 more');
  });

  it('falls back to a placeholder when the error message is blank', () => {
    const partition = failedPartition([['leumi', '   ']]);

    const message = buildBanksFailedMessage(partition);

    expect(message).toBe('Import failed for leumi: unknown error');
  });

  it('still reads sensibly when no quarantine entry was recorded', () => {
    const partition: IBankResultsState = {
      successful: [], quarantined: [], totalBanks: 1,
    };

    const message = buildBanksFailedMessage(partition);

    expect(message).toBe('Import failed for the only configured bank');
  });

  it('omits the detail suffix for a multi-bank run with no quarantine entries', () => {
    const partition: IBankResultsState = {
      successful: [], quarantined: [], totalBanks: 4,
    };

    const message = buildBanksFailedMessage(partition);

    expect(message).toBe('All 4 banks failed');
  });

  it('flattens a multi-line reason onto one line', () => {
    const stack = 'Request failed\n    at fetchAccounts (api.ts:42)\n    at scrape';

    const message = buildBanksFailedMessage(failedPartition([['visacal', stack]]));

    expect(message).not.toContain('\n');
    expect(message).toBe(
      'Import failed for visacal: Request failed at fetchAccounts (api.ts:42) at scrape',
    );
  });

  it('truncates an oversized reason so other banks stay visible', () => {
    const huge = 'x'.repeat(500);
    const partition = failedPartition([['visacal', huge], ['max', 'login rejected']]);

    const message = buildBanksFailedMessage(partition);

    expect(message).toContain('…');
    expect(message).toContain('max: login rejected');
    expect(message.length).toBeLessThan(300);
  });

  it('never exceeds the reason cap, ellipsis included', () => {
    const overCap = 'y'.repeat(161);

    const message = buildBanksFailedMessage(failedPartition([['visacal', overCap]]));

    const reason = message.replace('Import failed for visacal: ', '');
    expect(reason.endsWith('…')).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(160);
  });
});
