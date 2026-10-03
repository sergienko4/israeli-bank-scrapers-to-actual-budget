// Canary: must trigger the portal floating-promise guardrail (SonarCloud S9383,
// typescript-eslint no-floating-promises) under config/eslint.portal-public.mjs.
// A local async function called from an event handler without await, .catch,
// or `void` must be flagged — the shape of the app.js keydown → login() bug.
// The call is nested, so the top-level S7785 selector cannot fire here: if
// ESLint stops flagging this file, the S9383 guardrail is dead.
async function submit() {
  await Promise.resolve();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') submit();
});
