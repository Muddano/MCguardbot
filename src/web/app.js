import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isOwner } from '../config.js';
import { handleUpdate } from '../core/router.js';
import { getSettings, patchSettings, listChats, touchChat } from '../core/settings.js';
import { db, now } from '../core/db.js';
import { ban, unban, kick, mute, unmute, warn, clearWarns, logAction } from '../core/punish.js';
import { addRule, listRules, removeRule, lockUser, unlockUser, listLocked } from '../core/rules.js';
import { preview } from '../core/moderation.js';
import { buildPatch, SECTIONS, getIn } from './schema.js';
import { dashboardPage, groupPage, loginPage, esc } from './views.js';
import {
  SESSION_COOKIE, cookieHeader, makeSession, parseCookies, readSession,
  verifyTelegramHashFields, canManage, myManagedChats, timingSafeEqual,
} from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const userFrom = (req) => readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);

function denied(res, req, wantHtml) {
  if (wantHtml) return res.status(403).send('<h1>403</h1>');
  return res.status(403).json({ ok: false, error: 'forbidden' });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '128kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use('/assets', express.static(path.join(here, 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  app.get('/healthz', (_req, res) => res.json({ ok: true, ts: now() }));

  // ---- Telegram webhook -------------------------------------------------
  app.post(/^\/tg\/[a-z0-9_-]+$/i, (req, res) => {
    if (env.webhookSecret && req.headers['x-telegram-bot-api-secret-token'] !== env.webhookSecret) {
      return res.sendStatus(403);
    }
    res.sendStatus(200);
    handleUpdate(req.body).catch((err) => console.error('webhook update', err?.message));
  });

  // ---- auth -------------------------------------------------------------
  app.get('/login', (req, res) => {
    const user = userFrom(req);
    if (user) return res.redirect('/');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(loginPage({ lang: req.query.lang ?? 'uz', error: req.query.error ?? '', botUsername: env.ownerUsername }));
  });

  app.post('/login', (req, res) => {
    const code = String(req.body?.code ?? '');
    if (!env.panelSecret || !timingSafeEqual(code, env.panelSecret)) {
      return res.redirect('/login?error=' + encodeURIComponent('wrong code'));
    }
    const owner = env.adminIds[0] ? String(env.adminIds[0]) : '0';
    res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, makeSession(owner)));
    res.redirect('/');
  });

  app.get('/auth/telegram', (req, res) => {
    const { ok, user, reason } = verifyTelegramHashFields(req.query);
    if (!ok) return res.redirect('/login?error=' + encodeURIComponent(reason ?? 'bad signature'));
    if (!isOwner(user.id)) {
      // Non-owner may still continue if they manage at least one group.
    }
    res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, makeSession(user.id)));
    res.redirect('/');
  });

  app.get('/logout', (_req, res) => {
    res.setHeader('Set-Cookie', cookieHeader(SESSION_COOKIE, '', 0));
    res.redirect('/login');
  });

  const requireUser = (req, res, next) => {
    const user = userFrom(req);
    if (!user) {
      if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'login' });
      return res.redirect('/login');
    }
    req.user = user;
    next();
  };

  // ---- pages ------------------------------------------------------------
  app.get('/', requireUser, async (req, res) => {
    const chats = await myManagedChats(req.user.uid);
    const withSettings = [];
    for (const c of chats) withSettings.push({ ...c, settings: await getSettings(c.chat_id) });
    const totals = await readTotals(req.user.uid);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(dashboardPage({ user: req.user, chats: withSettings, lang: req.user.lang ?? 'uz', totals }));
  });

  app.get('/g/:chatId', requireUser, async (req, res) => {
    const chatId = req.params.chatId;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req, true);
    const settings = await getSettings(chatId);
    const tab = String(req.query.tab ?? 'settings');
    const data = await readGroupData(chatId, settings, tab);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(
      groupPage({
        chat: { chat_id: chatId, title: data.title },
        settings,
        user: req.user,
        lang: settings.lang ?? req.user.lang ?? 'uz',
        tab,
        data,
      }),
    );
  });

  // ---- api --------------------------------------------------------------
  app.get('/api/chats', requireUser, async (req, res) => {
    const chats = await myManagedChats(req.user.uid);
    res.json({ ok: true, chats });
  });

  app.get('/api/chat/:chatId', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    res.json({ ok: true, settings: await getSettings(chatId), schema: SECTIONS.map((s) => s.fields.map((f) => f.path)) });
  });

  app.post('/api/chat/:chatId/settings', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    const patch = buildPatch(req.body?.patch ?? req.body);
    const next = await patchSettings(chatId, patch);
    await touchChat(chatId, { type: 'supergroup' });
    res.json({ ok: true, settings: next });
  });

  app.post('/api/chat/:chatId/action', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    const { action, userId, reason = '', seconds = 0 } = req.body ?? {};
    const user = { id: Number(userId), first_name: String(userId) };
    const by = { id: Number(req.user.uid) };
    const map = {
      ban: () => ban(chatId, user, { by, reason, seconds: Number(seconds) || 0, via: 'panel' }),
      unban: () => unban(chatId, user, { by, via: 'panel' }),
      kick: () => kick(chatId, user, { by, reason, via: 'panel' }),
      mute: () => mute(chatId, user, Number(seconds) || 3600, { by, reason, via: 'panel' }),
      unmute: () => unmute(chatId, user, { by, via: 'panel' }),
      warn: () => warn(chatId, user, { by, reason, via: 'panel' }),
      unwarn: async () => {
        await clearWarns(chatId, user.id);
        await logAction(chatId, 'unwarn', user.id, by.id, reason, 'panel');
      },
      lock: async () => {
        await lockUser(chatId, user.id, reason);
        return ban(chatId, user, { by, reason, silent: true, via: 'panel' });
      },
      unlock: async () => {
        await unlockUser(chatId, user.id);
        return unban(chatId, user, { by, via: 'panel' });
      },
    };
    const fn = map[action];
    if (!fn) return res.status(400).json({ ok: false, error: 'unknown action' });
    await fn();
    res.json({ ok: true });
  });

  app.get('/api/chat/:chatId/rules', requireUser, async (req, res) => {
    if (!(await canManage(req.params.chatId, req.user.uid))) return denied(res, req);
    res.json({ ok: true, rules: await listRules(req.params.chatId) });
  });

  app.post('/api/chat/:chatId/rules', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    const row = await addRule(chatId, { pattern: req.body.pattern, action: req.body.action ?? 'warn', note: req.body.note ?? '' });
    res.json({ ok: true, rule: row });
  });

  app.delete('/api/chat/:chatId/rules/:ruleId', requireUser, async (req, res) => {
    const { chatId, ruleId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    await removeRule(chatId, ruleId);
    res.json({ ok: true });
  });

  app.get('/api/chat/:chatId/preview', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    const settings = await getSettings(chatId);
    res.json({ ok: true, result: await preview(String(req.query.text ?? ''), settings) });
  });

  app.get('/api/chat/:chatId/export', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    res.json({
      ok: true,
      settings: await getSettings(chatId),
      rules: await listRules(chatId),
      locked: await listLocked(chatId),
    });
  });

  app.post('/api/chat/:chatId/import', requireUser, async (req, res) => {
    const { chatId } = req.params;
    if (!(await canManage(chatId, req.user.uid))) return denied(res, req);
    const patch = buildPatch(req.body?.settings ?? {});
    await patchSettings(chatId, patch);
    for (const r of req.body?.rules ?? []) await addRule(chatId, r);
    res.json({ ok: true });
  });

  app.get('/panel/:chatId', requireUser, (req, res) => res.redirect(`/g/${req.params.chatId}`));

  app.use((_req, res) => res.status(404).type('html').send('<h1>404</h1>'));

  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
      return res.status(400).json({ ok: false, error: 'bad body' });
    }
    console.error('http error', err?.message ?? err);
    res.status(500).json({ ok: false, error: 'internal' });
  });

  return app;
}

async function readTotals(userId) {
  const chats = await myManagedChats(userId);
  const ids = chats.map((c) => String(c.chat_id));
  if (!ids.length) return { chats: 0, members: 0, warns: 0, bans: 0 };
  const inList = (list) => list.map(() => '?').join(',');
  const members = await db().get(
    `SELECT COUNT(*) AS n FROM members WHERE chat_id IN (${inList(ids)}) AND is_member = 1`,
    ids,
  );
  const warns = await db().get(`SELECT COUNT(*) AS n FROM warns WHERE chat_id IN (${inList(ids)}) AND active = 1`, ids);
  const bans = await db().get(
    `SELECT COUNT(*) AS n FROM punishments WHERE chat_id IN (${inList(ids)}) AND kind = 'ban'`,
    ids,
  );
  return {
    chats: ids.length,
    members: Number(members?.n ?? 0),
    warns: Number(warns?.n ?? 0),
    bans: Number(bans?.n ?? 0),
  };
}

async function readGroupData(chatId, settings, tab) {
  const chat = await db().get('SELECT title FROM chats WHERE chat_id = ?', [String(chatId)]);
  const base = { title: chat?.title ?? String(chatId) };

  if (tab === 'users' || !tab) {
    const rows = await db().all(
      'SELECT user_id, username, first_name, is_member FROM members WHERE chat_id = ? ORDER BY joined_at DESC LIMIT 200',
      [String(chatId)],
    );
    base.members = rows.map((r) => ({
      ID: r.user_id,
      Username: r.username ? `@${r.username}` : '-',
      Ism: r.first_name,
      Holat: Number(r.is_member) ? 'member' : 'left',
    }));
  }
  if (tab === 'warns') {
    const warns = await db().all(
      `SELECT w.user_id, w.reason, w.created_at, (SELECT COUNT(*) FROM warns w2 WHERE w2.chat_id = w.chat_id AND w2.user_id = w.user_id AND w2.active = 1) AS total
       FROM warns w WHERE w.chat_id = ? AND w.active = 1 ORDER BY w.created_at DESC LIMIT 200`,
      [String(chatId)],
    );
    base.warns = warns.map((w) => ({
      ID: `${w.user_id} (${w.total})`,
      Sabab: w.reason,
      Qachon: new Date(w.created_at * 1000).toLocaleString(),
    }));
    const pun = await db().all(
      "SELECT user_id, kind, reason, until_ts FROM punishments WHERE chat_id = ? ORDER BY created_at DESC LIMIT 200",
      [String(chatId)],
    );
    base.punishments = pun.map((p) => ({
      ID: p.user_id,
      Turi: p.kind,
      Sabab: p.reason,
      Muddat: Number(p.until_ts) ? new Date(p.until_ts * 1000).toLocaleString() : 'forever',
    }));
    base.locked = (await listLocked(chatId)).map((l) => ({ ID: l.user_id, Sabab: l.reason }));
  }
  if (tab === 'filters') base.rules = await listRules(chatId);
  if (tab === 'logs') base.logs = await db().all(
    'SELECT action, user_id, reason, created_at FROM logs WHERE chat_id = ? ORDER BY created_at DESC LIMIT 200',
    [String(chatId)],
  );
  if (tab === 'test') base.preview = await preview('salom', settings);
  return base;
}

export { esc };
