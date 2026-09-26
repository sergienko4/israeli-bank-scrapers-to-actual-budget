/** Thrown when a store cannot read or replace its file, so nothing was saved. */
export default class StorageError extends Error {
  /**
   * Creates a StorageError.
   * @param message - What could not be saved, and why.
   */
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}
