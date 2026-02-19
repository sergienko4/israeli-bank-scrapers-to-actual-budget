# Task 03: Add Notification Support (Telegram + Extensible)

**Priority:** 🟡 MEDIUM
**Effort:** 4-5 hours
**Status:** ✅ DONE

---

## 🎯 Goal

Add notification service to send alerts on import success/failure. Start with Telegram support, designed to easily add more channels (Discord, Slack, Email, etc.).

---

## 📝 Requirements

- Support Telegram notifications
- Extensible architecture for future channels
- Send on import completion (success/failure summary)
- Send on critical errors
- Optional per-bank notifications
- Don't fail imports if notification fails
- Configuration via config.json

---

## 📦 Dependencies

**Zero external dependencies** - uses native Node.js 22+ `fetch()` API directly.
Original spec planned `node-telegram-bot-api` but native fetch is better (0 vulnerabilities, smaller image).

---

## 🗂️ Files Created

```
src/services/NotificationService.ts       # Orchestrator
src/services/notifications/
├── INotifier.ts                          # Interface (Open/Closed Principle)
└── TelegramNotifier.ts                   # Telegram via native fetch()
tests/services/NotificationService.test.ts
tests/services/notifications/TelegramNotifier.test.ts
```

---

## 📋 Implementation Steps

See full implementation in task file.

**Key Features:**
- Telegram bot integration
- Success/failure notifications
- Import summary with metrics
- Error alerts
- Extensible for Discord, Slack, Email

---

## 🧪 Testing

1. Create Telegram bot via @BotFather
2. Get chat ID
3. Add to config.json
4. Run import
5. Receive notification

---

## ✅ Acceptance Criteria

- [ ] Telegram notifications work
- [ ] Success notifications sent
- [ ] Failure notifications sent
- [ ] Notifications don't break imports
- [ ] config.json.example updated
- [ ] README documented
- [ ] Extensible architecture

---

## 🚀 Future Enhancements

- Discord webhook
- Slack webhook
- Email via SMTP
- SMS via Twilio

---

## 🔗 Related Tasks

- Task 01 (tests for notifications)
