const URL_RE = /\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|me|cc|ru|uz|tk|ml|ga|gq|cf|xyz|top|online|site|shop|store|live|fun|pw|su|info|biz|click|link|vip|pro|club|space|website|tech|world|news|tv|gg|gg\.la|to|is|im|fm|sx|st|ly|gl|sh|bi|dz|ag|am|ws|mo|nu|co|kd|lb|tl|uyt)\b(?:\/[^\s<>"')\]]*)?/gi;

const TME_INVITE = /(?:t(?:elegram)?\.me|[tg]\.ly|telegram\.dog)\/(?:\+|invite\/|joinchat\/)([a-z0-9_-]+)/gi;
const TME_ANY = /(?:t(?:elegram)?\.me)\/([a-z0-9_+/]{3,})/gi;
const AT_MENTION = /(^|\s)@([a-z][a-z0-9_]{3,31})/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.cn', 'goo.gl', 'is.gd', 'buff.ly', 'ow.ly', 'cutt.ly',
  'rb.gy', 'short.link', 'rebrand.ly', 'cli.pw', 's.id', 'linktr.ee', 'lnkd.in',
]);

// Bundled so the filter works offline; SCAM_LIST_URL can extend it at boot.
const SCAM_HINTS = [
  'nitro', 'dlscord', 'dlscordapp', 'discordgift', 'discord-nitro', 'free-gift',
  'steamcommunity', 'steamgift', 'airdrop', 'giveaway', 'claim-your', 'premium-vote',
  'vote-for-my', 'donate-alert', 'cryptofund', 'binance-verify', 'wallet-connect',
  'metamask', 'seed-phrase', 'payday-loan', 'onlyfans', 'adult', 'xxx', 'porn',
  'telegram-premium-sale', 'puls 24', 'kassa', 'polu', 'uzum-market',
];

export function extractDomains(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(URL_RE)) {
    let raw = m[0].replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '');
    raw = raw.split(/[\/?#]/)[0].toLowerCase();
    if (raw.includes('.')) out.add(raw);
  }
  return [...out];
}

export function hasLink(text) {
  return extractDomains(text).length > 0;
}

export function extractInviteLinks(text) {
  return [...String(text ?? '').matchAll(TME_INVITE)].map((m) => m[1]);
}

export function extractTmePaths(text) {
  return [...String(text ?? '').matchAll(TME_ANY)].map((m) => m[1]);
}

export function extractMentions(text) {
  return [...String(text ?? '').matchAll(AT_MENTION)].map((m) => m[2].toLowerCase());
}

export function countEmojis(text) {
  return [...String(text ?? '').matchAll(EMOJI_RE)].length;
}

export function capsRatio(text) {
  const s = String(text ?? '');
  const letters = [...s].filter((c) => /[a-zа-яё]/i.test(c));
  if (letters.length < 8) return 0;
  const upper = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return upper / letters.length;
}

/**
 * Cheap scam heuristics: known-bad host, link shortener, giveaway keywords
 * next to a link, or a domain that mimics a group admin's username.
 */
export function scamScore(text, { domains = [], adminUsernames = [], blocklist = [] } = {}) {
  const lower = String(text ?? '').toLowerCase();
  let score = 0;
  const reasons = [];

  for (const d of domains) {
    const root = d.split('.').slice(-2).join('.');
    const flatDomain = d.replace(/[^a-z0-9]/g, '');
    const label = d.split('.')[0].replace(/[^a-z0-9]/g, '');
    if (blocklist.includes(d) || blocklist.includes(root)) {
      score += 3;
      reasons.push(`domain:${d}`);
    }
    if (SHORTENERS.has(d)) {
      score += 2;
      reasons.push(`shortener:${d}`);
    }
    for (const hint of SCAM_HINTS) {
      const hintFlat = hint.replace(/[^a-z0-9]/g, '');
      if (hintFlat && flatDomain.includes(hintFlat)) {
        score += 2;
        reasons.push(`lookalike:${d}`);
        break;
      }
    }
    for (const name of adminUsernames) {
      const clean = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (clean.length < 4) continue;
      if (label !== clean && levenshteinNear(label, clean)) {
        score += 3;
        reasons.push(`impersonation:${d}`);
      }
    }
  }

  for (const hint of ['nitro', 'free gift', 'bedava', 'airdrop', 'giveaway', 'vote for my', 'premium 1 god', '1 god premium']) {
    if (lower.includes(hint)) {
      score += domains.length ? 2 : 0;
      if (domains.length) reasons.push(`keyword:${hint}`);
    }
  }

  return { score, reasons };
}

function levenshteinNear(a, b) {
  if (Math.abs(a.length - b.length) > 3) return false;
  const dist = levenshtein(a, b, 3);
  return dist !== null && dist <= 2;
}

function levenshtein(a, b, cap) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > cap) return null;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return null;
    prev = cur;
  }
  return prev[n];
}

/** Same text posted twice is the classic spam signature. */
export function dupKey(text) {
  const norm = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-zа-яё0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return norm.slice(0, 120);
}

export function looksLikeAd(text, { mentions = [], whitelist = [] } = {}) {
  const bad = mentions.filter((m) => !whitelist.map((w) => w.replace(/^@/, '').toLowerCase()).includes(m));
  return { adChannels: bad, hasAd: bad.length > 0 };
}

export { SCAM_HINTS };
