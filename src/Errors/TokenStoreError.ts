/** Thrown when the persisted bank token store cannot be read or written safely. */
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
