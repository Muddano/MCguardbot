import crypto from 'node:crypto';
import { getSettings, patchSettings, touchChat } from '../core/settings.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { t, reasonLabel } from '../core/i18n.js';
import { ban, unban, kick, mute, unmute, warn, clearWarns, activeWarnCount, userMention, formatDuration, logAction } from '../core/punish.js';
import { addRule, listRules, removeRule, lockUser, unlockUser, listLocked } from '../core/rules.js';
import { db, now } from '../core/db.js';
import { isOwner } from '../config.js';
import { panelUrl } from '../core/links.js';

// Both prefixes work: Telegram's own menu sends "/warn", while GuardBot-style
// groups are used to typing "!warn". A command must start with a letter, so
// "!!!" or "!123" stay ordinary chat messages.
const CMD_RE = /^[/!]([a-zA-Z][a-zA-Z0-9_]*)(?:@MCguarduzbot)?(?:\s+([\s\S]*))?$/;

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
      const parts = args.split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();
      if (sub === 'add') {
        const last = (parts[parts.length - 1] || '').toLowerCase();
        let action = 'delete';
        let patternWords = parts.slice(1);
        if (['delete', 'warn', 'mute', 'kick', 'ban'].includes(last) && parts.length > 2) {
          action = last;
          patternWords = parts.slice(1, -1);
        }
        const pat = patternWords.join(' ').trim();
        if (!pat) {
          await tg.sendMessage(chatId, '❌ So‘zni kiriting:\nMisol: <code>/filter add zb</code> yoki <code>/filter add zb ban</code>');
          return true;
        }
        await addRule(chatId, { pattern: pat, action });
        await tg.sendMessage(chatId, `✅ Maxsus filtrga qo‘shildi:\n• So‘z: <b>${escapeHtml(pat)}</b>\n• Jazo: <b>${action}</b>`);
      } else if (sub === 'del' || sub === 'remove') {
        const target = parts.slice(1).join(' ').trim();
        if (!target) {
          await tg.sendMessage(chatId, '❌ O‘chirish uchun so‘zni kiriting:\nMisol: <code>/filter del zb</code>');
          return true;
        }
        await removeRule(chatId, target);
        await tg.sendMessage(chatId, `✅ Maxsus filtrdan o‘chirildi: <b>${escapeHtml(target)}</b>`);
      } else {
        const rows = await listRules(chatId);
        const text = rows.length
          ? rows.map((r) => `• <b>${escapeHtml(r.pattern)}</b> → <code>${r.action}</code>`).join('\n')
          : 'Hozircha maxsus so‘zlar qo‘shilmagan.';
        await tg.sendMessage(
          chatId,
          `📝 <b>Maxsus taqiqlangan so‘zlar:</b>\n\n${text}\n\n` +
            `➕ Qo‘shish: <code>/filter add so‘z [delete|warn|mute|ban]</code>\n` +
            `➖ O‘chirish: <code>/filter del so‘z</code>`,
        );
      }
      return true;
    }
    case 'warnlimit':
    case 'limit': {
      const n = parseInt(args, 10);
      if (!n || n < 1 || n > 20) {
        await tg.sendMessage(chatId, `ℹ️ Ogohlantirish chegarasini kiriting (1-20 oralig‘ida):\nMisol: <code>/warnlimit 3</code> yoki <code>/warnlimit 5</code>\nHozirgi limit: <b>${settings.warns?.limit ?? 3}</b> ta`);
        return true;
      }
      await patchSettings(chatId, { warns: { limit: n } });
      await tg.sendMessage(chatId, `✅ Ogohlantirishlar chegarasi <b>${n}</b> taga o‘rnatildi!`);
      return true;
    }
    case 'profanity':
    case 'haqorat': {
      const act = (args || '').toLowerCase().trim();
      if (!act) {
        await tg.sendMessage(
          chatId,
          `ℹ️ Haqorat filtri: <b>${settings.profanity?.on ? settings.profanity?.action : 'o‘chiq'}</b>\n\n` +
            `O‘zgartirish buyruqlari:\n` +
            `• <code>/profanity delete</code> — xabarni o‘chirish\n` +
            `• <code>/profanity warn</code> — ogohlantirish berish\n` +
            `• <code>/profanity mute</code> — ovozini o‘chirish (mute)\n` +
            `• <code>/profanity ban</code> — guruhdan haydash (ban)\n` +
            `• <code>/profanity off</code> — filtrni o‘chirish`,
        );
        return true;
      }
      if (act === 'off') {
        await patchSettings(chatId, { profanity: { on: false } });
        await tg.sendMessage(chatId, '✅ Haqorat filtri o‘chirildi ❌');
        return true;
      }
      if (['delete', 'warn', 'mute', 'kick', 'ban'].includes(act)) {
        await patchSettings(chatId, { profanity: { on: true, action: act, delete: true } });
        await tg.sendMessage(chatId, `✅ Haqorat filtri yangilandi, jazo: <b>${act}</b>`);
        return true;
      }
      await tg.sendMessage(chatId, '❌ Noto‘g‘ri parametr. Tanlang: <code>delete</code>, <code>warn</code>, <code>mute</code>, <code>ban</code>, <code>off</code>');
      return true;
    }
    case 'links':
    case 'link':
    case 'reklama': {
      const act = (args || '').toLowerCase().trim();
      if (!act) {
        await tg.sendMessage(
          chatId,
          `ℹ️ Havola va reklama filtri: <b>${settings.links?.on ? settings.links?.action : 'o‘chiq'}</b>\n\n` +
            `Tanlang: <code>/links delete</code>, <code>/links warn</code>, <code>/links mute</code>, <code>/links ban</code>, <code>/links off</code>`,
        );
        return true;
      }
      if (act === 'off') {
        await patchSettings(chatId, { links: { on: false }, ads: { on: false } });
        await tg.sendMessage(chatId, '✅ Havola va reklama filtri o‘chirildi ❌');
        return true;
      }
      if (['delete', 'warn', 'mute', 'kick', 'ban'].includes(act)) {
        await patchSettings(chatId, { links: { on: true, action: act, delete: true }, ads: { on: true, action: act, delete: true } });
        await tg.sendMessage(chatId, `✅ Havola va reklama filtri: <b>${act}</b> ga o‘rnatildi!`);
        return true;
      }
      return true;
    }
    case 'antiflood':
    case 'flood': {
      const act = (args || '').toLowerCase().trim();
      if (act === 'off') {
        await patchSettings(chatId, { antiflood: { on: false } });
        await tg.sendMessage(chatId, '✅ Anti-flood filtri o‘chirildi ❌');
        return true;
      }
      if (['mute', 'delete', 'warn', 'kick', 'ban'].includes(act)) {
        await patchSettings(chatId, { antiflood: { on: true, action: act } });
        await tg.sendMessage(chatId, `✅ Anti-flood filtri yoqildi, jazo: <b>${act}</b>`);
        return true;
      }
      await tg.sendMessage(chatId, `ℹ️ Anti-flood holati: <b>${settings.antiflood?.on ? settings.antiflood?.action : 'o‘chiq'}</b>\nTanlang: <code>/antiflood mute</code>, <code>/antiflood delete</code>, <code>/antiflood off</code>`);
      return true;
    }
    case 'mutetime':
    case 'mutemuddati': {
      const parsed = parseDuration(args);
      const sec = parsed ?? (Number(args) > 0 ? Number(args) : null);
      if (!sec) {
        await tg.sendMessage(chatId, `ℹ️ Mute muddatini kiriting:\nMisol: <code>/mutetime 10m</code>, <code>/mutetime 1h</code>, <code>/mutetime 1d</code>\nHozirgi muddat: <b>${formatDuration(settings.profanity?.muteSeconds ?? 3600, lang)}</b>`);
        return true;
      }
      await patchSettings(chatId, {
        profanity: { muteSeconds: sec },
        links: { muteSeconds: sec },
        antiflood: { muteSeconds: sec },
      });
      await tg.sendMessage(chatId, `✅ Mute qilish muddati <b>${formatDuration(sec, lang)}</b> ga o‘rnatildi!`);
      return true;
    }
    case 'bantime':
    case 'banmuddati': {
      let sec = 0;
      if (args === '0' || args === 'abadiy' || args === 'perm' || args === 'permanent') {
        sec = 0;
      } else {
        const parsed = parseDuration(args);
        sec = parsed ?? (Number(args) >= 0 ? Number(args) : null);
      }
      if (sec === null) {
        await tg.sendMessage(chatId, `ℹ️ Ban muddatini kiriting:\nMisol: <code>/bantime 1d</code>, <code>/bantime 7d</code>, <code>/bantime 0</code> (0 = abadiy)\nHozirgi muddat: <b>${settings.warns?.banSeconds ? formatDuration(settings.warns.banSeconds, lang) : 'Abadiy'}</b>`);
        return true;
      }
      await patchSettings(chatId, {
        warns: { banSeconds: sec },
        profanity: { banSeconds: sec },
      });
      await tg.sendMessage(chatId, `✅ Ban muddati: <b>${sec === 0 ? 'Abadiy' : formatDuration(sec, lang)}</b> ga o‘rnatildi!`);
      return true;
    }
    case 'admins':
    case 'adminlar': {
      const v = (args || '').toLowerCase().trim();
      if (v === 'off' || v === 'yoq' || v === 'tekshir') {
        await patchSettings(chatId, { adminRights: { adminsAreExempt: false } });
        await tg.sendMessage(chatId, '✅ Adminlar ham filtrdan o‘tkaziladi (istisno o‘chirildi)!');
        return true;
      }
      if (v === 'on' || v === 'ha') {
        await patchSettings(chatId, { adminRights: { adminsAreExempt: true } });
        await tg.sendMessage(chatId, '✅ Adminlar himoyalandi (filtr adminlarga tegmaydi)!');
        return true;
      }
      await tg.sendMessage(chatId, `ℹ️ Hozirgi holat: <b>${settings.adminRights?.adminsAreExempt ? 'Adminlar himoyalangan (on)' : 'Adminlar ham tekshiriladi (off)'}</b>\nO‘zgartirish: <code>/admins on</code> yoki <code>/admins off</code>`);
      return true;
    }
    case 'settings':
    case 'panel':
    case 'sozlamalar': {
      await touchChat(chatId, { title: message.chat.title ?? '', type: message.chat.type });
      const p = settings.profanity ?? {};
      const w = settings.warns ?? {};
      const l = settings.links ?? {};
      const text =
        `⚙️ <b>${escapeHtml(message.chat.title ?? 'Guruh')} sozlamalari:</b>\n\n` +
        `🛡 <b>Haqorat filtri:</b> ${p.on ? `Yoqilgan (${p.action})` : 'O‘chiq'}\n` +
        `⚠️ <b>Ogohlantirish limiti:</b> ${w.limit ?? 3} ta\n` +
        `🚫 <b>Ban muddati:</b> ${w.banSeconds ? formatDuration(w.banSeconds, lang) : 'Abadiy'}\n` +
        `🔇 <b>Mute muddati:</b> ${formatDuration(p.muteSeconds ?? 3600, lang)}\n` +
        `🔗 <b>Havolalar/Reklama:</b> ${l.on ? `Yoqilgan (${l.action})` : 'O‘chiq'}\n` +
        `🌊 <b>Anti-flood:</b> ${settings.antiflood?.on ? `Yoqilgan (${settings.antiflood?.action})` : 'O‘chiq'}\n` +
        `👮 <b>Adminlar istisnosi:</b> ${settings.adminRights?.adminsAreExempt ? 'Yoqilgan' : 'O‘chiq'}\n\n` +
        `<b>Tezkor buyruqlar:</b>\n` +
        `• <code>/warnlimit 3</code> — limitni o‘zgartirish (3, 5, ...)\n` +
        `• <code>/profanity delete|warn|mute|ban|off</code> — haqorat jazosi\n` +
        `• <code>/links delete|warn|mute|off</code> — reklama/havola jazosi\n` +
        `• <code>/mutetime 10m|1h|1d</code> — mute qilish vaqti\n` +
        `• <code>/bantime 1d|7d|0</code> — ban qilish vaqti (0 = abadiy)\n` +
        `• <code>/filter add &lt;so‘z&gt; [jazo]</code> — yangi so‘z qo‘shish\n` +
        `• <code>/filter del &lt;so‘z&gt;</code> — so‘zni o‘chirish\n` +
        `• <code>/filter</code> — maxsus so‘zlar ro‘yxati\n` +
        `• <code>/admins on|off</code> — adminlarni tekshirish/tekshirmaslik`;

      await tg.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `🛡 Haqorat: ${p.action || 'warn'}`, callback_data: `cfg:${chatId}:profanity:toggle` },
              { text: `⚠️ Limit: ${w.limit ?? 3}`, callback_data: `cfg:${chatId}:warnlimit:toggle` },
            ],
            [
              { text: `🔗 Havola: ${l.on ? 'Yoqiq' : 'O‘chiq'}`, callback_data: `cfg:${chatId}:links:toggle` },
              { text: `👮 Admin: ${settings.adminRights?.adminsAreExempt ? 'Himoyalangan' : 'Tekshiriladi'}`, callback_data: `cfg:${chatId}:admins:toggle` },
            ],
            [{ text: `🌐 Veb-panelni ochish`, url: panelUrl(chatId) }],
          ],
        },
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
