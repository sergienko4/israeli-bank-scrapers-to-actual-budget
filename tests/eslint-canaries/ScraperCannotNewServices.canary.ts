// Canary: should trigger ban on `new <IntegrationService>` from Scraper layer.
// The PR 1 rule (src/Scraper/** + this canary path) forbids constructing
// Integration Services directly — the composition root (src/Index.ts) must
// inject the dependency through an interface (e.g. ITwoFactorPrompter).
//
// This fixture deliberately exercises the violation so the canary harness
// can prove the rule is alive on every commit.

class TwoFactorService {
  /**
   * Stub class shaped like src/Services/TwoFactorService.ts — exists only
   * so the `new TwoFactorService()` expression below parses and the
   * `no-restricted-syntax` selector can flag it.
   * @param _notifier - Stub notifier parameter, intentionally unused.
   */
  constructor(_notifier: unknown) {
    void _notifier;
  }
}

const notifier = { sendMessage: (): void => undefined };
const offender = new TwoFactorService(notifier);
export { offender };
