# Changelog

All notable changes to the Israeli Bank Importer project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.37.7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.6...v1.37.7) (2026-04-13)


### Fixed

* **ci:** systemic tsc wrapper to filter upstream node_modules type errors ([#306](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/306)) ([1662053](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1662053ef42ccb788438aa90d35e2d79fd7ecb20))

## [1.37.6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.5...v1.37.6) (2026-04-09)


### Fixed

* upgrade to Vite 8 with OXC/Babel decorator compatibility ([#296](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/296)) ([115b1b7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/115b1b72a96c50a112d0fa61469c73a79bf89869))

## [1.37.5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.4...v1.37.5) (2026-04-06)


### Fixed

* **ci:** reproducible Docker builds and pipeline resilience ([#293](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/293)) ([e90b0a4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/e90b0a4f80755261d9320b4b613443b5dcf89e1c))

## [1.37.4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.3...v1.37.4) (2026-04-02)


### Fixed

* generic npm-bundled CVE patching + brace-expansion CVE-2026-33750 ([#287](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/287)) ([12808fa](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/12808fad975ae44555d2ae0805bda3254f487d79))

## [1.37.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.2...v1.37.3) (2026-03-31)


### Fixed

* import deduplication — use resolved account UUID, not configured ID ([#285](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/285)) ([0ce0ac3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0ce0ac348a2f069aa2c0452ff970721a390ebd35))

## [1.37.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.1...v1.37.2) (2026-03-29)


### Fixed

* TelegramPoller resilience — HTTP status, circuit breaker, cancelable sleep ([#276](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/276)) ([b97d97d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b97d97d7f29001f85e6847a73547f356a756d10a))

## [1.37.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.37.0...v1.37.1) (2026-03-26)


### Fixed

* ARM64 Docker image — fetch correct Camoufox binary per architecture ([#273](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/273)) ([bbd4f0a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/bbd4f0adfd58087e9071d74dafa29fcdc66a1ff0))

## [1.37.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.36.0...v1.37.0) (2026-03-25)


### Added

* add /import_receipt command for OCR receipt photo import ([#271](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/271)) ([a5cb3b1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a5cb3b13965a5ee47f3022d3ebd5bb9548cdbcdb))


### Refactored

* Result Pattern + Pipeline architecture migration ([#263](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/263)) ([3c0360e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/3c0360e48a75a3723fffd8b04d7b9e6d6ad608b7))

## [1.36.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.35.0...v1.36.0) (2026-03-17)


### Added

* add Semgrep + ai-commit-guard pre-commit gates (15 gates) ([#259](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/259)) ([6cb9984](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/6cb998438323657ffd7ba51c28f43799c8dda519))
* blocking ai-commit-guard + 120s Ollama timeout ([#261](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/261)) ([992aea7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/992aea79745bce80877e88f76b4b23040f6b9d0a))


### Fixed

* **deps:** update critical dependencies ([#247](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/247)) ([a1b0218](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a1b0218b67acaee65f5b8283c4d9c10482213ce6))
* **deps:** upgrade vitest 4.0.18→4.1.0 with Babel decorator support ([#256](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/256)) ([ed62ce2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ed62ce27613fc900f9caf8db715e4ac42f66785c))


### Refactored

* fix all 65 SonarCloud code smells ([#258](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/258)) ([79be880](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/79be880ca25fc79edbb725e340f13c08bf115565))

## [1.35.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.34.0...v1.35.0) (2026-03-15)


### Added

* add SonarCloud analysis and license compliance to CI pipeline ([#241](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/241)) ([d5fbb3b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d5fbb3bbcb41c200f3d8b5fadd052a9b29823fa0))


### Fixed

* resolve SonarCloud security and reliability findings ([#242](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/242)) ([fd27ac0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fd27ac0a8f58270927270ca3b140f5b194efd34c))

## [1.34.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.8...v1.34.0) (2026-03-14)


### Added

* actionable error messages, /retry command, and failure tracking ([#239](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/239)) ([aa0c87b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/aa0c87be3fc33e27d42f904013bf3ebf10c35139))

## [1.33.8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.7...v1.33.8) (2026-03-14)


### Fixed

* **ci:** critical release pipeline safety improvements ([#235](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/235)) ([b0399a8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b0399a811b5458fc0b0ae66950226b761ab259b1))

## [1.33.7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.6...v1.33.7) (2026-03-14)


### Fixed

* stale error reporting, budget validation, and OTP race condition ([#233](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/233)) ([b4523ec](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b4523eca7fe9cd61fb77f9f97223a9801573ee5c))

## [1.33.6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.5...v1.33.6) (2026-03-13)


### Refactored

* extract ImportMediator/Queue and wire into Scheduler ([#231](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/231)) ([9c08c97](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/9c08c97f70bac81ad447d3c8bcf45a1bd713fad1))

## [1.33.5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.4...v1.33.5) (2026-03-13)


### Fixed

* update README badge URL for renamed pr.yml workflow ([#229](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/229)) ([b1e50ca](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b1e50ca1c81cf56c23691163339b51fad8242824))

## [1.33.4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.3...v1.33.4) (2026-03-13)


### Fixed

* **deps:** update critical dependencies ([#224](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/224)) ([169dcf7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/169dcf748137ed6e2e1d6968fc4a298fd24d0079))

## [1.33.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.2...v1.33.3) (2026-03-11)


### Fixed

* confirm Telegram offset in OTP flow to prevent scan-all timeout ([#222](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/222)) ([f1d937e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f1d937e98765373473f5f27c5dca9d5209369ecf))

## [1.33.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.1...v1.33.2) (2026-03-08)


### Fixed

* replace deprecated npm and Trivy CLI flags ([#211](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/211)) ([1a4dd82](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1a4dd8207469fc2456c8522afb4a39fdb3a615cd))

## [1.33.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.33.0...v1.33.1) (2026-03-08)


### Fixed

* move Camoufox binary to node user home + add browser smoke test ([#209](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/209)) ([83a787b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/83a787bdf7bfa59ecf7d6625185cbccdcf77958f))

## [1.33.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.32.0...v1.33.0) (2026-03-08)


### Added

* upgrade scraper to v7.9.0 — Camoufox replaces Chromium ([#207](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/207)) ([c31f67e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c31f67e3e22910d91e40cec0ec0362a553ac2da1))

## [1.32.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.31.0...v1.32.0) (2026-03-06)


### Added

* strict ESLint — no-warning-comments + mandatory logger in Utils ([#205](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/205)) ([d23f73c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d23f73c0867cf649ebc3d8160de9430aad97251e))

## [1.31.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.30.0...v1.31.0) (2026-03-05)


### Added

* add strict JSDoc + Docker security improvements ([#203](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/203)) ([25b5fe3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/25b5fe3ffe831a5b52bb7deb1fba2d908513075c))

## [1.30.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.29.0...v1.30.0) (2026-03-04)


### Added

* **lint:** add 8 new ESLint rules — node protocol, type imports, null safety, modern APIs ([#200](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/200)) ([f5cbddd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f5cbddd171c435c715540703fccae70b1f649441))

## [1.29.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.7...v1.29.0) (2026-03-04)


### Added

* **lint:** enforce PascalCase on all src/ files, tighten no-unused-vars for TypeScript ([#198](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/198)) ([92e5a32](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/92e5a32af71615b9e53fe4a03b40933b6d7d5259))

## [1.28.7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.6...v1.28.7) (2026-03-04)


### Fixed

* **deps:** update critical dependencies ([#195](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/195)) ([841d6e0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/841d6e0fccabdad2dea66bdb7e3a765460909ceb))
* **test:** use deterministic byte-flip to tamper ciphertext in encryption test ([#197](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/197)) ([e27b605](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/e27b605b2f3bbc8d538c0da20ec326b75470f332))

## [1.28.6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.5...v1.28.6) (2026-03-03)


### Fixed

* **docs:** fix wrong VM deploy path, document all-in-one docker-compose, add Node 22 note ([#193](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/193)) ([0b3d346](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0b3d346dfe66089c5b935388f4b3736aaf67f49f))

## [1.28.5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.4...v1.28.5) (2026-03-03)


### Fixed

* enforce daysBack/startDate filter on scraped transactions ([#190](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/190)) ([f7bc2b2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f7bc2b2e95377432e1ecb57241e7913a6c5f096a))

## [1.28.4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.3...v1.28.4) (2026-03-03)


### Fixed

* show error reason inline in bank performance log ([#188](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/188)) ([439a292](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/439a2921a6e4f5cfe8dc38a1d6cac52d10bed7b4))

## [1.28.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.2...v1.28.3) (2026-03-03)


### Fixed

* abort TelegramPoller on stop(), filter non-OTP replies, sanitize undefined errors ([#185](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/185)) ([37cee90](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/37cee907f16546733ed46ad011c867a1c8dc8e16))

## [1.28.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.1...v1.28.2) (2026-03-03)


### Fixed

* **deps:** update critical dependencies ([#183](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/183)) ([9592d80](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/9592d806bdd7dab0d81731fceed95a9a6d17c48a))

## [1.28.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.28.0...v1.28.1) (2026-03-02)


### Fixed

* bump scrapers to v7.6.0, upgrade module resolution, fix scan_all callback ([#180](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/180)) ([dd25be9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/dd25be98490bd2cc49d8af08dee0ca5ba584af72))

## [1.28.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.27.4...v1.28.0) (2026-03-01)


### Added

* selective bank import via /scan with inline keyboard menu ([#172](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/172)) ([de924fd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/de924fde5c618188a02aaf4a87e43d3b6a2e4260))

## [1.27.4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.27.3...v1.27.4) (2026-03-01)


### Testing

* add unit tests for masked OTP code in TwoFactorService ([#170](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/170)) ([fb542a9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fb542a9f74b822e112fd5b5399fdbe37d214bb4b))

## [1.27.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.27.2...v1.27.3) (2026-03-01)


### Fixed

* show masked OTP code in logs and Telegram confirmation ([#168](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/168)) ([c812fa7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c812fa7ed39d9b61c347984ffbfdf28f8303719b))

## [1.27.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.27.1...v1.27.2) (2026-03-01)


### Fixed

* retry OTP scraping once when bank rejects the code ([#166](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/166)) ([9ef9d8b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/9ef9d8b0de58193bc89ff9cd153834a23e6445e5))

## [1.27.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.27.0...v1.27.1) (2026-03-01)


### Fixed

* treat Discount Hebrew no-records as success and prevent OTP retry ([#164](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/164)) ([1abc309](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1abc3095d5c0decded031c166a4d53894e97d9f2))

## [1.27.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.26.0...v1.27.0) (2026-03-01)


### Added

* enrich config validation report with target account details ([#160](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/160)) ([5106b0d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5106b0dd43e7323ce5b030bd9dd057560a2e525f))

## [1.26.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.25.3...v1.26.0) (2026-03-01)


### Added

* pino file logging with LogMediator, @Loggable decorator, and ESLint enforcement ([#157](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/157)) ([6a87cd4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/6a87cd442bd276f2a890e13a7ee40e1bbadafb90))

## [1.25.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.25.2...v1.25.3) (2026-03-01)


### Fixed

* route OTP via ScraperOptions for all banks, not just oneZero ([#153](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/153)) ([8a3cc72](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/8a3cc72d04d4d8ee1ba0e1f3c7974fb835c95580))
* route OTP via ScraperOptions for all banks, not just oneZero ([#155](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/155)) ([3e41789](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/3e41789d08d8f581bdbb900c4ce2cd6017082167))
* route OTP via ScraperOptions for all banks, not just oneZero ([#156](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/156)) ([f32fb2e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f32fb2e9ca6894bf5bed6cc0b68a46671b67085d))

## [1.25.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.25.1...v1.25.2) (2026-03-01)


### Fixed

* bump @sergienko4/israeli-bank-scrapers 7.1.0 → 7.3.1 ([#151](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/151)) ([b563cf7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b563cf7b8bdee9e7905ecf94d3926e1da2a3c7b2))

## [1.25.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.25.0...v1.25.1) (2026-03-01)


### Fixed

* /check_config crash on split config (Cannot read properties of undefined) ([#147](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/147)) ([d8b3c06](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d8b3c06fbc0fee5f4771b7479e42d3034c046b22))


### Refactored

* **ci:** move TypeDoc to validate job, fix exclude paths, document npm run docs ([#146](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/146)) ([a35d231](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a35d2312353ddca873758e3de663ae4a5c27d9ba))

## [1.25.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.24.0...v1.25.0) (2026-02-28)


### Added

* add DRY_RUN mode and /preview Telegram command ([#142](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/142)) ([17a21da](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/17a21daf037429b9e88a818b78cc98967ad81981))

## [1.24.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.23.2...v1.24.0) (2026-02-28)


### Added

* add --validate CLI flag and /check_config bot command ([#140](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/140)) ([5324da9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5324da96248f0d11b08ebaaaaf79cb9c9194a52d))

## [1.23.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.23.1...v1.23.2) (2026-02-28)


### Fixed

* add gitignore exception for release-please config file ([#137](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/137)) ([d707947](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d707947cb54b9efba929d1742431b612e192a4dc))


### Refactored

* consolidate config files into config/ directory ([#136](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/136)) ([d1846ea](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d1846eafadf6b036d789b423e52b050befa86681))

## [1.23.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.23.0...v1.23.1) (2026-02-28)


### Refactored

* rename src folders to PascalCase for check-file enforcement ([#134](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/134)) ([2280d3f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/2280d3f5f0bba9b575a709db115f39883a49d5cd))

## [1.23.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.22.0...v1.23.0) (2026-02-28)


### Added

* add optional accountName label to targets ([#131](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/131)) ([bb9abe2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/bb9abe2da832407dfd1b0782eb00d19ab24627f8))


### Fixed

* OTP acknowledgment UX + enforce 90% branch coverage ([#133](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/133)) ([30160f6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/30160f6e63a0cbf01274220f8a59a923d23ace9a))

## [1.22.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.21.2...v1.22.0) (2026-02-28)


### Added

* enrich logs and Telegram notifications ([#128](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/128)) ([7ba550b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7ba550b771c463c637829f35473e476dc85a7a1f))

## [1.21.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.21.1...v1.21.2) (2026-02-27)


### Fixed

* **deps:** update critical dependencies ([#126](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/126)) ([3a14e80](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/3a14e80fe492151477b5f6f2a778e63c1441125d))

## [1.21.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.21.0...v1.21.1) (2026-02-26)


### Fixed

* **test:** use formatDate() in SpendingWatch test to match service timezone ([#125](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/125)) ([8b8ef62](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/8b8ef6230f2b36b9181d8c85062aafc79dbd336b))
* use defaultTimeout instead of timeout for page navigation ([#123](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/123)) ([150725e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/150725e2a0561bae5b7d5e263e52ba652422beca))

## [1.21.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.20.1...v1.21.0) (2026-02-26)


### Added

* 2FA OTP via Telegram for OneZero (Task 07) ([#25](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/25)) ([824c2ba](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/824c2bad7d2bc667c8269663586e77b5197c2513))
* Add auto-categorization with history and translate modes ([#51](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/51)) ([03f7462](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/03f746245ea5b111b4c1c9d9ec19415ac2885947))
* add E2E testing environment with Docker pipeline ([#74](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/74)) ([f55a4c9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f55a4c95a196e91f58f2840920bf9017226c42b2))
* Add encrypted config file support (AES-256-GCM) ([#62](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/62)) ([296369d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/296369d35572a1b9c76ca7bf4859a70c2cc2c90a))
* add per-bank clearSession option ([#95](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/95)) ([f0a43c1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f0a43c11d742bb1093c2697a1150c3af097949b5))
* add per-bank timeout and navigationRetryCount options ([#113](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/113)) ([7b37de5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7b37de5d134a35f85de1b8450f2ab421c3d65935))
* Add proxy support and stealth anti-detection mode ([#86](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/86)) ([7037fff](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7037ffffa14d5c53b6b40c55c503f332321858fe))
* add spending watch with configurable rules ([#72](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/72)) ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))
* add spending watch with configurable rules and auto Telegram command registration ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))
* Add structured logging with 4 formats and /logs bot command ([05665f8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/05665f8951445ae424b9e8302f78b3cc85beefa1))
* Add Telegram notifications (Task 03) ([#22](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/22)) ([696947c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/696947c87846aa0678713379f236531a9832b6d3))
* Add unit tests + GitHub Actions CI (Task 01) ([30b18a6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/30b18a6e25190d76490ffe318d9b8d96eca488d4))
* Add unit tests and GitHub Actions CI (Task 01) ([dcabe0c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/dcabe0ce2e352227636b5d2e3fbf1257a6fe3338))
* daily dependency check + update scraper to 6.7.8 ([#94](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/94)) ([988f11f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/988f11f44f680f2219f4e3e8ade06b98eaf198b8))
* Docker Compose production setup (Task 10) ([#30](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/30)) ([a796c33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a796c33142c5e86c24a327a3b9588129d1810e2f))
* Enhanced GitHub release notes (Task 05) ([#20](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/20)) ([cc80863](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cc80863c9dcadc66c9f8858aded67765909206e9))
* Import audit log with /status history (Task 17) ([#32](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/32)) ([46c75d5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/46c75d59033056ad62f3e030add2538280805428))
* Rate limiting between bank imports (Task 18) ([#31](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/31)) ([c70003e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c70003eabb72c857a06f91c37c241fa5048ab611))
* Split config into credentials and settings files ([#64](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/64)) ([ba71e33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba71e3356326fdc151d36e794af10999be366d6a))
* switch to @sergienko4/israeli-bank-scrapers npm package ([#91](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/91)) ([cca429a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cca429ab51758ad45f3c7b6a0c8b606dde531228))
* Telegram bot commands - /scan, /status, /help ([#23](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/23)) ([55456c4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/55456c47a4854b166284624f0c4968121f3e035e))
* update scraper to v7 — Puppeteer → Playwright migration ([#110](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/110)) ([c9e155d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c9e155d4a7d4b1d892469a6602534fd15e74334a))
* use forked scraper with Amex/Isracard WAF fix ([#89](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/89)) ([d0fc0cd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0fc0cd096f2bb910203e10b806a09787fa19286))
* Webhook notifications — Slack, Discord, plain JSON (Task 16) ([#33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/33)) ([25c5c7c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/25c5c7cee769bcd9b945bdc2f967e7cec4efae3d))


### Fixed

* add hasDockerImage() guard to Docker-dependent E2E tests ([#78](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/78)) ([1ebaf00](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1ebaf000ae9ba11c7aa47fc1937297ec178c2b0a))
* Close unclosed HTML tags in truncated Telegram messages ([#52](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/52)) ([655392d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/655392d1b42169ae256c44edcfbd114c2619d2e3))
* Correct bank categories — 14 banks + 4 credit cards ([#36](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/36)) ([4a7e9db](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a7e9db7f831e07dc514b7cf30c7fbd8f5f95e3c))
* **deps:** update critical dependencies ([#119](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/119)) ([aabc3f6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/aabc3f6adf7190170aaea362b00c31a3f2a4f3ed))
* **deps:** upgrade cron-parser v4 → v5 ([#106](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/106)) ([96ddca1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/96ddca1a3fdd704c03211857b91da649ccca4abc))
* Improve stealth + add proxy/stealth/known issues to README ([#88](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/88)) ([d31e3d3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d31e3d3af323792fcd29d3c97621f59172afec0d))
* move blocking Trivy scan to PR validation, bust apt cache on release ([#66](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/66)) ([35edc71](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/35edc711929199c3d090852e55b17396e1114174))
* Pause poller during import + reconciliation + daysBack + docs ([#26](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/26)) ([af73f1e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/af73f1e14ed6e0e1431a644cace2b109851c5dc6))
* per-bank chrome-data directories for clearSession isolation ([#99](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/99)) ([f528f4f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f528f4fb52588327c786f05f2884914796f9420e))
* Prevent scheduler timeout overflow causing infinite import loop ([#37](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/37)) ([48c985c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/48c985c9dd3ef6dfe2e5643ca69c2ad80468b53e))
* Remove hardcoded Docker tags, link to Releases ([#38](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/38)) ([347e852](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/347e8529557188b3fa0bb76e161788cf06fdc31d))
* update @actual-app/api to 26.2.1 ([#79](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/79)) ([d038918](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0389185a26e558510c0976731eca036aab9ff44))
* use Playwright bundled Chromium instead of system APT chromium ([#117](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/117)) ([4a39f6a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a39f6ab8f4bbbf53c1391651d1a98f5eff58add))
* Use simple tag format (v1.9.0) instead of component prefix ([#44](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/44)) ([533db06](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/533db0608e3e75cf553f65fa786b1a0accecd5cd))


### Refactored

* Centralize utility functions - DRY (Task 04) ([567f12b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/567f12b61b1c268227f7955ace33afebabb90d30))
* Centralize utility functions - DRY principle (Task 04) ([b1e8514](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b1e8514f2506f9ad43d461693d058c85254213c4))
* Eliminate all any types, CI ratchet → 0 (Task 08) ([#27](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/27)) ([ba870d2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba870d2b68e3515ee1397bf3b091454288971d89))
* Extract all long methods to max ~10 lines (Task 13) ([#28](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/28)) ([7337ae7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7337ae75f11274bf3c5bc34f32564dd88317e50b))
* Extract TransactionService from index.ts (Task 02) ([#21](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/21)) ([ba21f2a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba21f2ad610bea5d94459aeeedb882460017cb23))
* move docs to docs/, simplify CI/CD, fix Docker Hub links ([5099a97](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5099a977ff19f3893eaf0c1dc1b883ee26eb3e75))
* remove redundant stealth code, upgrade scraper to v6.9.1 ([#108](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/108)) ([52d7dcd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/52d7dcd41bf1ecd66a4397fb3f254ead79c53e3d))


### Testing

* close HIGH priority E2E coverage gaps ([#77](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/77)) ([fa37195](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fa3719539ba5b7e028a0067f560af6536e5ed255))
* Improve coverage from 92% to 99%+ and add PRD template ([f82e872](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f82e872be40ba7dd1f24e99b7e006ab453b896cd))

## [1.20.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.20.0...v1.20.1) (2026-02-26)


### Fixed

* **deps:** update critical dependencies ([#119](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/119)) ([aabc3f6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/aabc3f6adf7190170aaea362b00c31a3f2a4f3ed))
* use Playwright bundled Chromium instead of system APT chromium ([#117](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/117)) ([4a39f6a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a39f6ab8f4bbbf53c1391651d1a98f5eff58add))

## [1.20.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.19.0...v1.20.0) (2026-02-26)


### Added

* add per-bank timeout and navigationRetryCount options ([#113](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/113)) ([7b37de5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7b37de5d134a35f85de1b8450f2ab421c3d65935))

## [1.19.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.18.0...v1.19.0) (2026-02-26)


### Added

* 2FA OTP via Telegram for OneZero (Task 07) ([#25](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/25)) ([824c2ba](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/824c2bad7d2bc667c8269663586e77b5197c2513))
* Add auto-categorization with history and translate modes ([#51](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/51)) ([03f7462](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/03f746245ea5b111b4c1c9d9ec19415ac2885947))
* add E2E testing environment with Docker pipeline ([#74](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/74)) ([f55a4c9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f55a4c95a196e91f58f2840920bf9017226c42b2))
* Add encrypted config file support (AES-256-GCM) ([#62](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/62)) ([296369d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/296369d35572a1b9c76ca7bf4859a70c2cc2c90a))
* add per-bank clearSession option ([#95](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/95)) ([f0a43c1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f0a43c11d742bb1093c2697a1150c3af097949b5))
* Add proxy support and stealth anti-detection mode ([#86](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/86)) ([7037fff](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7037ffffa14d5c53b6b40c55c503f332321858fe))
* add spending watch with configurable rules ([#72](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/72)) ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))
* add spending watch with configurable rules and auto Telegram command registration ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))
* Add structured logging with 4 formats and /logs bot command ([05665f8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/05665f8951445ae424b9e8302f78b3cc85beefa1))
* Add Telegram notifications (Task 03) ([#22](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/22)) ([696947c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/696947c87846aa0678713379f236531a9832b6d3))
* Add unit tests + GitHub Actions CI (Task 01) ([30b18a6](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/30b18a6e25190d76490ffe318d9b8d96eca488d4))
* Add unit tests and GitHub Actions CI (Task 01) ([dcabe0c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/dcabe0ce2e352227636b5d2e3fbf1257a6fe3338))
* daily dependency check + update scraper to 6.7.8 ([#94](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/94)) ([988f11f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/988f11f44f680f2219f4e3e8ade06b98eaf198b8))
* Docker Compose production setup (Task 10) ([#30](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/30)) ([a796c33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/a796c33142c5e86c24a327a3b9588129d1810e2f))
* Enhanced GitHub release notes (Task 05) ([#20](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/20)) ([cc80863](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cc80863c9dcadc66c9f8858aded67765909206e9))
* Import audit log with /status history (Task 17) ([#32](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/32)) ([46c75d5](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/46c75d59033056ad62f3e030add2538280805428))
* Rate limiting between bank imports (Task 18) ([#31](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/31)) ([c70003e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c70003eabb72c857a06f91c37c241fa5048ab611))
* Split config into credentials and settings files ([#64](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/64)) ([ba71e33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba71e3356326fdc151d36e794af10999be366d6a))
* switch to @sergienko4/israeli-bank-scrapers npm package ([#91](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/91)) ([cca429a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cca429ab51758ad45f3c7b6a0c8b606dde531228))
* Telegram bot commands - /scan, /status, /help ([#23](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/23)) ([55456c4](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/55456c47a4854b166284624f0c4968121f3e035e))
* update scraper to v7 — Puppeteer → Playwright migration ([#110](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/110)) ([c9e155d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c9e155d4a7d4b1d892469a6602534fd15e74334a))
* use forked scraper with Amex/Isracard WAF fix ([#89](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/89)) ([d0fc0cd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0fc0cd096f2bb910203e10b806a09787fa19286))
* Webhook notifications — Slack, Discord, plain JSON (Task 16) ([#33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/33)) ([25c5c7c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/25c5c7cee769bcd9b945bdc2f967e7cec4efae3d))


### Fixed

* add hasDockerImage() guard to Docker-dependent E2E tests ([#78](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/78)) ([1ebaf00](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1ebaf000ae9ba11c7aa47fc1937297ec178c2b0a))
* Close unclosed HTML tags in truncated Telegram messages ([#52](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/52)) ([655392d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/655392d1b42169ae256c44edcfbd114c2619d2e3))
* Correct bank categories — 14 banks + 4 credit cards ([#36](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/36)) ([4a7e9db](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/4a7e9db7f831e07dc514b7cf30c7fbd8f5f95e3c))
* **deps:** upgrade cron-parser v4 → v5 ([#106](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/106)) ([96ddca1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/96ddca1a3fdd704c03211857b91da649ccca4abc))
* Improve stealth + add proxy/stealth/known issues to README ([#88](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/88)) ([d31e3d3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d31e3d3af323792fcd29d3c97621f59172afec0d))
* move blocking Trivy scan to PR validation, bust apt cache on release ([#66](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/66)) ([35edc71](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/35edc711929199c3d090852e55b17396e1114174))
* Pause poller during import + reconciliation + daysBack + docs ([#26](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/26)) ([af73f1e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/af73f1e14ed6e0e1431a644cace2b109851c5dc6))
* per-bank chrome-data directories for clearSession isolation ([#99](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/99)) ([f528f4f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f528f4fb52588327c786f05f2884914796f9420e))
* Prevent scheduler timeout overflow causing infinite import loop ([#37](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/37)) ([48c985c](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/48c985c9dd3ef6dfe2e5643ca69c2ad80468b53e))
* Remove hardcoded Docker tags, link to Releases ([#38](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/38)) ([347e852](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/347e8529557188b3fa0bb76e161788cf06fdc31d))
* update @actual-app/api to 26.2.1 ([#79](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/79)) ([d038918](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0389185a26e558510c0976731eca036aab9ff44))
* Use simple tag format (v1.9.0) instead of component prefix ([#44](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/44)) ([533db06](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/533db0608e3e75cf553f65fa786b1a0accecd5cd))


### Refactored

* Centralize utility functions - DRY (Task 04) ([567f12b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/567f12b61b1c268227f7955ace33afebabb90d30))
* Centralize utility functions - DRY principle (Task 04) ([b1e8514](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/b1e8514f2506f9ad43d461693d058c85254213c4))
* Eliminate all any types, CI ratchet → 0 (Task 08) ([#27](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/27)) ([ba870d2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba870d2b68e3515ee1397bf3b091454288971d89))
* Extract all long methods to max ~10 lines (Task 13) ([#28](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/28)) ([7337ae7](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7337ae75f11274bf3c5bc34f32564dd88317e50b))
* Extract TransactionService from index.ts (Task 02) ([#21](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/21)) ([ba21f2a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba21f2ad610bea5d94459aeeedb882460017cb23))
* move docs to docs/, simplify CI/CD, fix Docker Hub links ([5099a97](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5099a977ff19f3893eaf0c1dc1b883ee26eb3e75))
* remove redundant stealth code, upgrade scraper to v6.9.1 ([#108](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/108)) ([52d7dcd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/52d7dcd41bf1ecd66a4397fb3f254ead79c53e3d))


### Testing

* close HIGH priority E2E coverage gaps ([#77](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/77)) ([fa37195](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fa3719539ba5b7e028a0067f560af6536e5ed255))
* Improve coverage from 92% to 99%+ and add PRD template ([f82e872](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f82e872be40ba7dd1f24e99b7e006ab453b896cd))

## [1.18.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.17.3...v1.18.0) (2026-02-26)


### Added

* update scraper to v7 — Puppeteer → Playwright migration ([#110](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/110)) ([c9e155d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c9e155d4a7d4b1d892469a6602534fd15e74334a))

## [1.17.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.17.2...v1.17.3) (2026-02-26)


### Refactored

* remove redundant stealth code, upgrade scraper to v6.9.1 ([#108](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/108)) ([52d7dcd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/52d7dcd41bf1ecd66a4397fb3f254ead79c53e3d))

## [1.17.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.17.1...v1.17.2) (2026-02-25)


### Fixed

* **deps:** upgrade cron-parser v4 → v5 ([#106](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/106)) ([96ddca1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/96ddca1a3fdd704c03211857b91da649ccca4abc))

## [1.17.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.17.0...v1.17.1) (2026-02-24)


### Fixed

* per-bank chrome-data directories for clearSession isolation ([#99](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/99)) ([f528f4f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f528f4fb52588327c786f05f2884914796f9420e))

## [1.17.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.16.0...v1.17.0) (2026-02-24)


### Added

* add per-bank clearSession option ([#95](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/95)) ([f0a43c1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f0a43c11d742bb1093c2697a1150c3af097949b5))
* daily dependency check + update scraper to 6.7.8 ([#94](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/94)) ([988f11f](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/988f11f44f680f2219f4e3e8ade06b98eaf198b8))

## [1.16.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.15.0...v1.16.0) (2026-02-24)


### Added

* switch to @sergienko4/israeli-bank-scrapers npm package ([#91](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/91)) ([cca429a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/cca429ab51758ad45f3c7b6a0c8b606dde531228))
* use forked scraper with Amex/Isracard WAF fix ([#89](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/89)) ([d0fc0cd](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0fc0cd096f2bb910203e10b806a09787fa19286))

## [1.15.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.14.1...v1.15.0) (2026-02-23)


### Added

* Add proxy support and stealth anti-detection mode ([#86](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/86)) ([7037fff](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/7037ffffa14d5c53b6b40c55c503f332321858fe))


### Fixed

* Improve stealth + add proxy/stealth/known issues to README ([#88](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/88)) ([d31e3d3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d31e3d3af323792fcd29d3c97621f59172afec0d))

## [1.14.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.14.0...v1.14.1) (2026-02-22)


### Fixed

* update @actual-app/api to 26.2.1 ([#79](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/79)) ([d038918](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/d0389185a26e558510c0976731eca036aab9ff44))

## [1.14.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.13.0...v1.14.0) (2026-02-22)


### Added

* add E2E testing environment with Docker pipeline ([#74](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/74)) ([f55a4c9](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/f55a4c95a196e91f58f2840920bf9017226c42b2))


### Fixed

* add hasDockerImage() guard to Docker-dependent E2E tests ([#78](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/78)) ([1ebaf00](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1ebaf000ae9ba11c7aa47fc1937297ec178c2b0a))


### Testing

* close HIGH priority E2E coverage gaps ([#77](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/77)) ([fa37195](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/fa3719539ba5b7e028a0067f560af6536e5ed255))

## [1.13.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.12.3...v1.13.0) (2026-02-21)


### Added

* add spending watch with configurable rules ([#72](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/72)) ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))
* add spending watch with configurable rules and auto Telegram command registration ([0e912af](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/0e912af99cd50b2ca1668a18b9a15590cc20f57e))

## [1.12.3](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.12.2...v1.12.3) (2026-02-21)


### Refactored

* move docs to docs/, simplify CI/CD, fix Docker Hub links ([5099a97](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5099a977ff19f3893eaf0c1dc1b883ee26eb3e75))

## [1.12.2](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.12.1...v1.12.2) (2026-02-21)


### Documentation

* update GUIDELINES with Trivy scan and SBOM in pipeline description ([#68](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/68)) ([ebcb789](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ebcb789d45f36cdb10f625714f8026cccebcb002))

## [1.12.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.12.0...v1.12.1) (2026-02-21)


### Fixed

* move blocking Trivy scan to PR validation, bust apt cache on release ([#66](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/66)) ([35edc71](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/35edc711929199c3d090852e55b17396e1114174))

## [1.12.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.11.1...v1.12.0) (2026-02-21)


### Added

* Add encrypted config file support (AES-256-GCM) ([#62](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/62)) ([296369d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/296369d35572a1b9c76ca7bf4859a70c2cc2c90a))
* Split config into credentials and settings files ([#64](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/64)) ([ba71e33](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/ba71e3356326fdc151d36e794af10999be366d6a))


### CI/CD

* add dynamic test count badge via Gist + shields.io ([#65](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/65)) ([c4ece3a](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/c4ece3aed51956855b215d4f1821982a6bacb757))

## [1.11.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.11.0...v1.11.1) (2026-02-21)


### CI/CD

* **deps:** bump actions/upload-artifact from 4 to 6 ([#57](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/57)) ([1c3598d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/1c3598d64f4e85ac73182f34dec60c8966f98169))
* **deps:** bump aquasecurity/trivy-action from 0.33.1 to 0.34.1 ([#60](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/60)) ([378d89b](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/378d89bbfb02eb315c34410e90efd6a4fb7a246b))
* **deps:** bump docker/build-push-action from 5 to 6 ([#58](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/58)) ([5f45f81](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/5f45f81f68488d5705c89c76cc8e6abd7af74627))
* Harden security and add open source community files ([#53](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/53)) ([667240e](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/667240e647ce672e9426c39215060c1f835947b4))

## [1.11.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.10.1...v1.11.0) (2026-02-20)


### Added

* Add auto-categorization with history and translate modes ([#51](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/51)) ([03f7462](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/03f746245ea5b111b4c1c9d9ec19415ac2885947))
* Add structured logging with 4 formats and /logs bot command ([05665f8](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/05665f8951445ae424b9e8302f78b3cc85beefa1))


### Fixed

* Close unclosed HTML tags in truncated Telegram messages ([#52](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/52)) ([655392d](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/655392d1b42169ae256c44edcfbd114c2619d2e3))

## [1.10.1](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.10.0...v1.10.1) (2026-02-20)


### CI/CD

* Use PAT for release-please to enable downstream workflow triggers ([#47](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/47)) ([35508fb](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/35508fb975bfef9d77b7835c7132fd6f6730522b))

## [1.10.0](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/compare/v1.9.0...v1.10.0) (2026-02-20)


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
* Use simple tag format (v1.9.0) instead of component prefix ([#44](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues/44)) ([533db06](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/commit/533db0608e3e75cf553f65fa786b1a0accecd5cd))


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
