import { getSettings } from './settings.js';
import { detect } from './filters/profanity.js';
import {
  extractDomains, extractInviteLinks, extractMentions, hasLink, countEmojis,
  capsRatio, scamScore,
} from './filters/content.js';
import { listRules } from './rules.js';
import { bumpFlood } from './state.js';
import { compileCustom } from './filters/profanity.js';
import { applyAction, userMention } from './punish.js';
import { tg, escapeHtml } from '../telegram/api.js';
import { reasonLabel, t } from './i18n.js';
import { db } from './db.js';
import { ACTIONS } from '../config.js';

const ACTION_ORDER = { none: 0, delete: 1, warn: 2, mute: 3, kick: 4, ban: 5 };

const MEDIA_KINDS = [
  ['stickers', (m) => !!m.sticker],
  ['gifs', (m) => !!m.animation],
  ['voice', (m) => !!m.voice],
  ['videoNotes', (m) => !!m.video_note],
  ['videos', (m) => !!m.video],
  ['photos', (m) => !!m.photo],
  ['docs', (m) => !!m.document],
  ['contacts', (m) => !!m.contact],
  ['locations', (m) => !!m.location],
  ['games', (m) => !!m.game],
  ['polls', (m) => !!m.poll],
  ['inlineBots', (m) => !!m.inline_query],
];

const memberStatusCache = new Map();
const adminNamesCache = new Map();

function cached(map, key, ttlSeconds, loader) {
  const hit = map.get(key);
  if (hit && hit.at + ttlSeconds * 1000 > Date.now()) return hit.value;
  return loader().then((value) => {
    map.set(key, { at: Date.now(), value });
    return value;
  });
}

/** Used when group rights change (and by tests) so stale admin lookups are dropped. */
export function clearCaches() {
  memberStatusCache.clear();
  adminNamesCache.clear();
}

export function textOf(message) {
  const parts = [];
  if (message.text) parts.push(message.text);
  if (message.caption) parts.push(message.caption);
  if (message.game?.description) parts.push(`${message.game.title} ${message.game.description}`);
  if (message.poll?.question) parts.push(message.poll.question);
  return parts.join('\n');
}

export function mediaKind(message) {
  for (const [name, test] of MEDIA_KINDS) if (test(message)) return name;
  return null;
}

function isForwarded(message) {
  return Boolean(message.forward_origin || message.forward_from || message.forward_from_chat || message.forward_date);
}

function forwardedFromId(message) {
  const o = message.forward_origin;
  if (o?.sender_user_id) return String(o.sender_user_id);
  if (o?.sender_chat_id) return String(o.sender_chat_id);
  if (message.forward_from_chat?.id) return String(message.forward_from_chat.id);
  if (message.forward_from?.id) return String(message.forward_from.id);
  return '';
}

function linkWhitelisted(domains, whitelist = []) {
  const rules = whitelist.map((w) => String(w).toLowerCase().replace(/^(https?:)?\/\//, '').replace(/^www\./, ''));
  return domains.some((d) => rules.some((r) => d === r || d.endsWith(`.${r}`) || r.includes(d)));
}

async function memberStatus(chatId, userId) {
  return cached(memberStatusCache, `${chatId}:${userId}`, 45, async () => {
    try {
      const m = await tg.getChatMember(chatId, userId);
      return m.status;
    } catch {
      return 'member';
    }
  });
}

async function adminNames(chatId) {
  return cached(adminNamesCache, String(chatId), 300, async () => {
    try {
      const list = await tg.call('getChatAdministrators', { chat_id: Number(chatId) });
      return list.map((a) => a.user.username || a.user.first_name || '');
    } catch {
      return [];
    }
  });
}

async function gatePassed(chatId, userId) {
  const row = await db().get('SELECT captcha_done FROM members WHERE chat_id = ? AND user_id = ?', [
    String(chatId),
    String(userId),
  ]);
  return Number(row?.captcha_done ?? 0) === 1;
}

/**
 * Runs every enabled rule against one message.
 * @returns {{violations: Array, applied: object|null}}
 */
export async function evaluate(message, settings, { skipFlood = false, skipGate = false } = {}) {
  const text = textOf(message);
  const violations = [];
  const author = message.from;
  if (!author || author.is_bot) return { violations, applied: null };

  const kind = mediaKind(message);
  const domains = extractDomains(text);
  const push = (key, rule, extra = {}) => {
    if (!rule?.on) return;
    violations.push({
      key,
      action: rule.action ?? 'delete',
      seconds: rule.muteSeconds ?? 0,
      banSeconds: rule.banSeconds ?? 0,
      warnCount: rule.warnCount ?? 1,
      delete: rule.delete !== false && (rule.action ?? 'delete') !== 'none',
      ...extra,
    });
  };

  // 1. profanity + custom regex rules. Custom panel words must fire even when
  // the built-in profanity switch is off; push() no-ops the generic rule itself.
  if (text) {
    const custom = compileCustom(await listRules(message.chat.id).catch(() => []));
    const hit = detect(text, {
      langs: settings.profanity.langs,
      minSeverity: settings.profanity.minSeverity ?? 1,
      custom,
    });
    if (!hit.clean) {
      push('profanity', settings.profanity, { detail: hit.hits.map((h) => h.label).join(', ') });
      // A panel rule carries its own punishment; it must outrank the generic
      // profanity action, otherwise "ban this phrase" silently degrades to a warn.
      const adminRules = hit.hits.filter((h) => h.custom);
      for (const h of adminRules) {
        const action = ACTIONS.includes(h.action) ? h.action : settings.profanity.action;
        violations.push({
          key: 'custom',
          action,
          seconds: settings.profanity.muteSeconds ?? 0,
          banSeconds: settings.profanity.banSeconds ?? 0,
          warnCount: settings.profanity.warnCount ?? 1,
          delete: action !== 'none',
          detail: h.label,
        });
      }
    }
  }

  // 2. links
  if (settings.links?.on && domains.length && !linkWhitelisted(domains, settings.links.whitelist)) {
    push('links', settings.links, { detail: domains.join(' ') });
  }

  // 3. ads: invite links and channel handles
  if (settings.ads?.on && text) {
    const invites = settings.ads.checkJoinLinks ? extractInviteLinks(text) : [];
    const mentions = settings.ads.checkChannelMentions ? extractMentions(text) : [];
    const own = String(message.chat.username || '').toLowerCase();
    const adChannels = mentions.filter((m) => m !== own && !m.includes('mcguard'));
    if (invites.length || adChannels.length) {
      push('ads', settings.ads, { detail: [...invites, ...adChannels].join(', ') });
    }
  }

  // 4. forwarded messages
  if (settings.forwarded?.on && isForwarded(message)) {
    const from = forwardedFromId(message);
    const allowed = (settings.forwarded.allowFrom ?? []).map(String);
    if (!allowed.includes(from)) push('forwarded', settings.forwarded, { detail: from });
  }

  // 5. too many mentions
  if (settings.mentions?.on && text) {
    const count = extractMentions(text).length;
    if (count > (settings.mentions.max ?? 3)) push('mentions', settings.mentions, { detail: String(count) });
  }

  // 6. caps lock
  if (settings.caps?.on && text) {
    const ratio = capsRatio(text);
    const letters = (text.match(/[^\s]/g) ?? []).length;
    if (ratio * 100 > (settings.caps.max ?? 70) && letters > 12) push('caps', settings.caps, { detail: `${Math.round(ratio * 100)}%` });
  }

  // 7. emoji spam
  if (settings.emojis?.on) {
    const n = countEmojis(text);
    if (n > (settings.emojis.max ?? 10)) push('emojis', settings.emojis, { detail: String(n) });
  }

  // 8. banned media type
  if (kind) {
    const rule = settings.media?.[kind];
    if (rule?.on) push('media', rule, { detail: kind });
  }

  // 9. scam links
  if (settings.scam?.on && domains.length) {
    const names = await adminNames(message.chat.id);
    const { score } = scamScore(text, { domains, adminUsernames: names.filter(Boolean) });
    if (score >= 4) push('scam', settings.scam, { detail: domains.join(' ') });
  }

  // 10. flood
  if (settings.antiflood?.on && !skipFlood) {
    const count = bumpFlood(message.chat.id, author.id, {
      max: settings.antiflood.max,
      windowSeconds: settings.antiflood.windowSeconds,
    });
    if (count > (settings.antiflood.max ?? 6)) push('flood', settings.antiflood, { detail: String(count) });
  }

  // 11. subscription / captcha gate
  const gateOn = !skipGate && (settings.subscriptions?.on || settings.captcha?.on);
  if (gateOn && !isForwarded(message)) {
    const passed = await gatePassed(message.chat.id, author.id).catch(() => true);
    if (!passed) {
      violations.push({
        key: 'gate',
        action: 'delete',
        seconds: 0,
        delete: true,
        warnCount: 0,
      });
    }
  }

  return { violations, applied: null };
}

function pickWorst(violations) {
  let worst = null;
  for (const v of violations) {
    const rank = ACTION_ORDER[v.action] ?? 1;
    if (!worst || rank > (ACTION_ORDER[worst.action] ?? 1)) worst = v;
  }
  return worst;
}

/**
 * Full pipeline: evaluate, then punish once (the strictest rule wins).
 * Returns null when the message is clean or the sender is protected.
 */
export async function moderateMessage(message, { force = false } = {}) {
  const settings = await getSettings(message.chat.id);
  if (!settings.enabled) return null;
  if (message.chat.type === 'private' && !settings.profanity?.private) return null;

  const { violations } = await evaluate(message, settings);
  if (!violations.length) return null;

  const author = message.from;
  if (!author) return null;

  const privileged = await memberStatus(message.chat.id, author.id);
  const isStaff = privileged === 'administrator' || privileged === 'creator' || privileged === 'owner';
  if (isStaff && settings.adminRights?.adminsAreExempt && !force) {
    if (violations.some((v) => v.key === 'profanity' || v.key === 'custom')) {
      const lang = settings.lang;
      const reasons = violations.map((v) => reasonLabel(lang, v.key)).filter(Boolean);
      const reason = [...new Set(reasons)].join(', ');
      const notice = await tg
        .sendMessage(
          message.chat.id,
          `ℹ️ <i>Admin xabarida qoidabuzarlik aniqlandi (${escapeHtml(reason)}), lekin administratorlar himoyalangan (adminsAreExempt: true).</i>`,
        )
        .catch(() => {});
      if (notice?.message_id) {
        setTimeout(() => {
          tg.deleteMessage(message.chat.id, notice.message_id).catch(() => {});
        }, 7000);
      }
    }
    return null;
  }

  const worst = pickWorst(violations);
  if (!worst || (!force && worst.action === 'none' && !worst.delete)) return null;

  const lang = settings.lang;
  const reasons = violations.map((v) => reasonLabel(lang, v.key)).filter(Boolean);
  const reason = [...new Set(reasons)].join(', ');

  if (worst.delete) {
    await tg.deleteMessage(message.chat.id, message.message_id).catch(() => {});
  }
  if (worst.action === 'none' || worst.action === 'delete' || worst.key === 'gate') {
    if (worst.action === 'delete' && worst.key !== 'gate') {
      const notice = await tg
        .sendMessage(
          message.chat.id,
          `${t(lang, 'deleted_reason', { reason: reason || reasonLabel(lang, worst.key) })}\n👤 ${userMention(author)}`,
        )
        .catch(() => {});
      if (notice?.message_id) {
        setTimeout(() => {
          tg.deleteMessage(message.chat.id, notice.message_id).catch(() => {});
        }, 7000);
      }
    }
    return { violations, deleted: true, action: worst.action };
  }

  const rule = { action: worst.action, muteSeconds: worst.seconds, banSeconds: worst.banSeconds };
  if (worst.action === 'warn') {
    for (let i = 0; i < Math.max(1, worst.warnCount || 1); i++) {
      await applyAction(message.chat.id, author, rule, { reason, by: null });
    }
  } else {
    await applyAction(message.chat.id, author, rule, { reason, by: null });
  }

  return { violations, deleted: worst.delete, action: worst.action, reason };
}

/** Silent variant used by the panel when an admin previews a rule. */
export async function preview(text, settings) {
  const fake = { chat: { id: -1000000000000, type: 'group', username: 'preview' }, from: { id: 1, is_bot: false, first_name: 'X' }, text, message_id: 1 };
  const custom = compileCustom((settings.custom?.patterns ?? []).map((p) => (typeof p === 'string' ? { pattern: p } : p)));
  const hit = detect(text, { langs: settings.profanity?.langs, minSeverity: settings.profanity?.minSeverity ?? 1, custom });
  const domains = extractDomains(text);
  const { violations } = await evaluate(fake, settings, { skipFlood: true, skipGate: true });
  const worst = pickWorst(violations);
  return {
    clean: violations.length === 0,
    verdict: worst ? { key: worst.key, action: worst.action } : { key: null, action: 'none' },
    reasons: [...new Set(violations.map((v) => reasonLabel(settings.lang ?? 'uz', v.key)).filter(Boolean))],
    profanity: hit.hits,
    domains,
    invites: extractInviteLinks(text),
    mentions: extractMentions(text),
    emojis: countEmojis(text),
    caps: capsRatio(text),
    media: mediaKind(fake) ?? 'text',
  };
}

export function notifyDelete(chatId, messageId, reason, lang = 'uz') {
  return tg.sendMessage(chatId, t(lang, 'deleted_reason', { reason: escapeHtml(reason) })).catch(() => {});
}
