import { env } from '../src/config.js';
import { initDb, db } from '../src/core/db.js';

if (env.databaseUrl) {
  console.error('DATABASE_URL is set — refusing to drop a hosted database.');
  console.error('Clear the table you need from the panel instead, or unset DATABASE_URL for a local reset.');
  process.exit(1);
}

await initDb();
const tables = [
  'chats', 'chat_admins', 'members', 'warns', 'punishments', 'filters',
  'reports', 'locks', 'logs', 'captcha', 'messages', 'kv',
];
for (const t of tables) await db().run(`DROP TABLE IF EXISTS ${t}`);
await initDb();
console.log(`Local database reset: ${env.sqliteFile}`);
