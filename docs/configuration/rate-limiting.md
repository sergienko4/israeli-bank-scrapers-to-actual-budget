# Rate Limiting

Prevent bank API throttling by adding a delay between bank imports.

```json
"delayBetweenBanks": 5000
```

| Option | Default | Description |
|--------|---------|-------------|
| `delayBetweenBanks` | `0` | Milliseconds to wait between bank imports |

The delay is applied **between** banks, not before the first bank or after the last one. It lives at the **top level** of `config.json`, not per-bank.

## When to use

- You have **3 or more banks** and at least one of them aggressively rate-limits scrapers.
- You see `Too many requests` or sporadic auth failures after several successful banks.
- Your VM is a shared IP (Oracle Cloud free tier, Hetzner shared) and back-to-back hits look suspicious to the bank's WAF.

## Per-bank tuning

Rate limiting only delays between banks. For per-bank scraper tuning (timeout, retries), see [Bank options](https://github.com/sergienko4/israeli-bank-scrapers-to-actual-budget/blob/main/docs/configuration/banks.md#scraper-tuning).

## Concurrency

Banks always run **sequentially** — never in parallel. This is by design: the Camoufox browser is single-instance, and parallel scrapes would share session state. `delayBetweenBanks` adds an explicit pause on top of the natural sequential ordering.
