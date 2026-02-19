# Task 01: Add Unit Tests + GitHub Actions CI

**Priority:** 🔴 HIGH
**Effort:** 2-3 days
**Status:** 📋 TODO

---

## 🎯 Goal

Add comprehensive unit tests for all services using Vitest and integrate with GitHub Actions for automated testing on every push/PR.

---

## 📝 Requirements

- Choose test framework (Vitest recommended for ESM)
- Test coverage target: 80%+ for services
- All services and utilities should have tests
- Mock external dependencies (API, file system)
- Fast test execution (<30 seconds)
- **Run tests automatically in GitHub Actions**
- **Block merges if tests fail**

---

## 📦 Dependencies to Add

```json
{
  "devDependencies": {
    "vitest": "^1.3.0",
    "@vitest/ui": "^1.3.0",
    "@vitest/coverage-v8": "^1.3.0",
    "@types/node": "^22.19.11",
    "typescript": "^5.9.3"
  }
}
```

---

## 🗂️ Files to Create

```
tests/
├── config/
│   └── ConfigLoader.test.ts
├── services/
│   ├── MetricsService.test.ts
│   └── ReconciliationService.test.ts
├── resilience/
│   ├── RetryStrategy.test.ts
│   └── TimeoutWrapper.test.ts
├── errors/
│   └── ErrorFormatter.test.ts
└── utils/
    └── utils.test.ts (after Task 04)

.github/workflows/
└── test.yml (NEW - CI/CD for tests)

vitest.config.ts (NEW)
```

---

## 📋 Implementation Steps

### Step 1: Setup Test Framework
**File:** `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
```

**Update package.json:**
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest run --coverage",
  "build": "tsc",
  "start": "node dist/index.js",
  "dev": "tsc && node dist/index.js"
}
```

### Step 2: Create GitHub Actions Workflow
**File:** `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [22.x]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter (optional)
        run: npm run lint || true

      - name: Run tests
        run: npm test

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage reports
        uses: codecov/codecov-action@v4
        if: success()
        with:
          files: ./coverage/coverage-final.json
          flags: unittests
          name: codecov-umbrella
        env:
          CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}

      - name: Comment coverage on PR
        uses: romeovs/lcov-reporter-action@v0.3.1
        if: github.event_name == 'pull_request'
        with:
          lcov-file: ./coverage/lcov.info
          github-token: ${{ secrets.GITHUB_TOKEN }}

  build:
    runs-on: ubuntu-latest
    needs: test

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build TypeScript
        run: npm run build

      - name: Check for build artifacts
        run: test -f dist/index.js && echo "Build successful"
```

### Step 3: Test ConfigLoader
**File:** `tests/config/ConfigLoader.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigLoader } from '../../src/config/ConfigLoader.js';
import { ConfigurationError } from '../../src/errors/ErrorTypes.js';
import * as fs from 'fs';

vi.mock('fs');

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads valid config.json successfully', () => {
    const validConfig = {
      actual: {
        init: {
          dataDir: './data',
          password: 'test123',
          serverURL: 'http://localhost:5006'
        },
        budget: {
          syncId: '12345678-1234-1234-1234-123456789abc',
          password: null
        }
      },
      banks: {
        discount: {
          id: '123456789',
          password: 'pass',
          num: 'ABC123',
          targets: [{
            actualAccountId: '12345678-1234-1234-1234-123456789abc',
            reconcile: true,
            accounts: 'all'
          }]
        }
      }
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validConfig));

    const loader = new ConfigLoader('/test/config.json');
    const config = loader.load();

    expect(config.actual.budget.syncId).toBe('12345678-1234-1234-1234-123456789abc');
  });

  it('throws error for invalid UUID format', () => {
    const invalidConfig = {
      actual: {
        init: { dataDir: './data', password: 'test', serverURL: 'http://localhost:5006' },
        budget: { syncId: 'invalid-uuid', password: null }
      },
      banks: {}
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

    const loader = new ConfigLoader('/test/config.json');
    expect(() => loader.load()).toThrow(ConfigurationError);
  });

  it('throws error for future startDate', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    const config = {
      actual: {
        init: { dataDir: './data', password: 'test', serverURL: 'http://localhost:5006' },
        budget: { syncId: '12345678-1234-1234-1234-123456789abc', password: null }
      },
      banks: {
        discount: {
          id: '123',
          password: 'pass',
          num: 'ABC',
          startDate: futureDate.toISOString().split('T')[0],
          targets: [{
            actualAccountId: '12345678-1234-1234-1234-123456789abc',
            reconcile: true,
            accounts: 'all'
          }]
        }
      }
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    const loader = new ConfigLoader('/test/config.json');
    expect(() => loader.load()).toThrow(/cannot be in the future/);
  });
});
```

### Step 4: Test MetricsService
**File:** `tests/services/MetricsService.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsService } from '../../src/services/MetricsService.js';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
    metrics.startImport();
  });

  it('tracks bank success correctly', () => {
    metrics.startBank('discount');
    metrics.recordBankSuccess('discount', 10, 5);

    const summary = metrics.getSummary();
    expect(summary.totalBanks).toBe(1);
    expect(summary.successfulBanks).toBe(1);
    expect(summary.totalTransactions).toBe(10);
    expect(summary.totalDuplicates).toBe(5);
  });

  it('calculates success rate correctly', () => {
    metrics.startBank('discount');
    metrics.recordBankSuccess('discount', 10, 0);

    metrics.startBank('leumi');
    metrics.recordBankFailure('leumi', new Error('Auth failed'));

    const summary = metrics.getSummary();
    expect(summary.successRate).toBe(50);
    expect(summary.successfulBanks).toBe(1);
    expect(summary.failedBanks).toBe(1);
  });

  it('hasFailures returns true when banks fail', () => {
    metrics.startBank('discount');
    metrics.recordBankFailure('discount', new Error('Failed'));

    expect(metrics.hasFailures()).toBe(true);
  });

  it('hasFailures returns false when all succeed', () => {
    metrics.startBank('discount');
    metrics.recordBankSuccess('discount', 5, 0);

    expect(metrics.hasFailures()).toBe(false);
  });
});
```

### Step 5: Test ReconciliationService
**File:** `tests/services/ReconciliationService.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReconciliationService } from '../../src/services/ReconciliationService.js';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let mockApi: any;

  beforeEach(() => {
    mockApi = {
      runQuery: vi.fn(),
      importTransactions: vi.fn()
    };
    service = new ReconciliationService(mockApi);
  });

  it('creates reconciliation when balance differs', async () => {
    mockApi.runQuery.mockResolvedValue({ data: 10000 }); // 100.00 in cents
    mockApi.importTransactions.mockResolvedValue(undefined);

    const result = await service.reconcile('account-123', 150.00, 'ILS');

    expect(result.status).toBe('created');
    expect(result.diff).toBe(5000); // 50.00 difference
    expect(mockApi.importTransactions).toHaveBeenCalled();
  });

  it('skips when balance matches', async () => {
    mockApi.runQuery.mockResolvedValue({ data: 10000 });

    const result = await service.reconcile('account-123', 100.00, 'ILS');

    expect(result.status).toBe('skipped');
    expect(result.diff).toBe(0);
    expect(mockApi.importTransactions).not.toHaveBeenCalled();
  });

  it('detects duplicate reconciliation', async () => {
    mockApi.runQuery.mockResolvedValue({ data: 10000 });
    mockApi.importTransactions.mockRejectedValue(new Error('Transaction already exists'));

    const result = await service.reconcile('account-123', 150.00, 'ILS');

    expect(result.status).toBe('already-reconciled');
  });
});
```

### Step 6: Test RetryStrategy
**File:** `tests/resilience/RetryStrategy.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExponentialBackoffRetry } from '../../src/resilience/RetryStrategy.js';

describe('ExponentialBackoffRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('succeeds on first attempt', async () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000
    });

    const fn = vi.fn().mockResolvedValue('success');
    const result = await retry.execute(fn, 'test');

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure', async () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success');

    const promise = retry.execute(fn, 'test');

    // Fast-forward through backoffs
    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

---

## ✅ Acceptance Criteria

- [ ] Vitest installed and configured
- [ ] All services have unit tests
- [ ] Test coverage >= 80%
- [ ] All tests pass locally
- [ ] **GitHub Actions workflow created**
- [ ] **Tests run on every push/PR**
- [ ] **Build step runs after tests pass**
- [ ] **Coverage reports generated**
- [ ] README.md updated with testing instructions
- [ ] Tests execute in under 30 seconds

---

## 📖 Commands

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

---

## 🔗 GitHub Actions Integration

After merging, every push/PR will:
1. ✅ Run all unit tests
2. ✅ Generate coverage report
3. ✅ Build TypeScript
4. ✅ Block merge if tests fail
5. ✅ Comment coverage on PRs (optional)

---

## 📝 Notes

- Use Vitest for better ESM support
- Mock external APIs properly
- Focus on business logic testing
- GitHub Actions will ensure code quality
