// Canary: must trigger `no-unneeded-ternary` (SonarCloud S6644) and ONLY that
// rule. `x ? x : y` is a redundant ternary and should be written `x || y`.
// `mode` is a non-nullable string, so prefer-nullish-coalescing stays silent
// (`??` would not fall back on '') and this canary isolates S6644. If ESLint
// stops flagging this, the S6644 guardrail is dead.
const mode: string = process.env.NODE_ENV ?? '';
const resolved = mode ? mode : 'production';
export { resolved };
