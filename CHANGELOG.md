# Changelog

All notable changes to the Israeli Bank Importer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/israeli-bank-actual-importer-v1.8.2...israeli-bank-actual-importer-v1.9.0) (2026-02-20)


### Added

* 2FA OTP via Telegram for OneZero (Task 07) ([#25](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/25)) ([824c2ba](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/824c2bad7d2bc667c8269663586e77b5197c2513))
* Add Telegram notifications (Task 03) ([#22](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/22)) ([696947c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/696947c87846aa0678713379f236531a9832b6d3))
* Add unit tests + GitHub Actions CI (Task 01) ([30b18a6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/30b18a6e25190d76490ffe318d9b8d96eca488d4))
* Add unit tests and GitHub Actions CI (Task 01) ([dcabe0c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/dcabe0ce2e352227636b5d2e3fbf1257a6fe3338))
* Docker Compose production setup (Task 10) ([#30](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/30)) ([a796c33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a796c33142c5e86c24a327a3b9588129d1810e2f))
* Enhanced GitHub release notes (Task 05) ([#20](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/20)) ([cc80863](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cc80863c9dcadc66c9f8858aded67765909206e9))
* Import audit log with /status history (Task 17) ([#32](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/32)) ([46c75d5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/46c75d59033056ad62f3e030add2538280805428))
* Rate limiting between bank imports (Task 18) ([#31](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/31)) ([c70003e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c70003eabb72c857a06f91c37c241fa5048ab611))
* Telegram bot commands - /scan, /status, /help ([#23](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/23)) ([55456c4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/55456c47a4854b166284624f0c4968121f3e035e))
* Webhook notifications — Slack, Discord, plain JSON (Task 16) ([#33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/33)) ([25c5c7c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/25c5c7cee769bcd9b945bdc2f967e7cec4efae3d))


### Fixed

* Add workflow permissions to allow tag creation ([4a2184b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a2184b9f11652be7c11f39af4c20db9a29df546))
* Correct bank categories — 14 banks + 4 credit cards ([#36](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/36)) ([4a7e9db](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a7e9db7f831e07dc514b7cf30c7fbd8f5f95e3c))
* Pause poller during import + reconciliation + daysBack + docs ([#26](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/26)) ([af73f1e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/af73f1e14ed6e0e1431a644cace2b109851c5dc6))
* Prevent scheduler timeout overflow causing infinite import loop ([#37](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/37)) ([48c985c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/48c985c9dd3ef6dfe2e5643ca69c2ad80468b53e))
* Remove hardcoded Docker tags, link to Releases ([#38](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/38)) ([347e852](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/347e8529557188b3fa0bb76e161788cf06fdc31d))


### Refactored

* Centralize utility functions - DRY (Task 04) ([567f12b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/567f12b61b1c268227f7955ace33afebabb90d30))
* Centralize utility functions - DRY principle (Task 04) ([b1e8514](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b1e8514f2506f9ad43d461693d058c85254213c4))
* Eliminate all any types, CI ratchet → 0 (Task 08) ([#27](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/27)) ([ba870d2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba870d2b68e3515ee1397bf3b091454288971d89))
* Extract all long methods to max ~10 lines (Task 13) ([#28](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/28)) ([7337ae7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7337ae75f11274bf3c5bc34f32564dd88317e50b))
* Extract TransactionService from index.ts (Task 02) ([#21](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/21)) ([ba21f2a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba21f2ad610bea5d94459aeeedb882460017cb23))


### Documentation

* Add GUIDELINES.md and fix broken documentation links ([92e4297](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/92e4297f0edef83a24659d544d98b80533cef05b))
* Add Task 05 - Enhance GitHub Release Page ([c8e11be](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c8e11be8ece21087c9f33d9ccb869f1051a6dcd0))
* Add Task 06 - Fix Broken Documentation Links ([220a980](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/220a98099412ef94376e774e167dac50a5e16ee2))
* Add tasks folder with improvement roadmap ([fddd032](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fddd0326d8cce6ebc6127d3d795be3732f6814dd))
* Clean up internal documentation files ([ccaf527](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ccaf527efcbcde8bd2c63d530da7c2bf33811ec1))
* Complete documentation overhaul ([#39](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/39)) ([b6b641f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b6b641f3e4b38fe22fd94de9cace228bd52dcdea))
* Complete Task 06 - Verify documentation links ([fd595e2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fd595e2d010a771b90c4b1ae32442bc4c9d92231))
* Comprehensive documentation cleanup ([#34](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/34)) ([e4fdd58](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/e4fdd5877222ce292251905136a6f19245bcff32))
* Fix bank count to 18, add institution table ([#35](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/35)) ([9abf008](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/9abf0083c8c7ea4170b9e5c5c48015867709d980))
* Update GUIDELINES with release-please workflow ([#43](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/43)) ([bcf7b8a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/bcf7b8a212a0a677ae83afa202c6376b42df2212))
* Update GUIDELINES.md and CHANGELOG.md for Task 08 + 13 ([#29](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/29)) ([d53d1d7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d53d1d722f980201ff1bdcba36b353597d125c21))
* Verify and complete Task 06 - Fix documentation links ([c962a72](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c962a72c809f2b03540950ab75b40416e44bb54e))


### Testing

* Improve coverage from 92% to 99%+ and add PRD template ([f82e872](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f82e872be40ba7dd1f24e99b7e006ab453b896cd))


### CI/CD

* Add CodeQL security scanning to CI/CD pipeline ([7881371](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/78813718712c5b85ccb6f92f4630bdf057c3cb79))
* Add release-please for gated releases + markdownlint + lychee ([#41](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/41)) ([c3b12f8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c3b12f8896225843f07a7ae1bad9e5673af64b1f))
* Merge into single CI/CD pipeline with test gate ([075ee5c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/075ee5ce39a3c4c70520f0abdd5ffe6a64ef7164))
* Merge test and docker workflows into single CI/CD pipeline ([e754cb0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/e754cb0c896448a5007ab933a35afbfa6cb93cd2))
* Rename PR jobs for clarity ([#24](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/24)) ([3462af4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/3462af4705e785fa76602a1ec0b51f322b71ca54))
* Skip redundant test/CodeQL on push to main ([#18](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/18)) ([a0912bb](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a0912bbb99f2b13a6046483340ee97fa4daddd62))
* Skip release for docs-only changes ([#19](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/19)) ([0791a92](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0791a92e5d892b2ee180259871d7b49aa5b7685b))

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
