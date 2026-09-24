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
- any name ending in `phoneNumber`, `phone_number` or `phone-number`, since a
  phone number is personal data and the login for OneZero, PayBox and Pepper
- `auth`, `authorization`, `bearer`, `jwt`, `creditCard` and `cvv` as a word
  of their own, at the start of a name or after `_`, `-` or `.`: `card_cvv`
  is hidden, while the `twoFactorAuth: true` hint stays readable

An auth scheme in front of the value is hidden with it: `Basic`, `Bearer`,
`DPoP`, `GNAP`, `Negotiate`, `NTLM` or `Token`, in any letter case. So
`authorization: Bearer <jwt>` is written as `authorization=[REDACTED]`. A
scheme that sends a list of parameters (`Concealed`, `Digest`, `HOBA`,
`Mutual`, `OAuth`, `PrivateToken`, `SCRAM-SHA-1`, `SCRAM-SHA-256` or `vapid`)
hides the rest of its line, and any folded line after it that starts with a
space or a tab, since any parameter can carry the secret. Under `auth` or
`authorization`, any other scheme followed by a `name=` parameter, such as
`AWS4-HMAC-SHA256 Credential=..., Signature=...`, is hidden the same way. The
key itself is kept, so you can still tell what was hidden. A quoted value is
hidden through its closing quote, spaces included, and keeps its quotes:
`{"idToken":"..."}` is written as `{"idToken":"[REDACTED]"}`, still valid JSON,
and the fields after it stay readable. Double quotes, single quotes and
backticks all count. A value the bank's reply cut off before its closing quote
hides the rest of the reply, but the importer's own advice after it, such as
"Verify your password on the bank website", stays readable. An unquoted value is
hidden up to the next space, except that one starting with a digit, `+` or
`(` is hidden with each word after it on the same line that holds no letter,
so a phone number such as `+972 50-000-0016` is hidden whole, however it is
spaced. An invisible format character, such as the right-to-left marks that
Hebrew text puts around a number, counts as a space, so it cannot cut a value
short. A `=` or `:` inside it opens another value, which
is hidden too: the quoted value in `{"token":null,"idToken": "..."}`, or the
secret after `Basic` in `token=null,auth=Basic ...`. When a secret key holds an
object or a list, the rest of the reply is hidden, because the fields inside it
can be secrets under ordinary names. Masking a line twice gives the same line.

Structured log fields follow the same keys, in any letter case and at any
depth: a field named `authToken` or `Authorization` is written as
`[REDACTED]`, whether the call logged it, a child logger bound it, or it sits
in a nested object or a list. A phone number field is hidden the same way,
and so is a name with spaces or invisible marks after the key, such as
`idToken` followed by a right-to-left mark, or with an invisible mark inside
it, such as one between `idTok` and `en`. A secret quoted inside any
field's text or name is masked as above, and so is one in a logged
`Error`'s message and stack. This masking runs on each
finished line just before it is written, so it covers every field pino
writes; numbers, including ones too large for a double, are written
unchanged. A line that is not valid JSON, or is nested too deep to read, is
masked as text instead. A message's `%s`-style values are never written: the
message is written as the call wrote it, placeholders included, because a key
in the message and its value in an argument, as in `token: %s`, cannot be
masked as a pair.

Masking covers stdout, the log files that `/logs` reads, and error alerts on
Telegram, webhook and push. It also covers the failure reasons kept in the
import history, which `/api/status` serves to the portal and the app, and
which the reply after a failed import quotes. A reason that an older release
stored with less thorough masking is masked again each time the history is
read, and is saved masked the next time an import is recorded.

## Deprecated: `maxBufferSize`

`maxBufferSize` is ignored. The `/logs` command now reads from log files (no in-memory buffer).
