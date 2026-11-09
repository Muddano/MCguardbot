import { db } from '../core/db.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { tg, escapeHtml } from './api.js';
import { t } from '../core/i18n.js';
import { pmMenu } from './keyboard.js';
import { isOwner } from '../config.js';
import { panelUrl } from '../core/links.js';
import { getCaptcha, dropCaptchaRow, markVerified, makeCaptcha, saveCaptcha } from '../core/gate.js';
import { unmute, mute } from '../core/punish.js';

export async function myChats(userId) {
  const rows = await db().all(
    `SELECT c.chat_id, c.title FROM chat_admins a JOIN chats c ON c.chat_id = a.chat_id
     WHERE a.user_id = ? ORDER BY c.updated_at DESC`,
    [String(userId)],
  );
  if (rows.length) return rows;
  if (!isOwner(userId)) return rows;
  return db().all(
    'SELECT chat_id, title FROM chats WHERE type <> ? ORDER BY updated_at DESC LIMIT 20',
    ['private'],
  );
}

export async function handlePrivate(message) {
  const chatId = message.chat.id;
  const settings = await getSettings(chatId);
  const lang = settings.lang;
  const text = String(message.text ?? '');

  const pending = await db().all(
    `SELECT chat_id, answer, expires_at FROM captcha WHERE user_id = ? ORDER BY expires_at DESC`,
    [String(message.from.id)],
  );
  if (pending.length) {
    const row = pending[0];
    if (Number(row.expires_at) * 1000 < Date.now()) {
      await dropCaptchaRow(row.chat_id, message.from.id);
      await tg.sendMessage(chatId, t(lang, 'captcha_fail'));
      return;
    }
    const ok = text.trim().toLowerCase() === String(row.answer).trim().toLowerCase();
    if (ok) {
      await dropCaptchaRow(row.chat_id, message.from.id);
      await markVerified(row.chat_id, message.from.id);
      await unmute(row.chat_id, { id: message.from.id }, { silent: true }).catch(() => {});
      await tg.sendMessage(chatId, t(lang, 'captcha_ok'));
    } else {
      const fresh = makeCaptcha(settings.captcha?.type ?? 'math');
      await saveCaptcha(row.chat_id, message.from.id, fresh, settings.captcha?.timeoutSeconds ?? 120);
      await tg.sendMessage(chatId, `${t(lang, 'captcha_bad', { left: String((settings.captcha?.maxTries ?? 3) - 1) })}\n${fresh.question}`);
    }
    return;
  }

  if (/^\/(start|help)/.test(text)) {
    const groups = await myChats(message.from.id);
    await tg.sendMessage(chatId, `${t(lang, 'hello')}\n\n${t(lang, 'help_intro')}\n${panelUrl()}`, {
      reply_markup: pmMenu({ groups, panelUrl: panelUrl(), lang }),
    });
    return;
  }

  const langMatch = text.match(/^\/(?:lang|uz|ru|en)(?:\s+(uz|ru|en))?/);
  if (langMatch) {
    const code = langMatch[1] ?? text.slice(1, 3);
    if (['uz', 'ru', 'en'].includes(code)) {
      await patchSettings(chatId, { lang: code });
      await tg.sendMessage(chatId, t(code, 'hello'));
      return;
    }
  }

  await tg.sendMessage(chatId, t(lang, 'unknown_command'));
}

export async function ensureGateMessage(chatId, user, settings) {
  const fresh = makeCaptcha(settings.captcha?.type ?? 'math');
  await saveCaptcha(chatId, user.id, fresh, settings.captcha?.timeoutSeconds ?? 120);
  await mute(chatId, user, 0, { reason: 'captcha', silent: true }).catch(() => {});
  return tg.sendMessage(chatId, t(settings.lang, 'captcha_q', {
    question: fresh.question,
    timeout: settings.captcha?.timeoutSeconds ?? 120,
  }));
}
