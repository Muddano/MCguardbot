import crypto from 'node:crypto';
import { db, now } from './db.js';

const id = () => crypto.randomUUID();

export async function listRules(chatId) {
  return db().all('SELECT id, pattern, action, note, created_at FROM filters WHERE chat_id = ? ORDER BY created_at', [String(chatId)]);
}

export async function addRule(chatId, { pattern, action = 'delete', note = '' }) {
  const row = { id: id(), chat_id: String(chatId), pattern, action, note, created_at: now() };
  await db().run(
    'INSERT INTO filters (id, chat_id, pattern, action, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [row.id, row.chat_id, row.pattern, row.action, row.note, row.created_at],
  );
  return row;
}

export async function removeRule(chatId, ruleId) {
  await db().run('DELETE FROM filters WHERE chat_id = ? AND id = ?', [String(chatId), ruleId]);
}

export async function clearRules(chatId) {
  await db().run('DELETE FROM filters WHERE chat_id = ?', [String(chatId)]);
}

/** Locked users survive a ban and are re-banned the moment they rejoin. */
export async function lockUser(chatId, userId, reason = '') {
  await db().run(
    `INSERT INTO locks (chat_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET reason = excluded.reason`,
    [String(chatId), String(userId), reason, now()],
  );
}

export async function unlockUser(chatId, userId) {
  await db().run('DELETE FROM locks WHERE chat_id = ? AND user_id = ?', [String(chatId), String(userId)]);
}

export async function isLocked(chatId, userId) {
  const row = await db().get('SELECT reason FROM locks WHERE chat_id = ? AND user_id = ?', [String(chatId), String(userId)]);
  return row ? row.reason || '' : null;
}

export async function listLocked(chatId) {
  return db().all('SELECT user_id, reason, created_at FROM locks WHERE chat_id = ? ORDER BY created_at DESC LIMIT 200', [String(chatId)]);
}
