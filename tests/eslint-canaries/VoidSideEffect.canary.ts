// Canary: should trigger void-return-in-side-effect rule
/** Intentionally bad service for canary testing. */
class BadService {
  /**
   * Intentionally returns void to trigger ESLint rule.
   * @returns Promise that resolves to void.
   */
  async writeToDatabase(): Promise<void> {
    if (!this) return; // should trigger: void return in writeTo* method
  }
}
export { BadService };
