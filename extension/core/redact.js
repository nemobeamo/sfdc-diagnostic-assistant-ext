import { detectAndRedactPii } from './pii.js';
const secret = /authorization|cookie|token|password|secret|session|api[-_]?key/i;
export function redactCredentials(value) {
  return String(value ?? '').slice(0, 16000)
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT]')
    .replace(/((?:access_token|refresh_token|password|sessionId|sid|secret|api_key)\s*[=:]\s*["']?)[^\s,"';&]+/gi, '$1[REDACTED]')
    .replace(/\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._-]+/g, '[SESSION]');
}
export function redactText(value, settings) {
  return detectAndRedactPii(redactCredentials(value), settings).text;
}
export function redactUrl(value, settings) {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
    url.pathname = url.pathname.split('/').map(segment=>encodeURIComponent(redactText(decodeURIComponent(segment),settings))).join('/');
    url.pathname = url.pathname.replace(/\b[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g, '[ID]');
    return redactText(url.href, settings);
  } catch { return '[INVALID URL]'; }
}
// An allowlist avoids retaining arbitrary application-specific secret headers.
export function safeHeaders(headers = {}, settings) {
  const allowed = new Set(['content-type', 'content-length', 'accept', 'cache-control']);
  return Object.entries(headers).filter(([name]) => allowed.has(name.toLowerCase()) && !secret.test(name))
    .map(([name, value]) => ({ name, value: redactText(value, settings) }));
}
export function isSalesforceUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['salesforce.com', 'force.com', 'salesforce.mil']
      .some(domain => u.hostname.endsWith('.' + domain) || u.hostname === domain);
  } catch { return false; }
}
