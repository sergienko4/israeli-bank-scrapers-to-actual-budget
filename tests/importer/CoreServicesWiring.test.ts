import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockHistoryResolver, MockTranslateResolver } = vi.hoisted(() => {
  class HistoryResolver {
    public readonly _kind = 'history';
  }
  class TranslateResolver {
    public readonly _kind = 'translate';
    constructor(public readonly translations: unknown) {}
  }
  return { MockHistoryResolver: HistoryResolver, MockTranslateResolver: TranslateResolver };
});
vi.mock('../../src/Services/HistoryCategoryResolver.js', () => ({
  default: MockHistoryResolver,
}));
vi.mock('../../src/Services/TranslateCategoryResolver.js', () => ({
  default: MockTranslateResolver,
}));

const { MockTransactionService, MockReconciliationService, MockMetricsService, MockAuditLog, MockNotificationService, MockDryRunCollector, MockTelegramNotifier, MockTwoFactorService, MockAccountImporter } = vi.hoisted(() => {
  class TxnService {
    constructor(public readonly api: unknown, public readonly resolver: unknown) {}
  }
  class RecService {
    constructor(public readonly api: unknown) {}
  }
  class Metrics {}
  class AuditLog {}
  class NotifService {
    constructor(public readonly cfg: unknown) {}
  }
  class DryRun {}
  class TelegramNotif {
    constructor(public readonly cfg: unknown) {}
  }
  class TwoFactor {
    constructor(public readonly notifier: unknown) {}
  }
  class AccImporter {
    constructor(public readonly deps: unknown) {}
  }
  return {
    MockTransactionService: TxnService,
    MockReconciliationService: RecService,
    MockMetricsService: Metrics,
    MockAuditLog: AuditLog,
    MockNotificationService: NotifService,
    MockDryRunCollector: DryRun,
    MockTelegramNotifier: TelegramNotif,
    MockTwoFactorService: TwoFactor,
    MockAccountImporter: AccImporter,
  };
});
vi.mock('../../src/Services/TransactionService.js', () => ({
  TransactionService: MockTransactionService,
}));
vi.mock('../../src/Services/ReconciliationService.js', () => ({
  ReconciliationService: MockReconciliationService,
}));
vi.mock('../../src/Services/MetricsService.js', () => ({
  MetricsService: MockMetricsService,
}));
vi.mock('../../src/Services/AuditLogService.js', () => ({
  AuditLogService: MockAuditLog,
}));
vi.mock('../../src/Services/NotificationService.js', () => ({
  default: MockNotificationService,
}));
vi.mock('../../src/Services/DryRunCollector.js', () => ({
  DryRunCollector: MockDryRunCollector,
}));
vi.mock('../../src/Services/Notifications/TelegramNotifier.js', () => ({
  default: MockTelegramNotifier,
}));
vi.mock('../../src/Services/TwoFactorService.js', () => ({
  default: MockTwoFactorService,
}));
vi.mock('../../src/Services/AccountImporter.js', () => ({
  AccountImporter: MockAccountImporter,
}));
vi.mock('@actual-app/api', () => ({
  default: { kind: 'fake-actual-api' },
}));

import { buildAccountImporter, buildCoreServices } from '../../src/Importer/CoreServicesWiring.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

function makeConfig(overrides: Partial<IImporterConfig> = {}): IImporterConfig {
  return {
    accounts: [],
    actual: {} as never,
    categorization: { mode: 'none' },
    notifications: undefined,
    ...overrides,
  } as IImporterConfig;
}

describe('CoreServicesWiring', () => {
  let originalDryRun: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDryRun = process.env.DRY_RUN;
    delete process.env.DRY_RUN;
  });

  afterEach(() => {
    if (originalDryRun === undefined) {
      delete process.env.DRY_RUN;
    } else {
      process.env.DRY_RUN = originalDryRun;
    }
  });

  describe('buildCoreServices', () => {
    it('returns categoryResolver=undefined when mode is "none"', () => {
      const services = buildCoreServices(makeConfig({ categorization: { mode: 'none' } }));

      expect(services.categoryResolver).toBeUndefined();
    });

    it('returns a HistoryCategoryResolver when mode is "history"', () => {
      const services = buildCoreServices(makeConfig({ categorization: { mode: 'history' } }));

      expect(services.categoryResolver).toBeInstanceOf(MockHistoryResolver);
    });

    it('returns a TranslateCategoryResolver when mode is "translate"', () => {
      const services = buildCoreServices(
        makeConfig({ categorization: { mode: 'translate', translations: [{ fromPayee: 'A', toPayee: 'B' }] } })
      );

      expect(services.categoryResolver).toBeInstanceOf(MockTranslateResolver);
    });

    it('sets isDryRun=true when DRY_RUN env var equals "true"', () => {
      process.env.DRY_RUN = 'true';

      const services = buildCoreServices(makeConfig());

      expect(services.isDryRun).toBe(true);
    });

    it('sets isDryRun=false when DRY_RUN env var is absent', () => {
      const services = buildCoreServices(makeConfig());

      expect(services.isDryRun).toBe(false);
    });

    it('builds a TwoFactorService when telegram config is present', () => {
      const services = buildCoreServices(
        makeConfig({
          notifications: {
            enabled: true,
            telegram: { botToken: 't', chatId: '1' },
          },
        } as never)
      );

      expect(services.twoFactorPrompter).toBeInstanceOf(MockTwoFactorService);
    });

    it('returns twoFactorPrompter=null when telegram config is absent', () => {
      const services = buildCoreServices(makeConfig({ notifications: { enabled: false } }));

      expect(services.twoFactorPrompter).toBeNull();
    });

    it('constructs all five core service classes', () => {
      const services = buildCoreServices(makeConfig());

      expect(services.transactionService).toBeInstanceOf(MockTransactionService);
      expect(services.reconciliationService).toBeInstanceOf(MockReconciliationService);
      expect(services.metrics).toBeInstanceOf(MockMetricsService);
      expect(services.auditLog).toBeInstanceOf(MockAuditLog);
      expect(services.notificationService).toBeInstanceOf(MockNotificationService);
      expect(services.dryRunCollector).toBeInstanceOf(MockDryRunCollector);
    });
  });

  describe('buildAccountImporter', () => {
    it('wires services + resilience.shutdownHandler into the AccountImporter', () => {
      const services = buildCoreServices(makeConfig());
      const fakeResilience = {
        shutdownHandler: { isShuttingDown: () => false },
      } as never;

      const importer = buildAccountImporter(services, fakeResilience);

      expect(importer).toBeInstanceOf(MockAccountImporter);
      const deps = (importer as unknown as { deps: Record<string, unknown> }).deps;
      expect(deps.transactionService).toBe(services.transactionService);
      expect(deps.reconciliationService).toBe(services.reconciliationService);
      expect(deps.metrics).toBe(services.metrics);
      expect(deps.isDryRun).toBe(services.isDryRun);
      expect(deps.dryRunCollector).toBe(services.dryRunCollector);
      expect(deps.shutdownHandler).toBe((fakeResilience as { shutdownHandler: unknown }).shutdownHandler);
    });
  });
});
