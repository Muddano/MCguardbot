import { env } from './config.js';
import { initDb } from './core/db.js';
import { tg } from './telegram/api.js';
import { startPoller, stopPoller } from './telegram/poller.js';
import { createApp } from './web/app.js';
import { baseUrl, webhookUrl } from './core/links.js';

const COMMANDS = [
  { command: 'help', description: 'Bot haqida / about' },
  { command: 'settings', description: 'Guruh sozlamalari / group settings' },
  { command: 'rules', description: 'Qoidalar / rules' },
  { command: 'warn', description: 'Ogohlantirish / warn' },
  { command: 'mute', description: 'Pinhol / mute' },
  { command: 'kick', description: 'Chiqarish / kick' },
  { command: 'ban', description: 'Ban / ban' },
  { command: 'unban', description: 'Banni olish / unban' },
  { command: 'unmute', description: 'Ovozni qaytarish / unmute' },
  { command: 'info', description: 'Foydalanuvchi haqida / user info' },
  { command: 'report', description: 'Shikoyat / report' },
  { command: 'filter', description: 'Maxsus so‘zlar / custom words' },
  { command: 'lang', description: 'Til / language' },
];

/** Telegram's API is occasionally unreachable for a second right at boot. */
async function retry(name, fn, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (i === attempts) console.warn(`${name} failed`, e.message);
      else await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
}

async function main() {
  await initDb();
  if (!env.token && !env.dryRun) console.warn('BOT_TOKEN is empty — the bot cannot reach Telegram');

  const app = createApp();
  const server = app.listen(env.port, () => console.log(`http://0.0.0.0:${env.port} (${baseUrl()})`));

  await retry('setMyCommands', () => tg.setMyCommands(COMMANDS));

  const useWebhook = Boolean(env.publicUrl || process.env.RENDER || process.env.FORCE_WEBHOOK);
  if (useWebhook) {
    const url = webhookUrl();
    const res = await tg.setWebhook(url, env.webhookSecret).catch((e) => {
      console.error('setWebhook failed', e.message);
      return false;
    });
    if (res) {
      console.log(`webhook set: ${url}`);
      stopPoller();
    }
  } else {
    await tg.deleteWebhook().catch(() => {});
    startPoller().catch((e) => console.error('poller', e?.message ?? e));
  }

  const shutdown = async () => {
    console.log('shutting down');
    stopPoller();
    server.close();
    // Keep the webhook registered on SIGTERM: Render's free spin-down must not
    // unregister it, or Telegram stops delivering until the next deploy.
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (e) => console.error('unhandled', e?.message ?? e));
}

main().catch((err) => {
  console.error('fatal', err);
  process.exitCode = 1;
});
