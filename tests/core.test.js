import test from 'node:test';
import assert from 'node:assert/strict';
import { redactText, redactUrl, safeHeaders, isSalesforceUrl } from '../extension/core/redact.js';
import { captureEvent, toHar } from '../extension/core/evidence.js';
import { crc32, makeZip } from '../extension/core/zip.js';
import { ToolingClient } from '../extension/core/salesforce.js';
test('redaction drops credential headers, query values, fragments and IDs', () => {
  const url = redactUrl('https://user:pass@acme.lightning.force.com/lightning/r/Account/001123456789012ABC/view?sid=secret&q=name#private');
  assert.ok(!url.includes('secret') && !url.includes('001123456789012ABC') && !url.includes('user:pass') && !url.includes('private'));
  assert.deepEqual(safeHeaders({ Authorization: 'Bearer secret', Cookie: 'sid=secret', 'X-Customer': 'private', 'Content-Type': 'application/json' }), [{ name: 'Content-Type', value: 'application/json' }]);
  assert.equal(redactText('a@example.com Bearer abc password=123'), '[EMAIL] Bearer [REDACTED] password=[REDACTED]');
  assert.ok(!isSalesforceUrl('https://salesforce.com.evil.example'));
});
const session = () => ({ startedMs: 1700000000000, requests: [], timeline: [] });
function request(s, id = '1') {
  captureEvent(s, 'Network.requestWillBeSent', { requestId: id, wallTime: s.startedMs / 1000, timestamp: 10, request: { url: 'https://acme.my.salesforce.com/api?token=hidden', method: 'GET', headers: {} } });
}
test('HAR and timeline correlate a failed request with sanitized URL', () => {
  const s = session(); request(s);
  captureEvent(s, 'Network.responseReceived', { requestId: '1', timestamp: 10.1, response: { status: 403, headers: {}, mimeType: 'application/json' } });
  captureEvent(s, 'Network.loadingFinished', { requestId: '1', timestamp: 10.3, encodedDataLength: 30 });
  const entry = toHar(s).log.entries[0];
  assert.equal(entry.response.status, 403); assert.ok(Math.abs(entry.time - 300) < .001);
  assert.equal(s.timeline[1].offsetMs, 300); assert.equal(s.timeline[1].kind, 'network-error');
  assert.ok(!JSON.stringify(s).includes('hidden')); assert.equal(entry._incomplete, false);
});
test('redirects preserve separate HAR entries and incomplete requests are explicit', () => {
  const s = session(); request(s);
  captureEvent(s, 'Network.requestWillBeSent', { requestId: '1', wallTime: s.startedMs / 1000 + .2, timestamp: 10.2,
    redirectResponse: { status: 302, headers: {} }, request: { url: 'https://acme.my.salesforce.com/done', method: 'GET', headers: {} } });
  const entries = toHar(s).log.entries; assert.equal(entries.length, 2);
  assert.equal(entries[0].response.status, 302); assert.equal(entries[0]._incomplete, false); assert.equal(entries[1]._incomplete, true);
});
test('console secrets are filtered before evidence storage and caps are explicit', () => {
  const s = session();
  captureEvent(s, 'Runtime.exceptionThrown', { timestamp: s.startedMs + 1, exceptionDetails: { exception: { description: 'Bearer secret a@example.com' } } });
  assert.ok(!JSON.stringify(s).includes('secret')); assert.equal(s.timeline[0].offsetMs, 1);
  s.timeline = Array(2000).fill({});
  captureEvent(s, 'Runtime.consoleAPICalled', { type: 'error', args: [{ value: 'extra' }] }); assert.equal(s.timeline.length, 2000); assert.equal(s.truncated, true);
});
test('ZIP output has valid signatures and CRC', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = new Uint8Array(await makeZip({ 'summary.json': '{}', 'recording.webm': new Uint8Array([1, 2, 3]) }).arrayBuffer());
  const v = new DataView(bytes.buffer); assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(v.getUint16(bytes.length - 14, true), 2);
  assert.throws(() => makeZip({ '../escape': 'bad' }));
});
const userId = '005123456789012', debugLevelId = '7dl123456789012', traceId = '7tf123456789012';
function client(fetchImpl) { return new ToolingClient({ instanceUrl: 'https://acme.my.salesforce.com', accessToken: 'private-token', apiVersion: '65.0', fetchImpl }); }
test('Tooling trace has bounded expiry and cleanup only deletes owned records', async () => {
  const calls = []; let traceBody;
  const c = client(async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'POST') traceBody = JSON.parse(options.body);
    if (options.method === 'GET' && url.endsWith('/TraceFlag/' + traceId)) return Response.json(traceBody);
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json(options.method === 'POST' ? { id: traceId, success: true } : { records: [], done: true });
  });
  const trace = await c.createTrace({ userId, debugLevelId, startMs: 1700000000000 });
  assert.equal(trace.created, true); const body = JSON.parse(calls[1].body);
  assert.equal(Date.parse(body.ExpirationDate) - Date.parse(body.StartDate), 300000);
  assert.equal(calls[0].headers.Authorization, 'Bearer private-token'); assert.equal(calls[0].redirect, 'error');
  await assert.rejects(c.cleanupTrace('7tf999999999999'), /only delete/);
  await c.cleanupTrace(trace.id); await assert.rejects(c.cleanupTrace(trace.id), /only delete/);
  await assert.rejects(c.createTrace({ userId, debugLevelId, durationMs: 900000 }), /duration/);
});
test('existing trace flags are never modified', async () => {
  let calls = 0; const c = client(async () => { calls++; return Response.json({ records: [{ Id: traceId }], done: true }); });
  assert.equal((await c.createTrace({ userId, debugLevelId })).created, false); assert.equal(calls, 1);
});
test('Salesforce permission failures exclude raw response messages', async () => {
  const c = client(async () => Response.json([{ errorCode: 'INSUFFICIENT_ACCESS', message: 'secret customer data' }], { status: 403 }));
  await assert.rejects(c.query('SELECT Id FROM ApexLog'), e => e.status === 403 && !e.message.includes('customer'));
  assert.throws(() => new ToolingClient({ instanceUrl: 'https://evil.example', accessToken: 'token', apiVersion: '65.0' }), /trusted/);
  assert.throws(() => new ToolingClient({ instanceUrl: 'https://acme.my.salesforce.com', accessToken: 'token', apiVersion: '../bad' }), /version/);
});

test('Tooling requests retain the browser global receiver for native fetch', async () => {
  const c = client(async function () {
    assert.equal(this, globalThis);
    return Response.json({ records: [], done: true });
  });
  assert.deepEqual(await c.query('SELECT Id FROM ApexLog'), []);
});
