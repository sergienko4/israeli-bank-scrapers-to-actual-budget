import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinoAdapter } from '../../src/Logger/PinoAdapter.js';

function makeMockPino() {
  return {
    debug: vi.fn(),
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
  };
}

describe('PinoAdapter – words format', () => {
  let mockPino: ReturnType<typeof makeMockPino>;
  let adapter: PinoAdapter;

  beforeEach(() => {
    mockPino = makeMockPino();
    adapter  = new PinoAdapter(mockPino as never, 'words');
  });

  it('calls pino.info with context and message', () => {
    adapter.info('hello', { bank: 'discount' });
    expect(mockPino.info).toHaveBeenCalledWith({ bank: 'discount' }, 'hello');
  });

  it('calls pino.info with empty context when none given', () => {
    adapter.info('bare message');
    expect(mockPino.info).toHaveBeenCalledWith({}, 'bare message');
  });

  it('calls pino.debug, warn, error', () => {
    adapter.debug('d');
    adapter.warn('w');
    adapter.error('e');
    expect(mockPino.debug).toHaveBeenCalledWith({}, 'd');
    expect(mockPino.warn).toHaveBeenCalledWith({}, 'w');
    expect(mockPino.error).toHaveBeenCalledWith({}, 'e');
  });

  it('preserves emojis in words format', () => {
    adapter.info('🚀 Starting');
    expect(mockPino.info).toHaveBeenCalledWith({}, '🚀 Starting');
  });
});

describe('PinoAdapter – phone format', () => {
  let mockPino: ReturnType<typeof makeMockPino>;
  let adapter: PinoAdapter;

  beforeEach(() => {
    mockPino = makeMockPino();
    adapter  = new PinoAdapter(mockPino as never, 'phone');
  });

  it('strips emojis and prefixes info with >', () => {
    adapter.info('🚀 Starting import');
    expect(mockPino.info).toHaveBeenCalledWith({}, '> Starting import');
  });

  it('strips emojis and prefixes error with !', () => {
    adapter.error('❌ Failed');
    expect(mockPino.error).toHaveBeenCalledWith({}, '! Failed');
  });

  it('collapses extra whitespace after emoji removal', () => {
    adapter.info('✅  Done  🎉');
    expect(mockPino.info).toHaveBeenCalledWith({}, '> Done');
  });

  it('prefixes debug and warn with >', () => {
    adapter.debug('detail');
    adapter.warn('caution');
    expect(mockPino.debug).toHaveBeenCalledWith({}, '> detail');
    expect(mockPino.warn).toHaveBeenCalledWith({}, '> caution');
  });
});
