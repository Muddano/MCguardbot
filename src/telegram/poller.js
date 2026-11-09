import { tg } from './api.js';
import { handleUpdate } from '../core/router.js';
import { kvGet, kvSet } from '../core/db.js';
import { env } from '../config.js';

let running = false;
const OFFSET_KEY = 'longpoll_offset';

export async function startPoller() {
  if (running) return;
  running = true;
  let offset = Number(await kvGet(OFFSET_KEY, 0)) || 0;
  let backoff = 1000;

  console.log(`polling from offset ${offset}`);
  while (running) {
    try {
      const updates = await tg.getUpdates(offset, 25);
      backoff = 1000;
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        await kvSet(OFFSET_KEY, offset);
        handleUpdate(update).catch((err) => console.error('update failed', err?.message));
      }
      // DRY_RUN answers instantly, and Telegram can also answer instantly with an
      // empty list; without this the loop would burn CPU and starve the HTTP server.
      if (!updates.length) await sleep(env.dryRun ? 300 : 1000);
    } catch (err) {
      console.error('poll error', String(err?.message ?? err).slice(0, 120));
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function stopPoller() {
  running = false;
}
