import { getSettings } from './settings.js';
import { touchChat } from './settings.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { t } from './i18n.js';
import { ban, kick, mute, warn, userMention, logAction } from './punish.js';
import { isLocked } from './rules.js';
import { enforceGate } from './gate.js';
import { db, now } from './db.js';
import { noteJoin, raidActive, startRaid } from './state.js';

function fill(template, vars) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

async function rememberMember(chatId, user) {
  await db().run(
    `INSERT INTO members (chat_id, user_id, username, first_name, joined_at, is_member, captcha_done)
     VALUES (?, ?, ?, ?, ?, 1, 0)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       username = excluded.username, first_name = excluded.first_name,
       joined_at = excluded.joined_at, is_member = 1`,
    [String(chatId), String(user.id), user.username ?? '', user.first_name ?? '', now()],
  );
}

async function markLeft(chatId, user) {
  await db().run(
    `UPDATE members SET is_member = 0, left_at = ? WHERE chat_id = ? AND user_id = ?`,
    [now(), String(chatId), String(user.id)],
  );
}

async function lookalikeOf(chatId, user) {
  try {
    const admins = await tg.call('getChatAdministrators', { chat_id: Number(chatId) });
    const needle = String(user.first_name ?? '').toLowerCase().trim();
    if (needle.length < 3) return null;
    for (const a of admins) {
      const names = [a.user.first_name, a.user.username].filter(Boolean).map((n) => String(n).toLowerCase().trim());
      if (names.some((n) => n.length > 2 && needle.includes(n) && String(a.user.id) !== String(user.id))) {
        return names.find((n) => needle.includes(n));
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function handleNewMembers(message) {
  const chatId = message.chat.id;
  const settings = await getSettings(chatId);
  if (!settings.enabled) return;

  const joinsInMinute = noteJoin(chatId);
  if (settings.raid?.on && joinsInMinute > (settings.raid.joinsPerMinute ?? 8)) {
    startRaid(chatId, settings.raid.quietSeconds ?? 180);
    await tg.sendMessage(chatId, t(settings.lang, 'raid_on')).catch(() => {});
    await logAction(chatId, 'raid', '', '', `${joinsInMinute}/min`, '');
  }

  for (const user of message.new_chat_members ?? []) {
    if (user.is_bot && String(user.username ?? '').toLowerCase() === 'mcguarduzbot') continue;
    await rememberMember(chatId, user);

    const locked = await isLocked(chatId, user.id);
    if (locked !== null) {
      await ban(chatId, user, { reason: `${t(settings.lang, 'locked', { user: '', reason: locked })}`, silent: true });
      await tg.sendMessage(chatId, t(settings.lang, 'locked', { user: userMention(user), reason: locked })).catch(() => {});
      continue;
    }

    if (settings.bots?.on && user.is_bot) {
      if (settings.bots.action === 'ban') await ban(chatId, user, { reason: t(settings.lang, 'filters.bot'), silent: true });
      else await kick(chatId, user, { reason: t(settings.lang, 'filters.bot') });
      continue;
    }

    if (settings.usernameCheck?.on && settings.usernameCheck.deleteFake && !user.username) {
      await kick(chatId, user, { reason: t(settings.lang, 'filters.username') });
      continue;
    }

    if (settings.usernameCheck?.removeAdminLookalikes) {
      const hit = await lookalikeOf(chatId, user);
      if (hit) {
        await ban(chatId, user, { reason: `admin lookalike: ${hit}`, silent: true });
        continue;
      }
    }

    if (settings.warngate?.on) {
      await warn(chatId, user, { reason: t(settings.lang, 'filters.warngate'), silent: true });
    }

    if (raidActive(chatId)) {
      await mute(chatId, user, 3600, { reason: 'raid', silent: true });
    } else if (settings.quarantine?.on) {
      await mute(chatId, user, (settings.quarantine.minutes ?? 30) * 60, { reason: 'quarantine', silent: true });
      await tg.sendMessage(chatId, t(settings.lang, 'quarantined', { user: userMention(user) })).catch(() => {});
    }

    const gate = await enforceGate(chatId, user, settings);

    if (settings.welcome?.on && !gate.blocked) {
      const count = await tg.getChatMemberCount(chatId).catch(() => 0);
      const text = fill(settings.welcome.text, {
        user: userMention(user),
        first: escapeHtml(user.first_name ?? ''),
        id: String(user.id),
        group: escapeHtml(message.chat.title ?? ''),
        count: String(count || ''),
        rules: settings.rules?.text ? '/rules' : '',
      });
      const sent = await tg.sendMessage(chatId, text).catch(() => null);
      if (sent && settings.welcome.deleteAfterSeconds > 0) {
        setTimeout(() => tg.deleteMessage(chatId, sent.message_id).catch(() => {}), settings.welcome.deleteAfterSeconds * 1000);
      }
    }
  }

  if (settings.clean?.serviceMessages) {
    await tg.deleteMessage(chatId, message.message_id).catch(() => {});
  }
}

export async function handleLeft(message) {
  const chatId = message.chat.id;
  const settings = await getSettings(chatId);
  const user = message.left_chat_member;
  if (!user) return;
  await markLeft(chatId, user);
  if (settings.goodbye?.on) {
    await tg.sendMessage(chatId, fill(settings.goodbye.text, { user: userMention(user) })).catch(() => {});
  }
  if (settings.clean?.serviceMessages) {
    await tg.deleteMessage(chatId, message.message_id).catch(() => {});
  }
}

/** Bot was added, promoted, demoted or removed. */
export async function handleMyChatMember(update) {
  const chat = update.my_chat_member?.chat;
  const status = update.my_chat_member?.new_chat_member?.status;
  if (!chat) return;
  if (status === 'left' || status === 'kicked') {
    await touchChat(chat.id, { title: chat.title ?? '', type: chat.type });
    return;
  }
  await touchChat(chat.id, { title: chat.title ?? '', type: chat.type });
  const by = update.my_chat_member?.from;
  if (by?.id) {
    await db().run(
      `INSERT INTO chat_admins (chat_id, user_id, perms, added_by, created_at)
       VALUES (?, ?, '{}', ?, ?)
       ON CONFLICT (chat_id, user_id) DO NOTHING`,
      [String(chat.id), String(by.id), String(by.id), now()],
    );
  }
}
