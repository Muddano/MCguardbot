import { db, now } from '../core/db.js';
import { getSettings, touchChat } from '../core/settings.js';
import { moderateMessage } from '../core/moderation.js';
import { handleNewMembers, handleLeft, handleMyChatMember } from '../core/joins.js';
import { checkSubscription, markVerified, enforceGate } from '../core/gate.js';
import { handleCommand } from '../handlers/commands.js';
import { handleCallback } from '../handlers/callbacks.js';
import { handlePrivate } from '../telegram/private.js';
import { tg } from '../telegram/api.js';
import { isDuplicateUpdate } from '../core/state.js';
import { t } from '../core/i18n.js';

async function rememberMessage(message) {
  if (!message?.from || !message?.message_id) return;
  await db().run(
    `INSERT INTO messages (chat_id, message_id, user_id, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id, message_id) DO NOTHING`,
    [String(message.chat.id), message.message_id, String(message.from.id), now()],
  ).catch(() => {});
  const u = message.from;
  await db().run(
    `INSERT INTO members (chat_id, user_id, username, first_name, lang, joined_at, is_member)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = CASE WHEN excluded.username = '' THEN members.username ELSE excluded.username END,
       first_name = CASE WHEN excluded.first_name = '' THEN members.first_name ELSE excluded.first_name END,
       lang = CASE WHEN excluded.lang = '' THEN members.lang ELSE excluded.lang END,
       is_member = 1`,
    [String(message.chat.id), String(u.id), u.username ?? '', u.first_name ?? '', u.language_code ?? '', now()],
  ).catch(() => {});
}

async function handleJoinRequest(update) {
  const req = update.chat_join_request;
  const chatId = req.chat.id;
  const user = req.from;
  const settings = await getSettings(chatId);
  if (!settings.enabled) return;

  if (settings.subscriptions?.on) {
    const res = await checkSubscription(chatId, user.id, settings.subscriptions.channels ?? []);
    if (!res.ok) {
      await tg.declineJoinRequest(chatId, user.id).catch(() => {});
      await tg
        .sendMessage(user.id, `${t(settings.lang, 'need_channel', { title: (settings.subscriptions.channels ?? []).map((c) => c.username ? `@${c.username}` : c.title).join(', ') })}`)
        .catch(() => {});
      return;
    }
  }
  await tg.approveJoinRequest(chatId, user.id).catch(() => {});
  await db().run(
    `INSERT INTO members (chat_id, user_id, username, first_name, joined_at, is_member, captcha_done)
     VALUES (?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET is_member = 1, captcha_done = 1`,
    [String(chatId), String(user.id), user.username ?? '', user.first_name ?? '', now()],
  );
  if (settings.captcha?.on) await enforceGate(chatId, user, settings);
  if (settings.welcome?.on) {
    await tg.sendMessage(chatId, `${t(settings.lang, 'welcome', { user: `<a href="tg://user?id=${user.id}">${user.first_name ?? ''}</a>` })}`).catch(() => {});
  }
  void markVerified;
}

/** Single entry point for both webhook POST bodies and long-polling updates. */
export async function handleUpdate(update) {
  if (update.update_id && isDuplicateUpdate(update.update_id)) return { skipped: 'duplicate' };
  const message = update.message ?? update.edited_message;

  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return { handled: 'callback' };
  }

  if (update.my_chat_member) {
    await handleMyChatMember(update);
    return { handled: 'my_chat_member' };
  }

  if (update.chat_join_request) {
    await handleJoinRequest(update);
    return { handled: 'join_request' };
  }

  if (!message) return { skipped: 'unsupported' };

  await touchChat(message.chat.id, { title: message.chat.title ?? '', type: message.chat.type }).catch(() => {});

  if (message.chat.type === 'private') {
    await handlePrivate(message);
    return { handled: 'private' };
  }

  await rememberMessage(message);

  if (message.new_chat_members?.length) {
    await handleNewMembers(message);
    return { handled: 'joins' };
  }
  if (message.left_chat_member) {
    await handleLeft(message);
    return { handled: 'left' };
  }

  if (message.text && /^[/!][a-zA-Z]/.test(message.text)) {
    const handled = await handleCommand(message).catch((err) => {
      console.error('command failed', err?.message);
      return false;
    });
    if (handled) return { handled: 'command' };
  }

  const result = await moderateMessage(message, { edited: Boolean(update.edited_message) }).catch((err) => {
    console.error('moderate failed', err?.message);
    return null;
  });
  return { handled: 'message', result };
}
