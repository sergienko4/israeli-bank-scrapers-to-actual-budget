/**
 * Edge-case unit tests for AccountTargetResolver — locks in the Procedure
 * pattern semantics (succeed/fail) introduced by the AccountImporter split
 * to comply with general-rules-guidlines.md P1.
 *
 * The happy path is already exercised by tests/services/AccountImporter.test.ts
 * end-to-end; this file covers only the resolver-local branches that the
 * orchestrator does not surface directly.
 */
import { describe, expect, it } from 'vitest';

import findTargetForAccount from '../../../src/Services/Account/AccountTargetResolver.js';
import type { IBankConfig, IBankTarget } from '../../../src/Types/Index.js';
import { isFail, isSuccess } from '../../../src/Types/Index.js';

const targetAll: IBankTarget = {
  actualAccountId: 'act-all', reconcile: false, accounts: 'all',
};
const targetSpecific: IBankTarget = {
  actualAccountId: 'act-123', accountName: 'Checking', reconcile: true, accounts: ['12345'],
};

describe('findTargetForAccount', () => {
  it('returns fail(no-target) when bankConfig has no targets field', () => {
    const result = findTargetForAccount({} as IBankConfig, '12345');
    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.status).toBe('no-target');
      expect(result.message).toMatch(/no target/i);
    }
  });

  it('returns fail(no-target) when targets is an empty array', () => {
    const result = findTargetForAccount({ targets: [] }, '12345');
    expect(isFail(result)).toBe(true);
  });

  it('returns fail(no-target) when no target matches the account number', () => {
    const result = findTargetForAccount({ targets: [targetSpecific] }, '99999');
    expect(isFail(result)).toBe(true);
  });

  it('returns succeed with the matching specific-account target', () => {
    const result = findTargetForAccount({ targets: [targetSpecific] }, '12345');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.actualAccountId).toBe('act-123');
      expect(result.data.accountName).toBe('Checking');
    }
  });

  it('returns succeed when a target with accounts="all" is present', () => {
    const result = findTargetForAccount({ targets: [targetAll] }, '99999');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.actualAccountId).toBe('act-all');
    }
  });

  it('returns the first matching target when multiple targets cover the account', () => {
    const result = findTargetForAccount(
      { targets: [targetSpecific, targetAll] }, '12345',
    );
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.actualAccountId).toBe('act-123');
    }
  });
});
