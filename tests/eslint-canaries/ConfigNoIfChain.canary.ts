// Canary: should trigger the OCP ban on `if (config.X)` dispatch chains.
//
// The PR 2 rule (Section 6d) is scoped to:
//   - src/Config/ConfigLoader.ts
//   - src/Config/ConfigLoaderValidator.ts
//   - src/Services/NotificationService.ts
//   - tests/eslint-canaries/ConfigNoIfChain.canary.ts  ← this file
//
// Production dispatch on a `config` field MUST go through a registry
// (IBlockValidator / INotifierFactory) — adding a new optional section
// or notifier MUST be one registry entry, never an `if (config.X)`
// branch in the dispatcher.
//
// This fixture deliberately exercises the forbidden shape so the
// canary harness can prove the rule is alive on every commit.

interface IFakeConfig {
  readonly telegram?: { readonly token: string };
  readonly webhook?: { readonly url: string };
}

/** Stub dispatcher that violates the OCP registry rule on purpose. */
function pickChannels(config: IFakeConfig): string[] {
  const out: string[] = [];
  if (config.telegram) out.push('telegram');
  if (config.webhook) out.push('webhook');
  return out;
}

const config: IFakeConfig = { telegram: { token: 't' } };
export const offenders = pickChannels(config);
