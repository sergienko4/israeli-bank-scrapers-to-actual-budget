# Task 03: Add Notification Support (Telegram + Extensible)

**Priority:** 🟡 MEDIUM
**Effort:** 4-5 hours
**Status:** 📋 TODO

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

## 📦 Dependencies to Add

```json
{
  "dependencies": {
    "node-telegram-bot-api": "^0.66.0"
  },
  "devDependencies": {
    "@types/node-telegram-bot-api": "^0.64.0"
  }
}
```

---

## 🗂️ Files to Create

```
src/services/NotificationService.ts
src/services/notifications/
├── BaseNotifier.ts
├── TelegramNotifier.ts
├── DiscordNotifier.ts (future)
├── SlackNotifier.ts (future)
└── EmailNotifier.ts (future)
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
