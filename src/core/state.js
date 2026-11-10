import { env } from '../config.js';

const flood = new Map();
const raid = new Map();
const reports = new Map();
const captchaTimers = new Map();
const seenUpdates = new Map();
// Bir xabar bir marta jazolansin: chatId:messageId → timestamp
const processedMessages = new Map();

const ttl = () => env.floodCacheTtlMs;

function prune(map, maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [k, v] of map) {
    const ts = v?.at ?? v?.ts ?? v;
    if (typeof ts === 'number' && ts < cutoff) map.delete(k);
  }
}

export function bumpFlood(chatId, userId, { max, windowSeconds }) {
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;
  const bucket = (flood.get(key)?.v ?? []).filter((ts) => ts > cutoff);
  bucket.push(now);
  flood.set(key, { ts: now, v: bucket });
  return bucket.length;
}

export function resetFlood(chatId, userId) {
  flood.delete(`${chatId}:${userId}`);
}

export function noteJoin(chatId) {
  const now = Date.now();
  const list = (raid.get(chatId)?.v ?? []).filter((ts) => ts > now - 60_000);
  list.push(now);
  raid.set(chatId, { ts: now, v: list });
  return list.length;
}

export function raidActive(chatId) {
  const entry = raid.get(chatId);
  if (!entry) return false;
  return entry.until ? entry.until > now() : false;
}

export function startRaid(chatId, seconds) {
  raid.set(chatId, { ts: Date.now(), v: [], until: now() + seconds });
}

export function now() {
  return Math.floor(Date.now() / 1000);
}

export function addReport(chatId, messageId, target, userId) {
  const key = `${chatId}:${messageId}:${target}`;
  const set = reports.get(key) ?? new Set();
  if (set.has(userId)) return { fresh: false, count: set.size };
  set.add(userId);
  reports.set(key, { ts: Date.now(), v: set });
  return { fresh: true, count: set.size };
}

export function clearReport(chatId, messageId, target) {
  reports.delete(`${chatId}:${messageId}:${target}`);
}

export function setCaptchaTimer(chatId, userId, timeoutSeconds) {
  captchaTimers.set(`${chatId}:${userId}`, {
    ts: Date.now() + timeoutSeconds * 1000,
    at: Date.now(),
  });
}

export function captchaExpired(chatId, userId) {
  const entry = captchaTimers.get(`${chatId}:${userId}`);
  if (!entry) return true;
  return entry.ts < Date.now();
}

export function dropCaptcha(chatId, userId) {
  captchaTimers.delete(`${chatId}:${userId}`);
}

/** Telegram redelivers webhook updates; a processed id must never run twice. */
export function clearCache() {
  flood.clear();
  raid.clear();
  reports.clear();
  captchaTimers.clear();
  processedMessages.clear();
}

export function isDuplicateUpdate(id) {
  if (seenUpdates.has(id)) return true;
  seenUpdates.set(id, Date.now());
  return false;
}

/**
 * Bir chat+message_id juftligi faqat bir marta moderatsiya qilinsin.
 * Render.com da webhook timeout bo'lsa Telegram bir xabarni qayta yuborishi mumkin.
 */
export function markMessageProcessed(chatId, messageId) {
  const key = `${chatId}:${messageId}`;
  if (processedMessages.has(key)) return false; // allaqachon qayta ishlangan
  processedMessages.set(key, Date.now());
  return true; // yangi, qayta ishlansin
}

setInterval(() => {
  prune(flood, ttl());
  prune(raid, ttl());
  prune(reports, ttl());
  prune(captchaTimers, ttl());
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, ts] of seenUpdates) if (ts < cutoff) seenUpdates.delete(id);
  // processedMessages 10 daqiqa saqlanadi
  const msgCutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, ts] of processedMessages) if (ts < msgCutoff) processedMessages.delete(k);
}, 60_000).unref?.();
