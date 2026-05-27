# Webhooks

Send import summaries to any HTTP endpoint — Slack, Discord, or a generic JSON consumer.

```json
"notifications": {
  "enabled": true,
  "webhook": {
    "url": "https://hooks.slack.com/services/T.../B.../...",
    "format": "slack"
  }
}
```

| Format | Target | Payload shape |
|--------|--------|---------------|
| `slack` | Slack Incoming Webhook | `{ "text": "✅ *Import Summary*..." }` |
| `discord` | Discord Webhook | `{ "content": "✅ **Import Summary**..." }` |
| `plain` | Any HTTP endpoint | `{ "event": "import_complete", "totalTransactions": 5, ... }` |

Webhooks can run **alongside** the Telegram bot — both channels fire independently.

## Slack

Create an Incoming Webhook in your Slack workspace:

1. Slack → **Apps** → **Incoming WebHooks** → **Add to Slack**.
2. Pick a channel → copy the webhook URL.
3. Drop it into `config.json`:

```json
"webhook": {
  "url": "https://hooks.slack.com/services/T.../B.../...",
  "format": "slack"
}
```

## Discord

Create a webhook in your Discord channel:

1. Channel → **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**.
2. Copy the URL.
3. Drop it into `config.json`:

```json
"webhook": {
  "url": "https://discord.com/api/webhooks/.../...",
  "format": "discord"
}
```

## Generic (`plain`)

For ingestion by Loki, Grafana On-Call, n8n, Zapier, Make, your own service…

```json
"webhook": {
  "url": "https://example.com/hooks/import",
  "format": "plain"
}
```

Payload schema:

```json
{
  "event": "import_complete",
  "timestamp": "2026-05-27T14:23:14.000Z",
  "totalTransactions": 47,
  "totalDuplicates": 12,
  "totalDurationMs": 38200,
  "banks": [
    {
      "key": "discount",
      "status": "ok",
      "transactions": 18,
      "durationMs": 12300,
      "reconciled": true
    }
  ],
  "failures": []
}
```

## Disable

Remove the `webhook` block or set `notifications.enabled: false`.
