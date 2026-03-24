// Canary: should trigger void-return-in-side-effect rule
class BadService {
  async writeToDatabase(): Promise<void> {
    if (!this) return; // should trigger: void return in writeTo* method
  }
}
export { BadService };
