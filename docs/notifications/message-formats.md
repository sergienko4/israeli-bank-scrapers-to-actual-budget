# Message Formats

The Telegram bot offers four message formats — pick one in `notifications.telegram.messageFormat`.

=== "summary"

    Banks-overview only. **Default.**

    ```text
    ✅ Import Summary

    🏦 Banks: 3/3 (100%)
    📥 Transactions: 47 imported
    🔄 Duplicates: 12 skipped
    ⏱ Duration: 38.2s

    ✅ discount: 18 txns 12.3s
    ✅ leumi: 22 txns 15.1s
    ✅ hapoalim: 7 txns 10.8s
    ```

=== "compact"

    Transaction details with amounts.

    ```text
    ✅ Import Summary
    3/3 banks | 47 txns | 38.2s

    ✅ Discount · 0152228812
    14/02  משכורת חודשית
           +12,500.00
    14/02  שופרסל דיזנגוף
           -342.50
    14/02  חברת חשמל
           -289.00
    💰 45,230.50 ILS
    ✅ Balance matched
    ```

=== "ledger"

    Monospace table layout.

    ```text
    ✅ Import Summary
    47 transactions · 38.2s

    ✅ Discount (0152228812)
    14/02 משכורת חודשית
            +12,500.00
    14/02 שופרסל דיזנגוף
               -342.50
    14/02 חברת חשמל
               -289.00
    Balance: 45,230.50 ILS
    ✅ Balance matched
    ```

=== "emoji"

    Visual deposit / payment indicators.

    ```text
    ✅ Import Summary

    📊 3/3 banks · 47 txns · 38.2s

    💳 Discount
      📥 +12,500.00  משכורת חודשית
      📤 -342.50  שופרסל דיזנגוף
      📤 -289.00  חברת חשמל
      💰 45,230.50 ILS
      ✅ Balance matched
    ```

## Phone-friendly variant

When `listenForCommands: true`, the **logger** format auto-switches to `phone` (no emojis, compact lines) so that `/logs` output is readable on a small screen. Message format stays whatever you chose.

## On failure

```text
🚨 Import Failed

🔐 Authentication Error (discount): Invalid credentials. Please verify your password.
```

Errors are categorized so users can self-serve fixes: authentication, captcha, rate-limit, password change required, network. Each category includes a one-line action hint.

## Partial runs

Every bank is imported in its own child process, so one bank failing never
cancels the others. When a Telegram-triggered import finishes with a mix of
outcomes, the bot reports exactly which banks failed instead of implying the
whole run was lost:

```text
⚠️ Partial import (38s) — 4/5 banks OK, 1 failed:
  • paybox: Invalid credentials. Please verify your password.

Use /retry to re-run the failed bank(s), or /logs for details.
```

Only when *every* bank failed does the message read as a total failure:

```text
❌ Import failed (12s) — all 3 bank(s) failed:
```

`/status` uses the same distinction and shows `partial: 4/5 OK` for a mixed run.

## See also

- [Telegram setup](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/telegram.md)
- [Webhook payloads](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/notifications/webhooks.md)
- [Logging](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/logging.md) — controls log file output, separate from Telegram message format
