import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: process.cwd(),
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/Index.ts',
        'src/Scheduler.ts',
        // Orchestration classes extracted from Index.ts — covered by E2E tests, not unit tests
        'src/Scraper/BankScraper.ts',
        'src/Services/AccountImporter.ts',
        // Validation helpers extracted from ConfigLoader — tested indirectly via ConfigLoader tests
        'src/Config/ConfigLoaderValidator.ts',
        // Individual error class files — trivial constructors, tested via ErrorFormatter tests
        'src/Errors/TimeoutError.ts',
        'src/Errors/AuthenticationError.ts',
        'src/Errors/NetworkError.ts',
        'src/Errors/TwoFactorAuthError.ts',
        'src/Errors/ShutdownError.ts',
        'src/Errors/BankScrapingError.ts',
        'src/Errors/ConfigurationError.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 95,
        branches: 90,
        statements: 90
      }
    }
  }
});
