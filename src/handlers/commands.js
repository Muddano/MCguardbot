import crypto from 'node:crypto';
import { getSettings, patchSettings, touchChat } from '../core/settings.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { t, reasonLabel } from '../core/i18n.js';
import { ban, unban, kick, mute, unmute, warn, clearWarns, activeWarnCount, userMention, formatDuration, logAction } from '../core/punish.js';
import { addRule, listRules, removeRule, lockUser, unlockUser, listLocked } from '../core/rules.js';
import { db, now } from '../core/db.js';
import { isOwner } from '../config.js';
import { panelUrl } from '../core/links.js';

const CMD_RE = /^\/([a-zA-Z0-9_]+)(?:@MCguarduzbot)?(?:\s+([\s\S]*))?$/;

export function parseCommand(text) {
  const m = String(text ?? '').match(CMD_RE);
  if (!m) return null;
  return { cmd: m[1].toLowerCase(), args: (m[2] ?? '').trim() };
}

export function parseDuration(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  let total = 0;
  const re = /(\d+)\s*(s|sec|son|m|min|da|д|h|soat|ч|d|kun|к|w|hafta|н)/g;
  let matched = false;
  let m;
  while ((m = re.exec(raw))) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    if (/^(s|sec|son)$/.test(unit)) total += n;
    else if (/^(m|min|da|д)$/.test(unit)) total += n * 60;
    else if (/^(h|soat|ч)$/.test(unit)) total += n * 3600;
    else if (/^(d|kun|к)$/.test(unit)) total += n * 86400;
    else total += n * 604800;
  }
  return matched ? total : null;
}

async function staffStatus(chatId, userId) {
  try {
    const m = await tg.getChatMember(chatId, userId);
    return m.status;
  } catch {
    return 'left';
  }
}

export async function isModerator(message) {
  const status = await staffStatus(message.chat.id, message.from?.id ?? 0);
  if (status === 'creator' || status === 'administrator') return { ok: true, owner: status === 'creator' };
  if (isOwner(message.from?.id)) return { ok: true, owner: true };
  const row = await db().get('SELECT perms FROM chat_admins WHERE chat_id = ? AND user_id = ?', [
    String(message.chat.id),
    String(message.from?.id ?? 0),
  ]);
  if (row) return { ok: true, owner: false, panel: true };
  return { ok: false, status };
}

async function resolveTarget(message, args) {
  if (message.reply_to_message?.from) return message.reply_to_message.from;
  const arg = String(args ?? '').split(/\s+/)[0];
  if (/^\d{2,}$/.test(arg ?? '')) {
    const id = Number(arg);
    try {
      const m = await tg.getChatMember(message.chat.id, id);
      return m.user;
    } catch {
      return null;
    }
  }
  if (arg?.startsWith('@')) {
    const row = await db().get('SELECT user_id FROM members WHERE chat_id = ? AND lower(username) = ? LIMIT 1', [
      String(message.chat.id),
      arg.slice(1).toLowerCase(),
    ]);
    if (row) {
      try {
        const m = await tg.getChatMember(message.chat.id, Number(row.user_id));
        return m.user;
      } catch {
        return { id: Number(row.user_id), first_name: arg };
      }
    }
  }
  return null;
}

function reasonFrom(args, lang) {
  const parts = String(args ?? '').trim().split(/\s+/).slice(1).join(' ');
  return parts || t(lang, 'ban_reason_default');
}

async function deny(message) {
  const s = await getSettings(message.chat.id);
  return tg.sendMessage(message.chat.id, `❌ ${t(s.lang, 'not_admin')}`);
}

export async function handleCommand(message) {
  const parsed = parseCommand(message.text);
  if (!parsed) return false;
  const chatId = message.chat.id;
  if (message.chat.type === 'private') return false;

  const settings = await getSettings(chatId);
  const lang = settings.lang;
  const { cmd, args } = parsed;

  if (['help', 'start'].includes(cmd)) {
    await tg.sendMessage(
      chatId,
      `${t(lang, 'hello')}\n${t(lang, 'help_intro')}\n\n` +
        '/warn /mute /ban /kick /unban /unmute /info /rules /settings /filter /report',
    );
    return true;
  }

  if (cmd === 'rules') {
    const text = settings.rules?.text?.trim();
    return !!(await tg.sendMessage(chatId, text ? t(lang, 'rules_title') + escapeHtml(text) : t(lang, 'rules_empty')));
  }

  if (cmd === 'id' || cmd === 'info') {
    const target = (await resolveTarget(message, args)) ?? message.from;
    const warns = await activeWarnCount(chatId, target.id);
    const status = await staffStatus(chatId, target.id);
    const row = await db().get('SELECT joined_at FROM members WHERE chat_id = ? AND user_id = ?', [String(chatId), String(target.id)]);
    await tg.sendMessage(
      chatId,
      t(lang, 'info', {
        id: String(target.id),
        username: target.username ? `@${target.username}` : escapeHtml(target.first_name ?? '-'),
        joined: row?.joined_at ? new Date(row.joined_at * 1000).toISOString().slice(0, 10) : '-',
        warns: String(warns),
        state: status,
      }),
    );
    return true;
  }

  if (cmd === 'report') {
    const target = await resolveTarget(message, args);
    if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
    if (!settings.reports?.on) return true;
    const already = await db().get(
      'SELECT id FROM reports WHERE chat_id = ? AND target_user = ? AND reporter = ?',
      [String(chatId), String(target.id), String(message.from.id)],
    );
    if (already) return !!(await tg.sendMessage(chatId, t(lang, 'report_already')));
    await db().run(
      'INSERT INTO reports (id, chat_id, target_user, reporter, message_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), String(chatId), String(target.id), String(message.from.id), message.message_id, reasonFrom(args, lang), now()],
    );
    const rows = await db().all('SELECT DISTINCT reporter FROM reports WHERE chat_id = ? AND target_user = ?', [
      String(chatId),
      String(target.id),
    ]);
    const need = Math.max(1, settings.reports.threshold ?? 3) - rows.length;
    if (need > 0) {
      await tg.sendMessage(chatId, t(lang, 'report_ok', { left: String(need) }));
      return true;
    }
    if (settings.reports.action === 'delete') {
      await tg.deleteMessage(chatId, message.reply_to_message?.message_id ?? message.message_id).catch(() => {});
    }
    if (settings.reports.notifyAdmins) {
      await tg.sendMessage(chatId, `🚩 ${userMention(target)} — ${escapeHtml(reasonFrom(args, lang))}`);
    }
    await logAction(chatId, 'report', target.id, message.from.id, reasonFrom(args, lang), `${rows.length}`);
    return true;
  }

  const mod = await isModerator(message);
  if (!mod.ok) return await deny(message).then(() => true);

  switch (cmd) {
    case 'warn': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      const res = await warn(chatId, target, {
        by: message.from,
        reason: reasonFrom(args, lang),
        messageId: message.message_id,
        deleteMessage: settings.warns?.deleteWarned,
      });
      if (res.banned) await logAction(chatId, 'auto-ban', target.id, message.from.id, 'warn limit', '');
      return true;
    }
    case 'unwarn':
    case 'delwarn': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      const before = await activeWarnCount(chatId, target.id);
      if (!before) return !!(await tg.sendMessage(chatId, t(lang, 'warn_none', { user: userMention(target) })));
      await clearWarns(chatId, target.id);
      await tg.sendMessage(chatId, t(lang, 'warn_reset', { user: userMention(target) }));
      await logAction(chatId, 'unwarn', target.id, message.from.id, '', `-${before}`);
      return true;
    }
    case 'ban': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      const dur = parseDuration(args.split(/\s+/)[0]);
      await ban(chatId, target, { by: message.from, reason: reasonFrom(args, lang), seconds: dur && dur > 0 ? dur : 0 });
      return true;
    }
    case 'unban': {
      const target = await resolveTarget(message, args) ?? (args ? { id: Number(args), first_name: args } : null);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      await unban(chatId, target, { by: message.from });
      return true;
    }
    case 'kick':
    case 'remove': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      await kick(chatId, target, { by: message.from, reason: reasonFrom(args, lang) });
      return true;
    }
    case 'mute':
    case 'restrict': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      const seconds = parseDuration(args.split(/\s+/)[0]) ?? 3600;
      await mute(chatId, target, seconds, { by: message.from, reason: reasonFrom(args, lang) });
      return true;
    }
    case 'unmute':
    case 'unrestrict': {
      const target = await resolveTarget(message, args) ?? (args ? { id: Number(args), first_name: args } : null);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      await unmute(chatId, target, { by: message.from });
      return true;
    }
    case 'lock': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      await lockUser(chatId, target.id, reasonFrom(args, lang));
      await ban(chatId, target, { by: message.from, reason: 'locked', silent: true });
      await tg.sendMessage(chatId, `🔒 ${userMention(target)}`);
      return true;
    }
    case 'unlock': {
      const target = await resolveTarget(message, args) ?? (args ? { id: Number(args), first_name: args } : null);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      await unlockUser(chatId, target.id);
      await unban(chatId, target, { by: message.from });
      return true;
    }
    case 'locked': {
      const rows = await listLocked(chatId);
      const text = rows.length ? rows.map((r) => `<code>${r.user_id}</code> — ${escapeHtml(r.reason)}`).join('\n') : '-';
      await tg.sendMessage(chatId, `<b>Locked</b>\n${text}`);
      return true;
    }
    case 'purge': {
      const target = await resolveTarget(message, args);
      if (!target) return !!(await tg.sendMessage(chatId, t(lang, 'no_target')));
      const ids = [];
      for (let i = 0; i < 200; i++) {
        const offset = ids.length ? Math.min(...ids) : message.message_id;
        const got = await db().all(
          'SELECT message_id FROM messages WHERE chat_id = ? AND user_id = ? AND message_id < ? ORDER BY message_id DESC LIMIT 100',
          [String(chatId), String(target.id), offset],
        );
        if (!got.length) break;
        ids.push(...got.map((g) => g.message_id));
      }
      for (const mid of ids) await tg.deleteMessage(chatId, mid).catch(() => {});
      await tg.sendMessage(chatId, `🗑 ${ids.length}`);
      return true;
    }
    case 'setrules': {
      await patchSettings(chatId, { rules: { text: args } });
      await tg.sendMessage(chatId, t(lang, 'settings_saved'));
      return true;
    }
    case 'filter':
    case 'word': {
      const [sub, ...rest] = args.split(/\s+/);
      if (sub === 'add') {
        await addRule(chatId, { pattern: rest.join(' '), action: 'warn' });
        await tg.sendMessage(chatId, t(lang, 'settings_saved'));
      } else if (sub === 'del') {
        await removeRule(chatId, rest[0]);
        await tg.sendMessage(chatId, t(lang, 'settings_saved'));
      } else {
        const rows = await listRules(chatId);
        await tg.sendMessage(chatId, rows.map((r) => `<code>${r.id.slice(0, 8)}</code> ${escapeHtml(r.pattern)} → ${r.action}`).join('\n') || '-');
      }
      return true;
    }
    case 'settings':
    case 'panel': {
      await touchChat(chatId, { title: message.chat.title ?? '', type: message.chat.type });
      await tg.sendMessage(chatId, `⚙️ ${escapeHtml(message.chat.title ?? '')}\n${panelUrl(chatId)}`, {
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'open_panel'), url: panelUrl(chatId) }]] },
      });
      return true;
    }
    case 'lang': {
      if (!['uz', 'ru', 'en'].includes(args)) return true;
      await patchSettings(chatId, { lang: args });
      await tg.sendMessage(chatId, t(args, 'hello'));
      return true;
    }
    case 'on':
      await patchSettings(chatId, { enabled: true });
      return true;
    case 'off':
      if (!mod.owner) return !!(await tg.sendMessage(chatId, t(lang, 'not_owner')));
      await patchSettings(chatId, { enabled: false });
      return true;
    default:
      await tg.sendMessage(chatId, t(lang, 'unknown_command'));
      return true;
  }
}

export { formatDuration, reasonLabel };
