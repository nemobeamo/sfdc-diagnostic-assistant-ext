import { redactEvidence } from './core/pii-evidence.js';
import { normalizePiiSettings } from './core/pii.js';
import { isRecordableUrl } from './core/capture-policy.js';
import { getSession, saveSession, deleteSession } from './core/store.js';
import { captureEvent, event } from './core/evidence.js';
import { isSalesforceUrl, redactUrl, redactText } from './core/redact.js';
import { ApexCapture } from './core/apex-capture.js';
import { auth } from './auth-controller.js';

let current, chain = Promise.resolve();
const apex = new ApexCapture({
  getClient: (orgId, userId) => auth.toolingClient(orgId, userId),
  remember: async session => {
    const {apexCleanup = []} = await chrome.storage.local.get('apexCleanup');
    const entry = {sessionId:session.id, orgId:session.apex.orgId, userId:session.apex.userId, ownership:session.apex.ownership};
    await chrome.storage.local.set({apexCleanup:[...apexCleanup.filter(e=>e.ownership.id!==entry.ownership.id), entry]});
    await chrome.alarms.create('apex-cleanup', {periodInMinutes:1});
  },
  forget: async id => {
    const {apexCleanup = []} = await chrome.storage.local.get('apexCleanup');
    const remaining = apexCleanup.filter(e=>e.ownership.id!==id);
    await chrome.storage.local.set({apexCleanup:remaining});
    if (!remaining.length) await chrome.alarms.clear('apex-cleanup');
  }
});
async function retryApexCleanup() {
  const {apexCleanup = []} = await chrome.storage.local.get('apexCleanup');
  const connection = await auth.status();
  for (const entry of apexCleanup.slice(0, 5)) {
    if (['starting','recording'].includes(current?.status) && current.id === entry.sessionId) continue;
    if (connection.orgId !== entry.orgId || connection.userId !== entry.userId) continue;
    const saved = await getSession(entry.sessionId);
    const session = saved || {warnings:[], apex:{orgId:entry.orgId, userId:entry.userId, ownership:entry.ownership, cleanup:'pending'}};
    await apex.cleanup(session, async () => { if (saved) await saveSession(session); });
  }
}
const loaded = Promise.all([chrome.storage.session.get('currentId'), chrome.storage.local.get('latestId')]).then(async ([{ currentId }, { latestId }]) => {
  if (currentId || latestId) current = await getSession(currentId || latestId);
  if (!currentId && current && ['starting', 'recording', 'stopping'].includes(current.status)) {
    current.status = 'ready'; current.endedMs = Date.now();
    current.warnings.push('Browser restarted; capture was interrupted and video may be incomplete.');
    if (current.apex?.status === 'recording') { current.apex.status = 'interrupted'; current.apex.reason = 'Browser restart interrupted Apex retrieval. Pending traces expire automatically; reconnect the same account to retry cleanup.'; }
    await saveSession(current);
  }
  if (current?.status === 'stopping') {
    current.endedMs ||= Date.now();
    await apex.finish(current, persist); current.status = 'ready'; await persist();
  }
});
function serialize(task) {
  const result = chain.then(() => loaded).then(task);
  chain = result.catch(() => {}); return result;
}
async function offscreen() {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Record a user-selected web tab locally.' });
  }
}
async function recorder(message) {
  const reply = await chrome.runtime.sendMessage({ target: 'recorder', ...message });
  if (!reply?.ok) throw new Error(reply?.error || 'Recorder unavailable');
  return reply;
}
async function showIndicator() {
  await chrome.scripting.executeScript({ target: { tabId: current.tabId }, files: ['recording-indicator.js'] });
  await chrome.tabs.sendMessage(current.tabId, {target:'recording-indicator', type:'SHOW', session:{id:current.id, startedMs:current.videoStartedMs, videoOnly:current.capture?.network === false, apexStatus:current.apex?.status}}, {frameId:0});
}
async function hideIndicator() {
  if (current) await chrome.tabs.sendMessage(current.tabId, { target: 'recording-indicator', type: 'HIDE' }, { frameId: 0 }).catch(() => {});
}
async function persist() { if (current) await saveSession(current); }
async function start(tabId, browserOnly = false) {
  if (current && ['starting', 'recording', 'stopping'].includes(current.status)) throw new Error('A recording is already active.');
  const tab = await chrome.tabs.get(tabId);
  if (!isRecordableUrl(tab.url)) throw new Error('Open a normal web page before recording. Browser settings and extension pages cannot be recorded.');
  if (!browserOnly && !isSalesforceUrl(tab.url)) throw new Error('Open a Salesforce tab for full diagnostics.');
  const connection = browserOnly ? null : await auth.requireConnection(tab.url);
  if (!browserOnly) await retryApexCleanup();
  const {piiSettings} = await chrome.storage.local.get('piiSettings');
  const redaction = normalizePiiSettings(piiSettings);
  if (current) await deleteSession(current.id);
  current = { id: crypto.randomUUID(), tabId, mode: 'support', browserOnly, redaction,
    status: 'starting', startedMs: Date.now(), requests: [], timeline: [], warnings: [],
    environment: { page: redactUrl(tab.url, redaction), browser: navigator.userAgent, capturedAt: new Date().toISOString(),
      orgId: connection?.orgId || null, userId: connection?.userId || null, apiVersion: connection?.apiVersion || null, release: null },
    apex: browserOnly ? {status:'disabled', reason:'Connect Salesforce to collect Apex logs and verified org/user details.', logs:[]} : { status: 'not-started', logs: [] } };
  await chrome.storage.session.set({ currentId: current.id });
  await chrome.storage.local.set({ latestId: current.id }); await persist();
  let attached = false, stage = 'Preparing recorder';
  try {
    await offscreen();
    stage = 'Capturing tab';
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    stage = 'Connecting network and console capture';
    try {
      await chrome.debugger.attach({ tabId }, '1.3'); attached = true;
    } catch (error) {
      // Browser isolation forbids debugging another extension's embedded page.
      // Continue the independently authorized tab video, with explicit evidence gaps.
      if (!/Cannot access a chrome-extension:\/\/ URL of different extension/i.test(error.message)) throw error;
      current.warnings.push('Video only: another extension has embedded a page in this tab, so Edge blocked network and console capture. Use a browser profile without that extension for full diagnostics.');
    }
    current.capture = { video: true, network: attached, console: attached };
    if (attached) {
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    }
    stage = 'Starting video recorder';
    const result = await recorder({ type: 'START', streamId, sessionId: current.id });
    current.videoStartedMs = result.startedMs;
    current.status = 'recording'; event(current, 'recording-start', {}, result.startedMs);
    await chrome.alarms.create('capture-limit', { when: current.startedMs + 10 * 60 * 1000 });
    await chrome.action.setBadgeText({ text: 'REC' }); await chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
    stage = 'Showing recording indicator';
    await showIndicator();
    if (!browserOnly) {
      stage = 'Preparing Apex capture';
      await apex.prepare(current, persist);
      await showIndicator();
    }
    await persist(); return { id: current.id };
  } catch (error) {
    await hideIndicator();
    await chrome.alarms.clear('capture-limit');
    await chrome.action.setBadgeText({ text: '' });
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
    await recorder({ type: 'STOP' }).catch(() => {});
    await apex.cleanup(current, persist).catch(() => {});
    current.status = 'error'; current.warnings.push(redactText(error.message)); await persist(); throw new Error(stage + ': ' + redactText(error.message));
  }
}
async function stop(reason) {
  if (!current || !['recording', 'starting'].includes(current.status)) return;
  current.status = 'stopping';
  await hideIndicator();
  await persist().catch(() => { current.warnings.push('Evidence storage failed while stopping.'); });
  await chrome.alarms.clear('capture-limit');
  if (current.capture?.network) await chrome.debugger.detach({ tabId: current.tabId }).catch(() => {});
  try { await recorder({ type: 'STOP' }); }
  catch (error) { current.warnings.push('Recording may be incomplete: ' + redactText(error.message)); }
  current.endedMs = Date.now();
  await persist().catch(() => {});
  await apex.finish(current, persist).catch(() => { current.warnings.push('Apex capture was interrupted; check cleanup and coverage.'); });
  current.status = 'ready';
  if (reason) current.warnings.push(redactText(reason));
  event(current, 'recording-stop', { reason: reason || 'user' });
  await chrome.action.setBadgeText({ text: '' }); await persist();
  await chrome.tabs.create({ url: chrome.runtime.getURL('review.html') + '?id=' + current.id });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target === 'recording-indicator') {
    // The isolated top-frame script can only inspect/stop its own current capture.
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !isRecordableUrl(sender.url) || !(current?.browserOnly || current?.videoOnly) && !isSalesforceUrl(sender.url)) return;
    serialize(async () => {
      const ownCapture = current?.tabId === sender.tab?.id && current.status === 'recording';
      if (message.type === 'STATUS') return { session: ownCapture ? { id: current.id, startedMs: current.videoStartedMs, videoOnly: current.capture?.network === false, apexStatus: current.apex?.status } : null };
      if (message.type === 'STOP' && ownCapture && message.id === current.id) { await stop(); return {}; }
      throw new Error('This recording is no longer active.');
    }).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: redactText(error.message) }));
    return true;
  }
  if (message.target !== 'controller') return;
  // Full capture control is restricted to our extension documents.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  serialize(async () => {
    switch (message.type) {
      case 'STATUS': await retryApexCleanup(); return { session: current ? { id: current.id, status: current.status, startedMs: current.startedMs, warnings: current.warnings, capture: current.capture, apexStatus: current.apex?.status } : null };
      case 'START': return start(message.tabId, message.browserOnly === true || message.videoOnly === true);
      case 'STOP': return stop(message.reason);
      case 'REVIEW': if (current) await chrome.tabs.create({ url: chrome.runtime.getURL('review.html') + '?id=' + current.id }); return {};
      case 'REDACT':
        if (!current || message.id !== current.id) throw new Error('This session is no longer the latest.');
        if (!['ready','error'].includes(current.status)) throw new Error('Stop recording before applying redaction.');
        current = redactEvidence(current, message.settings); await persist(); return {};
      case 'DELETE':
        if (message.id && message.id !== current?.id) throw new Error('This session is no longer the latest; nothing was deleted.');
        if (current && !['ready', 'error'].includes(current.status)) throw new Error('Stop recording before deleting.');
        if (current) await deleteSession(current.id);
        current = null; await chrome.storage.session.remove('currentId'); await chrome.storage.local.remove('latestId'); return {};
      default: throw new Error('Unknown command');
    }
  }).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: redactText(error.message) }));
  return true;
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  serialize(async () => {
    if (current?.status !== 'recording' || source.tabId !== current.tabId) return;
    captureEvent(current, method, params); await persist();
  }).catch(() => { serialize(() => stop('Evidence storage failed; capture stopped.')).catch(() => {}); });
});
chrome.debugger.onDetach.addListener(source => {
  serialize(async () => {
    if (current?.status === 'recording' && current.tabId === source.tabId) await stop('Debugger detached; network and console capture ended.');
  }).catch(() => {});
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'apex-cleanup') serialize(retryApexCleanup).catch(() => {});
  if (alarm.name === 'capture-limit') serialize(() => stop('Ten-minute capture limit reached.')).catch(() => {});
});
// A browser restart cannot resume a MediaRecorder or debugger session.
chrome.runtime.onStartup.addListener(() => serialize(async () => {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.alarms.clear('capture-limit');
}).catch(() => {}));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete') return;
  serialize(async () => {
    if (current?.status !== 'recording' || current.tabId !== tabId) return;
    if (!isRecordableUrl(tab.url) || !(current.browserOnly || current.videoOnly) && !isSalesforceUrl(tab.url)) { await stop('Captured tab left the supported recording pages.'); return; }
    await showIndicator();
  }).catch(() => serialize(() => stop('Recording indicator could not be restored.')).catch(() => {}));
});
