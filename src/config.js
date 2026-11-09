import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function list(name, fallback = '') {
  const raw = process.env[name] ?? fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const ROOT = root;
export const DATA_DIR = path.join(root, 'data');

export const env = {
  token: process.env.BOT_TOKEN ?? '',
  port: num('PORT', 10000),
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  panelSecret: process.env.PANEL_SECRET ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  sqliteFile: process.env.SQLITE_FILE ?? path.join(DATA_DIR, 'mcguard.sqlite'),
  adminIds: list('ADMIN_IDS').map(BigInt),
  dryRun: process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true',
  ownerUsername: process.env.OWNER_USERNAME ?? 'MCguarduzbot',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // On the free Render plan the instance is recycled on redeploy, so a few
  // minutes of warm cache loss is expected; keep in-memory state short-lived.
  floodCacheTtlMs: num('FLOOD_TTL_MS', 10 * 60 * 1000),
};

export const LANGS = ['uz', 'ru', 'en'];

/**
 * Every switch the bot and the panel can touch lives here. Stored per chat as
 * one JSON blob so a new feature never needs a migration.
 */
export const DEFAULT_SETTINGS = {
  lang: 'uz',
  enabled: true,

  profanity: {
    on: true,
    delete: true,
    action: 'warn', // none | delete | mute | kick | ban | warn
    muteSeconds: 3600,
    banSeconds: 0,
    warnCount: 1,
    private: false,
    minSeverity: 1,
    langs: ['uz', 'ru', 'en'],
  },

  warns: {
    limit: 3,
    resetDays: 30,
    action: 'ban', // what happens once the limit is reached
    banSeconds: 0,
    reasonRequired: false,
    deleteWarned: true,
  },

  antiflood: {
    on: true,
    max: 6,
    windowSeconds: 8,
    action: 'mute',
    muteSeconds: 600,
    countEdits: false,
  },

  links: {
    on: true,
    delete: true,
    action: 'warn',
    muteSeconds: 3600,
    warnCount: 1,
    whitelist: ['t.me/MCguarduzbot', 'mcguarduzbot.onrender.com'],
  },

  mentions: {
    on: false,
    max: 3,
    action: 'delete',
  },

  forwarded: {
    on: true,
    delete: true,
    action: 'none',
    allowFrom: [],
  },

  ads: {
    on: true,
    delete: true,
    action: 'warn',
    muteSeconds: 86400,
    warnCount: 1,
    checkJoinLinks: true,
    checkChannelMentions: true,
  },

  media: {
    stickers: { on: false, action: 'delete' },
    gifs: { on: false, action: 'delete' },
    voice: { on: false, action: 'delete' },
    videoNotes: { on: false, action: 'delete' },
    videos: { on: false, action: 'delete' },
    photos: { on: false, action: 'delete' },
    docs: { on: true, action: 'delete' },
    contacts: { on: true, action: 'delete' },
    locations: { on: true, action: 'delete' },
    games: { on: false, action: 'delete' },
    polls: { on: false, action: 'delete' },
    inlineBots: { on: true, action: 'delete' },
  },

  caps: {
    on: false,
    max: 70,
    action: 'delete',
  },

  emojis: {
    on: false,
    max: 10,
    action: 'delete',
  },

  subscriptions: {
    on: false,
    channels: [], // { id, username, title }
    button: true,
    kickInsteadOfMute: false,
    notice: true,
  },

  captcha: {
    on: false,
    type: 'math', // math | text | emoji
    timeoutSeconds: 120,
    maxTries: 3,
    action: 'kick', // kick | mute | ban | none
    muteSeconds: 3600,
    private: true,
    greet: true,
  },

  warngate: {
    on: false,
    days: 7,
  },

  raid: {
    on: true,
    joinsPerMinute: 8,
    action: 'restrict',
    quietSeconds: 180,
  },

  bots: {
    on: true,
    action: 'ban',
  },

  usernameCheck: {
    on: true,
    deleteFake: true, // no username at all
    removeAdminLookalikes: true,
    prefix: '',
  },

  scam: {
    on: true,
    action: 'ban',
    muteAdmins: true,
  },

  reports: {
    on: true,
    threshold: 3,
    action: 'delete',
    notifyAdmins: true,
  },

  lock: {
    on: false,
    until: 0,
    reason: '',
  },

  welcome: {
    on: true,
    text: 'Xush kelibsiz {user}! {rules}',
    deleteAfterSeconds: 0,
    pm: true,
  },

  goodbye: {
    on: false,
    text: '{user} guruhni tark etdi.',
  },

  rules: {
    text: "1. Haqorat qilish taqiqlanadi.\n2. Spam va reklama taqiqlanadi.\n3. Qoidani buzgan 3 marta ogohlantirishdan keyin ban qilinadi.",
  },

  quarantine: {
    on: false,
    minutes: 30,
  },

  clean: {
    serviceMessages: true,
    onJoin: false,
  },

  adminRights: {
    adminsAreExempt: true,
    ownerCommandsOnly: false,
  },

  logs: {
    on: true,
    channelId: null,
    channelUsername: '',
  },

  custom: {
    patterns: [], // { pattern, action, note }
  },
};

export const ACTIONS = ['none', 'delete', 'warn', 'mute', 'kick', 'ban'];

export function isOwner(id) {
  const big = BigInt(id);
  return env.adminIds.some((a) => a === big);
}
