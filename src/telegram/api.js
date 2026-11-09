import { env } from '../config.js';

const API = 'https://api.telegram.org';

let lastId = 0;
const inflight = new Map();

class RateLimit extends Error {
  constructor(retryAfter) {
    super(`rate limited ${retryAfter}s`);
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DRY_RUN=1 keeps every Telegram call local: writes report success, reads give
// neutral answers. Used by the test suite and by “try it before deploying”.
const DRY_READS = {
  getMe: () => ({ id: 1, is_bot: true, username: 'dryrun_bot', first_name: 'MC Guard' }),
  getChat: ({ chat_id }) => ({ id: chat_id, type: 'supergroup', title: 'Dry run group' }),
  getChatMember: ({ user_id }) => ({ status: 'member', user: { id: user_id, is_bot: false, first_name: 'Dry' } }),
  getChatAdministrators: () => [],
  getChatMemberCount: () => 42,
  getWebhookInfo: () => ({ url: '', pending_update_count: 0 }),
  getUpdates: () => [],
};

const dryJournal = [];

export function dryCalls(method = null) {
  return method ? dryJournal.filter((c) => c.method === method) : dryJournal.slice();
}

export function resetDryCalls() {
  dryJournal.length = 0;
}

function dryResponse(method, params) {
  dryJournal.push({ method, params });
  if (DRY_READS[method]) return Promise.resolve(DRY_READS[method](params));
  if (method === 'sendMessage' || method === 'copyMessage') {
    return Promise.resolve({ message_id: Math.floor(Math.random() * 1e6), chat: { id: params.chat_id }, text: params.text });
  }
  return Promise.resolve(true);
}

async function request(method, params = {}, attempt = 1) {
  if (env.dryRun) return dryResponse(method, params);
  if (!env.token) throw new Error('BOT_TOKEN is not set');
  const url = `${API}/bot${env.token}/${method}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (attempt < 3) {
      await sleep(400 * attempt);
      return request(method, params, attempt + 1);
    }
    throw err;
  }

  const body = await res.json().catch(() => ({ ok: false, description: 'bad json' }));
  if (body.ok) return body.result;

  const retryAfter = body.parameters?.retry_after;
  if (res.status === 429 && retryAfter && attempt < 4) {
    await sleep((retryAfter + 1) * 1000);
    return request(method, params, attempt + 1);
  }
  const err = new Error(`${method}: ${body.description ?? res.status}`);
  err.code = body.error_code ?? res.status;
  err.description = body.description;
  throw err;
}

/** Anti-duplicate guard: Telegram retries webhooks, a second ban must not fire. */
export async function call(method, params = {}, dedupeKey = null) {
  if (dedupeKey) {
    if (inflight.has(dedupeKey)) return inflight.get(dedupeKey);
    const p = request(method, params).finally(() => inflight.delete(dedupeKey));
    inflight.set(dedupeKey, p);
    return p;
  }
  return request(method, params);
}

const asNumber = (id) => (typeof id === 'string' || typeof id === 'bigint' ? Number(id) : id);

export const tg = {
  call,
  getMe: () => call('getMe'),
  setWebhook: (url, secret) =>
    call('setWebhook', {
      url,
      secret_token: secret || undefined,
      drop_pending_updates: false,
      allowed_updates: [
        'message', 'edited_message', 'callback_query', 'chat_member',
        'my_chat_member', 'chat_join_request', 'inline_query',
      ],
    }),
  deleteWebhook: (drop = false) => call('deleteWebhook', { drop_pending_updates: drop }),
  getWebhookInfo: () => call('getWebhookInfo'),
  getUpdates: (offset, timeout = 25) =>
    call('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request'],
    }),

  sendMessage: (chat_id, text, extra = {}) =>
    call('sendMessage', {
      chat_id: asNumber(chat_id),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }),
  editMessageText: (chat_id, message_id, text, extra = {}) =>
    call('editMessageText', { chat_id: asNumber(chat_id), message_id, text, parse_mode: 'HTML', ...extra }),
  editReplyMarkup: (chat_id, message_id, reply_markup) =>
    call('editMessageReplyMarkup', { chat_id: asNumber(chat_id), message_id, reply_markup }),
  // Alias: callers historically used the Telegram method name.
  editMessageReplyMarkup: (chat_id, message_id, reply_markup) =>
    call('editMessageReplyMarkup', { chat_id: asNumber(chat_id), message_id, reply_markup }),
  deleteMessage: (chat_id, message_id) =>
    call('deleteMessage', { chat_id: asNumber(chat_id), message_id }, `${chat_id}:${message_id}:del`),
  forwardMessage: (chat_id, from_chat_id, message_id) =>
    call('forwardMessage', { chat_id: asNumber(chat_id), from_chat_id: asNumber(from_chat_id), message_id }),
  copyMessage: (chat_id, from_chat_id, message_id, extra = {}) =>
    call('copyMessage', { chat_id: asNumber(chat_id), from_chat_id: asNumber(from_chat_id), message_id, ...extra }),

  ban: (chat_id, user_id, { untilDate, revoke = true } = {}) =>
    call('banChatMember', {
      chat_id: asNumber(chat_id),
      user_id: asNumber(user_id),
      until_date: untilDate || undefined,
      revoke_messages: revoke,
    }, `${chat_id}:${user_id}:ban`),
  unban: (chat_id, user_id) =>
    call('unbanChatMember', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }, `${chat_id}:${user_id}:unban`),
  kick: (chat_id, user_id) =>
    call('banChatMember', {
      chat_id: asNumber(chat_id),
      user_id: asNumber(user_id),
      until_date: Math.floor(Date.now() / 1000) + 30,
    }, `${chat_id}:${user_id}:kick`),
  restrict: (chat_id, user_id, seconds, { untilDate } = {}) =>
    call(
      'restrictChatMember',
      {
        chat_id: asNumber(chat_id),
        user_id: asNumber(user_id),
        until_date: untilDate || (seconds ? Math.floor(Date.now() / 1000) + seconds : undefined),
        permissions: {
          can_send_messages: false,
          can_send_audios: false,
          can_send_documents: false,
          can_send_photos: false,
          can_send_videos: false,
          can_send_video_notes: false,
          can_send_voice_notes: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_manage_topics: false,
        },
      },
      `${chat_id}:${user_id}:restrict:${Math.floor((seconds || 0) / 60)}`,
    ),
  unrestrict: (chat_id, user_id) =>
    call('unbanChatMember', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }, `${chat_id}:${user_id}:unmute`),
  promote: (chat_id, user_id, permissions) =>
    call('promoteChatMember', { chat_id: asNumber(chat_id), user_id: asNumber(user_id), ...permissions }),
  demote: (chat_id, user_id) =>
    call('demoteChatMember', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }),

  getChatMember: (chat_id, user_id) => call('getChatMember', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }),
  getChat: (chat_id) => call('getChat', { chat_id: asNumber(chat_id) }),
  getChatMemberCount: (chat_id) => call('getChatMemberCount', { chat_id: asNumber(chat_id) }),
  approveJoinRequest: (chat_id, user_id) => call('approveChatJoinRequest', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }),
  declineJoinRequest: (chat_id, user_id) => call('rejectChatJoinRequest', { chat_id: asNumber(chat_id), user_id: asNumber(user_id) }),
  pin: (chat_id, message_id, silent = true) =>
    call('pinChatMessage', { chat_id: asNumber(chat_id), message_id, disable_notification: silent }),
  setChatTitle: (chat_id, title) => call('setChatTitle', { chat_id: asNumber(chat_id), title }),
  leaveChat: (chat_id) => call('leaveChat', { chat_id: asNumber(chat_id) }),
  answerCallback: (id, text = '', show_alert = false) =>
    call('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190), show_alert }),
  setMyCommands: (commands) => call('setMyCommands', { commands }),
};

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
