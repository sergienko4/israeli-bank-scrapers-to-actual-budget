# Task 07: 2FA Code Input via Telegram

**Priority:** 🟡 MEDIUM
**Effort:** TBD
**Status:** 📋 TODO

---

## Goal

Some Israeli banks require 2FA (two-factor authentication) during login. Use the existing Telegram notification channel to:
1. Send a prompt to the user asking for the 2FA code
2. Wait for the user to reply with the code via Telegram
3. Use the code to complete the bank login

This turns the Telegram bot from send-only to interactive.

---

## Requirements

- Reuse the existing `NotificationConfig` and `TelegramNotifier`
- Bot must be able to **receive** messages (currently only sends)
- Timeout: wait up to N minutes for 2FA code, then fail gracefully
- Support multiple banks needing 2FA in sequence
- Security: validate that the reply comes from the correct chat ID

---

## Notes

- This task depends on Task 03 (Telegram notifications) being complete
- The `israeli-bank-scrapers` library has callback support for 2FA
- Requires Telegram bot polling or webhook to receive replies
- Consider security implications: 2FA codes are sensitive
