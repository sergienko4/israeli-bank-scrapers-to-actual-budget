import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fail, isSuccess, succeed } from '../../../src/Types/ProcedureHelpers.js';

const { mockLoadRaw } = vi.hoisted(() => ({
  mockLoadRaw: vi.fn(),
}));
vi.mock('../../../src/Config/ConfigLoader.js', () => {
  class MockConfigLoader {
    loadRaw = mockLoadRaw;
  }
  return { ConfigLoader: MockConfigLoader };
});

import loadRaw from '../../../src/Scheduler/Config/ConfigLoaderFactory.js';

describe('ConfigLoaderFactory.loadRaw', () => {
  beforeEach(() => { mockLoadRaw.mockReset(); });

  it('delegates to a fresh ConfigLoader instance and returns its result', () => {
    const fakeConfig = { banks: { mizrahi: {} } };
    mockLoadRaw.mockReturnValue(succeed(fakeConfig));
    const result = loadRaw();
    expect(result.success).toBe(true);
    if (!isSuccess(result)) return;
    expect(result.data).toBe(fakeConfig);
    expect(mockLoadRaw).toHaveBeenCalledOnce();
  });

  it('propagates loader failures without wrapping', () => {
    mockLoadRaw.mockReturnValue(fail('missing config.json'));
    const result = loadRaw();
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toBe('missing config.json');
  });
});
