import { COOKIE_NAME } from '../../../shared/const';

/** Use the real application session, including the starter's Preview bearer fallback. */
export function envFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  try {
    const raw = sessionStorage.getItem('manus-cookie');
    const prefix = `${COOKIE_NAME}=`;
    const pair = raw?.split(';').find(item => item.trim().startsWith(prefix));
    const token = pair?.trim().slice(prefix.length);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  } catch { /* Browser storage may be disabled; the normal cookie remains available. */ }
  return fetch(input, { ...init, headers, credentials: 'include' });
}
