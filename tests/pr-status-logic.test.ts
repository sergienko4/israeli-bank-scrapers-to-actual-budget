/**
 * Canary tests for scripts/pr-status-logic.cjs — the verdict logic behind the
 * PR Status Watch workflow (.github/workflows/pr-status-watch.yml).
 *
 * These lock the contract that the CI verdict EXCLUDES CodeRabbit's own check
 * run, so a CodeRabbit rate-limit ("Insufficient usage credits", the exact
 * state observed on PR #464) is never reported as a CI failure. They also lock
 * the latest-review resolution and the overall ready/blocked precedence. They
 * fail if the CodeRabbit exclusion is removed or the precedence is reordered.
 */

import { describe, it, expect } from 'vitest';
import {
  isCodeRabbit,
  ciVerdict,
  crVerdict,
  overallVerdict,
} from '../scripts/pr-status-logic.cjs';

const checkRun = (name: string, conclusion: string | null, status = 'COMPLETED') => ({
  __typename: 'CheckRun' as const,
  name,
  status,
  conclusion,
});

const statusContext = (context: string, state: string) => ({
  __typename: 'StatusContext' as const,
  context,
  state,
});

const review = (login: string, state: string, submittedAt: string) => ({
  author: { login },
  state,
  submittedAt,
});

describe('isCodeRabbit', () => {
  it('matches CodeRabbit check names and bot logins case-insensitively', () => {
    expect(isCodeRabbit('CodeRabbit')).toBe(true);
    expect(isCodeRabbit('coderabbitai')).toBe(true);
    expect(isCodeRabbit('coderabbitai[bot]')).toBe(true);
    expect(isCodeRabbit('CODERABBIT')).toBe(true);
  });

  it('does not match real CI checks or other authors', () => {
    expect(isCodeRabbit('Test & Lint')).toBe(false);
    expect(isCodeRabbit('Build & Audit')).toBe(false);
    expect(isCodeRabbit('some-other-bot')).toBe(false);
    expect(isCodeRabbit('')).toBe(false);
    expect(isCodeRabbit(null)).toBe(false);
    expect(isCodeRabbit(undefined)).toBe(false);
  });
});

describe('ciVerdict — excludes CodeRabbit so its outage is not CI red', () => {
  it('returns SUCCESS when all real CI passes even if the CodeRabbit check failed', () => {
    const contexts = [
      checkRun('Test & Lint', 'SUCCESS'),
      checkRun('Build & Audit', 'SUCCESS'),
      checkRun('CodeRabbit', 'FAILURE'), // "Insufficient usage credits"
    ];
    expect(ciVerdict(contexts)).toBe('SUCCESS');
  });

  it('reproduces PR #464: real checks mostly green with two pending => PENDING (CodeRabbit ignored)', () => {
    const contexts = [
      checkRun('Test & Lint', 'SUCCESS'),
      checkRun('Build & Audit', 'SUCCESS'),
      checkRun('SonarCloud Analysis', 'SUCCESS'),
      checkRun('CodeQL Security Scan', 'SUCCESS'),
      checkRun('Documentation Quality', 'SUCCESS'),
      checkRun('License Compliance', 'SUCCESS'),
      checkRun('E2E Tests', null, 'IN_PROGRESS'),
      checkRun('Container Security Scan', null, 'QUEUED'),
      checkRun('CodeRabbit', 'FAILURE'),
    ];
    expect(ciVerdict(contexts)).toBe('PENDING');
  });

  it('returns FAILURE on a real CI failure regardless of CodeRabbit', () => {
    const contexts = [checkRun('Test & Lint', 'FAILURE'), checkRun('CodeRabbit', 'SUCCESS')];
    expect(ciVerdict(contexts)).toBe('FAILURE');
  });

  it('treats NEUTRAL and SKIPPED conclusions as non-failing', () => {
    const contexts = [checkRun('A', 'NEUTRAL'), checkRun('B', 'SKIPPED'), checkRun('C', 'SUCCESS')];
    expect(ciVerdict(contexts)).toBe('SUCCESS');
  });

  it('honours legacy StatusContext states', () => {
    expect(ciVerdict([statusContext('legacy', 'PENDING')])).toBe('PENDING');
    expect(ciVerdict([statusContext('legacy', 'FAILURE')])).toBe('FAILURE');
    expect(ciVerdict([statusContext('legacy', 'SUCCESS')])).toBe('SUCCESS');
  });

  it('returns NONE when there are no checks, or only CodeRabbit', () => {
    expect(ciVerdict([])).toBe('NONE');
    expect(ciVerdict([checkRun('CodeRabbit', 'FAILURE')])).toBe('NONE');
    expect(ciVerdict(undefined as unknown as [])).toBe('NONE');
  });
});

describe('crVerdict — latest CodeRabbit review wins', () => {
  it('returns NONE when CodeRabbit has not reviewed (human reviews ignored)', () => {
    expect(crVerdict([review('a-human', 'COMMENTED', '2026-06-16T10:00:00Z')])).toBe('NONE');
    expect(crVerdict([])).toBe('NONE');
    expect(crVerdict(undefined as unknown as [])).toBe('NONE');
  });

  it('picks the most recent CodeRabbit review by submittedAt', () => {
    const reviews = [
      review('coderabbitai[bot]', 'CHANGES_REQUESTED', '2026-06-16T10:00:00Z'),
      review('coderabbitai[bot]', 'APPROVED', '2026-06-16T12:00:00Z'),
    ];
    expect(crVerdict(reviews)).toBe('APPROVED');
    expect(crVerdict([...reviews].reverse())).toBe('APPROVED');
  });

  it('ignores non-CodeRabbit reviews when resolving the latest', () => {
    const reviews = [
      review('coderabbitai[bot]', 'COMMENTED', '2026-06-16T09:00:00Z'),
      review('a-human', 'APPROVED', '2026-06-16T23:00:00Z'),
    ];
    expect(crVerdict(reviews)).toBe('COMMENTED');
  });

  it('is robust when a CodeRabbit review has no submittedAt (sorts it oldest)', () => {
    const reviews = [
      review('coderabbitai[bot]', 'CHANGES_REQUESTED', '2026-06-16T10:00:00Z'),
      { author: { login: 'coderabbitai[bot]' }, state: 'COMMENTED', submittedAt: undefined },
    ];
    expect(crVerdict(reviews)).toBe('CHANGES_REQUESTED');
  });
});

describe('overallVerdict — precedence', () => {
  it('CI failure blocks regardless of CodeRabbit', () => {
    expect(overallVerdict('FAILURE', 'NONE')).toContain('CI failing');
    expect(overallVerdict('FAILURE', 'CHANGES_REQUESTED')).toContain('CI failing');
  });

  it('CodeRabbit changes-requested blocks even while CI is still running', () => {
    expect(overallVerdict('SUCCESS', 'CHANGES_REQUESTED')).toContain('requested changes');
    expect(overallVerdict('PENDING', 'CHANGES_REQUESTED')).toContain('requested changes');
  });

  it('waits on CI while checks run or before any check exists', () => {
    expect(overallVerdict('PENDING', 'NONE')).toContain('CI running');
    expect(overallVerdict('NONE', 'APPROVED')).toContain('CI running');
  });

  it('waits on CodeRabbit once CI is green but no review yet', () => {
    expect(overallVerdict('SUCCESS', 'NONE')).toContain('review pending');
  });

  it('is ready when CI is green and CodeRabbit has reviewed', () => {
    expect(overallVerdict('SUCCESS', 'APPROVED')).toContain('Ready for maintainer');
    expect(overallVerdict('SUCCESS', 'COMMENTED')).toContain('Ready for maintainer');
  });
});
