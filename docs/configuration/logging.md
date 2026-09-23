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
| `level` | `info` | Verbosity: `trace`, `debug`, `info`, `warn`, `error`. |
| `logDir` | `./logs` | Directory for rotating log files. In Docker, use an absolute path like `/app/logs` and mount as a volume. |

## Log level

`level` is editable from the **config portal** (Logging section), so you can raise
verbosity and re-run without editing files over SSH. It falls back to the
`LOG_LEVEL` environment variable when unset.

!!! warning "Turn it back down"
    `trace` is noisy. Return `level` to `info` once you have diagnosed the
    problem.

!!! info "Failure screenshots were removed in scrapers 8.7.0"
    Earlier releases asked the scraper to photograph a failed login by setting
    `storeFailureScreenShotPath`. Scrapers 8.7.0 deprecated that option: only
    its legacy non-Pipeline banks ever honoured it, so for most banks no
    screenshot was ever taken. The importer no longer sends it, and the
    per-bank `failureScreenshotPath` setting is now accepted but ignored.

## Getting the scraper's own log output

`level` controls the **importer's** logger. The scraper library keeps a
separate logger. The published image sets `PRETTY_LOGS=false`, so the library
does not attach its pretty container-log transport. Without an upstream file
destination, it falls back to `level: 'silent'`, and no scraper line reaches
the container logs. A configured upstream file destination remains active.
Since scraper 8.7.1, `NODE_ENV` does not control the scraper's logging mode.

`LOG_LEVEL` alone does not enable scraper container logs. The library only
consults it _after_ deciding to attach a transport, so raising it changes
importer output unless `PRETTY_LOGS=true` or an upstream file destination
already enables scraper logging.

To read the scraper's own narration, opt in for one throwaway container:

```bash
# Add your usual volumes and flags to this run
docker run --rm \
  -e PRETTY_LOGS=true \
  -e LOG_LEVEL=debug \
  sergienko4/israeli-bank-importer
```

!!! warning "Diagnostic runs only"
    `PRETTY_LOGS=true` makes the library attach a `pino-pretty` transport,
    which starts a worker thread per scrape process and emits ANSI colour codes
    into the container log. Scraper 8.6.3+ caches that transport per
    destination, so the cost is one ~4 MB worker rather than the leak that once
    OOM-killed a 2 GB container. Production deployments should keep
    `PRETTY_LOGS=false` — see
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

## Secret masking

Log lines and error alerts can quote a bank's reply, and some banks echo
credentials in it. Before a line is written or an alert is sent, the importer
replaces the value after any of these keys with `[REDACTED]` when the key is
followed by `=` or `:`:

- any name ending in `token`, `password` or `secret`, which covers the
  long-term login token under each of its names (`otpLongTermToken`,
  `longTermToken`, `persistentOtpToken`, `idToken` and `access_token`) as well
  as names like `clientSecret` and `new_password`
- `auth`, `authorization`, `bearer`, `jwt`, `creditCard` and `cvv` as a word
  of their own, at the start of a name or after `_`, `-` or `.`: `card_cvv`
  is hidden, while the `twoFactorAuth: true` hint stays readable

A `Bearer` or `Basic` word in front of the value is hidden with it, so
`authorization: Bearer <jwt>` is written as `authorization=[REDACTED]`. The
key itself is kept, so you can still tell what was hidden. A quoted value is
hidden through its closing quote, spaces included, and keeps its quotes:
`{"idToken":"..."}` is written as `{"idToken":"[REDACTED]"}`, still valid JSON,
and the fields after it stay readable. Double quotes, single quotes and
backticks all count. A value the bank's reply cut off before its closing quote
hides the rest of the reply. An unquoted value is
hidden up to the next space. A `=` or `:` inside it opens another value, which
is hidden too: the quoted value in `{"token":null,"idToken": "..."}`, or the
secret after `Basic` in `token=null,auth=Basic ...`. When a secret key holds an
object or a list, the rest of the reply is hidden, because the fields inside it
can be secrets under ordinary names. Masking a line twice gives the same line.

Structured log fields follow the same keys, in any letter case: a field named
`authToken` or `Authorization` is written as `[REDACTED]`, and a secret quoted
inside another field's text is masked as above. The importer logs a message
and one level of fields, and these rules cover exactly that. Other things pino
can log are outside them: fields nested deeper and fields bound to a child
logger are hidden by exact name only, and a logged `Error` object is written as
pino serialises it.

Masking covers stdout, the log files that `/logs` reads, and error alerts on
Telegram, webhook and push.

## Deprecated: `maxBufferSize`

`maxBufferSize` is ignored. The `/logs` command now reads from log files (no in-memory buffer).
