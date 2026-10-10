import { event } from './evidence.js';
const explain = error => error?.status === 401 ? 'Salesforce authorization expired; reconnect to retrieve Apex logs.'
  : error?.status === 403 ? 'Salesforce denied debug-log access. Check the authorized user’s Tooling API and debug-log permissions.'
  : error?.status === 429 ? 'Salesforce API rate limit reached during Apex capture.'
  : 'Apex capture could not complete. Check Salesforce access, debug levels, and log storage limits.';
export class ApexCapture {
  constructor({getClient, remember, forget, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
    this.getClient = getClient; this.remember = remember; this.forget = forget; this.wait = wait;
  }
  async prepare(session, persist) {
    const a = session.apex = {status:'preparing', userId:session.environment.userId, orgId:session.environment.orgId, logs:[], warnings:[], cleanup:'not-needed'};
    try {
      const client = await this.getClient(a.orgId, a.userId);
      let trace = await client.activeTrace(a.userId);
      if (trace) {
        a.trace = {created:false, id:trace.Id, expiresAt:trace.ExpirationDate};
      } else {
        const levels = await client.debugLevels();
        const level = levels.find(l => l.DeveloperName === 'SDA_Diagnostic') || levels.find(l => l.DeveloperName === 'SFDC_DevConsole') || levels[0];
        if (!level) {
          a.status = 'unavailable'; a.reason = 'No DebugLevel is available. Create a debug level in Salesforce Setup → Debug Logs, then retry.';
          session.warnings.push(a.reason); return;
        }
        const startMs = Date.now();
        trace = await client.createTrace({userId:a.userId, debugLevelId:level.Id, startMs, durationMs:10 * 60 * 1000});
        a.trace = trace; a.debugLevel = level.DeveloperName;
        if (trace.created) {
          a.ownership = {id:trace.id, userId:a.userId, debugLevelId:level.Id, startMs, expiresAt:trace.expiresAt};
          a.cleanup = 'pending';
          try { await this.remember(session); await persist(); }
          catch (error) {
            await client.cleanupTrace(trace.id).catch(() => {}); throw error;
          }
        }
      }
      a.enabledMs = Date.now(); a.windowStartMs = Math.max(session.startedMs, a.ownership?.startMs || session.startedMs); a.status = 'recording';
      if (!a.trace.created) a.warnings.push('Existing trace flag reused without modification; its debug level and expiration determine coverage.');
      a.warnings.push('Only Apex transactions for the authorized app user are collected. Transactions before trace setup or starting after recording stops are outside the capture window.');
      event(session, 'apex-trace-enabled', {userId:a.userId, existing:!a.trace.created}, a.enabledMs);
    } catch (error) {
      a.status = 'unavailable'; a.reason = explain(error); session.warnings.push(a.reason);
    } finally { await persist(); }
  }
  async cleanup(session, persist) {
    const a = session.apex;
    if (!a?.ownership || a.cleanup === 'complete') return;
    try {
      const client = await this.getClient(a.orgId, a.userId);
      client.restoreTrace(a.ownership);
      await client.cleanupTrace(a.ownership.id);
      await this.forget(a.ownership.id); a.cleanup = 'complete';
    } catch {
      a.cleanup = 'pending';
      const message = 'Temporary Apex trace cleanup was not confirmed. It expires at ' + a.ownership.expiresAt + '; reconnect the same account to retry cleanup.';
      if (!session.warnings.includes(message)) session.warnings.push(message);
    }
    await persist();
  }
  async finish(session, persist) {
    const a = session.apex;
    if (!a || a.status === 'unavailable' || a.status === 'not-started' || a.status === 'disabled') { await this.cleanup(session, persist); return; }
    a.status = 'collecting'; await persist().catch(() => {});
    try {
      const client = await this.getClient(a.orgId, a.userId);
      const deadlineMs = Date.now() + 30000;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (Date.now() >= deadlineMs) { a.warnings.push('Apex retrieval reached its 30-second time limit.'); break; }
        if (attempt) await this.wait(Math.min(2000, Math.max(0, deadlineMs - Date.now())));
        const logs = await client.retrieveLogs({userId:a.userId, startMs:a.windowStartMs || session.startedMs,
          endMs:session.endedMs, deadlineMs, redaction:session.redaction, skipIds:a.logs.map(l=>l.id).filter(Boolean)});
        for (const log of logs) {
          if (log.id && a.logs.some(l=>l.id===log.id)) continue;
          if (a.logs.length >= 21) break;
          a.logs.push(log);
          if (log.id) event(session, 'apex-log', {id:log.id, status:log.status || 'omitted', truncated:!!log.truncated,
            correlation:'Time-based only; not proof of a specific browser request'}, Date.parse(log.startedAt) || session.endedMs);
        }
        await persist();
      }
      a.status = a.logs.length ? a.logs.some(l=>l.omitted || l.truncated) ? 'partial' : 'complete' : 'empty';
      if (!a.logs.length) a.reason = 'No Apex logs were found for the authorized user in this time window. The reproduction may not have executed Apex.';
      if (a.logs.some(l=>l.omitted || l.truncated)) a.warnings.push('Some Apex logs were omitted or truncated; inspect capture coverage.');
    } catch (error) {
      a.status = a.logs.length ? 'partial' : 'unavailable'; a.reason = explain(error); session.warnings.push(a.reason);
    } finally { await this.cleanup(session, persist); await persist(); }
  }
}
export function apexSummary(apex) {
  if (!apex) return null;
  return {...apex, logs:(apex.logs || []).map(({body, ...metadata})=>metadata)};
}
export function apexFiles(apex) {
  const files = {};
  for (const log of apex?.logs || []) {
    if (typeof log.body === 'string' && /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(log.id)) files['apex/' + log.id + '.log'] = log.body;
  }
  return files;
}
