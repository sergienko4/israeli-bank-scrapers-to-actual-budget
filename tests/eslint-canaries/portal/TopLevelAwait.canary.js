// Canary: must trigger the portal top-level-await guardrail (SonarCloud S7785)
// under config/eslint.portal-public.mjs. A top-level call to a local function
// left floating (not awaited) must be flagged so the SPA boot entry point never
// regresses from `await init()` back to a fire-and-forget `init()`. If ESLint
// stops flagging this, the S7785 guardrail is dead.
async function init() {
  await Promise.resolve();
}
init();
