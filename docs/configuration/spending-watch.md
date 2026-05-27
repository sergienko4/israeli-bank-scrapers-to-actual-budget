# Spending Watch

Monitor spending patterns and get alerts when thresholds are exceeded. Define an array of rules — each watches a time window for spending over a limit.

```json
"spendingWatch": [
  { "alertFromAmount": 500, "numOfDayToCount": 1 },
  { "alertFromAmount": 3000, "numOfDayToCount": 7, "watchPayees": ["שופרסל", "רמי לוי"] },
  { "alertFromAmount": 10000, "numOfDayToCount": 30, "watchPayees": ["rent", "שכירות"] }
]
```

## Rule fields

| Field | Required | Description |
|-------|----------|-------------|
| `alertFromAmount` | Yes | Alert if total spending exceeds this amount (currency units, e.g. ILS) |
| `numOfDayToCount` | Yes | Time window in days (1 = today only, 7 = week, 30 = month). Range: 1–365 |
| `watchPayees` | No | Only count transactions matching these payees (substring match, case-insensitive). Missing/empty = ALL payees |

## How it works

1. After each bank import, the tool queries Actual Budget for all **debit** transactions in the time window.
2. If `watchPayees` is set, only transactions matching those names are counted (substring — `שופרסל` matches `שופרסל דיזנגוף סניף 123`).
3. If `watchPayees` is missing or empty, ALL debits are counted.
4. Amounts are summed and compared to `alertFromAmount`.
5. Triggered rules are combined into one message and sent to all configured channels (Telegram + webhook).

## Example rules explained

| Rule | What it does |
|------|-------------|
| `500 / 1 day / no filter` | "Alert if I spend more than 500 ILS today" |
| `3000 / 7 days / שופרסל, רמי לוי` | "Alert if grocery spending exceeds 3,000 ILS this week" |
| `10000 / 30 days / rent, שכירות` | "Alert if rent payments exceed 10,000 ILS this month" |

## Alert output

```text
🔔 Spending Watch

⚠️ All payees: 1,250.00 in 1 day (limit: 500)
  -507.08  AliExpress
  -398.21  AliExpress
  -263.90  Netflix
  ... and 2 more

⚠️ שופרסל, רמי לוי: 3,420.00 in 7 days (limit: 3,000)
  -1,200.00  שופרסל דיזנגוף
  -890.00    רמי לוי תל אביב
  -1,330.00  שופרסל דיל
```

## Backward compatibility

No `spendingWatch` config = no alerts. Fully opt-in.

Spending watch runs **automatically after each import**. The `/watch` Telegram command currently shows info — on-demand checking is planned for a future release (see [Roadmap](../ROADMAP.md)).
