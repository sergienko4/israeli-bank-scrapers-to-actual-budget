# SMS OTP to Telegram — Setup Guide

Automatically forward bank OTP codes from your phone to Telegram so your bank scraper can read them without manual input.

## What it does

```text
Bank sends SMS with OTP code to your phone
        ↓
Your phone detects the SMS automatically
        ↓
Extracts the numeric code (e.g. 848156)
        ↓
Replies to the Telegram bot notification with the code
        ↓
Your bank scraper reads the code automatically
```

## Important: How Telegram OTP forwarding works

The bot **cannot read messages from other bots** — only from you (the user). So the phone must send the OTP code **as you** by replying to the bot's Telegram notification. This is why we use MacroDroid's **Notification Reply** action instead of the HTTP/Bot API approach.

**Requirements for Notification Reply to work:**

- The Telegram bot must send a notification asking for OTP (this creates a reply-able notification)
- The SMS must arrive while the notification is still active
- MacroDroid must have Notification Access permission
- Telegram must NOT be open in the foreground (notifications don't appear when the chat is open)

---

## Android Setup (MacroDroid)

### Prerequisites

- Android phone (tested on Samsung Galaxy S24)
- MacroDroid app (free from Google Play Store)
- An Israeli bank importer bot configured with `twoFactorAuth: true`

### Step 1: Install MacroDroid

1. Open **Google Play Store**
2. Search for **MacroDroid**
3. Install it (free — up to 5 macros)
4. Open the app

### Step 2: Grant Permissions

When prompted, allow:

- **SMS** — Read & Receive
- **Notification access**: Settings → Apps → Special access → Notification access → enable MacroDroid
- **Accessibility**: Settings → Accessibility → Installed Apps → MacroDroid → enable

### Step 3: Create New Macro

1. Tap the **+** button (Add Macro)
2. Name it: `SMS Code Copier`

### Step 4: Add Trigger

1. Tap **Triggers** → **+**
2. Select **Phone/SMS** → **SMS Received**
3. Select **Any Number**
4. Content matching: select **Contains**
5. Enable **Regex**
6. Enter: `\d{5,6}` (matches any 5-6 digit number)
7. Tap **OK**

### Step 5: Add Actions

#### Action 1 — Set Variable (capture SMS text)

1. Tap **Actions** → **+**
2. Select **Variables** → **Set Variable**
3. Variable name: `sms`
4. Value: `[sms_message]` (tap magic wand → SMS → SMS Message Body)
5. Tap **OK**

#### Action 2 — Wait 50ms

1. Tap **Actions** → **+**
2. Select **Conditions/Loops** → **Wait**
3. Set: **50 milliseconds**
4. Tap **OK**

#### Action 3 — Extract Text (extract OTP code)

1. Tap **Actions** → **+**
2. Select **Variables** → **Extract Text**
3. Source: `[lv=sms]`
4. Pattern/Regex: `\d{4,10}` (matches 4-10 digit codes)
5. Save result to variable: `numbers`
6. Tap **OK**

#### Action 4 — Wait 50ms

1. Tap **Actions** → **+**
2. Select **Conditions/Loops** → **Wait**
3. Set: **50 milliseconds**
4. Tap **OK**

#### Action 5 — Copy to Clipboard

1. Tap **Actions** → **+**
2. Select **Device Actions** → **Fill Clipboard**
3. Text: `[lv=numbers]`
4. Tap **OK**

#### Action 6 — Wait 50ms

1. Tap **Actions** → **+**
2. Select **Conditions/Loops** → **Wait**
3. Set: **50 milliseconds**
4. Enable **Use alarm** (keeps running even if phone sleeps)
5. Tap **OK**

#### Action 7 — Show Popup (optional, for visual confirmation)

1. Tap **Actions** → **+**
2. Select **Device Actions** → **Popup Message**
3. Text: `Code Copied: [lv=numbers]`
4. Tap **OK**

#### Action 8 — Clear SMS Notification

Clears the bank SMS notification matching the OTP code (within last 60 seconds).

1. Tap **Actions** → **+**
2. Select **Device Actions** → **Clear Notifications**
3. **Select application**: **Messages** (your SMS app)
4. **Match text**: `{lv=numbers}`
5. **Enable Regex**: Yes
6. **Age**: 60 seconds
7. Tap **OK**

#### Action 9 — Notification Reply (send OTP to Telegram)

This is the key action — it replies to the Telegram notification as YOU (the user), not as a bot.

1. Tap **Actions** → **+**
2. Select **Notification Reply**
3. Configure:
   - **Application**: **Telegram**
   - **Reply text**: `{lv=numbers}`
4. Tap **OK**

> **Note:** Telegram must appear in the app list. If it doesn't, make sure you have an active Telegram notification in your notification bar, then try again.
>
> **Important:** The Notification Reply action uses `{lv=numbers}` (curly braces), not `[lv=numbers]` (square brackets). This is different from other MacroDroid actions.

#### Action 10 — Wait 50ms

1. Tap **Actions** → **+**
2. Select **Conditions/Loops** → **Wait**
3. Set: **50 milliseconds**
4. Enable **Use alarm**
5. Tap **OK**

#### Action 11 — Clear Telegram OTP Notification

Clears the bot's "Enter OTP code" notification after the code has been sent.

1. Tap **Actions** → **+**
2. Select **Device Actions** → **Clear Notifications**
3. **Select application**: **Telegram**
4. **Match text**: `🔐 Enter OTP code for`
5. **Age**: 1 second
6. Tap **OK**

### Step 6: Save and Enable

1. Tap the **checkmark** (top right) to save
2. Make sure the macro toggle is **ON**
3. You should see a persistent notification: "MacroDroid is running"

### Step 7: Prevent Android from Killing the App

This is critical — without these settings, your phone will kill MacroDroid in the background.

**Samsung Galaxy (One UI):**

1. Settings → Apps → MacroDroid → Battery → select **Unrestricted**
2. Settings → Device Care → Battery → Background usage limits → make sure MacroDroid is NOT in the sleeping or deep sleeping list
3. Open Recent Apps → find MacroDroid → tap the **lock icon** to pin it

**Xiaomi (MIUI):**

1. Security app → Permissions → Autostart → enable MacroDroid
2. Settings → Battery → App Battery Saver → MacroDroid → **No restrictions**
3. Disable **Verification Code Protection**: Settings → Passwords & Security → Privacy

**Huawei (EMUI):**

1. Settings → Battery → App Launch → MacroDroid → set to **Manual** → enable all toggles
2. Settings → Security → disable verification code protection

### Step 8: Test

> **Important:** The "Test Macro" button will NOT work — it doesn't have real SMS data. Only real incoming SMS triggers correctly.

**End-to-end test:**

1. Make sure **Telegram is NOT open** (minimize it / press Home)
2. Trigger an import from Telegram: send `/scan oneZero` to the bot
3. Wait for the bot to send "Waiting for OTP code..." — this creates a notification on your phone
4. **Do NOT dismiss the notification**
5. The bank sends SMS with OTP code
6. MacroDroid extracts the code → clears SMS notification → replies to the Telegram notification → clears OTP notification
7. The importer reads the code and completes the import

**Verify:**

- Check your Telegram chat — you should see the OTP code as a message **from you** (not from the bot)
- The importer should show "OTP received" in the logs

### Android Action Flow

```text
SMS Received containing 5-6 digits (trigger)
    ↓
[1] Set Variable      →  sms = full SMS text
    ↓
[2] Wait 50ms
    ↓
[3] Extract Text      →  numbers = OTP code (4-10 digits)
    ↓
[4] Wait 50ms
    ↓
[5] Fill Clipboard    →  copies OTP to clipboard
    ↓
[6] Wait 50ms
    ↓
[7] Popup Message     →  shows "Code Copied: 848156"
    ↓
[8] Clear SMS Notif   →  removes bank SMS notification
    ↓
[9] Notification Reply → sends OTP to Telegram AS YOU
    ↓
[10] Wait 50ms
    ↓
[11] Clear Telegram   →  removes "Enter OTP code" notification
```

### Android Troubleshooting

| Problem | Solution |
|---------|----------|
| SMS not detected | Check SMS permissions: Settings → Apps → MacroDroid → Permissions → SMS |
| Code not extracted | The SMS may not contain a 5-6 digit number, or the regex doesn't match |
| Notification Reply doesn't send | Make sure Telegram notification is visible (not dismissed). Telegram must NOT be open in foreground |
| Reply sends wrong text | Check variable syntax: use `[lv=numbers]` or `{lv=numbers}` depending on MacroDroid version |
| App killed after hours | Disable battery optimization + lock in recents (see Step 7) |
| Test button doesn't work | Normal — only real SMS triggers work, not the test button |
| Amex marketing SMS triggers macro | The regex `\d{5,6}` may match phone numbers in ads. Consider filtering by sender |
| Xiaomi blocks OTP reading | Disable "Verification Code Protection" in Settings → Security |
| Telegram notification has no Reply button | Enable Direct Reply: Settings → Notifications → Advanced → Direct reply |

---

## iPhone Setup (iOS Shortcuts)

No jailbreak or third-party apps needed. Uses the built-in Shortcuts app.

> **Note:** On iPhone, Shortcuts sends the full SMS text (not just the extracted code). The importer must be able to parse the code from the full message.

### Prerequisites

- iOS 18 or later (required for "Run Immediately" on message triggers)
- Shortcuts app (built-in, pre-installed)
- Telegram bot token and chat ID

### Step 1: Open Shortcuts App

1. Open the **Shortcuts** app on your iPhone
2. Tap the **Automation** tab at the bottom

### Step 2: Create New Automation

1. Tap the **+** button (top right)
2. Select **Message** from the list of triggers

### Step 3: Configure the Trigger

1. **Sender**: leave empty (catches SMS from any sender)
2. **Message Contains**: tap and enter `קוד`
   - This filters for Hebrew OTP messages containing "code"
   - Alternatively, leave a blank space to forward ALL SMS
3. Tap **Next**

### Step 4: Set to Run Immediately

This is the most important step — it makes the automation fully automatic.

1. Select **"Run Immediately"**
2. Toggle OFF **"Notify When Run"** (optional — disables the notification banner)
3. Tap **Next**

> Without "Run Immediately", iOS will show a notification that you must tap to confirm — defeating the purpose of automation.

### Step 5: Create the Action

1. Select **"New Blank Automation"**
2. Tap **"Add Action"**
3. Search for **"Get Contents of URL"**
4. Tap to add it

### Step 6: Configure the HTTP Request

1. Tap the **URL** field and enter:

   ```text
   https://api.telegram.org/bot<BOT_TOKEN>/sendMessage
   ```

2. Tap **"Show More"** to expand options

3. Set **Method**: `POST`

4. Set **Headers**:
   - Tap **"Add New Header"**
   - Key: `Content-Type`
   - Value: `application/x-www-form-urlencoded`

5. Set **Request Body**: select **"Form"**

6. Add form fields:
   - Tap **"Add New Field"** → Key: `chat_id` → Value: `<CHAT_ID>`
   - Tap **"Add New Field"** → Key: `text` → tap here, then tap **"Shortcut Input"** from the variable suggestions above the keyboard (this inserts the SMS message body)

> Replace `<BOT_TOKEN>` and `<CHAT_ID>` with your actual values.

> **Note:** On iPhone, the message is sent via Bot API (as the bot, not as you). This only works if the importer is configured to read bot messages in a **group chat**. See the "iPhone Limitation" section below.

### Step 7: Save

1. Tap **"Done"** (top right)
2. The automation should appear in your Automation list
3. Verify it shows **"When I receive a message..."** with **"Runs Immediately"**

### Step 8: Test

1. Send yourself an SMS from another phone containing the word `קוד` and a number:

   ```text
   קוד האימות שלך: 123456
   ```

2. Check your Telegram — the full SMS text should appear in your chat

### iPhone: Extract Just the OTP Code (Advanced)

If you want to send only the 6-digit code instead of the full SMS:

1. Before the HTTP request, add action: **"Match Text"**
   - Input: **Shortcut Input**
   - Pattern: `\d{5,6}`
2. In the HTTP request, for the `text` field value:
   - Use **"Matches"** (output from Match Text) instead of **"Shortcut Input"**

### iPhone Action Flow

```text
SMS Received containing "קוד" (trigger)
    ↓
    Runs Immediately (no user interaction)
    ↓
    [1] Get Contents of URL  →  POST to Telegram Bot
```

### iPhone Limitation

On iPhone, the message is sent via **Bot API** (as the bot), not as you. Telegram bots cannot read messages from other bots in private chats. To work around this:

1. Create a **Telegram group**
2. Add the importer bot to the group
3. Disable bot privacy mode via @BotFather (`/setprivacy` → Disable)
4. Use the **group chat ID** in the HTTP request

> **Note:** Even with this workaround, bots cannot see messages from other bots in groups. The iPhone Bot API approach may not work for OTP forwarding. The **Android Notification Reply method is the only confirmed working solution** for fully automatic OTP forwarding.

### iPhone Troubleshooting

| Problem | Solution |
|---------|----------|
| Automation asks for confirmation tap | Make sure "Run Immediately" is selected (Step 4). Requires iOS 18+ |
| Nothing happens when SMS arrives | Check that the trigger keyword matches. Try blank space instead of `קוד` |
| HTTP error in Shortcuts | Verify bot token and chat ID. Test the URL in Safari |
| "Shortcut Input" not available | Only appears inside a Message automation trigger |
| Automation doesn't run when locked | Should work on iOS 18+. Check Shortcuts has permissions |
| Hebrew text garbled in Telegram | HTTP POST with form encoding handles UTF-8 correctly |

---

## Platform Comparison

| Feature | Android (MacroDroid) | iPhone (iOS Shortcuts) |
|---------|---------------------|----------------------|
| Fully automatic OTP | **Yes** (Notification Reply) | Limited (Bot API only) |
| Sends as user | **Yes** | No (sends as bot) |
| No third-party app needed | No (Play Store) | Yes (built-in) |
| Background running | Yes (with battery settings) | Yes |
| Filter by content | Yes | Yes |
| Extract OTP code only | Yes (Extract Text) | Yes (Match Text) |
| Cost | Free | Free |
| Clipboard copy | Yes | No (add extra action) |

---

## Security Notes

- On Android, MacroDroid uses Notification Reply which goes through Telegram's notification system — the message is sent as you, encrypted in transit
- OTP codes expire in 2-5 minutes so even if intercepted, they're useless quickly
- Use a dedicated Telegram bot for OTP forwarding only
- MacroDroid requires SMS read permissions — use only trusted apps (MacroDroid has millions of Play Store downloads)
- iOS Shortcuts is Apple's built-in automation tool — maximum trust
- Neither method sends data through third-party servers
