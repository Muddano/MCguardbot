import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const dbFile = path.join(os.tmpdir(), `mcguard-test-${process.pid}.sqlite`);
process.env.DRY_RUN = '1';
process.env.BOT_TOKEN = '123456:TESTTOKEN';
process.env.ADMIN_IDS = '7667103099';
process.env.PANEL_SECRET = 'testpanelcode';
process.env.WEBHOOK_SECRET = 'testwebhooksecret';
process.env.SQLITE_FILE = dbFile;

const { initDb, db } = await import('../src/core/db.js');
const { handleUpdate } = await import('../src/core/router.js');
const { patchSettings, getSettings, clearCache } = await import('../src/core/settings.js');
const { lockUser } = await import('../src/core/rules.js');
const api = await import('../src/telegram/api.js');
const moderation = await import('../src/core/moderation.js');
const state = await import('../src/core/state.js');
const { createApp } = await import('../src/web/app.js');

await initDb();

const GROUP = -100700100200;
const OWNER = 7667103099;
const TITLE = 'MC Test Guruh';

let seq = 1000;
const user = (id, extra = {}) => ({ id, is_bot: false, first_name: `User${id}`, username: `user_${id}`, ...extra });

function groupMessage(from, text, extra = {}) {
  seq += 1;
  return {
    update_id: seq,
    message: {
      message_id: seq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: GROUP, type: 'supergroup', title: TITLE },
      from: user(from),
      text,
      ...extra,
    },
  };
}

function joinEvent(ids, extra = {}) {
  seq += 1;
  return {
    update_id: seq,
    message: {
      message_id: seq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: GROUP, type: 'supergroup', title: TITLE },
      from: user(ids[0]),
      new_chat_members: ids.map((id) => user(id)),
      ...extra,
    },
  };
}

async function warnsOf(uid) {
  return db().all('SELECT * FROM warns WHERE chat_id = ? AND user_id = ? AND active = 1', [String(GROUP), String(uid)]);
}

const count = (method) => api.dryCalls(method).length;
const lastOf = (method) => api.dryCalls(method).at(-1)?.params ?? {};

const REAL_GET_CHAT_MEMBER = api.tg.getChatMember;

test.afterEach(() => {
  api.tg.getChatMember = REAL_GET_CHAT_MEMBER;
  moderation.clearCaches();
  state.clearCache();
});

test.beforeEach(async () => {
  api.resetDryCalls();
  await db().run('DELETE FROM warns');
  await db().run('DELETE FROM punishments');
  await db().run('DELETE FROM logs');
  await db().run('DELETE FROM messages');
  await db().run('DELETE FROM members');
  await db().run('DELETE FROM captcha');
  await db().run('DELETE FROM locks');
  await db().run('DELETE FROM filters');
  await db().run('DELETE FROM chats');
  await db().run('DELETE FROM chat_admins');
  await clearCache();
});

test('profanity deletes the message and warns once', async () => {
  const uid = 900001;
  const update = groupMessage(uid, 'sen qonxuy ekanmiz');
  await handleUpdate(update);
  assert.equal(count('deleteMessage'), 1, 'offending message must be deleted');
  assert.equal(lastOf('deleteMessage').message_id, update.message.message_id);
  assert.equal((await warnsOf(uid)).length, 1);
  assert.ok(api.dryCalls('sendMessage').some((c) => /1\/3/.test(c.params.text ?? '')), 'warn counter 1/3 announced');
});

test('third warning escalates to a ban and is logged', async () => {
  const uid = 900002;
  for (const text of ['qonxuy', 'xoroy siz', 'taqir inson']) {
    await handleUpdate(groupMessage(uid, text));
  }
  assert.equal((await warnsOf(uid)).length, 0, 'warns are cleared when the ban lands');
  assert.equal(count('banChatMember'), 1);
  const punished = await db().all('SELECT * FROM punishments WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  assert.equal(punished.length, 1);
  assert.equal(punished[0].kind, 'ban');
  const logged = await db().all('SELECT * FROM logs WHERE chat_id = ? AND action = ?', [String(GROUP), 'ban']);
  assert.equal(logged.length, 1);
});

test('clean chat is left completely alone', async () => {
  await handleUpdate(groupMessage(900003, 'salom, rebuild server 1.20.4 qachon?'));
  assert.equal(count('deleteMessage'), 0);
  assert.equal((await warnsOf(900003)).length, 0);
});

test('admins are exempt while the exemption switch is on', async () => {
  api.tg.getChatMember = async () => ({ status: 'administrator', user: { id: OWNER } });
  await handleUpdate(groupMessage(OWNER, 'taqir', {}));
  assert.equal(count('deleteMessage'), 0);
});

test('link filter warns, whitelist and domain settings are respected', async () => {
  await patchSettings(GROUP, { scam: { on: false } });
  await handleUpdate(groupMessage(900010, 'qarang misol-sayt.uz kirin'));
  assert.equal((await warnsOf(900010)).length, 1, 'unknown domain is punished');

  await patchSettings(GROUP, { links: { whitelist: ['mojang.com'] } });
  await handleUpdate(groupMessage(900011, 'rasmiy yangilik mojang.com/news'));
  assert.equal((await warnsOf(900011)).length, 0, 'whitelisted domain passes');
});

test('forced subscription mutes until the channel is joined, then releases', async () => {
  const realGetChatMember = api.tg.getChatMember;
  api.tg.getChatMember = async (chatId) =>
    String(chatId) === String(GROUP)
      ? { status: 'member', user: { id: 1 } }
      : { status: 'left', user: { id: 1 } };
  await patchSettings(GROUP, {
    subscriptions: { on: true, channels: [{ id: '-1001112223334', username: 'mcnews', title: 'MC News' }] },
    captcha: { on: false },
  });
  const uid = 900020;
  await handleUpdate(joinEvent([uid]));
  assert.equal(count('restrictChatMember'), 1, 'unsubscribed newcomer is muted');

  api.tg.getChatMember = realGetChatMember;
  await handleUpdate({
    update_id: ++seq,
    callback_query: { id: 'cb1', data: `sub:${GROUP}:${uid}`, from: user(uid), message: { message_id: 77, chat: { id: GROUP } } },
  });
  assert.equal(count('unbanChatMember'), 1, 'mute lifted after subscribing');
  const row = await db().get('SELECT captcha_done FROM members WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  assert.equal(Number(row.captcha_done), 1);
});

test('captcha callback verifies the right answer and drops the row', async () => {
  await patchSettings(GROUP, { captcha: { on: true, type: 'math', private: false }, subscriptions: { on: false } });
  const uid = 900030;
  await handleUpdate(joinEvent([uid]));
  assert.equal(count('sendMessage') >= 1, true, 'captcha question sent');
  const row = await db().get('SELECT answer FROM captcha WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  assert.ok(row, 'captcha row stored');

  await handleUpdate({
    update_id: ++seq,
    callback_query: { id: 'cb2', data: `cap:${GROUP}:${uid}:999999`, from: user(uid), message: { message_id: 78, chat: { id: GROUP } } },
  });
  const afterWrong = await db().get('SELECT tries FROM captcha WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  assert.equal(Number(afterWrong.tries), 1, 'wrong answer costs a try');

  const fresh = await db().get('SELECT answer FROM captcha WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  await handleUpdate({
    update_id: ++seq,
    callback_query: { id: 'cb3', data: `cap:${GROUP}:${uid}:${fresh.answer}`, from: user(uid), message: { message_id: 78, chat: { id: GROUP } } },
  });
  const gone = await db().get('SELECT answer FROM captcha WHERE chat_id = ? AND user_id = ?', [String(GROUP), String(uid)]);
  assert.equal(gone, null, 'solved captcha row is removed');
});

test('antiflood mutes a user who repeats too fast', async () => {
  await patchSettings(GROUP, { antiflood: { on: true, max: 3, windowSeconds: 60, action: 'mute', muteSeconds: 120 } });
  const uid = 900040;
  for (let i = 0; i < 6; i += 1) await handleUpdate(groupMessage(uid, `xabar ${i} matn`));
  assert.equal(count('restrictChatMember') >= 1, true, 'flood triggers a mute');
});

test('raid mode restricts a burst of joiners', async () => {
  await patchSettings(GROUP, { raid: { on: true, joinsPerMinute: 2, quietSeconds: 120 } });
  for (let i = 0; i < 5; i += 1) await handleUpdate(joinEvent([900050 + i]));
  assert.equal(count('restrictChatMember') >= 1, true, 'raid restricts newcomers');
});

test('permanently locked user is re-banned when rejoining', async () => {
  const uid = 900060;
  await lockUser(GROUP, uid, 'raid Lideri');
  await handleUpdate(joinEvent([uid]));
  assert.equal(count('banChatMember'), 1, 'locked user never gets in');
});

test('bot accounts are refused when the bot switch is on', async () => {
  await patchSettings(GROUP, { bots: { on: true, action: 'ban' } });
  seq += 1;
  await handleUpdate({
    update_id: seq,
    message: {
      message_id: seq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: GROUP, type: 'supergroup', title: TITLE },
      from: { id: 900070, is_bot: true, first_name: 'FakeBot' },
      new_chat_members: [{ id: 900070, is_bot: true, first_name: 'FakeBot' }],
    },
  });
  assert.equal(count('banChatMember'), 1);
});

test('join without username is kicked when the username rule is on', async () => {
  await patchSettings(GROUP, { usernameCheck: { on: true, deleteFake: true } });
  seq += 1;
  await handleUpdate({
    update_id: seq,
    message: {
      message_id: seq,
      date: Math.floor(Date.now() / 1000),
      chat: { id: GROUP, type: 'supergroup', title: TITLE },
      from: { id: 900080, is_bot: false, first_name: 'NoName' },
      new_chat_members: [{ id: 900080, is_bot: false, first_name: 'NoName' }],
    },
  });
  assert.equal(count('banChatMember'), 1);
});

test('custom panel rule punishes its own pattern', async () => {
  const { addRule } = await import('../src/core/rules.js');
  await addRule(GROUP, { pattern: 'administrator\\s*plus', action: 'ban' });
  await handleUpdate(groupMessage(900090, 'sotaman administrator plus akkaut'));
  assert.equal(count('banChatMember'), 1);
});

test('custom panel rule fires even when the profanity switch is off', async () => {
  const { addRule } = await import('../src/core/rules.js');
  await patchSettings(GROUP, { profanity: { on: false } });
  await addRule(GROUP, { pattern: 'zb', action: 'warn' });
  const uid = 900091;
  await handleUpdate(groupMessage(uid, 'zb'));
  assert.equal(count('deleteMessage'), 1, 'custom word must be deleted even with profanity off');
  assert.equal((await warnsOf(uid)).length, 1);
});

test('media policy deletes a document when docs are blocked', async () => {
  await patchSettings(GROUP, { media: { docs: { on: true, action: 'delete' } } });
  await handleUpdate(groupMessage(900100, undefined, { document: { file_id: 'x', file_name: 'cheat.pdf' } }));
  assert.equal(count('deleteMessage'), 1);
});

test('/ban command works for the owner in the group', async () => {
  const target = 900110;
  await handleUpdate(groupMessage(target, 'oddij xabar'));
  api.resetDryCalls();
  await handleUpdate(groupMessage(OWNER, `/ban ${target} firibgarlik`));
  assert.equal(count('banChatMember'), 1);
  assert.equal(lastOf('banChatMember').user_id, target);
});

test('! prefix works like / and plain bang text is left alone', async () => {
  const target = 900115;
  await handleUpdate(groupMessage(OWNER, `!warn ${target} haqorat`));
  assert.equal((await warnsOf(target)).length, 1, '!warn counts as a command');

  api.resetDryCalls();
  await handleUpdate(groupMessage(target, '!!! va !123 oddiy matn'));
  assert.equal((await warnsOf(target)).length, 1, 'not a command, no extra warn');
  assert.equal(api.dryCalls('sendMessage').filter((c) => /not_known|unknown/i.test(c.params.text ?? '')).length, 0);
});

test('/warn command adds exactly one warn and /unwarn clears them', async () => {
  const target = 900120;
  await handleUpdate(groupMessage(OWNER, `/warn ${target} haqorat`));
  assert.equal((await warnsOf(target)).length, 1);
  await handleUpdate(groupMessage(OWNER, `/unwarn ${target}`));
  assert.equal((await warnsOf(target)).length, 0);
});

test('/purge removes remembered messages of one user', async () => {
  const target = 900130;
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const u = groupMessage(target, `oddiy matn ${i}`);
    ids.push(u.message.message_id);
    await handleUpdate(u);
  }
  await handleUpdate(groupMessage(OWNER, `/purge ${target} 4`));
  const deleted = api.dryCalls('deleteMessage').map((c) => c.params.message_id);
  for (const id of ids) assert.ok(deleted.includes(id), `message ${id} purged`);
});

test('non-moderator commands are refused', async () => {
  const realGetChatMember = api.tg.getChatMember;
  api.tg.getChatMember = async () => ({ status: 'member', user: { id: 555 } });
  await handleUpdate(groupMessage(900140, '/ban 900141'));
  assert.equal(count('banChatMember'), 0);
  api.tg.getChatMember = realGetChatMember;
});

test('duplicate webhook updates are ignored', async () => {
  const update = groupMessage(900150, 'qonxuy');
  await handleUpdate(update);
  await handleUpdate(update);
  assert.equal((await warnsOf(900150)).length, 1, 'same update_id must not double-punish');
});

test('web panel: auth, settings save, rules, preview and actions over HTTP', async () => {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = { cookie: '' };
  const send = (p, init = {}) =>
    fetch(base + p, { ...init, headers: { cookie: jar.cookie, ...(init.headers ?? {}) }, redirect: 'manual' });

  try {
    assert.equal((await send('/api/chats')).status, 401, 'api needs a session');

    const hook = await send(`/tg/123456`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(groupMessage(900200, 'salom')),
    });
    assert.equal(hook.status, 403, 'webhook rejects a wrong secret');

    const login = await send('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=wrong',
    });
    assert.match(login.headers.get('location'), /error/);

    const ok = await send('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'code=testpanelcode',
    });
    assert.equal(ok.status, 302);
    jar.cookie = (ok.headers.getSetCookie?.()[0] ?? ok.headers.get('set-cookie') ?? '').split(';')[0];
    assert.match(jar.cookie, /^mcguard_session=/, 'session cookie issued');

    await db().run(
      `INSERT INTO chats (chat_id, title, type, settings, created_at, updated_at) VALUES (?, ?, 'supergroup', '{}', ?, ?)
       ON CONFLICT (chat_id) DO UPDATE SET title = excluded.title`,
      [String(GROUP), TITLE, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)],
    );

    const page = await send(`/g/${GROUP}?tab=settings`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-path="profanity\.on"/, 'panel renders the profanity switch');
    assert.match(html, /data-path="subscriptions\.channels"/, 'panel renders forced-subscription channels');
    assert.match(html, /id="save"/, 'save button present');

    const saved = await send(`/api/chat/${GROUP}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'warns.limit': 5, 'links.on': false, 'subscriptions.channels': [{ id: '-100333', username: 'mc', title: 'MC' }] }),
    });
    const savedBody = await saved.json();
    assert.equal(savedBody.ok, true);
    assert.equal(savedBody.settings.warns.limit, 5);
    assert.equal(savedBody.settings.links.on, false, 'panel toggle reaches the settings blob');
    assert.equal(savedBody.settings.subscriptions.channels[0].username, 'mc');

    const unknownKey = await send(`/api/chat/${GROUP}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ 'enabled': true, 'adminRights.ownerCommandsOnly': true, 'notASetting': 'x' }),
    });
    const injected = await unknownKey.json();
    assert.equal(injected.settings.notASetting, undefined, 'unknown keys cannot be injected');

    const rule = await send(`/api/chat/${GROUP}/rules`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern: 'sotuvchi', action: 'mute' }),
    });
    const ruleBody = await rule.json();
    assert.equal(ruleBody.ok, true);
    const rules = await (await send(`/api/chat/${GROUP}/rules`)).json();
    assert.equal(rules.rules.length, 1);
    const removed = await send(`/api/chat/${GROUP}/rules/${ruleBody.rule.id}`, { method: 'DELETE' });
    assert.equal((await removed.json()).ok, true);

    const probe = await send(`/api/chat/${GROUP}/preview?text=${encodeURIComponent('sen qonxuy')}`);
    const probeBody = await probe.json();
    assert.equal(probeBody.result.clean, false, 'preview flags profanity');
    assert.ok(probeBody.result.profanity.length >= 1);
    assert.equal(probeBody.result.verdict.action, 'warn');

    api.resetDryCalls();
    const act = await send(`/api/chat/${GROUP}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ban', userId: '900201', reason: 'panel test' }),
    });
    assert.equal((await act.json()).ok, true);
    assert.equal(count('banChatMember'), 1, 'panel ban reaches Telegram');

    const muteAct = await send(`/api/chat/${GROUP}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'mute', userId: '900202', seconds: 600 }),
    });
    assert.equal((await muteAct.json()).ok, true);
    assert.equal(lastOf('restrictChatMember').user_id, 900202);

    const panelLogs = await db().all("SELECT * FROM logs WHERE chat_id = ? AND action = 'ban'", [String(GROUP)]);
    assert.equal(panelLogs.length, 1, 'one log row per panel action');
    assert.match(panelLogs[0].detail, /panel/, 'log keeps the panel provenance marker');

    const exported = await (await send(`/api/chat/${GROUP}/export`)).json();
    assert.ok(exported.settings && Array.isArray(exported.rules), 'export bundles settings + rules');

    const dash = await send('/');
    assert.equal(dash.status, 200);
    assert.match(await dash.text(), /MC Test Guruh/, 'dashboard lists the group');

    const assets = await send('/assets/styles.css');
    assert.equal(assets.status, 200);
    assert.match(await assets.text(), /--green/, 'stylesheet served');
    assert.match(await (await send('/assets/app.js')).text(), /data-path/, 'panel script served');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + suffix, { force: true });
    } catch {
      /* windows can hold the file for a moment */
    }
  }
});
