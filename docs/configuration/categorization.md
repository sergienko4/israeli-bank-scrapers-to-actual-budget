# Auto-Categorization

Automatically categorize imported transactions before they hit Actual Budget. Three modes:

```json
"categorization": {
  "mode": "none"
}
```

| Mode | Description |
|------|-------------|
| `none` (default) | No auto-categorization. Actual Budget's own rules handle everything. |
| `history` | Find the most recent transaction (across all accounts) with the same payee that has a category, and apply it. |
| `translate` | Rename Hebrew payees to English using user-provided rules, so Actual Budget's English rules can match. |

## Mode: `history` — learn from past categorizations

```json
"categorization": { "mode": "history" }
```

For each incoming transaction:

1. Query all accounts in Actual Budget for the most recent transaction where the payee contains the same substring.
2. If that transaction has a category, copy it onto the new one.
3. If no match is found, leave the transaction uncategorized.

Example: a new transaction with payee `שופרסל דיזנגוף` finds the previous `שופרסל מרכז` categorized as `Groceries` → category copied.

## Mode: `translate` — Hebrew → English

```json
"categorization": {
  "mode": "translate",
  "translations": [
    { "fromPayee": "סופר",   "toPayee": "Supermarket" },
    { "fromPayee": "שופרסל", "toPayee": "Shufersal" },
    { "fromPayee": "דלק",    "toPayee": "Gas Station" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `fromPayee` | Substring to match against the Hebrew payee |
| `toPayee` | English replacement payee — Actual Budget's rules see this |

**Longest match wins** — `שופרסל` matches before `סופר`. The original Hebrew name is preserved in `imported_payee`.

## Important: Actual Budget rules always run

Both modes produce a **first-pass suggestion**. Actual Budget's own rules run **after** import and have the final word. They work together — no conflict.

If you want translate-then-categorize, list a `translate` rule for the Hebrew payee and let Actual Budget's English rule pick the category.
