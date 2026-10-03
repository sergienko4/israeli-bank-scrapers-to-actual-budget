/**
 * TelegramOtpPoller — OTP-reply polling helper for {@link TelegramNotifier}.
 *
 * Sends an HTML prompt via the injected {@link TelegramApiClient}, then
 * long-polls `getUpdates` until a numeric OTP arrives or the deadline
 * expires. Non-OTP replies trigger a hint message and polling continues.
 * Extracted from `TelegramNotifier` (PR 5) to isolate the polling state
 * machine from the orchestrator and the HTTP client.
 *
 * Pure orchestration: no fetch I/O (delegated to client), no HTML formatting
 * other than the inline hint string, no business logic. Public surface is a
 * single default export so the notifier can
 * `import waitForOtpReply from './TelegramOtpPoller.js'`.
 */

import { TimeoutError } from '../../Errors/ErrorTypes.js';
import { getLogger } from '../../Logger/Index.js';
import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import { errorMessage, repeatWhile } from '../../Utils/Index.js';
import type TelegramApiClient from './TelegramApiClient.js';
import type { IPollResult } from './TelegramApiClient.js';
import { looksLikeOtp } from './TelegramHtml.js';

const POLL_TIMEOUT_SEC = 5;
const POLL_BACKOFF_MS = 2000;
const OTP_HINT_MESSAGE = '⚠️ Please send the numeric OTP code from your SMS (4–8 digits).';
const BACKED_OFF = succeed({ status: 'backed-off' });

interface IPollState {
  offset: number;
  sentAt: number;
  deadline: number;
  chatId: string;
}

/**
 * Sends an HTML prompt and waits for the next numeric OTP reply.
 *
 * @param client - Telegram HTTP client used for sendMessage + getUpdates.
 * @param prompt - HTML-formatted prompt text to send before polling.
 * @param timeoutMs - Maximum milliseconds to wait for a reply before throwing.
 * @returns The text content of the first valid OTP reply received after `prompt`.
 */
export default async function waitForOtpReply(
  client: TelegramApiClient, prompt: string, timeoutMs: number
): Promise<string> {
  const offset = await client.getLatestOffset();
  await client.sendHtmlMessage(prompt);
  const sentAt = Math.floor(Date.now() / 1000);
  const deadline = Date.now() + timeoutMs;
  return await pollUntilReply(client, { offset, sentAt, deadline, chatId: client.chatId });
}

/**
 * Polls `getUpdates` in a loop until an OTP is found or the deadline expires.
 *
 * @param client - Telegram HTTP client.
 * @param state - Mutable poll state (offset/sentAt/deadline/chatId).
 * @returns The OTP text from the first valid reply.
 * @throws TimeoutError when the deadline expires without an OTP.
 */
async function pollUntilReply(
  client: TelegramApiClient, state: IPollState
): Promise<string> {
  const replies = repeatWhile(
    () => Date.now() < state.deadline, () => processOneReplyPoll(client, state)
  );
  for await (const reply of replies) {
    if (reply !== false) return reply;
    await waitBeforeNextPoll();
  }
  throw new TimeoutError('2FA reply wait', 0);
}

/**
 * Waits out the backoff between two reply polls.
 *
 * @returns A Procedure that resolves after POLL_BACKOFF_MS.
 */
function waitBeforeNextPoll(): Promise<Procedure<{ status: string }>> {
  return new Promise((resolve) => {
    globalThis.setTimeout(() => { resolve(BACKED_OFF); }, POLL_BACKOFF_MS);
  });
}

/**
 * Performs one getUpdates call, handles non-OTP replies with a hint, and
 * confirms the offset once a valid OTP is found.
 *
 * @param client - Telegram HTTP client.
 * @param state - Mutable poll state; `state.offset` is updated in place.
 * @returns OTP text when a valid reply is found, else `false`.
 */
async function processOneReplyPoll(
  client: TelegramApiClient, state: IPollState
): Promise<string | false> {
  try {
    const poll = await client.getUpdates(state.offset, POLL_TIMEOUT_SEC);
    if (!poll.success) return false;
    state.offset = poll.data.nextOffset;
    const reply = findReplyMessage(poll.data.updates, state.sentAt, state.chatId);
    if (reply === false) return false;
    if (!looksLikeOtp(reply)) {
      await client.sendHtmlMessage(OTP_HINT_MESSAGE);
      return false;
    }
    await client.confirmOffset(state.offset);
    return reply;
  } catch (error: unknown) {
    getLogger().error(`waitForReply poll error: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Walks the updates payload looking for the first non-command text message
 * from the configured chat, sent after `sentAt`.
 *
 * @param updates - Telegram API response body from getUpdates.
 * @param sentAt - Unix-second timestamp before which messages are ignored.
 * @param chatId - Expected chat id; messages from other chats are skipped.
 * @returns The reply text when a valid message is found, else `false`.
 */
function findReplyMessage(
  updates: IPollResult['updates'], sentAt: number, chatId: string
): string | false {
  for (const update of updates.result ?? []) {
    const message = update.message;
    if (!message?.text || String(message.chat.id) !== chatId) continue;
    if (message.date < sentAt || message.text.startsWith('/')) continue;
    return message.text;
  }
  return false;
}
