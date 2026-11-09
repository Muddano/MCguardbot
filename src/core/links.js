import { env } from '../config.js';

/** Base address of the panel: explicit PUBLIC_URL, otherwise the Render host. */
export function baseUrl() {
  if (env.publicUrl) return env.publicUrl;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
  return `http://localhost:${env.port}`;
}

export function panelUrl(chatId = '') {
  return chatId ? `${baseUrl()}/g/${chatId}` : baseUrl();
}

export function webhookUrl() {
  return `${baseUrl()}/tg/${env.token.split(':')[0]}`;
}
