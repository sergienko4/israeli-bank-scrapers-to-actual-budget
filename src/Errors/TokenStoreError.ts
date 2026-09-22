/**
 * Thrown when the persisted bank token store cannot be read or written safely.
 *
 * <p>Internal to the store. Every throw is caught before it leaves
 * `BankTokenStore`, which reports failures as a `Procedure` value rather than
 * an exception so a storage problem can never fail a scrape that otherwise
 * worked. It therefore has no `ErrorFormatter` entry on purpose: nothing
 * reaches the formatter carrying this type, and an entry would claim a
 * user-facing path that does not exist. The operator-facing wording lives in
 * the warning the capture emits instead.
 */
export default class TokenStoreError extends Error {
  /**
   * Creates a TokenStoreError.
   * @param message - Description of the token store failure.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TokenStoreError';
  }
}
