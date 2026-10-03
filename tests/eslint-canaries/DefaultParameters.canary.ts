// Canary: must trigger `unicorn/prefer-default-parameters` (SonarCloud S7760).
// Reassigning a parameter to supply a fallback is a default parameter in
// disguise; declare `label = '(empty)'` instead. If ESLint stops flagging
// this, the S7760 guardrail is dead.
/**
 * Labels an account id, falling back when it is blank.
 * @param id - The account id to label.
 * @returns The id, or a placeholder when it is blank.
 */
function labelAccountId(id: string): string {
  const label = id || '(empty)';
  return label;
}
export { labelAccountId };
