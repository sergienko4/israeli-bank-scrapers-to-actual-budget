# Changelog

All notable changes to the Israeli Bank Importer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.8.2] - 2026-02-19

### Fixed

- Scheduler timeout overflow causing infinite import loop (`safeSleep()` clamp at 24.8 days)
- Bank categories — 14 banks + 4 credit cards (was inconsistent across docs)
- Documentation cleanup — bank count, institution table, hardcoded Docker tags

---

## [1.8.0] - 2026-02-19

### Added

- **Import audit log** (Task 17)
  - `AuditLogService` — persists import history to `/app/data/audit-log.json`
  - Each entry: timestamp, bank results, durations, transaction counts, errors
  - Auto-rotates: keeps last 90 entries
  - `/status` command shows last 3 import runs from audit log
  - 8 unit tests for AuditLogService

---

## [1.7.0] - 2026-02-19

### Added

- **Webhook notifications — Slack, Discord, plain JSON** (Task 16)
  - `WebhookNotifier` implementing `INotifier` interface (OCP — no changes to existing code)
  - 3 formats: Slack (`{ text }`), Discord (`{ content }`), plain JSON (`{ event, ... }`)
  - Config: `notifications.webhook.url` + `notifications.webhook.format`
  - Config validation for URL format and allowed formats
  - 8 unit tests for WebhookNotifier

---

## [1.6.0] - 2026-02-19

### Added

- **Rate limiting between bank imports** (Task 18)
  - `delayBetweenBanks` config option (milliseconds, default: 0 = no delay)
  - Prevents bank API throttling when scraping multiple banks
  - Logs delay: "Waiting 5s before next bank..."
- **Docker Compose production setup** (Task 10)
  - `docker-compose.yml` with restart policy, named volumes, health check
  - Named volumes (`importer-data`, `importer-cache`, `importer-chrome`) survive container recreation
  - `unless-stopped` restart policy, 5m health check interval

---

## [1.5.3] - 2026-02-19

### Refactored

- **All methods refactored to max ~10 lines** (Task 13)
  - Extracted helpers across all services: `buildScraperOptions`, `buildOtpRetriever`, `processAccount`, `reconcileIfConfigured`, `initializeApi`, `processAllBanks`, `finalizeImport`, `handleFatalError`
  - OCP credential validation map replaces if/else chain in ConfigLoader
  - OCP error format map + keyword categorization map in ErrorFormatter
  - `Record<MessageFormat, ...>` dispatch replaces switch in TelegramNotifier

### Added

- `errorMessage()` utility — replaces 5 duplicated `error instanceof Error` patterns
- OCP dispatch maps in ConfigLoader, ErrorFormatter, TelegramNotifier

### Removed

- Dead `ConfigurationError` instanceof check in `loadFromFile` (could never match)

---

## [1.5.2] - 2026-02-19

### Refactored

- **Full `any` type elimination** (Task 08)
  - Separated `scraperConfig: any` into typed `ScraperOptions` + `ScraperCredentials`
  - Replaced `error: any` with `unknown` + type guards
  - Typed account lookups with `ActualAccount` interface
  - Typed query results with `extractQueryData<T>` utility
  - CI `any` ratchet lowered from 8 to 0 — zero tolerance

### Added

- `ActualAccount` type in `src/types/index.ts`
- `extractQueryData<T>()` utility with 7 unit tests

---

## [1.5.1] - 2026-02-19

### Fixed

- Pause Telegram poller during import to prevent OTP conflicts
- Reconciliation re-enabled as opt-in per target (`"reconcile": true`)
- `daysBack` relative date import (1-30 days, recalculated each run)

---

## [1.5.0] - 2026-02-19

### Added

- **2FA via Telegram** (Task 07)
  - OneZero bank: bot asks for SMS OTP code via Telegram
  - Long-term token support: skip OTP after first login (`otpLongTermToken`)
  - Per-bank config: `twoFactorAuth`, `twoFactorTimeout`
  - TwoFactorService with code extraction and validation
- **Relative date import** (`daysBack`)
  - Use `"daysBack": 14` instead of fixed `startDate`
  - Max 30 days. Mutually exclusive with `startDate`

---

## [1.4.0] - 2026-02-19

### Added

- **Telegram bot commands** (`listenForCommands: true`)
  - `/scan` — trigger import from Telegram
  - `/status` — show last run info
  - `/help` — list commands
  - Runs alongside cron scheduler
  - Shared import lock prevents concurrent imports
  - Ignores old messages on restart
- **Telegram notifications** (Task 03)
  - 4 message formats: summary, compact, ledger, emoji
  - `showTransactions`: new (only new) | all | none
  - Smart detection via `imported_id` to distinguish new vs existing
  - Zero new dependencies (native `fetch()`)
  - Extensible `INotifier` interface
  - Non-blocking: notification failures never break imports
  - 4096 char truncation for Telegram limit

### CI/CD

- Upgraded CodeQL Action v3 → v4
- Added `npm audit` vulnerability check to PR
- Added `any` type ratchet guard (max 8)
- Split CI: `pr-validation.yml` + `release.yml`

---

## [1.3.0] - 2026-02-19

### Added

- **Full TypeScript migration** with strict mode
  - Interface-based architecture following SOLID principles
- **Resilience features**
  - Exponential backoff retry strategy (3 attempts: 1s, 2s, 4s)
  - 10-minute timeout protection
  - Graceful shutdown handling (SIGTERM/SIGINT)
  - Custom error types with categorization

---

## [1.2.1] - 2026-02-19

### Refactored

- **Extract TransactionService** (Task 02)
  - New `src/services/TransactionService.ts` with `importTransactions()` and `getOrCreateAccount()`
  - 14 new unit tests for TransactionService

---

## [1.2.0] - 2026-02-19

### Added

- **Enhanced GitHub release notes** (Task 05)
  - Auto-generated release notes with Docker pull commands

---

## [1.1.0] - 2026-02-19

### Added

- **Unit test suite with Vitest** (Task 01)
  - 118 tests across 10 test files
  - GitHub Actions CI workflow
- **Centralized utility functions** (Task 04)
  - `toCents()`, `fromCents()`, `formatDate()`

### Fixed

- Broken documentation links (Task 06)

---

## [1.0.0] - 2026-02-18

### Added

- Automatic transaction import from Israeli banks
- Support for 18 Israeli financial institutions
- Docker containerization with Chromium
- Cron scheduling support (`SCHEDULE` env var)
- Duplicate transaction detection via `imported_id`
- Browser session persistence for 2FA
- Idempotent reconciliation system
- Metrics collection and import summary reporting
- Configuration validation at startup
- Multiple account mapping per bank with `targets` array
- Account filtering (specific accounts or `"all"`)

---

For detailed upgrade instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

For security considerations, see [SECURITY.md](SECURITY.md).
