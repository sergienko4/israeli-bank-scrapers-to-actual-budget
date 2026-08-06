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

## PayBox asks for the OTP twice in a row

**Symptom:** a single PayBox login shows two back-to-back OTP prompts, and the
second prompt arrives before any new SMS does.

**Fix:** upgrade — the importer now reuses the code you supplied for PayBox's
second internal request, so one login prompts once. See
[PayBox](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/banks/paybox.md).
If a prompt times out or the bank rejects the code, you are asked again with a
fresh code — that re-prompt is expected.

## One bank failed but the notification says the import failed

**Symptom:** four of five banks imported fine, yet Telegram reported a failure.

**Fix:** upgrade — failure notifications are now built from the per-bank results
of the run and read `⚠️ Partial import (38s) — 4/5 banks OK, 1 failed:` with the
failed bank named. Use `/retry` to re-run only the failed banks.

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

## Container is OOM-killed or the host becomes unresponsive

**Symptom:** the importer disappears mid-run, `docker inspect israeli-bank-importer --format '{{.State.OOMKilled}}'` reports `true`, or — with no memory limit set — the whole host stops responding while still accepting TCP connections.

**Cause:** a bank scrape that exceeds its deadline used to leave its browser process running. Each retry launched another, so a single bank could hold several browsers at once and RSS climbed without bound. Fixed in v1.42.2: every attempt now closes the browsers it launched, whether it succeeded, failed, or timed out. You will see this line in the logs when a browser is reclaimed:

```text
🧹 Reclaimed 1 abandoned browser(s) after Scraping discount
```

**Fix:**

1. Upgrade to v1.42.2 or later.
2. Always run with a memory limit — this is the guard that keeps a runaway container from taking the host with it:

   ```bash
   docker run --memory 2g --memory-swap 2g ...        # docker run
   ```

   ```yaml
   mem_limit: 2g                                       # docker compose
   memswap_limit: 2g
   ```

   Kubernetes users set `resources.limits.memory: 2Gi`.

`NODE_OPTIONS=--max-old-space-size` does **not** solve this: it caps only the JS heap, and most of the importer's memory is native browser allocation outside the heap. See [Docker Compose → Memory limits](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/docker-compose.md).

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
