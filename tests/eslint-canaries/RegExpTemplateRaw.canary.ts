// Canary: must trigger the RegExp-template String.raw guardrail (SonarCloud
// S7780) and ONLY that rule. A RegExp built from a NON-raw template literal
// containing a backslash doubles every escape (`\\d`, `\\$`) and should use
// `String.raw`. The `${...}` interpolation keeps prefer-regex-literals silent
// (a dynamic pattern cannot become a literal), isolating S7780. Mirrors the
// real PortalPassword hash pattern. If ESLint stops flagging this, the S7780
// guardrail is dead.
const SALT_BYTES = 16;
const DIGITS = new RegExp(`^scrypt\\$[0-9a-f]{${String(SALT_BYTES * 2)}}$`);
export { DIGITS };
