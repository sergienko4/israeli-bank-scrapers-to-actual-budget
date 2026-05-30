# Real-Bank E2E Suite

Opt-in tests that exercise the production code path against **live bank
APIs** using your real credentials. Built to catch the class of regression
that PR #393 missed — where the bank API contract is broken but mocked
unit tests still pass.

## Why this exists

PR #393 added PayBox and Pepper but did NOT add real-bank tests. Both
banks shipped to production with a `phoneNumber` formatting bug that
caused immediate 400/envelope-miss errors. This suite is the gate that
would have caught both before merge.

## When to use

- **Always** before merging any PR that touches `CredentialsBuilder`,
  `LiveScrapeStrategy`, `PhoneNumberNormaliser`, bank-specific config
  surfaces, or upstream `@sergienko4/israeli-bank-scrapers` bumps.
- **Always** when adding a new bank that uses 2FA / OTP / phoneNumber.
- Optional for refactor-only changes that demonstrably don't touch
  the credential boundary.

## Setup

1. **Install Camoufox locally.** PayBox + Pepper require `requiresBrowserTls`
   (Firefox TLS profile) — run the upstream install command once.
2. **Populate `.env.e2e`** (preferred) or `.env` (fallback, supported for
   developer convenience). Both files are gitignored.

```bash
# Gate (skip-by-default if absent)
RUN_REAL_BANK_TESTS=true

# PayBox (digits-only or +972... form — both normalised)
PAYBOX_PHONE_NUMBER=972XXXXXXXXX
# Leave empty on first login
PAYBOX_OTP_LONG_TERM=

# Pepper
PEPPER_PHONE_NUMBER=972XXXXXXXXX
PEPPER_PASSWORD=your-password
# Leave empty on first login
PEPPER_OTP_LONG_TERM=

# OneZero (regression-only — verifies the normalisation doesn't break it)
ONEZERO_EMAIL=your@email
ONEZERO_PASSWORD=your-password
ONEZERO_PHONE_NUMBER=972XXXXXXXXX
ONEZERO_OTP_LONG_TERM=
```

> **Project convention:** real bank credentials belong in `.env.e2e`,
> NOT `.env`. The suite reads `.env.e2e` first and falls back to `.env`
> for developers who already have the values there.

## Run

```bash
# Native (REQUIRED — Docker Desktop on Windows hangs Camoufox; see CLAUDE.md)
npm run test:e2e:real
```

The suite is **interactive**: when a bank needs an OTP, the test prompts
on stdin with `[<bank>] Enter OTP code from SMS:`. You forward the SMS
manually within the 10-minute test timeout. After the first successful
login, copy the `otpLongTermToken` printed by the upstream scraper into
your env file so subsequent runs use the warm-start path (no OTP).

## NOT in CI

This suite is **never** executed by GitHub Actions. Why:

- Real bank APIs rate-limit aggressively.
- Bank credentials cannot be safely stored in GitHub Secrets without
  high audit overhead.
- OTP flows require a human in the loop.
- Camoufox + Docker Desktop on Windows is unreliable (CLAUDE.md note).

The suite gates on `RUN_REAL_BANK_TESTS=true`. CI never sets it.

## Failure triage

### PayBox returns HTTP 400

1. Confirm `PAYBOX_PHONE_NUMBER` is digits-only `972XXXXXXXXX` (or
   `+972XXXXXXXXX` — the normaliser handles both).
2. Inspect the request body in upstream debug logs (`LOG_LEVEL=debug`).
   Confirm `phoneNum` is `972-XXXXXXXXX` after upstream's
   wire-format step.
3. If 1-2 are correct, the PayBox API contract may have changed.
   Capture the request/response and file an upstream bug.

### Pepper "envelope selector miss: smsAssertionId"

1. Confirm `PEPPER_PHONE_NUMBER` + `PEPPER_PASSWORD` work via the
   Pepper mobile app (login manually).
2. Confirm the Pepper account has SMS 2FA enabled (vs email or push only).
3. If 1-2 are correct, capture the upstream response body for
   `ASSERT_PWD_STEP`; the schema may have changed.

### Camoufox hangs / fails to launch

1. Verify Camoufox is installed: re-run the upstream install command.
2. On Windows, do NOT run via Docker Desktop — use native vitest.
3. Check for zombie Firefox processes: `Get-Process firefox` in PowerShell.

### Test skips with "skip-no-creds"

Means the env var named in the skip message is missing. Add it to
`.env.e2e` (preferred) or `.env`.
