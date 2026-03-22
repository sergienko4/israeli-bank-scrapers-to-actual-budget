import { describe, it, expect } from 'vitest';
import ChainBuilder from '../../../src/Scrapers/Pipeline/Builder/ChainBuilder.js';
import { succeed } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

const MOCK_STEP = async (ctx: IPipelineContext) => succeed(ctx);

describe('ChainBuilder', () => {
  it('builds an empty pipeline', () => {
    const steps = new ChainBuilder().build();
    expect(steps).toHaveLength(0);
  });

  it('adds steps with metadata', () => {
    const steps = new ChainBuilder()
      .add(MOCK_STEP, { name: 'step-a', description: 'First step' })
      .add(MOCK_STEP, { name: 'step-b', description: 'Second step' })
      .build();

    expect(steps).toHaveLength(2);
    expect(steps[0].meta.name).toBe('step-a');
    expect(steps[1].meta.name).toBe('step-b');
  });

  it('returns a frozen array', () => {
    const steps = new ChainBuilder()
      .add(MOCK_STEP, { name: 'x', description: 'x' })
      .build();

    expect(Object.isFrozen(steps)).toBe(true);
  });

  it('supports method chaining', () => {
    const builder = new ChainBuilder();
    const returned = builder.add(MOCK_STEP, { name: 'a', description: 'a' });
    expect(returned).toBe(builder);
  });

  it('each step has an execute function', () => {
    const steps = new ChainBuilder()
      .add(MOCK_STEP, { name: 'test', description: 'test' })
      .build();

    expect(typeof steps[0].execute).toBe('function');
  });
});
