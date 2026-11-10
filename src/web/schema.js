import { ACTIONS, LANGS } from '../config.js';

const L = (uz, ru, en) => ({ uz, ru, en });

/**
 * One entry per control the panel shows. Keeping this declarative means a new
 * setting is one line here plus one line in config.js defaults.
 */
export const SECTIONS = [
  {
    title: L('Asosiy', 'Основные', 'General'),
    fields: [
      { path: 'enabled', type: 'bool', label: L('Bot yoqilgan', 'Бот включён', 'Bot enabled') },
      { path: 'adminRights.adminsAreExempt', type: 'bool', label: L('Adminlar istisno (jazolanmasin)', 'Админы не наказываются', 'Admins exempt from punishment') },
      { path: 'lang', type: 'select', options: LANGS, label: L('Til', 'Язык', 'Language') },
      { path: 'rules.text', type: 'textarea', label: L('Qoidalar', 'Правила', 'Rules text') },
      { path: 'logs.on', type: 'bool', label: L('Log kanali', 'Лог-канал', 'Log channel') },
      { path: 'logs.channelId', type: 'text', label: L('Log kanal ID', 'ID лога', 'Log channel id') },
    ],
  },
  {
    title: L('Haqorat filtri', 'Фильтр мата', 'Profanity filter'),
    fields: [
      { path: 'profanity.on', type: 'bool', label: L('Yoqilgan', 'Включено', 'Enabled') },
      { path: 'profanity.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
      { path: 'profanity.muteSeconds', type: 'duration', label: L('Pinhol muddati', 'Длительность мута', 'Mute duration') },
      { path: 'profanity.banSeconds', type: 'duration', label: L('Ban muddati', 'Длительность бана', 'Ban duration') },
      { path: 'profanity.warnCount', type: 'number', label: L('Bir xatoda nechta ogoh.', 'Предупреждений за раз', 'Warnings per hit') },
      { path: 'profanity.minSeverity', type: 'select', options: [1, 2, 3], label: L('Qattiqlik', 'Жесткость', 'Severity') },
      { path: 'profanity.delete', type: 'bool', label: L('Xabarni o‘chirish', 'Удалять сообщение', 'Delete message') },
      { path: 'profanity.private', type: 'bool', label: L('Shaxsiy chatda ham', 'Фильтровать в личке', 'Also in private chat') },
    ],
  },
  {
    title: L('Ogohlantirish va ban', 'Предупреждения и бан', 'Warns & bans'),
    fields: [
      { path: 'warns.limit', type: 'number', label: L('Limit (nechta ogoh.)', 'Лимит предупреждений', 'Warn limit') },
      { path: 'warns.resetDays', type: 'number', label: L('Kunlardan keyin tozalansin', 'Сброс через дней', 'Auto-reset after days') },
      { path: 'warns.action', type: 'select', options: ACTIONS, label: L('Limitda', 'При лимите', 'At limit') },
      { path: 'warns.banSeconds', type: 'duration', label: L('Ban muddati', 'Срок бана', 'Ban duration') },
      { path: 'warns.deleteWarned', type: 'bool', label: L('Ogoh. qilingan xabarni o‘chir', 'Удалять за сообщение', 'Delete warned message') },
    ],
  },
  {
    title: L('Havola va reklama', 'Ссылки и реклама', 'Links & ads'),
    fields: [
      { path: 'links.on', type: 'bool', label: L('Havolani taqiqlash', 'Блокировать ссылки', 'Block links') },
      { path: 'links.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
      { path: 'links.muteSeconds', type: 'duration', label: L('Pinhol', 'Мут', 'Mute') },
      { path: 'links.whitelist', type: 'list', label: L('Ruxsat etilgan domenlar', 'Белый список', 'Whitelisted domains') },
      { path: 'ads.on', type: 'bool', label: L('Reklama va taklif havolalari', 'Реклама и инвайты', 'Ads & invite links') },
      { path: 'ads.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
      { path: 'forwarded.on', type: 'bool', label: L('Forward taqiqlansin', 'Блокировать пересылку', 'Block forwards') },
      { path: 'forwarded.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
      { path: 'scam.on', type: 'bool', label: L('Firibgar havolalari', 'Ссылки-скамы', 'Scam links') },
      { path: 'scam.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
    ],
  },
  {
    title: L('Flood va raid', 'Флуд и рейд', 'Flood & raid'),
    fields: [
      { path: 'antiflood.on', type: 'bool', label: L('Antiflood', 'Антифлуд', 'Anti-flood') },
      { path: 'antiflood.max', type: 'number', label: L('Maks. xabar', 'Макс. сообщений', 'Max messages') },
      { path: 'antiflood.windowSeconds', type: 'duration', label: L('Oyna (sek)', 'Окно (сек)', 'Window (s)') },
      { path: 'antiflood.action', type: 'select', options: ACTIONS, label: L('Jazo', 'Наказание', 'Action') },
      { path: 'antiflood.muteSeconds', type: 'duration', label: L('Pinhol', 'Мут', 'Mute') },
      { path: 'raid.on', type: 'bool', label: L('Raid himoyasi', 'Антирейд', 'Raid protection') },
      { path: 'raid.joinsPerMinute', type: 'number', label: L('Maks. qo‘shilish/min', 'Джойнов в минуту', 'Joins per minute') },
      { path: 'raid.quietSeconds', type: 'duration', label: L('Tinchlik muddati', 'Длительность блокировки', 'Quiet time') },
    ],
  },
  {
    title: L('Yangi azolar', 'Новые участники', 'New members'),
    fields: [
      { path: 'subscriptions.on', type: 'bool', label: L('Majburiy obuna', 'Обязательная подписка', 'Force subscribe') },
      { path: 'subscriptions.channels', type: 'channels', label: L('Kanallar (@name yoki -100...)', 'Каналы', 'Channels') },
      { path: 'subscriptions.kickInsteadOfMute', type: 'bool', label: L('O‘rniga chiqarish', 'Кик вместо мута', 'Kick instead of mute') },
      { path: 'subscriptions.notice', type: 'bool', label: L('Xabar ko‘rsatish', 'Показывать текст', 'Send notice') },
      { path: 'captcha.on', type: 'bool', label: L('Captcha', 'Капча', 'Captcha') },
      { path: 'captcha.type', type: 'select', options: ['math', 'text', 'emoji'], label: L('Turi', 'Тип', 'Type') },
      { path: 'captcha.timeoutSeconds', type: 'duration', label: L('Vaqt (sek)', 'Время (сек)', 'Timeout (s)') },
      { path: 'captcha.maxTries', type: 'number', label: L('Urinishlar', 'Попыток', 'Tries') },
      { path: 'captcha.action', type: 'select', options: ['kick', 'mute', 'ban', 'none'], label: L('Otamasa', 'Если не прошёл', 'On fail') },
      { path: 'warngate.on', type: 'bool', label: L('Yangi azoga avtomatik ogoh.', 'Авто-предупреждение новым', 'Auto-warn newcomers') },
      { path: 'quarantine.on', type: 'bool', label: L('Karantin', 'Карантин', 'Quarantine') },
      { path: 'quarantine.minutes', type: 'number', label: L('Daqiqa', 'Минут', 'Minutes') },
      { path: 'bots.on', type: 'bool', label: L('Botlarga ruxsat yo‘q', 'Ботам нельзя', 'Block bots') },
      { path: 'usernameCheck.on', type: 'bool', label: L('Username talabi', 'Требовать username', 'Require username') },
      { path: 'usernameCheck.removeAdminLookalikes', type: 'bool', label: L('Adminga o‘xshash isimlar', 'Двойники админов', 'Admin lookalikes') },
      { path: 'welcome.on', type: 'bool', label: L('Xush kelibsiz', 'Приветствие', 'Welcome') },
      { path: 'welcome.text', type: 'textarea', label: L('Matn ({user} {group} {count})', 'Текст', 'Text') },
      { path: 'goodbye.on', type: 'bool', label: L('Xayrlashuv', 'Прощание', 'Goodbye') },
      { path: 'goodbye.text', type: 'textarea', label: L('Matn', 'Текст', 'Text') },
      { path: 'clean.serviceMessages', type: 'bool', label: L('Xizmat xabarlarini o‘chirish', 'Удалять служебные', 'Delete service messages') },
    ],
  },
  {
    title: L('Media va uslub', 'Медиа и стиль', 'Media & style'),
    fields: [
      { path: 'media.stickers.on', type: 'bool', label: L('Sticker', 'Стикеры', 'Stickers') },
      { path: 'media.gifs.on', type: 'bool', label: L('GIF/animatsiya', 'Гифки', 'GIFs') },
      { path: 'media.voice.on', type: 'bool', label: L('Ovozli xabar', 'Голосовые', 'Voice') },
      { path: 'media.videos.on', type: 'bool', label: L('Video', 'Видео', 'Videos') },
      { path: 'media.photos.on', type: 'bool', label: L('Rasm', 'Фото', 'Photos') },
      { path: 'media.docs.on', type: 'bool', label: L('Hujjat', 'Документы', 'Documents') },
      { path: 'media.contacts.on', type: 'bool', label: L('Kontakt', 'Контакты', 'Contacts') },
      { path: 'media.locations.on', type: 'bool', label: L('Joylashuv', 'Геолокация', 'Locations') },
      { path: 'media.polls.on', type: 'bool', label: L('So‘rov', 'Опросы', 'Polls') },
      { path: 'caps.on', type: 'bool', label: L('CAPS LOCK', 'КАПС', 'CAPS LOCK') },
      { path: 'caps.max', type: 'number', label: L('Maks. %', 'Макс. %', 'Max %') },
      { path: 'emojis.on', type: 'bool', label: L('Emoji cheklewi', 'Лимит эмодзи', 'Emoji limit') },
      { path: 'emojis.max', type: 'number', label: L('Maks.', 'Макс.', 'Max') },
      { path: 'mentions.on', type: 'bool', label: L('@eslatmalar', 'Упоминания', 'Mentions') },
      { path: 'mentions.max', type: 'number', label: L('Maks.', 'Макс.', 'Max') },
      { path: 'reports.on', type: 'bool', label: L('Shikoyat tugmasi', 'Кнопка жалоб', 'Report button') },
      { path: 'reports.threshold', type: 'number', label: L('Nechta ovoz', 'Сколько голосов', 'Votes needed') },
      { path: 'reports.action', type: 'select', options: ['none', 'delete', 'warn', 'mute', 'kick', 'ban'], label: L('Jazo', 'Наказание', 'Action') },
    ],
  },
];

export function getIn(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setIn(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return obj;
}

/** Patch body from the panel → nested settings object. */
export function buildPatch(entries) {
  const patch = {};
  for (const [path, value] of Object.entries(entries ?? {})) {
    if (!SECTIONS.some((s) => s.fields.some((f) => f.path === path))) continue;
    setIn(patch, path, value);
  }
  return patch;
}
