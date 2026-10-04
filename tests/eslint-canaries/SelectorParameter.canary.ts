// Canary: must trigger `sonarjs/no-selector-parameter` (SonarCloud S2301). A
// boolean parameter that only picks between two branches hides two functions
// behind one name; split them instead. The rule only inspects a
// single-statement body, the shape the original S2301 finding had. If ESLint
// stops flagging this, the S2301 guardrail is dead.
/**
 * Formats a balance either signed or unsigned.
 * @param amount - The balance to format.
 * @param signed - Selects the signed form.
 * @returns The formatted balance.
 */
function formatBalance(amount: number, signed: boolean): string {
  return signed ? `+${String(amount)}` : String(amount);
}
export { formatBalance };
