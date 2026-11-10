import { env } from '../config.js';
import { SECTIONS, getIn } from './schema.js';
import { t } from '../core/i18n.js';
import { panelUrl } from '../core/links.js';

// Bump when public assets change so cached copies are bypassed immediately.
const ASSET_V = '2';

export const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TABS = [
  ['settings', 'Sozlamalar', 'Настройки', 'Settings'],
  ['users', 'Azolar', 'Участники', 'Members'],
  ['warns', 'Ogohlantirishlar', 'Предупреждения', 'Warnings'],
  ['filters', 'Maxsus so‘zlar', 'Фильтры', 'Custom words'],
  ['logs', 'Log', 'Журнал', 'Logs'],
  ['test', 'Tekshirish', 'Проверка', 'Test'],
];

const tabLabel = (tab, lang) => {
  const row = TABS.find((x) => x[0] === tab);
  return row ? row[LANG_INDEX[lang] ?? 1] : tab;
};

const LANG_INDEX = { uz: 1, ru: 2, en: 3 };

const ACTION_ICON = {
  warn: '⚠',
  mute: '🔇',
  kick: '🚪',
  ban: '🔨',
  unban: '✔',
  lock: '🔒',
  unlock: '🔓',
};
const USER_ACTIONS = Object.keys(ACTION_ICON);

export function layout({ title, body, user, lang = 'uz', active = '', chatId = '' }) {
  const backLabel = lang === 'ru' ? 'Группы' : lang === 'en' ? 'Groups' : 'Guruhlar';
  const main = chatId
    ? `<div class="shell">
  <aside class="side">
    <a class="back" href="/">← ${esc(backLabel)}</a>
    <nav class="sidenav">${TABS.map(
      ([key]) =>
        `<a class="${key === active ? 'on' : ''}" href="/g/${esc(chatId)}?tab=${key}" target="_blank" rel="noopener">${esc(tabLabel(key, lang))}</a>`,
    ).join('')}</nav>
  </aside>
  <main class="content">${body}</main>
</div>`
    : `<main>${body}</main>`;
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · MC Guard</title>
<link rel="icon" href="/assets/MCGuardUzBot.ico">
<link rel="stylesheet" href="/assets/styles.css?v=${ASSET_V}">
</head>
<body class="${user ? 'authed' : 'guest'}">
<header class="top">
  <a class="brand" href="/">
    <img src="/assets/MCguarduzbot.png" alt="" width="34" height="34">
    <span>MC Guard <em>panel</em></span>
  </a>
  <nav class="topnav">${
    user
      ? `<span class="who">@${esc(user.username || user.first_name || user.id)}</span><a class="ghost" href="/logout">${lang === 'ru' ? 'Выйти' : lang === 'en' ? 'Sign out' : 'Chiqish'}</a>`
      : `<a class="ghost" href="/login">Login</a>`
  }</nav>
</header>
${main}
<footer>
  <span>MC Guard · @${esc(env.ownerUsername)}</span>
  <span>Render + PostgreSQL</span>
</footer>
<script src="/assets/app.js?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

export function loginPage({ lang = 'uz', error = '', botUsername }) {
  const body = `
<section class="hero">
  <div class="hero-copy">
    <h1>MC Guard <span>boshqaruv paneli</span></h1>
    <p>Guruh filtrlari, ogohlantirishlar, banlar va loglar — barchasi bitta sahifada.</p>
    ${error ? `<p class="alert">${esc(error)}</p>` : ''}
    <div class="login-box">
      <script async src="https://telegram.org/js/telegram-widget.js?22"
        data-telegram-login="${esc(botUsername || env.ownerUsername)}"
        data-size="large" data-userpic="false"
        data-auth-url="${panelUrl()}/auth/telegram"
        data-request-auth="mcguard"></script>
      <details>
        <summary>${lang === 'ru' ? 'Код доступа' : lang === 'en' ? 'Access code' : 'Kirish kodi'}</summary>
        <form method="post" action="/login" class="row">
          <input name="code" type="password" placeholder="PANEL_SECRET" autocomplete="off" required>
          <button type="submit">OK</button>
        </form>
      </details>
    </div>
  </div>
  <div class="hero-art" aria-hidden="true">
    <div class="cube c1"></div><div class="cube c2"></div><div class="cube c3"></div>
  </div>
</section>`;
  return layout({ title: 'Login', body, user: null, lang });
}

export function dashboardPage({ user, chats, lang, totals }) {
  const cards = chats.length
    ? chats
        .map(
          (c) => `
      <a class="card chat" href="/g/${esc(c.chat_id)}">
        <div class="chat-title">${esc(c.title || c.chat_id)}</div>
        <div class="chat-meta">${esc(c.type)} · <code>${esc(c.chat_id)}</code></div>
        <div class="chat-state">${getIn(c, 'settings.enabled') ? '✅' : '⛔'} ${esc(
            Object.keys(c.violations || {}).length || 0,
          )} ${lang === 'ru' ? 'нарушений' : lang === 'en' ? 'hits' : 'buzilish'}</div>
      </a>`,
        )
        .join('')
    : `<p class="empty">${lang === 'ru' ? 'Групп пока нет. Добавьте бота админом.' : lang === 'en' ? 'No groups yet — add the bot as admin.' : "Guruhlar hali yo'q. Botni administrator qilib qo'shing."}</p>`;

  const body = `
<div class="dashwrap">
  <div class="dashmain">
    <section class="stats">
      <div><b>${totals.chats}</b><span>${lang === 'ru' ? 'групп' : lang === 'en' ? 'groups' : 'guruh'}</span></div>
      <div><b>${totals.members}</b><span>${lang === 'ru' ? 'участников' : lang === 'en' ? 'members' : 'a’zo'}</span></div>
      <div><b>${totals.warns}</b><span>${lang === 'ru' ? 'предупреждений' : lang === 'en' ? 'warnings' : 'ogohlantirish'}</span></div>
      <div><b>${totals.bans}</b><span>${lang === 'ru' ? 'банов' : lang === 'en' ? 'bans' : 'ban'}</span></div>
    </section>
    <section class="grid">${cards}</section>
  </div>
  <div class="hero-art dash-art" aria-hidden="true">
    <div class="cube c1"></div><div class="cube c2"></div><div class="cube c3"></div>
  </div>
</div>`;
  return layout({ title: 'Panel', body, user, lang });
}

function fieldInput(field, value, lang) {
  const name = esc(field.path);
  const label = esc(field.label[lang] ?? field.label.uz);
  if (field.type === 'bool') {
    return `<label class="ctl switch"><input type="checkbox" data-path="${name}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  }
  if (field.type === 'select') {
    return `<label class="ctl"><span>${label}</span><select data-path="${name}">${field.options
      .map((o) => `<option value="${esc(o)}" ${String(o) === String(value) ? 'selected' : ''}>${esc(o)}</option>`)
      .join('')}</select></label>`;
  }
  if (field.type === 'textarea') {
    return `<label class="ctl wide"><span>${label}</span><textarea data-path="${name}" rows="4">${esc(value)}</textarea></label>`;
  }
  if (field.type === 'list' || field.type === 'channels') {
    const rows = Array.isArray(value) ? value : [];
    const flat = field.type === 'channels' ? rows.map((c) => [c.id, c.username, c.title].filter(Boolean).join(':')).join('\n') : rows.join('\n');
    return `<label class="ctl wide"><span>${label}</span><textarea data-path="${name}" data-list="${field.type}" rows="3">${esc(flat)}</textarea></label>`;
  }
  if (field.type === 'duration') {
    return `<label class="ctl"><span>${label} (sek)</span><input type="number" min="0" step="1" data-path="${name}" value="${esc(value ?? 0)}"></label>`;
  }
  return `<label class="ctl"><span>${label}</span><input type="number" data-path="${name}" value="${esc(value ?? 0)}"></label>`;
}

export function groupPage({ chat, settings, user, lang, tab, data }) {
  let body = '';

  if (tab === 'settings' || !tab) {
    body = SECTIONS.map(
      (s) => `
    <section class="panel" data-section>
      <h2>${esc(s.title[lang] ?? s.title.uz)}</h2>
      <div class="fields">${s.fields.map((f) => fieldInput(f, getIn(settings, f.path), lang)).join('')}</div>
    </section>`,
    ).join('') +
      `<div class="savebar"><button id="save" class="primary">${lang === 'ru' ? 'Сохранить' : lang === 'en' ? 'Save' : 'Saqlash'}</button><span id="saved" class="saved"></span>
        <span class="spacer"></span>
        <button id="export">${lang === 'ru' ? 'Экспорт' : lang === 'en' ? 'Export' : 'Eksport'}</button>
        <button id="import">${lang === 'ru' ? 'Импорт' : lang === 'en' ? 'Import' : 'Import'}</button></div>`;
  }

  if (tab === 'users') {
    const kinds = ['warn', 'unwarn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'lock', 'unlock'];
    const rows = (data.members ?? []).length
      ? `<table class="tbl"><thead><tr><th>ID</th><th>Username</th><th>${lang === 'ru' ? 'Имя' : lang === 'en' ? 'Name' : 'Ism'}</th><th>${lang === 'ru' ? 'Статус' : lang === 'en' ? 'Status' : 'Holat'}</th><th></th></tr></thead><tbody>
          ${data.members
            .map(
              (m) =>
                `<tr><td><code>${esc(m.ID)}</code></td><td>${esc(m.Username)}</td><td>${esc(m.Ism)}</td><td>${esc(m.Holat)}</td>
                 <td class="acts">${USER_ACTIONS.map(
                   (a) => `<button data-action-user="${esc(m.ID)}" data-action-kind="${a}" title="${a}">${ACTION_ICON[a]}</button>`,
                 ).join('')}</td></tr>`,
            )
            .join('')}
        </tbody></table>`
      : `<p class="empty">${lang === 'ru' ? 'Пусто' : lang === 'en' ? 'Empty' : 'Bo‘sh'}</p>`;

    body = `<section class="panel"><h2>${lang === 'ru' ? 'Участники' : lang === 'en' ? 'Members' : 'Azolar'}</h2>
      <div class="row quick">
        <input id="quick-id" type="number" placeholder="${lang === 'ru' ? 'ID пользователя' : lang === 'en' ? 'user id' : 'foydalanuvchi ID'}">
        <select id="quick-action">${kinds.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
        <input id="quick-reason" placeholder="${lang === 'ru' ? 'причина' : lang === 'en' ? 'reason' : 'sabab'}">
        <input id="quick-seconds" type="number" min="0" step="1" placeholder="${lang === 'ru' ? 'секунд' : lang === 'en' ? 'seconds' : 'sekund'}">
        <button id="quick-go" class="primary">OK</button>
      </div>
      ${rows}
      <p class="hint">${lang === 'ru' ? 'Кнопки: warn mute kick ban unban lock unlock' : lang === 'en' ? 'Buttons: warn · mute · kick · ban · unban · lock · unlock' : 'Tugmalar: ogohlantirish · pinhol · chiqarish · ban · unbanning · abadiy blok · blokdan chiqarish'}</p></section>`;
  }

  if (tab === 'warns') {
    body = `<section class="panel"><h2>${lang === 'ru' ? 'Предупреждения' : lang === 'en' ? 'Warnings' : 'Ogohlantirishlar'}</h2>
      ${table(['ID', 'Sabab', 'Qachon'], data.warns, lang)}</section>
      <section class="panel"><h2>${lang === 'ru' ? 'Наказания' : lang === 'en' ? 'Punishments' : 'Jazolar'}</h2>
      ${table(['ID', 'Turi', 'Sabab', 'Muddat'], data.punishments, lang)}</section>
      <section class="panel"><h2>${lang === 'ru' ? 'Заблокированы навсегда' : lang === 'en' ? 'Locked forever' : 'Abadiy bloklangan'}</h2>
      ${table(['ID', 'Sabab'], data.locked, lang)}</section>`;
  }

  if (tab === 'filters') {
    body = `<section class="panel"><h2>${lang === 'ru' ? 'Свои слова' : lang === 'en' ? 'Custom words' : 'Maxsus so‘zlar'}</h2>
      <form id="add-rule" class="row" data-chat="${esc(chat.chat_id)}">
        <input name="pattern" placeholder="regex yoki so‘z" required>
        <select name="action"><option>warn</option><option>delete</option><option>mute</option><option>kick</option><option>ban</option></select>
        <button type="submit">+</button>
      </form>
      <table class="tbl"><thead><tr><th>Pattern</th><th>Action</th><th></th></tr></thead><tbody>
      ${data.rules
        .map(
          (r) =>
            `<tr><td><code>${esc(r.pattern)}</code></td><td>${esc(r.action)}</td><td><button class="del" data-rule="${esc(r.id)}">✕</button></td></tr>`,
        )
        .join('')}
      </tbody></table></section>`;
  }

  if (tab === 'logs') {
    body = `<section class="panel"><h2>${lang === 'ru' ? 'Журнал' : lang === 'en' ? 'Log' : 'Log'}</h2>
      <table class="tbl"><thead><tr><th>Waqt</th><th>Amal</th><th>ID</th><th>Sabab</th></tr></thead><tbody>
      ${data.logs
        .map(
          (l) =>
            `<tr><td>${new Date(l.created_at * 1000).toLocaleString()}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.user_id)}</td><td>${esc(l.reason)}</td></tr>`,
        )
        .join('')}
      </tbody></table></section>`;
  }

  if (tab === 'test') {
    body = `<section class="panel"><h2>${lang === 'ru' ? 'Проверка текста' : lang === 'en' ? 'Text check' : 'Matnni tekshirish'}</h2>
      <textarea id="probe" rows="4" placeholder="${lang === 'ru' ? 'Введите сообщение' : 'Xabarni yozing'}"></textarea>
      <button id="probe-run" class="primary">Run</button>
      <pre id="probe-out" class="out">${esc(JSON.stringify(data.preview ?? {}, null, 2))}</pre></section>`;
  }

  return layout({
    title: `${tabLabel(tab || 'settings', lang)} · ${chat.title || chat.chat_id}`,
    body: `<div class="chathead"><h1>${esc(tabLabel(tab || 'settings', lang))}</h1><div class="sub">${esc(chat.title || chat.chat_id)} · <code>${esc(chat.chat_id)}</code></div></div>${body}`,
    user,
    lang,
    active: tab || 'settings',
    chatId: chat.chat_id,
  });
}

function table(headers, rows, lang) {
  if (!rows?.length) return `<p class="empty">${lang === 'ru' ? 'Пусто' : lang === 'en' ? 'Empty' : 'Bo‘sh'}</p>`;
  return `<table class="tbl"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${Object.values(r).map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
}

export { TABS, tabLabel };
