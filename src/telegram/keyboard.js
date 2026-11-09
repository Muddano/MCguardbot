import { t } from '../core/i18n.js';

const row = (...buttons) => buttons.filter(Boolean);
const btn = (text, data) => ({ text, callback_data: data });
const url = (text, link) => ({ text, url: link });

export function channelGate({ chatId, userId, channels, lang }) {
  const keyboard = channels.map((c, i) => {
    const name = c.username ? `@${c.username.replace(/^@/, '')}` : c.title || `#${c.id}`;
    const link = c.username ? `https://t.me/${c.username.replace(/^@/, '')}` : null;
    if (link) return row(url(`${i + 1}. ${name}`, link), btn(t(lang, 'checked'), `sub:${chatId}:${userId}`));
    return row(btn(`${i + 1}. ${name}`, `sub:${chatId}:${userId}`));
  });
  keyboard.push(row(btn(t(lang, 'checked'), `sub:${chatId}:${userId}`)));
  return { inline_keyboard: keyboard };
}

export function captchaKeyboard({ chatId, userId, lang }) {
  return {
    inline_keyboard: [
      row(btn(t(lang, 'pm_menu'), `cap:${chatId}:${userId}:menu`)),
    ],
  };
}

export function userActions({ chatId, target, lang, canManage }) {
  if (!canManage) {
    return { inline_keyboard: [row(btn('🚩 Report', `rep:${chatId}:${target}`))] };
  }
  return {
    inline_keyboard: [
      row(btn('⚠️ Warn', `warn:${chatId}:${target}`), btn('🔇 Mute 1h', `mute:${chatId}:${target}:3600`)),
      row(btn('👢 Kick', `kick:${chatId}:${target}`), btn('🚫 Ban', `ban:${chatId}:${target}`)),
      row(btn('🗑 Delete', `del:${chatId}:${target}`), btn('🚩 Report', `rep:${chatId}:${target}`)),
    ],
  };
}

export function pmMenu({ groups, panelUrl, lang }) {
  const keyboard = [];
  if (groups.length) {
    keyboard.push(row(btn(t(lang, 'my_groups'), 'noop')));
    for (const g of groups.slice(0, 10)) {
      keyboard.push(row(btn(`⚙️ ${g.title || g.chat_id}`, `adm:${g.chat_id}`)));
    }
  }
  if (panelUrl) keyboard.push(row(url(t(lang, 'open_panel'), panelUrl)));
  keyboard.push(row(btn('UZ', `lang:uz`), btn('RU', `lang:ru`), btn('EN', `lang:en`)));
  return { inline_keyboard: keyboard };
}

export function groupSettingsMenu({ chatId, sections, current, lang }) {
  const rows = sections.map((s) =>
    row(btn(`${s.on ? '✅' : '❌'} ${s.title}`, `set:${chatId}:${s.key}`)),
  );
  if (current) rows.unshift(row(btn(t(lang, 'status_on'), 'noop')));
  return { inline_keyboard: rows };
}

export function confirmKeyboard({ chatId, action, lang }) {
  return {
    inline_keyboard: [
      row(btn('✅ Yes', `ok:${chatId}:${action}`), btn('❌ No', `noop`)),
    ],
  };
}
