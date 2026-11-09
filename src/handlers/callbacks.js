import { getSettings, patchSettings } from '../core/settings.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { t } from '../core/i18n.js';
import { checkSubscription, markVerified, getCaptcha, bumpTries, dropCaptchaRow, makeCaptcha, saveCaptcha } from '../core/gate.js';
import { unmute, warn, ban, kick, mute } from '../core/punish.js';
import { addReport, clearReport } from '../core/state.js';
import { isOwner } from '../config.js';

const parse = (data) => String(data ?? '').split(':');

async function memberStatus(chatId, userId) {
  try {
    const m = await tg.getChatMember(chatId, userId);
    return m.status;
  } catch {
    return 'left';
  }
}

async function isStaff(chatId, userId) {
  const s = await memberStatus(chatId, userId);
  return s === 'administrator' || s === 'creator' || isOwner(userId);
}

export async function handleCallback(query) {
  const [kind, chatId, userId, rest] = parse(query.data);
  const chat = Number(chatId);
  const target = Number(userId);
  const settings = await getSettings(chat || query.message?.chat?.id);
  const lang = settings.lang;
  const answer = (text = '', show_alert = false) => tg.answerCallback(query.id, text, show_alert);

  try {
    if (kind === 'noop') {
      await answer();
      return;
    }

    if (kind === 'lang') {
      await patchSettings(query.from.id, { lang: rest });
      await answer(t(rest, 'hello').replace(/<[^>]+>/g, ''));
      await tg.editMessageText(query.from.id, query.message.message_id, t(rest, 'hello'));
      return;
    }

    if (kind === 'sub') {
      const channels = settings.subscriptions?.channels ?? [];
      const res = await checkSubscription(chat, target, channels);
      if (!res.ok) {
        await answer(t(lang, 'subs_wait'), true);
        return;
      }
      await markVerified(chat, target);
      await unmute(chat, { id: target }, { silent: true }).catch(() => {});
      await answer(t(lang, 'subs_ok'));
      await tg.editMessageText(chat || query.from.id, query.message.message_id, t(lang, 'subs_ok')).catch(() => {});
      return;
    }

    if (kind === 'cap') {
      const row = await getCaptcha(chat, target);
      if (!row) return answer(t(lang, 'captcha_ok'));
      if (rest === 'menu') return answer(t(lang, 'captcha_q', { question: row.question, timeout: '' }), true);
      const passed = String(rest) === String(row.answer);
      if (passed) {
        await dropCaptchaRow(chat, target);
        await markVerified(chat, target);
        await unmute(chat, { id: target }, { silent: true }).catch(() => {});
        await answer(t(lang, 'captcha_ok'));
        await tg.editMessageText(query.from.id, query.message.message_id, t(lang, 'captcha_ok')).catch(() => {});
        return;
      }
      const tries = await bumpTries(chat, target);
      const max = settings.captcha?.maxTries ?? 3;
      if (tries >= max) {
        await dropCaptchaRow(chat, target);
        const action = settings.captcha?.action ?? 'kick';
        const user = { id: target, first_name: query.from.first_name };
        if (action === 'ban') await ban(chat, user, { reason: 'captcha', silent: true });
        else if (action === 'mute') await mute(chat, user, settings.captcha.muteSeconds ?? 3600, { reason: 'captcha' });
        else await kick(chat, user, { reason: 'captcha' });
        await answer(t(lang, 'captcha_fail'), true);
        return;
      }
      const fresh = makeCaptcha(settings.captcha?.type ?? 'math');
      await saveCaptcha(chat, target, fresh, settings.captcha?.timeoutSeconds ?? 120, { keepTries: true });
      await tg.editMessageText(
        query.from.id,
        query.message.message_id,
        `${t(lang, 'captcha_bad', { left: String(max - tries) })}\n${fresh.question}`,
        { reply_markup: captchaOptions(chat, target, fresh.options) },
      ).catch(() => {});
      return answer(t(lang, 'captcha_bad', { left: String(max - tries) }), true);
    }

    if (kind === 'rep') {
      if (String(query.from.id) === String(target)) return answer('😅');
      const { fresh, count } = addReport(chat, query.message.message_id, target, query.from.id);
      if (!fresh) return answer(t(lang, 'report_already'), true);
      const threshold = settings.reports?.threshold ?? 3;
      if (count >= threshold) {
        await tg.deleteMessage(chat, query.message.message_id).catch(() => {});
        await tg.sendMessage(chat, t(lang, 'report_done'));
        clearReport(chat, query.message.message_id, target);
      } else {
        await answer(`${count}/${threshold}`);
      }
      return;
    }

    if (['warn', 'ban', 'kick', 'mute', 'del'].includes(kind)) {
      if (!(await isStaff(chat, query.from.id))) return answer(t(lang, 'not_admin'), true);
      const user = await tg.getChatMember(chat, target).then((m) => m.user).catch(() => ({ id: target }));
      const by = query.from;
      if (kind === 'warn') await warn(chat, user, { by, reason: t(lang, 'ban_reason_default') });
      if (kind === 'ban') await ban(chat, user, { by, reason: t(lang, 'ban_reason_default') });
      if (kind === 'kick') await kick(chat, user, { by, reason: t(lang, 'ban_reason_default') });
      if (kind === 'mute') await mute(chat, user, Number(rest) || 3600, { by, reason: 'manual' });
      if (kind === 'del') await tg.deleteMessage(chat, Number(rest) || query.message.message_id).catch(() => {});
      await answer('✅');
      await tg.editMessageReplyMarkup(chat, query.message.message_id, { inline_keyboard: [] }).catch(() => {});
      return;
    }

    if (kind === 'set') {
      if (!(await isStaff(chat, query.from.id))) return answer(t(lang, 'not_admin'), true);
      const value = await toggle(chat, rest);
      await answer(`${rest}: ${value ? 'ON' : 'OFF'}`);
      await tg.editMessageReplyMarkup(chat, query.message.message_id, await menuMarkup(chat, settings)).catch(() => {});
      return;
    }

    if (kind === 'adm') {
      if (!(await isStaff(chat, query.from.id))) return answer(t(lang, 'not_admin'), true);
      const current = await getSettings(chat);
      await tg.sendMessage(chat || query.from.id, `⚙️ ${escapeHtml(current.lang)}`, {
        reply_markup: await menuMarkup(chat, current),
      });
      return answer();
    }

    await answer();
  } catch (err) {
    await answer(String(err.message ?? err).slice(0, 60), true).catch(() => {});
  }
}

function captchaOptions(chat, target, options = []) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) {
    rows.push(options.slice(i, i + 2).map((o) => ({ text: String(o), callback_data: `cap:${chat}:${target}:${o}` })));
  }
  return { inline_keyboard: rows };
}

const TOGGLES = {
  profanity: (v) => ({ profanity: { on: v } }),
  links: (v) => ({ links: { on: v } }),
  ads: (v) => ({ ads: { on: v } }),
  flood: (v) => ({ antiflood: { on: v } }),
  fwd: (v) => ({ forwarded: { on: v } }),
  subs: (v) => ({ subscriptions: { on: v } }),
  captcha: (v) => ({ captcha: { on: v } }),
  welcome: (v) => ({ welcome: { on: v } }),
  scam: (v) => ({ scam: { on: v } }),
  raid: (v) => ({ raid: { on: v } }),
  bots: (v) => ({ bots: { on: v } }),
  media: (v) => ({ media: { docs: { on: v }, contacts: { on: v }, locations: { on: v } } }),
  caps: (v) => ({ caps: { on: v } }),
  emojis: (v) => ({ emojis: { on: v } }),
  mentions: (v) => ({ mentions: { on: v } }),
  reports: (v) => ({ reports: { on: v } }),
};

async function toggle(chat, key) {
  const make = TOGGLES[key];
  if (!make) return null;
  const current = await getSettings(chat);
  const path = keyPath(key);
  const enabled = path ? Boolean(getIn(current, path)) : Boolean(current[key]?.on);
  const next = !enabled;
  await patchSettings(chat, make(next));
  return next;
}

function keyPath(key) {
  return { fwd: 'forwarded.on', flood: 'antiflood.on', subs: 'subscriptions.on' }[key] ?? null;
}

function getIn(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

async function menuMarkup(chat, settings) {
  const rows = [];
  const entries = Object.keys(TOGGLES);
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(
      entries.slice(i, i + 2).map((key) => {
        const path = keyPath(key) ?? `${key}.on`;
        const on = Boolean(getIn(settings, path));
        return { text: `${on ? '✅' : '❌'} ${key}`, callback_data: `set:${chat}:${key}` };
      }),
    );
  }
  return { inline_keyboard: rows };
}

export { menuMarkup, captchaOptions };
