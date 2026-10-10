import { redactText } from './redact.js';
const idPattern = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
function sfId(value) { if (!idPattern.test(value)) throw new Error('Invalid Salesforce ID'); return value; }
export class SalesforceApiError extends Error {
  constructor(status, code) { super(`Salesforce API ${status}: ${redactText(code)}`); this.status = status; this.code = code; }
}
// Credentials remain private to this trusted Tooling transport.
export class ToolingClient {
  #token; #fetch; #owned = new Map();
  constructor({ instanceUrl, accessToken, apiVersion, fetchImpl = fetch }) {
    const u = new URL(instanceUrl);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.salesforce.com') || u.port || u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
      throw new Error('Expected a trusted Salesforce HTTPS instance origin');
    }
    if (!/^\d{2,3}\.0$/.test(apiVersion)) throw new Error('Configure an API version supported by this org');
    if (!accessToken) throw new Error('Salesforce OAuth access token required');
    this.base = u.origin + '/services/data/v' + apiVersion + '/tooling';
    this.#token = accessToken; this.#fetch = fetchImpl.bind(globalThis);
  }
  async request(path, { method = 'GET', body, text = false, timeoutMs = 10000 } = {}) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..')) throw new Error('Invalid API path');
    const res = await this.#fetch(this.base + path, { method, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + this.#token, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(Math.max(1, Math.min(10000, timeoutMs))) });
    if (!res.ok) {
      const details = await res.json().catch(() => []);
      const code = details[0]?.errorCode;
      throw new SalesforceApiError(res.status, typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'REQUEST_FAILED');
    }
    if (res.status === 204) return null;
    if (!text) return res.json();
    // Cap bytes while streaming, even when Salesforce reports an inaccurate size.
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error('Apex log exceeds the 1 MB download limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(combined);
  }
  async query(soql, {deadlineMs} = {}) {
    const records = []; let path = '/query/?q=' + encodeURIComponent(soql);
    for (let pages = 0; path && pages < 10; pages++) {
      const page = await this.request(path, {timeoutMs:deadlineMs ? deadlineMs - Date.now() : 10000}); records.push(...page.records);
      if (page.done) return records;
      const prefix = new URL(this.base).pathname;
      if (!page.nextRecordsUrl?.startsWith(prefix + '/query/')) throw new Error('Unexpected pagination URL');
      path = page.nextRecordsUrl.slice(prefix.length);
    }
    throw new Error('Query limit reached; narrow the diagnostic window');
  }
  async activeTrace(userId, atMs = Date.now()) {
    sfId(userId); const at = new Date(atMs).toISOString();
    const records = await this.query(`SELECT Id, DebugLevelId, StartDate, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${userId}' AND ExpirationDate > ${at} AND StartDate <= ${at} AND LogType IN ('DEVELOPER_LOG','USER_DEBUG') ORDER BY ExpirationDate DESC LIMIT 1`);
    return records[0] || null;
  }
  async debugLevels() {
    return this.query('SELECT Id, DeveloperName FROM DebugLevel ORDER BY DeveloperName ASC LIMIT 100');
  }
  restoreTrace(ownership) {
    sfId(ownership.id); sfId(ownership.userId); sfId(ownership.debugLevelId);
    if (!Number.isFinite(ownership.startMs) || !Number.isFinite(Date.parse(ownership.expiresAt))) throw new Error('Invalid trace ownership');
    this.#owned.set(ownership.id, { ...ownership, restored: true });
  }
  async createTrace({ userId, debugLevelId, startMs = Date.now(), durationMs = 5 * 60 * 1000 }) {
    sfId(userId); sfId(debugLevelId);
    if (durationMs < 1000 || durationMs > 10 * 60 * 1000 || !Number.isFinite(startMs)) throw new Error('Trace duration must be 1 second to 10 minutes');
    const start = new Date(startMs).toISOString(), end = new Date(startMs + durationMs).toISOString();
    const existing = await this.activeTrace(userId, startMs);
    if (existing) return { created: false, id: existing.Id, expiresAt: existing.ExpirationDate, reason: 'Using an existing trace flag without changing its debug level or expiration.' };
    const result = await this.request('/sobjects/TraceFlag', { method: 'POST', body: {
      TracedEntityId: userId, DebugLevelId: debugLevelId, LogType: 'DEVELOPER_LOG', StartDate: start, ExpirationDate: end } });
    sfId(result.id); this.#owned.set(result.id, { id: result.id, userId, debugLevelId, startMs, expiresAt: end });
    return { id: result.id, created: true, expiresAt: end };
  }
  async retrieveLogs({ userId, startMs, endMs, skipIds = [], redaction, deadlineMs = Date.now() + 30000 }) {
    sfId(userId);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) throw new Error('Invalid log window');
    const logs = await this.query(`SELECT Id, StartTime, LogLength, Status FROM ApexLog WHERE LogUserId = '${userId}' AND StartTime >= ${new Date(startMs).toISOString()} AND StartTime <= ${new Date(endMs).toISOString()} ORDER BY StartTime ASC LIMIT 21`, {deadlineMs});
    const output = [];
    for (const log of logs.slice(0, 20)) {
      if (skipIds.includes(log.Id)) continue;
      sfId(log.Id);
      if (log.LogLength > 1024 * 1024) { output.push({ id: log.Id, omitted: 'Log exceeds 1 MB limit' }); continue; }
      if (Date.now() >= deadlineMs) { output.push({id:log.Id, startedAt:log.StartTime, omitted:'Apex retrieval time limit reached'}); continue; }
      let body;
      try { body = await this.request('/sobjects/ApexLog/' + log.Id + '/Body', { text: true, timeoutMs:deadlineMs - Date.now() }); }
      catch (error) {
        if (error.status === 401 || error.status === 403) throw error;
        output.push({id: log.Id, startedAt: log.StartTime, omitted: 'Log body could not be retrieved within capture limits'}); continue;
      }
      const sanitized = redactText(body, redaction);
      output.push({ id: log.Id, startedAt: log.StartTime, status: redactText(log.Status, redaction),
        body: sanitized.slice(0, 16000), truncated: body.length > 16000 || sanitized.length > 16000 });
    }
    if (logs.length > 20) output.push({omitted: 'More than 20 Apex logs matched; additional logs were omitted'});
    return output;
  }
  async cleanupTrace(id) {
    sfId(id);
    if (!this.#owned.has(id)) throw new Error('Will only delete a trace flag created by this client');
    const owned = this.#owned.get(id);
    {
      let remote;
      try { remote = await this.request('/sobjects/TraceFlag/' + id); }
      catch (error) { if (error.status === 404) { this.#owned.delete(id); return; } throw error; }
      if (remote.TracedEntityId !== owned.userId || remote.DebugLevelId !== owned.debugLevelId ||
          Date.parse(remote.StartDate) !== owned.startMs || Date.parse(remote.ExpirationDate) !== Date.parse(owned.expiresAt) || remote.LogType !== 'DEVELOPER_LOG') {
        throw new Error('Trace flag no longer matches its saved ownership; it was not deleted');
      }
    }
    try { await this.request('/sobjects/TraceFlag/' + id, { method: 'DELETE' }); }
    catch (error) { if (error.status !== 404) throw error; }
    this.#owned.delete(id);
  }
}
