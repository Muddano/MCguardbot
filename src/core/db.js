import fs from 'node:fs';
import path from 'node:path';
import { env, DATA_DIR } from '../config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chats (
  chat_id     TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'group',
  settings    TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_admins (
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  perms       TEXT NOT NULL DEFAULT '{}',
  added_by    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS members (
  chat_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  username     TEXT NOT NULL DEFAULT '',
  first_name   TEXT NOT NULL DEFAULT '',
  lang         TEXT NOT NULL DEFAULT '',
  joined_at    INTEGER NOT NULL DEFAULT 0,
  left_at      INTEGER NOT NULL DEFAULT 0,
  is_member    INTEGER NOT NULL DEFAULT 1,
  captcha_done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS warns (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  added_by    TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_warns_user ON warns (chat_id, user_id, active);

CREATE TABLE IF NOT EXISTS punishments (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  until_ts    INTEGER NOT NULL DEFAULT 0,
  by_id       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pun_user ON punishments (chat_id, user_id, active);

CREATE TABLE IF NOT EXISTS filters (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  pattern     TEXT NOT NULL,
  action      TEXT NOT NULL DEFAULT 'delete',
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_filters_chat ON filters (chat_id);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  chat_id      TEXT NOT NULL,
  target_user  TEXT NOT NULL,
  reporter     TEXT NOT NULL,
  message_id   INTEGER NOT NULL DEFAULT 0,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports ON reports (chat_id, target_user);

CREATE TABLE IF NOT EXISTS locks (
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS logs (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,
  action      TEXT NOT NULL,
  user_id     TEXT NOT NULL DEFAULT '',
  by_id       TEXT NOT NULL DEFAULT '',
  reason      TEXT NOT NULL DEFAULT '',
  detail      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_chat ON logs (chat_id, created_at);

CREATE TABLE IF NOT EXISTS captcha (
  chat_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  answer      TEXT NOT NULL,
  question    TEXT NOT NULL DEFAULT '',
  tries       INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL,
  message_id  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  chat_id     TEXT NOT NULL,
  message_id  INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages (chat_id, user_id, message_id);

CREATE TABLE IF NOT EXISTS kv (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL
);
`;

let driver = null;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function buildSqlite() {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    // Render's default image can be older than the release that ships this
    // module, so say exactly how to fix it instead of dying on a stack trace.
    throw new Error(
      'Node ' + process.version + " has no built-in sqlite. Either set DATABASE_URL to a free Postgres, or add NODE_VERSION=22.20.0 (Render: Environment).",
    );
  }
  fs.mkdirSync(path.dirname(env.sqliteFile), { recursive: true });
  const raw = new DatabaseSync(env.sqliteFile);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec(SCHEMA);

  // node:sqlite is synchronous, but every caller treats the driver as promise
  // based (and the Postgres driver has to be). Awaiting a plain value is free,
  // so this keeps one API shape for both backends.
  const wrap = (stmt) => ({
    run: (...p) => Promise.resolve(stmt.run(...p)),
    get: (...p) => Promise.resolve(stmt.get(...p) ?? null),
    all: (...p) => Promise.resolve(stmt.all(...p)),
  });

  return {
    kind: 'sqlite',
    file: env.sqliteFile,
    run: (sql, params = []) => wrap(raw.prepare(sql)).run(...params),
    get: (sql, params = []) => wrap(raw.prepare(sql)).get(...params),
    all: (sql, params = []) => wrap(raw.prepare(sql)).all(...params),
    exec: (sql) => Promise.resolve(raw.exec(sql)),
    close: () => Promise.resolve(raw.close()),
  };
}

async function buildPg() {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 6 });
  await pool.query(SCHEMA);
  return {
    kind: 'postgres',
    run: async (sql, params = []) => {
      const res = await pool.query(toPg(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    get: async (sql, params = []) => {
      const res = await pool.query(toPg(sql), params);
      return res.rows[0] ?? null;
    },
    all: async (sql, params = []) => {
      const res = await pool.query(toPg(sql), params);
      return res.rows;
    },
    exec: async (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

export async function initDb() {
  if (driver) return driver;
  driver = env.databaseUrl ? await buildPg() : await buildSqlite();
  console.log(driver.kind === 'postgres' ? 'db: postgres' : `db: sqlite ${driver.file}`);
  return driver;
}

export function db() {
  if (!driver) throw new Error('initDb() must run before db()');
  return driver;
}

export const now = () => Math.floor(Date.now() / 1000);

export async function kvGet(key, fallback = null) {
  const row = await db().get('SELECT v FROM kv WHERE k = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.v);
  } catch {
    return row.v;
  }
}

export async function kvSet(key, value) {
  const v = JSON.stringify(value);
  await db().run(
    `INSERT INTO kv (k, v) VALUES (?, ?)
     ON CONFLICT (k) DO UPDATE SET v = excluded.v`,
    [key, v],
  );
}
