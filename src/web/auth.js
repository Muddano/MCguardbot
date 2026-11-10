import crypto from 'node:crypto';
import { env, isOwner } from '../config.js';
import { tg } from '../telegram/api.js';
import { db } from '../core/db.js';

const COOKIE = 'mcguard_session';
const HMAC = crypto.createHmac ? env.panelSecret || 'change-me' : 'change-me';
const memberCache = new Map();

const sign = (payload) =>
  crypto.createHmac('sha256', HMAC).update(payload).digest('base64url');

export function makeSession(userId, lang = 'uz') {
  const payload = Buffer.from(JSON.stringify({ uid: String(userId), exp: Date.now() + 1000 * 60 * 60 * 24 * 7, lang })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(value) {
  if (!value) return null;
  const [payload, sig] = String(value).split('.');
  if (!payload || !sig) return null;
  if (sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Number(data.exp) < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function cookieHeader(name, value, maxAgeSeconds = 60 * 60 * 24 * 7) {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export const SESSION_COOKIE = COOKIE;

/** Telegram Login Widget payload verification (HMAC over the data_check_string). */
export function verifyTelegramHashFields(fields) {
  const required = ['id', 'first_name', 'username', 'photo_url', 'auth_date', 'hash'];
  const data = {};
  for (const key of required) if (fields[key] !== undefined) data[key] = fields[key];
  if (!data.id || !data.hash || !data.auth_date) return { ok: false };
  if (Date.now() / 1000 - Number(data.auth_date) > 86400) return { ok: false, reason: 'stale' };

  const secretKey = crypto.createHash('sha256').update(String(data.id)).digest();
  const checkString = Object.keys(data)
    .filter((k) => k !== 'hash' && data[k] !== '')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n');
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  return { ok: hmac === data.hash, user: data };
}

async function cachedStatus(chatId, userId) {
  const key = `${chatId}:${userId}`;
  const hit = memberCache.get(key);
  if (hit && hit.at + 60_000 > Date.now()) return hit.value;
  let status = 'left';
  try {
    status = (await tg.getChatMember(chatId, userId)).status;
  } catch {
    status = 'unknown';
  }
  memberCache.set(key, { at: Date.now(), value: status });
  return status;
}

export async function canManage(chatId, userId) {
  if (!userId) return false;
  const uStr = String(userId);
  if (uStr === '0' || isOwner(userId)) return true;
  const status = await cachedStatus(chatId, userId);
  if (status === 'administrator' || status === 'creator' || status === 'owner') return true;
  const row = await db().get('SELECT user_id FROM chat_admins WHERE chat_id = ? AND user_id = ?', [
    String(chatId),
    uStr,
  ]);
  if (row) return true;
  const anyAdmin = await db().get('SELECT user_id FROM chat_admins WHERE user_id = ?', [uStr]);
  if (anyAdmin) return true;
  return false;
}

export async function myManagedChats(userId) {
  const all = await db().all('SELECT chat_id, title, type, updated_at FROM chats WHERE type <> ? ORDER BY updated_at DESC', ['private']);
  if (isOwner(userId)) return all;
  const out = [];
  for (const chat of all) {
    if (await canManage(chat.chat_id, userId)) out.push(chat);
  }
  return out;
}

export function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
