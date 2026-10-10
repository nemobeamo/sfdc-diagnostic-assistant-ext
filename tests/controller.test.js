import { normalizePiiSettings } from '../extension/core/pii.js';
import { redactEvidence } from '../extension/core/pii-evidence.js';
import { isRecordableUrl } from '../extension/core/capture-policy.js';
import { ApexCapture } from '../extension/core/apex-capture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { captureEvent, event, toHar } from '../extension/core/evidence.js';
import { isSalesforceUrl, redactUrl, redactText } from '../extension/core/redact.js';

// Run the actual controller source with fake Chrome/storage adapters. Browser APIs
// still need the manual smoke test; these tests exercise orchestration/rollback.
async function harness({ url = 'https://acme.lightning.force.com/lightning/page/home', recorderFailure = false, attachError, failStoppingSave = false, authFailure = false, apexFailure = false, piiSettings } = {}) {
  const source = (await readFile(new URL('../extension/background.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const sessions = new Map(), sessionStorage = {}, localStorage = {piiSettings}, calls = [], listeners = {};
  function signal(name) { return { addListener(fn) { listeners[name] = fn; } }; }
  function storage(values) { return {
    async get() { return { ...values }; }, async set(newValues) { Object.assign(values, newValues); }, async remove(key) { delete values[key]; }
  }; }
  const chrome = {
    storage: { session: storage(sessionStorage), local: storage(localStorage) },
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p,
      onMessage: signal('message'), onStartup: signal('startup'),
      async sendMessage(message) {
        calls.push(message.type);
        return message.type === 'START' && recorderFailure ? { ok: false, error: 'Stream rejected' } : { ok: true, startedMs: Date.now() };
      } },
    scripting: { async executeScript(options) { calls.push({ indicator: options }); } },
    tabs: { onUpdated: signal('tabUpdated'), async sendMessage(id, message) { calls.push({tabId: id, indicatorMessage: message}); }, async get(id) { return { id, url }; }, async create(options) { calls.push({ opened: options.url }); } },
    offscreen: { async hasDocument() { return true; } },
    tabCapture: { async getMediaStreamId() { return 'stream'; } },
    debugger: { async attach() { calls.push('attach'); if (attachError) throw new Error(attachError); }, async detach() { calls.push('detach'); },
      async sendCommand(_, command) { calls.push(command); }, onEvent: signal('event'), onDetach: signal('detach') },
    alarms: { async create() {}, async clear() {}, onAlarm: signal('alarm') },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} }
  };
  const tooling = {
    async activeTrace() {return null;}, async debugLevels() {return [{Id:'7dl123456789012', DeveloperName:'SDA_Diagnostic'}];},
    async createTrace({startMs}) {calls.push('apex-start'); return {id:'7tf123456789012', created:true, expiresAt:new Date(startMs+600000).toISOString()};},
    restoreTrace() {}, async cleanupTrace() {calls.push('apex-cleanup');}, async retrieveLogs() {calls.push('apex-logs'); return [];}
  };
  class FastApexCapture extends ApexCapture { constructor(options) {super({...options, wait:async()=>{}});} }
  vm.runInNewContext(source, { ApexCapture: FastApexCapture, auth: { async status() {return {status:'connected',orgId:'00D123456789012',userId:'005123456789012'};}, async toolingClient() {if(apexFailure) throw Object.assign(new Error('private details'), {status:403}); return tooling;}, async requireConnection() { if (authFailure) throw new Error('Connect External Client App first'); return {orgId:'00D123456789012', userId:'005123456789012', apiVersion:'67.0'}; } }, chrome, navigator: { userAgent: 'test-browser' }, crypto: { randomUUID: () => 'session-' + (sessions.size + 1) },
    getSession: async id => structuredClone(sessions.get(id)),
    saveSession: async s => { if (failStoppingSave && s.status === 'stopping') throw new Error('Quota'); sessions.set(s.id, structuredClone(s)); },
    normalizePiiSettings, redactEvidence, deleteSession: async id => sessions.delete(id), captureEvent, event, isRecordableUrl, isSalesforceUrl, redactUrl, redactText });
  const send = message => new Promise(resolve => listeners.message({ target: 'controller', ...message },
    { id: 'test', url: 'chrome-extension://test/review.html', tab: { id: 9 } }, resolve));
  const indicator = (message, sender = {}) => new Promise(resolve => {
    const accepted = listeners.message({ target: 'recording-indicator', ...message },
      {id:'test', frameId:0, url, tab:{id:1}, ...sender}, resolve);
    if (!accepted) resolve(null);
  });
  return { send, indicator, sessions, calls, listeners };
}
test('controller start/stop produces ready evidence, allows extension-tab review, and deletes it', async () => {
  const h = await harness(); assert.equal((await h.send({ type: 'START', tabId: 1 })).ok, true);
  assert.equal((await h.send({ type: 'STATUS' })).session.status, 'recording');
  h.listeners.event({ tabId: 1 }, 'Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'a@example.com' }] });
  assert.equal((await h.send({ type: 'STOP' })).ok, true);
  const { session } = await h.send({ type: 'STATUS' }); assert.equal(session.status, 'ready');
  assert.equal(h.sessions.get(session.id).mode, 'support');
  assert.equal(h.sessions.get(session.id).timeline.find(e=>e.detail.message)?.detail.message, '[EMAIL]');
  assert.ok(h.calls.indexOf('detach') < h.calls.indexOf('STOP'));
  assert.equal((await h.send({ type: 'DELETE', id: session.id })).ok, true); assert.equal(h.sessions.size, 0);
});
test('startup recorder failure rolls back debugger attachment', async () => {
  const h = await harness({ recorderFailure: true });
  const reply = await h.send({ type: 'START', tabId: 1 }); assert.equal(reply.ok, false);
  assert.ok(h.calls.includes('detach')); assert.ok(h.calls.includes('STOP'));
  assert.equal((await h.send({ type: 'STATUS' })).session.status, 'error');
});
test('non-Salesforce tabs are rejected before debugger attachment', async () => {
  const h = await harness({ url: 'https://example.com' });
  assert.equal((await h.send({ type: 'START', tabId: 1 })).ok, false); assert.ok(!h.calls.includes('attach'));
});
test('stale review deletion cannot remove a newer session', async () => {
  const h = await harness(); await h.send({ type: 'START', tabId: 1 }); await h.send({ type: 'STOP' });
  assert.equal((await h.send({ type: 'DELETE', id: 'old-session' })).ok, false); assert.equal(h.sessions.size, 1);
});
test('storage failure while stopping still releases debugger and recorder', async () => {
  const h = await harness({ failStoppingSave: true }); await h.send({ type: 'START', tabId: 1 });
  assert.equal((await h.send({ type: 'STOP' })).ok, true); assert.ok(h.calls.includes('detach') && h.calls.includes('STOP'));
  assert.match([...h.sessions.values()][0].warnings[0], /storage failed/);
});

test('another extension embedded in the tab permits video with explicit network and console gaps', async () => {
  const h = await harness({ attachError: 'Cannot access a chrome-extension:// URL of different extension' });
  assert.equal((await h.send({ type: 'START', tabId: 1 })).ok, true);
  const {session} = await h.send({type: 'STATUS'});
  assert.equal(session.status, 'recording');
  assert.equal(session.capture.network, false); assert.equal(session.capture.console, false);
  assert.match(session.warnings[0], /Video only/);
  assert.ok(!h.calls.includes('Network.enable') && !h.calls.includes('Runtime.enable'));
  assert.equal((await h.send({type: 'STOP'})).ok, true);
});
test('unrelated debugger errors still fail startup with stage context', async () => {
  const h = await harness({attachError: 'Debugger already attached'});
  const reply = await h.send({type: 'START', tabId: 1});
  assert.equal(reply.ok, false); assert.match(reply.error, /Connecting network and console capture/);
  assert.ok(!h.calls.includes('START'));
});

test('recording indicator can only stop its own top-frame capture and is removed on stop', async () => {
  const h = await harness(); await h.send({type:'START', tabId:1});
  assert.ok(h.calls.some(c => c.indicator?.files.includes('recording-indicator.js')));
  const state = await h.indicator({type:'STATUS'}); assert.equal(state.session.id, 'session-1');
  for (const sender of [{id:'other'}, {frameId:1}, {url:'https://evil.example'}]) {
    assert.equal(await h.indicator({type:'STOP', id:state.session.id}, sender), null);
  }
  for (const [message, sender] of [[{type:'START'}, {}], [{type:'STOP', id:'old'}, {}], [{type:'STOP', id:state.session.id}, {tab:{id:2}}]]) {
    assert.equal((await h.indicator(message, sender)).ok, false);
  }
  assert.equal((await h.send({type:'STATUS'})).session.status, 'recording');
  assert.equal((await h.indicator({type:'STOP', id:state.session.id})).ok, true);
  assert.equal((await h.send({type:'STATUS'})).session.status, 'ready');
  assert.ok(h.calls.some(c => c.indicatorMessage?.type === 'HIDE' && c.tabId === 1));
  assert.equal((await h.indicator({type:'STATUS'})).session, null);
});
test('navigation restores the recording indicator on Salesforce and stops capture elsewhere', async () => {
  const h = await harness(); await h.send({type:'START', tabId:1});
  const indicatorsBeforeNavigation = h.calls.filter(c=>c.indicator).length;
  h.listeners.tabUpdated(1, {status:'complete'}, {url:'https://acme.lightning.force.com/lightning/page/home'});
  await h.send({type:'STATUS'});
  assert.equal(h.calls.filter(c => c.indicator).length, indicatorsBeforeNavigation + 1);
  h.listeners.tabUpdated(1, {status:'complete'}, {url:'https://example.com'});
  assert.equal((await h.send({type:'STATUS'})).session.status, 'ready');
});

test('recording requires a valid app connection before replacing evidence or attaching capture', async () => {
  const h = await harness({authFailure:true});
  const reply = await h.send({type:'START', tabId:1});
  assert.equal(reply.ok, false); assert.match(reply.error, /External Client App/);
  assert.equal(h.sessions.size, 0); assert.ok(!h.calls.includes('attach'));
});

test('Apex prepare and finish are part of capture and only owned traces are cleaned', async () => {
  const h = await harness(); await h.send({type:'START', tabId:1});
  assert.ok(h.calls.includes('apex-start'));
  await h.send({type:'STOP'});
  const {session} = await h.send({type:'STATUS'});
  assert.equal(h.sessions.get(session.id).apex.status, 'empty');
  assert.equal(h.sessions.get(session.id).apex.cleanup, 'complete');
  assert.equal(h.calls.filter(c=>c==='apex-logs').length, 3);
  assert.equal(h.calls.filter(c=>c==='apex-cleanup').length, 1);
});
test('Apex permission denial preserves browser capture and explicit coverage', async () => {
  const h = await harness({apexFailure:true});
  assert.equal((await h.send({type:'START', tabId:1})).ok, true);
  const {session} = await h.send({type:'STATUS'});
  assert.equal(session.status, 'recording'); assert.equal(session.apexStatus, 'unavailable');
  assert.match(session.warnings[0], /denied debug-log/);
  await h.send({type:'STOP'}); assert.ok(!h.calls.includes('apex-cleanup'));
});

test('disconnected users collect browser diagnostics without Salesforce calls', async () => {
  const h = await harness({url:'https://example.com',authFailure:true});
  assert.equal((await h.send({type:'START',tabId:1,browserOnly:true})).ok,true);
  let {session} = await h.send({type:'STATUS'});
  assert.equal(session.status,'recording'); assert.equal(session.capture.network,true); assert.equal(session.capture.console,true);
  const saved = h.sessions.get(session.id);
  assert.equal(saved.environment.orgId,null); assert.equal(saved.apex.status,'disabled');
  assert.ok(h.calls.includes('attach') && h.calls.includes('Network.enable') && h.calls.includes('Runtime.enable'));
  assert.ok(!h.calls.includes('apex-start'));
  h.listeners.event({tabId:1}, 'Network.requestWillBeSent', {requestId:'r1', wallTime:Date.now()/1000, timestamp:1, request:{url:'https://example.com/api?token=secret',method:'GET',headers:{Authorization:'Bearer secret'}}});
  h.listeners.event({tabId:1}, 'Network.responseReceived', {requestId:'r1',timestamp:1.2,response:{status:500,mimeType:'application/json',headers:{}}});
  h.listeners.event({tabId:1}, 'Network.loadingFinished', {requestId:'r1',timestamp:1.3,encodedDataLength:42});
  h.listeners.event({tabId:1}, 'Runtime.exceptionThrown', {exceptionDetails:{text:'a@example.com'},timestamp:Date.now()});
  await h.send({type:'STATUS'});
  const evidence=h.sessions.get(session.id);
  assert.equal(evidence.environment.browser,'test-browser');
  assert.equal(toHar(evidence).log.entries[0].response.status,500);
  assert.ok(!JSON.stringify(evidence).includes('secret'));
  assert.equal(evidence.timeline.find(e=>e.kind==='exception').detail.message,'[EMAIL]');
  assert.equal((await h.indicator({type:'STOP',id:session.id})).ok,true);
  session = (await h.send({type:'STATUS'})).session; assert.equal(session.status,'ready');
  assert.ok(!h.calls.includes('apex-logs')&&!h.calls.includes('apex-cleanup'));
  assert.ok(h.calls.some(c=>c.opened?.includes('/review.html')));
});
test('browser capture rejects internal browser pages before replacing evidence', async () => {
  for(const url of ['edge://extensions','chrome-extension://other/page.html','file:///tmp/private.html']) {
    const h=await harness({url,authFailure:true});
    assert.equal((await h.send({type:'START',tabId:1,browserOnly:true})).ok,false);
    assert.equal(h.sessions.size,0); assert.ok(!h.calls.includes('START'));
  }
});

test('disconnected Salesforce tabs retain network capture while skipping Apex', async () => {
  const h = await harness({authFailure:true});
  assert.equal((await h.send({type:'START',tabId:1,browserOnly:true})).ok,true);
  const {session} = await h.send({type:'STATUS'});
  assert.equal(session.capture.network,true);
  assert.equal(session.apexStatus,'disabled');
  h.listeners.tabUpdated(1, {status:'complete'}, {url:'https://acme.lightning.force.com/lightning/page/home'});
  assert.equal((await h.send({type:'STATUS'})).session.status,'recording');
  await h.send({type:'STOP'});
  assert.ok(h.calls.includes('detach'));
  assert.ok(!h.calls.some(c=>typeof c==='string' && c.startsWith('apex-')));
});

test('capture snapshots redaction preferences and review can strengthen saved text but cannot change active capture',async()=>{
  const h=await harness({piiSettings:{customValues:['Alice Jones']}});
  await h.send({type:'START',tabId:1,browserOnly:true});
  h.listeners.event({tabId:1},'Runtime.consoleAPICalled',{type:'error',args:[{value:'Alice Jones 415-555-0198'}]});
  const {session}=await h.send({type:'STATUS'});
  assert.equal((await h.send({type:'REDACT',id:session.id,settings:{}})).ok,false);
  await h.send({type:'STOP'});
  assert.equal(h.sessions.get(session.id).timeline.find(e=>e.kind==='console-error').detail.message,'[CUSTOM_PII] [PHONE]');
  assert.equal((await h.send({type:'REDACT',id:'stale',settings:{}})).ok,false);
  assert.equal((await h.send({type:'REDACT',id:session.id,settings:{recordIds:true}})).ok,true);
  assert.equal(h.sessions.get(session.id).redaction.recordIds,true);
});
