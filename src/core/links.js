import { env } from '../config.js';

/** Base address of the panel: explicit PUBLIC_URL, otherwise the Render host. */
export function baseUrl() {
  if (env.publicUrl) return env.publicUrl.replace(/\/+$/, '');
  if (process.env.RENDER_EXTERNAL_URL) {
    let u = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
    if (u.startsWith('http://')) u = 'https://' + u.slice(7);
    return u;
  }
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  }
  return `http://localhost:${env.port}`;
}

export function panelUrl(chatId = '') {
  return chatId ? `${baseUrl()}/g/${chatId}` : baseUrl();
}

export function webhookUrl() {
  return `${baseUrl()}/tg/${env.token.split(':')[0]}`;
}
