import test from 'node:test';
import assert from 'node:assert/strict';
import {ApexCapture, apexFiles, apexSummary} from '../extension/core/apex-capture.js';
import {ToolingClient} from '../extension/core/salesforce.js';
const orgId='00D123456789012', userId='005123456789012', debugLevelId='7dl123456789012', traceId='7tf123456789012', logId='07L123456789012';
function session() {return {id:'session', startedMs:Date.now(), endedMs:Date.now()+1000, environment:{orgId,userId}, timeline:[], warnings:[]};}
function harness({existing=false, noLevels=false, retrievalFailure=false, cleanupFailure=false}={}) {
  const calls=[], remembered=[], forgotten=[]; let passes=0;
  const client={
    async activeTrace() {return existing ? {Id:traceId, ExpirationDate:new Date(Date.now()+600000).toISOString()} : null;},
    async debugLevels(){return noLevels ? [] : [{Id:debugLevelId,DeveloperName:'SDA_Diagnostic'}];},
    async createTrace(options){calls.push(['create',options]);return {id:traceId,created:true,expiresAt:new Date(options.startMs+600000).toISOString()};},
    restoreTrace(ownership){calls.push(['restore',ownership]);},
    async cleanupTrace(id){calls.push(['delete',id]);if(cleanupFailure)throw new Error('network');},
    async retrieveLogs(options){calls.push(['logs',options]); if(retrievalFailure)throw Object.assign(new Error('raw private data'),{status:403}); passes++; return passes===1 ? [] : [{id:logId,startedAt:new Date().toISOString(),body:'redacted evidence'}];}
  };
  const capture=new ApexCapture({getClient:async(o,u)=>{assert.equal(o,orgId);assert.equal(u,userId);return client;},
    remember:async s=>remembered.push(structuredClone(s.apex.ownership)), forget:async id=>forgotten.push(id), wait:async()=>{}});
  return {capture,calls,remembered,forgotten};
}
test('Apex capture persists owned trace metadata, polls delayed logs once per ID, and exports separate files',async()=>{
  const h=harness(), s=session(); await h.capture.prepare(s,async()=>{});
  assert.equal(s.apex.status,'recording'); assert.equal(h.remembered.length,1);
  assert.equal(h.remembered[0].userId,userId); assert.equal(h.calls[0][1].durationMs,600000);
  s.endedMs=Date.now()+1000; await h.capture.finish(s,async()=>{});
  assert.equal(s.apex.status,'complete'); assert.equal(s.apex.logs.length,1); assert.equal(s.apex.cleanup,'complete');
  assert.equal(h.calls.filter(c=>c[0]==='delete').length,1); assert.deepEqual(h.forgotten,[traceId]);
  assert.ok(h.calls.filter(c=>c[0]==='logs')[2][1].skipIds.includes(logId));
  assert.equal(s.timeline.filter(e=>e.kind==='apex-log').length,1);
  assert.equal(apexFiles(s.apex)['apex/'+logId+'.log'],'redacted evidence');
  assert.ok(!JSON.stringify(apexSummary(s.apex)).includes('redacted evidence'));
});
test('preexisting trace flags are reused and never persisted as owned or deleted',async()=>{
  const h=harness({existing:true}), s=session(); await h.capture.prepare(s,async()=>{}); await h.capture.finish(s,async()=>{});
  assert.equal(s.apex.trace.created,false); assert.equal(h.remembered.length,0);
  assert.ok(!h.calls.some(c=>c[0]==='create'||c[0]==='delete')); assert.equal(s.apex.cleanup,'not-needed');
});
test('missing debug levels produce explicit unavailable coverage without server mutations',async()=>{
  const h=harness({noLevels:true}), s=session(); await h.capture.prepare(s,async()=>{});
  assert.equal(s.apex.status,'unavailable'); assert.match(s.apex.reason,/No DebugLevel/); assert.equal(h.calls.length,0);
});
test('retrieval failures still clean owned traces and hide raw provider details',async()=>{
  const h=harness({retrievalFailure:true}),s=session(); await h.capture.prepare(s,async()=>{});await h.capture.finish(s,async()=>{});
  assert.equal(s.apex.status,'unavailable');assert.equal(s.apex.cleanup,'complete');assert.ok(!JSON.stringify(s).includes('raw private'));
});
test('failed cleanup preserves a retryable ownership record and reports expiry',async()=>{
  const h=harness({cleanupFailure:true}),s=session();await h.capture.prepare(s,async()=>{});await h.capture.finish(s,async()=>{});
  assert.equal(s.apex.cleanup,'pending');assert.equal(h.forgotten.length,0);assert.match(s.warnings[0],/expires at/);
});
function client(fetchImpl){return new ToolingClient({instanceUrl:'https://acme.my.salesforce.com',accessToken:'private-token',apiVersion:'67.0',fetchImpl});}
test('Tooling retrieval redacts logs before persistence and labels truncated/oversized log bodies',async()=>{
  const c=client(async(url)=>url.includes('/query/') ? Response.json({done:true,records:[
    {Id:logId,StartTime:'2026-10-09T12:00:00.000Z',LogLength:20000,Status:'Success'},
    {Id:'07L999999999999',LogLength:2000000}
  ]}) : new Response('password=private a@example.com Bearer private-token\n'+'x'.repeat(20000)));
  const logs=await c.retrieveLogs({userId,startMs:0,endMs:Date.now()});
  assert.ok(!logs[0].body.includes('private')&&!logs[0].body.includes('a@example.com'));assert.equal(logs[0].truncated,true);
  assert.ok(logs[0].body.length <= 16000);assert.match(logs[1].omitted,/1 MB/);
});
test('streamed log bodies are bounded even if the metadata reports a small size',async()=>{
  const c=client(async(url)=>url.includes('/query/') ? Response.json({done:true,records:[{Id:logId,LogLength:1}]}) : new Response('x'.repeat(1024*1024+1)));
  const logs=await c.retrieveLogs({userId,startMs:0,endMs:Date.now()});assert.equal(logs[0].body,undefined);assert.match(logs[0].omitted,/capture limits/);
});
test('restored ownership checks remote trace identity and refuses to delete modified flags',async()=>{
  const ownership={id:traceId,userId,debugLevelId,startMs:1700000000000,expiresAt:new Date(1700000600000).toISOString()};
  for(const modified of [false,true]){
    let deleted=false;
    const c=client(async(_,options)=>{
      if(options.method==='DELETE'){deleted=true;return new Response(null,{status:204});}
      return Response.json({TracedEntityId:modified?'005999999999999':userId,DebugLevelId:debugLevelId,
        StartDate:new Date(ownership.startMs).toISOString(),ExpirationDate:ownership.expiresAt,LogType:'DEVELOPER_LOG'});
    });
    c.restoreTrace(ownership);
    if(modified) await assert.rejects(c.cleanupTrace(traceId),/no longer matches/);else await c.cleanupTrace(traceId);
    assert.equal(deleted,!modified);
  }
});
