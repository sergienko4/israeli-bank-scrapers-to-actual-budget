// Canary: must trigger `unicorn/prefer-default-parameters` (SonarCloud S7760).
// A `??` fallback on an optional parameter is a default parameter in
// disguise; declare `id = '(empty)'` instead. `||` is not used: from
// unicorn 79 the rule skips `||` on a `string`, because `''` would be
// replaced too, so it is not equivalent to a default. If ESLint stops
// flagging this, the S7760 guardrail is dead.
/**
 * Labels an account id, falling back when it is missing.
 * @param id - The account id to label.
 * @returns The id, or a placeholder when it is missing.
 */
function labelAccountId(id?: string): string {
  const label = id ?? '(empty)';
  return label;
}
export { labelAccountId };
