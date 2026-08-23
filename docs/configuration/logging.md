# Logging

The importer uses [pino](https://github.com/pinojs/pino) for structured logging. The format is auto-derived from your Telegram message format, but you can override it explicitly.

```json
"logConfig": {
  "format": "words",
  "level": "info",
  "logDir": "./logs"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `format` | _auto_ | Log format. Auto-derived from `telegram.messageFormat` when not set. |
| `level` | `info` | Verbosity: `trace`, `debug`, `info`, `warn`, `error`. `debug`/`trace` also enable scraper diagnostics. |
| `logDir` | `./logs` | Directory for rotating log files. In Docker, use an absolute path like `/app/logs` and mount as a volume. |

## Log level and scraper diagnostics

`level` is editable from the **config portal** (Logging section), so you can raise
verbosity and re-run without editing files over SSH. It falls back to the
`LOG_LEVEL` environment variable when unset.

Setting `level` to `debug` or `trace` additionally asks the bank scraper to
photograph any login it fails:

| What you get | Provider option |
|--------------|-----------------|
| A screenshot of the page at the moment login failed | `storeFailureScreenShotPath` |

Screenshots land in `logs/failures` below the working directory — which is
`/app/logs/failures` in the container. Override per bank with
`failureScreenshotPath`:

```json
"banks": {
  "visaCal": { "failureScreenshotPath": "/app/data/shots" }
}
```

This is the fastest way to diagnose an opaque scrape failure such as
*"resolved zero accounts"*, which on its own tells you the session was rejected
but not why (an expired session, a WAF challenge, or a changed login page).

!!! warning "Turn it back down"
    `trace` is noisy and screenshots may capture account details. Return `level`
    to `info` once you have diagnosed the problem.

## Getting the scraper's own log output

`level` controls the **importer's** logger. The scraper library keeps a
separate logger, and in the published container image it is switched off
entirely: the image sets `NODE_ENV=production`, which makes the library skip
attaching a log transport and fall back to `level: 'silent'`. No scraper line,
at any severity, reaches the logs.

`LOG_LEVEL` does not rescue it. The library only consults `LOG_LEVEL` *after*
it has decided to attach a transport, so raising it changes importer output
only.

Failure screenshots are unaffected — the provider writes those straight to
disk, so they still appear at `debug`/`trace` under `NODE_ENV=production`.

To read the scraper's own narration, run one throwaway container in
development mode:

```bash
# Add your usual volumes and flags to this run
docker run --rm \
  -e NODE_ENV=development \
  -e LOG_LEVEL=debug \
  sergienko4/israeli-bank-importer
```

!!! warning "Diagnostic runs only"
    Development mode makes the library attach a `pino-pretty` transport, which
    starts a worker thread per scrape process and emits ANSI colour codes into
    the container log. Scraper 8.6.3+ caches that transport per destination, so
    the cost is one ~4 MB worker rather than the leak that once OOM-killed a
    2 GB container. Production deployments should still keep
    `NODE_ENV=production` — see
    [Docker run](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/deployment/docker-run.md)
    for the memory background.

## Log formats

=== "words (default)"

    Emoji-rich, colorized (pino-pretty). Best for **development and human reading**.

    ```text
    14:23:01 INFO  🏦 Importing discount …
    14:23:14 INFO  ✅ discount: 18 txns 12.3s
    ```

=== "json"

    Structured NDJSON — one JSON object per line. Best for **Docker log aggregators (Loki, ELK, CloudWatch)**.

    ```text
    {"level":"info","time":1716799381000,"bank":"discount","status":"ok","count":18}
    ```

=== "table"

    `[HH:MM:SS] LEVEL message`. Best for **timestamped production logs**.

    ```text
    [14:23:01] INFO  Importing discount
    [14:23:14] INFO  discount: 18 txns 12.3s
    ```

=== "phone"

    `> compact message` (no emojis). Best for **mobile viewing**.

    ```text
    > Importing discount
    > discount: 18 txns 12.3s
    ```

## Auto-derived format

If `format` is not set, it's derived from your Telegram setup:

| `telegram.messageFormat` | Auto-selected `format` |
|--------------------------|------------------------|
| `summary` (default) | `words` |
| `compact` | `table` |
| `ledger` | `json` |
| `emoji` | `words` |
| `listenForCommands: true` (any format) | `phone` |

## Log file rotation

Log files are written to `logDir` as NDJSON (raw pino format), rotated at **10 MB per file**, and automatically cleaned up after **3 days**.

The `/logs` Telegram command reads from these files — so `logDir` is required if you want bot-driven log inspection.

```bash
# Persist logs across container restarts
-v /host/logs:/app/logs
```

## Deprecated: `maxBufferSize`

`maxBufferSize` is ignored. The `/logs` command now reads from log files (no in-memory buffer).
