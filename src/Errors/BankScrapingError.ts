/** Thrown when a bank scraping attempt fails. */
export default class BankScrapingError extends Error {
  /**
   * Creates a BankScrapingError.
   * @param bankName - Name of the bank that failed to scrape.
   * @param message - Description of the scraping failure.
   */
  constructor(bankName: string, message: string) {
    super(`Failed to scrape ${bankName}: ${message}`);
    this.name = 'BankScrapingError';
  }
}
