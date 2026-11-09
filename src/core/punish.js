import crypto from 'node:crypto';
import { db, now } from './db.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { t, reasonLabel } from './i18n.js';
import { getSettings } from './settings.js';
import { resetFlood } from './state.js';

const id = () => crypto.randomUUID();

/** One log row per action; `via` records where it was triggered from (panel, command, rule). */
function detailOf(base, via) {
  return [base, via].filter(Boolean).join(' · ');
}

export function userMention(user) {
  const name = escapeHtml(user?.first_name || user?.username || 'user');
  if (!user?.id) return name;
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

export function formatDuration(seconds, lang = 'uz') {
  if (!seconds || seconds <= 0) return t(lang, 'until_permanent');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}${t(lang, 'time_days')}`);
  if (h) parts.push(`${h}${t(lang, 'time_hours')}`);
  if (m) parts.push(`${m}${t(lang, 'time_minutes')}`);
  if (!parts.length) parts.push(`${seconds}s`);
  return t(lang, 'until_for', { time: parts.join(' ') });
}

export async function activeWarnCount(chatId, userId) {
  const resetSeconds = (await secondsToReset(chatId)) * 1000;
  const since = Math.floor((Date.now() - resetSeconds) / 1000);
  const row = await db().get(
    'SELECT COUNT(*) AS n FROM warns WHERE chat_id = ? AND user_id = ? AND active = 1 AND created_at >= ?',
    [String(chatId), String(userId), since],
  );
  return Number(row?.n ?? 0);
}

async function secondsToReset(chatId) {
  const s = await getSettings(chatId);
  return Math.max(0, (s.warns?.resetDays ?? 30) * 86400);
}

export async function logAction(chatId, action, userId, byId, reason, detail = '') {
  await db().run(
    `INSERT INTO logs (id, chat_id, action, user_id, by_id, reason, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id(), String(chatId), action, String(userId ?? ''), String(byId ?? ''), reason ?? '', detail, now()],
  );
  const settings = await getSettings(chatId);
  const channelId = settings.logs?.channelId;
  if (settings.logs?.on && channelId) {
    const line = `⚖️ <b>${action}</b>\n👤 ${userId ?? '-'}\n📄 ${escapeHtml(reason || '-')}\n🕒 ${new Date().toISOString()}`;
    await tg.sendMessage(channelId, line).catch(() => {});
  }
}

export async function warn(chatId, user, { reason = '', by = null, silent = false, deleteMessage = false, messageId = null, via = '' } = {}) {
  const settings = await getSettings(chatId);
  const lang = settings.lang;
  const weight = 1;
  await db().run(
    'INSERT INTO warns (id, chat_id, user_id, reason, added_by, created_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
    [id(), String(chatId), String(user.id), reason, String(by?.id ?? 'bot'), now()],
  );
  const total = await activeWarnCount(chatId, user.id);
  const limit = settings.warns?.limit ?? 3;

  if (deleteMessage && messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});

  if (total >= limit) {
    const res = await ban(chatId, user, {
      reason: reason || reasonLabel(lang, 'profanity'),
      by,
      seconds: settings.warns?.banSeconds ?? 0,
      silent: true,
      via,
    });
    if (!silent) {
      await tg
        .sendMessage(chatId, t(lang, 'warned', { user: userMention(user), now: total, limit, reason }) +
          '\n' + t(lang, 'ban_limit', { user: userMention(user), until: formatDuration(settings.warns?.banSeconds, lang) }))
        .catch(() => {});
    }
    return { warned: total, limit, banned: true, result: res };
  }

  if (!silent) {
    await tg
      .sendMessage(chatId, t(lang, 'warned', { user: userMention(user), now: total, limit, reason }))
      .catch(() => {});
  }
  await logAction(chatId, 'warn', user.id, by?.id, reason, detailOf(`${total}/${limit}`, via));
  return { warned: total, limit, banned: false };
}

export async function clearWarns(chatId, userId) {
  await db().run('UPDATE warns SET active = 0 WHERE chat_id = ? AND user_id = ?', [String(chatId), String(userId)]);
}

export async function ban(chatId, user, { reason = '', by = null, seconds = 0, silent = false, revoke = true, via = '' } = {}) {
  const settings = await getSettings(chatId);
  const lang = settings.lang;
  const until = seconds > 0 ? now() + seconds : 0;
  await tg.ban(chatId, user.id, { untilDate: until || undefined, revoke }).catch(async (err) => {
    if (String(err.message).includes('BOT_ADMIN_PROMOTE')) return;
    throw err;
  });
  await db().run(
    `INSERT INTO punishments (id, chat_id, user_id, kind, reason, until_ts, by_id, created_at, active)
     VALUES (?, ?, ?, 'ban', ?, ?, ?, ?, 1)`,
    [id(), String(chatId), String(user.id), reason, until, String(by?.id ?? 'bot'), now()],
  );
  await clearWarns(chatId, user.id);
  if (!silent) {
    await tg
      .sendMessage(chatId, t(lang, 'banned', {
        user: userMention(user),
        until: formatDuration(seconds, lang),
        reason: reason || t(lang, 'ban_reason_default'),
      }))
      .catch(() => {});
  }
  await logAction(chatId, 'ban', user.id, by?.id, reason, detailOf(seconds ? `${seconds}s` : 'permanent', via));
  return { kind: 'ban', until };
}

export async function unban(chatId, user, { by = null, silent = false, via = '' } = {}) {
  await tg.unban(chatId, user.id).catch(() => {});
  await db().run(
    `UPDATE punishments SET active = 0 WHERE chat_id = ? AND user_id = ? AND kind = 'ban' AND active = 1`,
    [String(chatId), String(user.id)],
  );
  const settings = await getSettings(chatId);
  if (!silent) {
    await tg.sendMessage(chatId, t(settings.lang, 'unbanned', { user: userMention(user) })).catch(() => {});
  }
  await logAction(chatId, 'unban', user.id, by?.id, '', detailOf('', via));
}

export async function kick(chatId, user, { reason = '', by = null, silent = false, via = '' } = {}) {
  await tg.kick(chatId, user.id).catch(() => {});
  await db().run(
    `INSERT INTO punishments (id, chat_id, user_id, kind, reason, until_ts, by_id, created_at, active)
     VALUES (?, ?, ?, 'kick', ?, ?, ?, ?, 1)`,
    [id(), String(chatId), String(user.id), reason, now() + 30, String(by?.id ?? 'bot'), now()],
  );
  const settings = await getSettings(chatId);
  if (!silent) {
    await tg.sendMessage(chatId, t(settings.lang, 'kicked', { user: userMention(user) })).catch(() => {});
  }
  await logAction(chatId, 'kick', user.id, by?.id, reason, detailOf('', via));
}

export async function mute(chatId, user, seconds, { reason = '', by = null, silent = false, via = '' } = {}) {
  const settings = await getSettings(chatId);
  await tg.restrict(chatId, user.id, seconds, { untilDate: seconds > 0 ? now() + seconds : undefined });
  await db().run(
    `INSERT INTO punishments (id, chat_id, user_id, kind, reason, until_ts, by_id, created_at, active)
     VALUES (?, ?, ?, 'mute', ?, ?, ?, ?, 1)`,
    [id(), String(chatId), String(user.id), reason, now() + (seconds || 0), String(by?.id ?? 'bot'), now()],
  );
  resetFlood(chatId, user.id);
  if (!silent) {
    await tg
      .sendMessage(chatId, t(settings.lang, 'muted', {
        user: userMention(user),
        time: formatDuration(seconds, settings.lang),
      }))
      .catch(() => {});
  }
  await logAction(chatId, 'mute', user.id, by?.id, reason, detailOf(`${seconds}s`, via));
}

export async function unmute(chatId, user, { by = null, silent = false, via = '' } = {}) {
  await tg.unrestrict(chatId, user.id).catch(() => {});
  await db().run(
    `UPDATE punishments SET active = 0 WHERE chat_id = ? AND user_id = ? AND kind = 'mute' AND active = 1`,
    [String(chatId), String(user.id)],
  );
  const settings = await getSettings(chatId);
  if (!silent) {
    await tg.sendMessage(chatId, t(settings.lang, 'unmuted', { user: userMention(user) })).catch(() => {});
  }
  await logAction(chatId, 'unmute', user.id, by?.id, '', detailOf('', via));
}

/** Applies a configured rule action to a message author. */
export async function applyAction(chatId, user, rule, { reason = '', by = null, messageId = null, extraSeconds = null, via = '' } = {}) {
  const seconds = extraSeconds ?? rule.muteSeconds ?? 0;
  switch (rule.action) {
    case 'none':
      if (rule.delete && messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});
      return { action: 'none' };
    case 'delete':
      if (messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});
      await logAction(chatId, 'delete', user.id, by?.id ?? '', reason, detailOf(String(messageId ?? ''), via));
      return { action: 'delete' };
    case 'mute':
      if (messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});
      await mute(chatId, user, seconds, { reason, by, silent: true, via });
      return { action: 'mute', seconds };
    case 'kick':
      if (messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});
      await kick(chatId, user, { reason, by, via });
      return { action: 'kick' };
    case 'ban':
      if (messageId) await tg.deleteMessage(chatId, messageId).catch(() => {});
      await ban(chatId, user, { reason, by, seconds: rule.banSeconds ?? 0, via });
      return { action: 'ban' };
    case 'warn':
    default:
      return {
        ...(await warn(chatId, user, {
          reason,
          by,
          deleteMessage: false,
          messageId,
          via,
        })),
        action: 'warn',
      };
  }
}
