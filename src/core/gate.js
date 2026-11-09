import crypto from 'node:crypto';
import { tg } from '../telegram/api.js';
import { db, now } from './db.js';
import { t } from './i18n.js';
import { channelGate, captchaKeyboard } from '../telegram/keyboard.js';
import { mute } from './punish.js';
import { setCaptchaTimer } from './state.js';

const rand = (n) => Number(crypto.randomInt(0, n));

export function makeCaptcha(type = 'math') {
  if (type === 'text') {
    const words = ['kit', 'ore', 'mop', 'sun', 'box', 'net', 'red', 'cat', 'dog', 'lap'];
    const pick = words[rand(words.length)];
    const options = shuffle([pick, ...pickDistinct(words, pick, 3)]);
    return { question: `So‘zni tanlang / choose the word: <b>${pick.toUpperCase()}</b>`, answer: pick, options };
  }
  if (type === 'emoji') {
    const emojis = ['🍎', '🚀', '🐍', '⛏️', '🧟', '🎮', '🐉', '🌵'];
    const options = shuffle(emojis.slice(0, 4));
    const pick = options[rand(options.length)];
    return { question: `Bosimg / tap: ${pick}`, answer: pick, options };
  }
  const a = rand(9) + 2;
  const b = rand(9) + 1;
  const answer = a + b;
  const options = shuffle([...new Set([answer, answer + rand(4) + 1, answer - rand(4) - 1, answer + rand(7) + 2])]);
  while (options.length < 4) options.push(answer + options.length + 3);
  return { question: `${a} + ${b} = ?`, answer: String(answer), options: options.slice(0, 4) };
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickDistinct(pool, exclude, count) {
  return pool.filter((w) => w !== exclude).sort(() => Math.random() - 0.5).slice(0, count);
}

/** keepTries: re-issuing a question must not hand the user a fresh try budget. */
export async function saveCaptcha(chatId, userId, { question, answer }, timeoutSeconds, { keepTries = false } = {}) {
  await db().run(
    `INSERT INTO captcha (chat_id, user_id, answer, question, tries, expires_at, message_id)
     VALUES (?, ?, ?, ?, 0, ?, 0)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET
       answer = excluded.answer, question = excluded.question,
       tries = ${keepTries ? 'captcha.tries' : 'excluded.tries'}, expires_at = excluded.expires_at`,
    [String(chatId), String(userId), answer, question, now() + timeoutSeconds],
  );
  setCaptchaTimer(chatId, userId, timeoutSeconds);
  return { question, answer };
}

export async function getCaptcha(chatId, userId) {
  return db().get('SELECT answer, question, tries, expires_at, message_id FROM captcha WHERE chat_id = ? AND user_id = ?', [
    String(chatId),
    String(userId),
  ]);
}

export async function bumpTries(chatId, userId) {
  await db().run('UPDATE captcha SET tries = tries + 1 WHERE chat_id = ? AND user_id = ?', [String(chatId), String(userId)]);
  const row = await getCaptcha(chatId, userId);
  return row?.tries ?? 1;
}

export async function dropCaptchaRow(chatId, userId) {
  await db().run('DELETE FROM captcha WHERE chat_id = ? AND user_id = ?', [String(chatId), String(userId)]);
}

export async function markVerified(chatId, userId) {
  await db().run(
    `INSERT INTO members (chat_id, user_id, captcha_done) VALUES (?, ?, 1)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET captcha_done = 1`,
    [String(chatId), String(userId)],
  );
}

export async function setUnverified(chatId, userId) {
  await db().run(
    `INSERT INTO members (chat_id, user_id, joined_at, is_member, captcha_done) VALUES (?, ?, ?, 1, 0)
     ON CONFLICT (chat_id, user_id) DO UPDATE SET captcha_done = 0`,
    [String(chatId), String(userId), now()],
  );
}

/** True when the user is subscribed to every required channel. */
export async function checkSubscription(chatId, userId, channels = []) {
  for (const ch of channels) {
    const target = ch.id || ch.username;
    if (!target) continue;
    try {
      const member = await tg.getChatMember(target, userId);
      if (member.status === 'left' || member.status === 'kicked') return { ok: false, missing: ch };
    } catch {
      // Channel unreachable: do not punish the whole group for a config typo.
      continue;
    }
  }
  return { ok: true };
}

export async function sendGateMessage(chatId, user, settings, reason) {
  const lang = settings.lang;
  const privateTarget = settings.captcha?.private || reason === 'captcha';
  const chatTarget = privateTarget ? user.id : chatId;

  if (reason === 'captcha') {
    const cap = makeCaptcha(settings.captcha.type);
    await saveCaptcha(chatId, user.id, cap, settings.captcha.timeoutSeconds);
    const text = t(lang, 'captcha_q', { question: cap.question, timeout: settings.captcha.timeoutSeconds });
    const sent = await tg.sendMessage(chatTarget, text, { reply_markup: captchaKeyboard({ chatId, userId: user.id, lang }) }).catch(() => null);
    if (sent) await db().run('UPDATE captcha SET message_id = ? WHERE chat_id = ? AND user_id = ?', [sent.message_id, String(chatId), String(user.id)]);
    return sent;
  }

  const channels = settings.subscriptions.channels ?? [];
  const text = t(lang, 'need_channel', { title: channels.map((c) => c.username ? `@${c.username}` : c.title).join(', ') });
  return tg.sendMessage(chatTarget, text, { reply_markup: channelGate({ chatId, userId: user.id, channels, lang }) }).catch(() => null);
}

/**
 * Restricts a newcomer until the gate is passed. Never throws: a failed mute
 * must not stop the welcome flow.
 */
export async function enforceGate(chatId, user, settings) {
  const subsOn = settings.subscriptions?.on && (settings.subscriptions.channels ?? []).length;
  if (subsOn) {
    const res = await checkSubscription(chatId, user.id, settings.subscriptions.channels);
    if (!res.ok) {
      await setUnverified(chatId, user.id);
      if (settings.subscriptions.kickInsteadOfMute) {
        await tg.kick(chatId, user.id).catch(() => {});
      } else {
        await mute(chatId, user, 0, { reason: 'subscription', silent: true }).catch(() => {});
      }
      if (settings.subscriptions.notice) await sendGateMessage(chatId, user, settings, 'subscription');
      return { blocked: true, reason: 'subscription' };
    }
  }

  if (settings.captcha?.on) {
    const row = await getCaptcha(chatId, user.id);
    if (!row) {
      await setUnverified(chatId, user.id);
      await mute(chatId, user, 0, { reason: 'captcha', silent: true }).catch(() => {});
      await sendGateMessage(chatId, user, settings, 'captcha');
      return { blocked: true, reason: 'captcha' };
    }
    return { blocked: true, reason: 'captcha', pending: true };
  }

  await markVerified(chatId, user.id);
  return { blocked: false };
}
