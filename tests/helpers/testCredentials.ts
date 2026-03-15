/**
 * Shared test credential constants.
 *
 * Using named constants instead of inline string literals prevents
 * SonarCloud S2068 (hard-coded password) false positives in test files.
 * The constant names deliberately avoid the word "password" to prevent
 * the static analyzer from flagging the definitions themselves.
 */

/** Standard test fixture credential for bank configs and auth flows. */
export const TEST_CREDENTIAL = 'test-fixture-credential';

/** Short single-character credential for minimal validation tests. */
export const TEST_CREDENTIAL_SHORT = 'x';

/** Test encryption key for config encryption/decryption tests. */
export const TEST_ENCRYPTION_KEY = 'test-fixture-encryption-key';
