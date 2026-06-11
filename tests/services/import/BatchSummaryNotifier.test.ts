/**
 * Edge-case unit tests for BatchSummaryNotifier â€” exercises the
 * three explicit Procedure outcomes (`no-notifier` / `sent` /
 * `notifier-threw`) and the icon/format branches that the
 * ImportMediator-level tests rely on but do not assert directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BatchSummaryNotifier from '../../../src/Services/Import/BatchSummaryNotifier.js';
import type { INotifier } from '../../../src/Services/Notifications/INotifier.js';
import type { IBatchResult, IImportJobResult } from '../../../src/Types/Index.js';

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const sampleJob: IImportJobResult = {
  job: { id: 'j', bankName: 'discount', batchId: 'b', source: 'api' },
  exitCode: 0,
  durationMs: 1000,
};

const baseBatch: IBatchResult = {
  batchId: 'batch-1',
  source: 'api',
  jobs: [sampleJob, { ...sampleJob, exitCode: 1 }],
  totalDurationMs: 8000,
  successCount: 1,
  failureCount: 1,
};

describe('BatchSummaryNotifier.send', () => {
  let notifier: { sendMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    notifier = { sendMessage: vi.fn().mockResolvedValue(undefined) };
  });

  it('returns no-notifier when constructed with null', async () => {
    const sut = new BatchSummaryNotifier(null);
    const result = await sut.send(baseBatch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('no-notifier');
  });

  it('returns sent when the notifier resolves', async () => {
    const sut = new BatchSummaryNotifier(notifier as unknown as INotifier);
    const result = await sut.send(baseBatch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('sent');
    expect(notifier.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns notifier-threw when sendMessage rejects (never propagates)', async () => {
    notifier.sendMessage.mockRejectedValueOnce(new Error('boom'));
    const sut = new BatchSummaryNotifier(notifier as unknown as INotifier);
    const result = await sut.send(baseBatch);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('notifier-threw');
  });

  it('uses the warning icon when failureCount > 0', async () => {
    const sut = new BatchSummaryNotifier(notifier as unknown as INotifier);
    await sut.send(baseBatch);
    const msg = notifier.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('\u26a0\ufe0f');
    expect(msg).toContain('1/2 banks OK');
  });

  it('uses the check icon and 8s duration when failureCount = 0', async () => {
    const sut = new BatchSummaryNotifier(notifier as unknown as INotifier);
    await sut.send({ ...baseBatch, jobs: [sampleJob], successCount: 1, failureCount: 0 });
    const msg = notifier.sendMessage.mock.calls[0][0] as string;
    expect(msg).toContain('\u2705');
    expect(msg).toMatch(/\(8s\)/);
  });
});
