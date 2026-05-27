# Scheduling

The importer runs in two modes:

- **Run-once** — no `SCHEDULE` env var. The process imports all banks once and exits.
- **Scheduled** — set the `SCHEDULE` env var to a cron expression. The process stays alive and fires the import on each tick.

## Set the schedule

In `docker-compose.yml`:

```yaml
environment:
  - TZ=Asia/Jerusalem
  - SCHEDULE=0 */8 * * *
```

With `docker run`:

```bash
docker run -d -e TZ=Asia/Jerusalem -e SCHEDULE="0 */8 * * *" ...
```

## Cron expression cheat sheet

| Schedule | Expression | Triggers |
|----------|-----------|----------|
| Every 8 hours | `0 */8 * * *` | 00:00, 08:00, 16:00 |
| Daily at 02:00 | `0 2 * * *` | Once per day |
| Twice daily | `0 6,18 * * *` | 06:00 and 18:00 |
| Weekdays at 09:00 | `0 9 * * 1-5` | Mon–Fri |
| Every 6 hours | `0 */6 * * *` | 00:00, 06:00, 12:00, 18:00 |
| Every hour on workdays | `0 * * * 1-5` | Hourly Mon–Fri |

```text
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6, Sun=0)
│ │ │ │ │
* * * * *
```

Test expressions with [crontab.guru](https://crontab.guru/).

## Timezone

`TZ` controls the cron's interpretation of times. Use [IANA tz names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) — e.g. `Asia/Jerusalem`, `Europe/London`, `America/New_York`.

When unset, the container defaults to UTC.

## Run-once vs scheduled — when to use each

| Mode | When to use |
|------|-------------|
| Run-once | CI batch jobs, manual sync, debugging |
| Scheduled | Daily automation, production deployments |

Even scheduled containers benefit from `restart: unless-stopped` so they survive Docker daemon restarts. The scheduler logs the next fire time on startup — check `docker compose logs -f` to confirm it's armed.

## Manual scan via Telegram

If the Telegram bot is enabled with `listenForCommands: true`, send `/scan` to trigger a run on demand without waiting for the next cron tick. The bot reports progress and the same summary the scheduler emits. See [Telegram docs](../notifications/telegram.md).
