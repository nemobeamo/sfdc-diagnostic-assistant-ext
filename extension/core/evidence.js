import { redactText, redactUrl, safeHeaders } from './redact.js';
export const MAX_REQUESTS = 2000;
export const MAX_EVENTS = 2000;
export function event(session, kind, detail, epochMs = Date.now()) {
  if (session.timeline.length >= MAX_EVENTS) { session.truncated = true; return; }
  session.timeline.push({ kind, at: new Date(epochMs).toISOString(), offsetMs: epochMs - session.startedMs, detail });
}
export function captureEvent(s, method, p) {
  if (method === 'Network.requestWillBeSent') {
    if (s.requests.length >= MAX_REQUESTS) { s.truncated = true; return; }
    const previous = s.requests.findLast(r => r.id === p.requestId);
    if (previous && p.redirectResponse) complete(previous, p.redirectResponse, p.timestamp, s.redaction);
    const r = { id: p.requestId, startedMs: p.wallTime * 1000, mono: p.timestamp,
      url: redactUrl(p.request.url, s.redaction), method: p.request.method, requestHeaders: safeHeaders(p.request.headers, s.redaction),
      type: p.type, status: 0, responseHeaders: [], mimeType: '', elapsed: 0, finished: false };
    s.requests.push(r);
    event(s, 'request', { url: r.url, method: r.method }, r.startedMs);
  } else if (method.startsWith('Network.')) {
    const r = s.requests.findLast(r => r.id === p.requestId);
    if (!r) return;
    if (method === 'Network.responseReceived') {
      complete(r, p.response, p.timestamp, s.redaction); r.finished = false;
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      r.elapsed = Math.max(0, (p.timestamp - r.mono) * 1000); r.finished = true;
      r.bytes = p.encodedDataLength ?? 0;
      if (p.errorText) r.error = redactText(p.errorText, s.redaction);
      event(s, r.error || r.status >= 400 ? 'network-error' : 'response',
        { url: r.url, status: r.status, error: r.error }, r.startedMs + r.elapsed);
    }
  } else if (method === 'Runtime.exceptionThrown') {
    const d = p.exceptionDetails;
    const message = redactText(d.exception?.description || d.text, s.redaction);
    event(s, 'exception', { message }, p.timestamp || Date.now());
  } else if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type)) {
    event(s, 'console-' + p.type, { message: redactText((p.args || []).map(a => a.value ?? a.description ?? a.type).join(' '), s.redaction) }, p.timestamp || Date.now());
  }
}
function complete(r, response, timestamp, settings) {
  r.status = response.status; r.mimeType = redactText(response.mimeType || '', settings);
  r.responseHeaders = safeHeaders(response.headers, settings);
  r.elapsed = Math.max(0, (timestamp - r.mono) * 1000); r.finished = true;
}
export function toHar(s) {
  return { log: { version: '1.2', creator: { name: 'Salesforce Diagnostic Assistant', version: '0.3.1' },
    comment: 'Metadata only. Bodies, cookies, query values and most headers omitted. Timing is total duration only.',
    entries: s.requests.map(r => ({ startedDateTime: new Date(r.startedMs).toISOString(), time: r.elapsed,
      request: { method: r.method, url: r.url, httpVersion: '', headers: r.requestHeaders,
        queryString: [], cookies: [], headersSize: -1, bodySize: -1 },
      response: { status: r.status, statusText: '', httpVersion: '', headers: r.responseHeaders,
        cookies: [], content: { size: -1, mimeType: r.mimeType }, redirectURL: '', headersSize: -1, bodySize: -1 },
      cache: {}, timings: { send: 0, wait: r.elapsed, receive: 0 },
      _incomplete: !r.finished, _error: r.error, _encodedDataLength: r.bytes })) } };
}
