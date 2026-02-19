# Task 02: Extract Transaction Import Service

**Priority:** 🟢 LOW
**Effort:** 2-3 hours
**Status:** ✅ DONE

---

## 🎯 Goal

Extract transaction import logic from `index.ts` into a dedicated `TransactionService` for better separation of concerns and testability.

---

## 📝 Requirements

- Move transaction import logic to separate service
- Keep index.ts clean and focused on orchestration
- Service should be easily testable
- No behavior changes, pure refactoring
- Maintain same error handling

---

## 🗂️ Files to Create/Modify

### New Files
```
src/services/TransactionService.ts
tests/services/TransactionService.test.ts (if Task 01 done)
```

### Modified Files
```
src/index.ts (remove transaction logic, use service)
```

---

## 📋 Implementation Steps

### Step 1: Create TransactionService
**File:** `src/services/TransactionService.ts`

```typescript
/**
 * TransactionService - Handles transaction import logic
 */

import api from '@actual-app/api';

export interface ImportResult {
  imported: number;
  skipped: number;
}

export class TransactionService {
  private api: typeof api;

  constructor(actualApi: typeof api) {
    this.api = actualApi;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date | string): string {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Convert currency units to cents
   */
  private toCents(amount: number): number {
    return Math.round(amount * 100);
  }

  /**
   * Import transactions for an account
   */
  async importTransactions(
    bankName: string,
    accountNumber: string,
    actualAccountId: string,
    transactions: any[]
  ): Promise<ImportResult> {
    let imported = 0;
    let skipped = 0;

    console.log(`     📥 Importing ${transactions.length} transactions...`);

    for (const txn of transactions) {
      try {
        const importedId = `${bankName}-${accountNumber}-${
          txn.identifier || `${this.formatDate(txn.date)}-${txn.chargedAmount || txn.originalAmount}`
        }`;

        const transaction = {
          account: actualAccountId,
          date: this.formatDate(txn.date),
          amount: this.toCents(txn.chargedAmount || txn.originalAmount),
          payee_name: txn.description || 'Unknown',
          imported_id: importedId,
          notes: txn.memo || txn.description || '',
          cleared: true
        };

        await this.api.importTransactions(actualAccountId, [transaction]);
        imported++;
      } catch (error: any) {
        if (error.message && error.message.includes('already exists')) {
          skipped++;
        } else {
          console.error(`     ❌ Error importing transaction:`, error.message);
        }
      }
    }

    console.log(`     ✅ Imported: ${imported}, Skipped (duplicates): ${skipped}`);
    return { imported, skipped };
  }

  /**
   * Get or create account in Actual Budget
   */
  async getOrCreateAccount(
    accountId: string,
    bankName: string,
    accountNumber: string
  ): Promise<any> {
    let account = await this.api.getAccounts().then((accounts: any[]) =>
      accounts.find((a: any) => a.id === accountId)
    );

    if (!account) {
      console.log(`     ➕ Creating new account: ${accountId}`);
      account = await this.api.createAccount({
        id: accountId,
        name: `${bankName} - ${accountNumber}`,
        offbudget: false,
        closed: false
      } as any);
    }

    return account;
  }
}
```

### Step 2: Update index.ts
Replace lines 159-213 with service calls

### Step 3: Add Tests (if Task 01 done)

---

## ✅ Acceptance Criteria

- [ ] TransactionService created
- [ ] index.ts uses service
- [ ] All imports work the same
- [ ] No behavior changes
- [ ] Tests added (if Task 01 done)

---

## 🔗 Related Tasks

- Task 01 (tests)
- Task 04 (DRY utilities)
