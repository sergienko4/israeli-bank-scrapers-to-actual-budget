# Task 04: Centralize Utility Functions (DRY Principle)

**Priority:** 🟢 LOW
**Effort:** 30 minutes
**Status:** 📋 TODO

---

## 🎯 Goal

Apply DRY (Don't Repeat Yourself) principle by centralizing duplicate utility functions (`formatDate`, `toCents`) into a single utilities module.

---

## 📝 Requirements

- Create centralized utils.ts module
- Remove duplicates from:
  - src/index.ts
  - src/services/ReconciliationService.ts
  - src/services/TransactionService.ts (if Task 02 done)
- Single source of truth
- Easy to test
- TypeScript strict mode compliant

---

## 🗂️ Files to Create

```
src/utils/
├── index.ts
├── currency.ts
└── date.ts

tests/utils/ (if Task 01 done)
├── currency.test.ts
└── date.test.ts
```

---

## 📋 Implementation Steps

### Step 1: Create Currency Utils
**File:** `src/utils/currency.ts`

```typescript
/**
 * Convert currency units to cents
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert cents to currency units
 */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number, currency: string = 'ILS'): string {
  return `${amount.toFixed(2)} ${currency}`;
}
```

### Step 2: Create Date Utils
**File:** `src/utils/date.ts`

```typescript
/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date
 */
export function getToday(): string {
  return formatDate(new Date());
}

/**
 * Check if date is in the future
 */
export function isFutureDate(date: Date | string): boolean {
  const d = new Date(date);
  const now = new Date();
  return d > now;
}
```

### Step 3: Export All
**File:** `src/utils/index.ts`

```typescript
export * from './currency.js';
export * from './date.js';
```

### Step 4: Update All Files
Remove duplicate functions and import from utils/

---

## ✅ Acceptance Criteria

- [ ] Utils module created
- [ ] Duplicates removed
- [ ] All imports updated
- [ ] Code compiles
- [ ] Functionality unchanged
- [ ] Tests added (if Task 01 done)

---

## 🔗 Related Tasks

- Task 01 (tests for utils)
- Task 02 (TransactionService uses these)

---

## 📝 Notes

- Pure refactoring - no behavior changes
- Good warm-up task
- Makes testing easier
