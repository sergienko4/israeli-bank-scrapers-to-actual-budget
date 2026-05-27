# Troubleshooting

Common issues and how to resolve them.

## Container fails to launch (browser sandbox)

**Symptom:** logs show `Failed to launch browser` or `sandbox creation failed`.

**Fix:** ensure `--cap-add SYS_ADMIN` is set. Camoufox/Firefox needs it for namespace sandboxing.

```bash
docker run --cap-add SYS_ADMIN ...
```

In `docker-compose.yml`:

```yaml
cap_add:
  - SYS_ADMIN
```

## "out-of-sync-migrations" from Actual Budget

**Symptom:** Actual Budget client returns `out-of-sync-migrations`.

**Fix:**

1. Confirm your Actual Budget server is **v26.2.0 or newer**.
2. Stop the importer.
3. Delete the `./data` directory contents.
4. Restart the importer — it will re-sync from scratch.

## 2FA / OTP requested every run

**Symptom:** every import asks for an OTP, even for banks that support persistence (oneZero).

**Fix:** after the first successful login, add `"otpLongTermToken"` to that bank's config block. For oneZero this is captured automatically on the first run.

Better still: [auto-forward OTP codes from your phone](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/OTP-AUTOFORWARD.md) so no manual input is needed.

## Windows volume mounts don't work

**Symptom:** `bind: invalid mount config` or container can't read `config.json`.

**Fix:** use absolute Windows paths and quote them:

```powershell
docker run --rm --cap-add SYS_ADMIN `
  -v "C:\path\to\config.json:/app/config.json:ro" `
  -v "C:\path\to\data:/app/data" `
  sergienko4/israeli-bank-importer
```

## "Too many transactions" or duplicate imports

**Symptom:** transactions appear duplicated in Actual Budget.

**Fix:** the importer is idempotent by transaction ID. Duplicates usually mean:

- `targets[].accounts` was changed mid-import.
- The Actual Budget account was reset without clearing `./data`.

Run with `DRY_RUN=true` first to preview what would be imported.

## Schedule doesn't fire

**Symptom:** importer starts, then exits — no scheduled runs.

**Fix:**

1. Check `SCHEDULE` is set (no `SCHEDULE` = run once and exit).
2. Verify the cron expression with [crontab.guru](https://crontab.guru/).
3. Set `restart: unless-stopped` so the container survives reboots.
4. Tail `docker compose logs -f` — the scheduler logs the next-run time on startup.

## Camoufox download fails (CI / pre-commit)

**Symptom:** first-time build downloads stall or 403.

**Fix:** the project ships a `docker/camoufox-cache` composite action that caches the Camoufox release between builds. Locally you can pre-download by running `npm install` once — the postinstall hook fetches Camoufox into `node_modules/`.

## Scraper times out on Oracle Cloud / slow VMs

**Symptom:** banks fail with `Navigation timeout of 30000ms exceeded`.

**Fix:** set per-bank tuning:

```json
"amex": {
  "timeout": 60000,
  "navigationRetryCount": 2,
  "...": "..."
}
```

See [Oracle Cloud deployment guide](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/oracle-cloud.md) for details.

## Proxy is set but ignored

**Symptom:** `PROXY_SERVER` or `proxy.server` has no effect.

**Fix:** proxy support is **not yet wired** to Camoufox (v7.9.0+). The config is preserved for future use. See [Proxy docs](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/proxy.md).

## Telegram bot stops responding

**Symptom:** `/scan` and `/status` no longer get replies.

**Fix:**

1. Confirm `listenForCommands: true` is set.
2. Check `docker compose logs -f` for `polling error`.
3. Re-generate the bot token via [@BotFather](https://t.me/BotFather) (`/token`).
4. Rate limits — Telegram throttles bots that exceed 30 messages/sec. The importer batches notifications by default; only `/logs N` with a very large `N` will hit this.

## Receipt OCR returns wrong amount

**Symptom:** `/import_receipt` extracts the wrong total.

**Fix:** OCR priority is `לתשלום` > `סה"כ` > `₪` prefix > largest formatted number. If your receipt uses non-standard layout, reply to the extraction message with the corrected amount — the bot updates the inline preview.

## Still stuck?

- 🐛 [Open an issue](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues)
- 💬 [Issue tracker](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/issues)
- 📜 [Recent log entries](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/logging.md) via `/logs` Telegram command
