import { db, now } from './db.js';
import { DEFAULT_SETTINGS } from '../config.js';

const cache = new Map();
const CACHE_TTL_MS = 20_000;

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, patch) {
  if (!isObj(patch)) return patch === undefined ? base : patch;
  const out = {};
  for (const key of Object.keys(base)) out[key] = structuredClone(base[key]);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : structuredClone(v);
  }
  return out;
}

function stripDefaults(s) {
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (JSON.stringify(v) === JSON.stringify(DEFAULT_SETTINGS[k])) continue;
    out[k] = v;
  }
  return out;
}

export async function getSettings(chatId) {
  const id = String(chatId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = await db().get('SELECT settings FROM chats WHERE chat_id = ?', [id]);
  let stored = {};
  if (row) {
    try {
      stored = JSON.parse(row.settings) || {};
    } catch {
      stored = {};
    }
  }
  const value = deepMerge(DEFAULT_SETTINGS, stored);
  cache.set(id, { at: Date.now(), value });
  return value;
}

export async function patchSettings(chatId, patch) {
  const current = await getSettings(chatId);
  const next = deepMerge(current, patch);
  cache.delete(String(chatId));
  await db().run(
    `INSERT INTO chats (chat_id, title, type, settings, created_at, updated_at)
     VALUES (?, '', 'group', ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    [String(chatId), JSON.stringify(stripDefaults(next)), now(), now()],
  );
  return next;
}

export async function touchChat(chatId, { title = '', type = 'group' } = {}) {
  const id = String(chatId);
  const existing = await db().get('SELECT chat_id FROM chats WHERE chat_id = ?', [id]);
  if (existing) {
    if (title) {
      await db().run('UPDATE chats SET title = ?, type = ?, updated_at = ? WHERE chat_id = ?', [
        title,
        type,
        now(),
        id,
      ]);
    }
    return;
  }
  await db().run(
    `INSERT INTO chats (chat_id, title, type, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (chat_id) DO UPDATE SET title = excluded.title, type = excluded.type`,
    [id, title, type, JSON.stringify({}), now(), now()],
  );
}

export async function forgetChat(chatId) {
  const id = String(chatId);
  cache.delete(id);
  await db().run('DELETE FROM chats WHERE chat_id = ?', [id]);
  await db().run('DELETE FROM chat_admins WHERE chat_id = ?', [id]);
  await db().run('DELETE FROM filters WHERE chat_id = ?', [id]);
  await db().run('DELETE FROM captcha WHERE chat_id = ?', [id]);
}

export async function listChats() {
  const rows = await db().all(
    'SELECT chat_id, title, type, settings, updated_at FROM chats ORDER BY updated_at DESC',
  );
  return rows.map((r) => ({
    chat_id: r.chat_id,
    title: r.title,
    type: r.type,
    updated_at: r.updated_at,
    settings: deepMerge(DEFAULT_SETTINGS, JSON.parse(r.settings || '{}')),
  }));
}

/** Effective settings for a message: defaults + saved + admin override. */
export async function settingsFor(chatId) {
  return getSettings(chatId);
}

export function clearCache() {
  cache.clear();
}
