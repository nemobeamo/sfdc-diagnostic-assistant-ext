import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isRecordableUrl} from '../extension/core/capture-policy.js';
import {isSalesforceUrl} from '../extension/core/redact.js';
import {connectionPermissionOrigins, salesforceOrigin, suggestedLoginOrigin, suggestedLoginFromTabs} from '../extension/core/oauth.js';

async function popup({url='https://acme.lightning.force.com/lightning/page/home', connection={status:'disconnected'}, session=null}={}) {
  const nodes=new Map();
  const el=id=> {
    if(!nodes.has(id)) nodes.set(id,{hidden:false,disabled:false,dataset:{},value:'https://login.salesforce.com',className:'',children:[],
      get firstElementChild(){return this.children[0];},
      insertBefore(node,before){if(node===before)return; this.children=this.children.filter(n=>n!==node); const index=this.children.indexOf(before); this.children.splice(index<0?this.children.length:index,0,node);}
    });
    return nodes.get(id);
  };
  el('actionGroups').children=[el('connectionActions'),el('recordingActions')];
  const tab={id:1,url}; const messages=[],permissionRequests=[];
  const source=(await readFile(new URL('../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const context=vm.createContext({document:{getElementById:el},renderInlineHelp(){},async mountPiiSettings(){},URL,Date,isRecordableUrl,isSalesforceUrl,connectionPermissionOrigins,salesforceOrigin,suggestedLoginOrigin,suggestedLoginFromTabs,setInterval(){},
    chrome:{tabs:{async query(){return [tab];}},storage:{local:{async get(){return {};},async set(){}}},permissions:{async request(request){permissionRequests.push(request);return true;}},runtime:{async sendMessage(m){messages.push(m);return m.target==='salesforce-auth'?{ok:true,connection}:{ok:true,session};}}}
  });
  vm.runInContext(source,context); await new Promise(resolve=>setImmediate(resolve));
  return {el,messages,context,permissionRequests};
}
test('disconnected Salesforce popup puts Connect first and preserves browser recording',async()=>{
  const h=await popup();
  assert.equal(h.el('actionGroups').firstElementChild,h.el('connectionActions'));
  assert.equal(h.el('connect').className,'primaryAction');
  assert.equal(h.el('start').className,'secondary');
  assert.equal(h.el('start').disabled,false);
  assert.equal(h.el('start').textContent,'Record browser diagnostics');
  assert.equal(h.el('connectionPanel').open,undefined);
  await h.el('start').onclick();
  assert.equal(h.messages.find(m=>m.type==='START').browserOnly,true);
});
test('ordinary web tab gives recording priority while keeping Connect available',async()=>{
  const h=await popup({url:'https://example.com'});
  assert.equal(h.el('actionGroups').firstElementChild,h.el('recordingActions'));
  assert.equal(h.el('start').className,'primaryAction');
  assert.equal(h.el('connect').className,'secondary');
  assert.equal(h.el('connect').hidden,false);
});
test('matching connected org makes recording primary and requests Apex capture',async()=>{
  const h=await popup({connection:{status:'connected',instanceUrl:'https://acme.my.salesforce.com',orgId:'org',userId:'user',verifiedAt:Date.now()}});
  assert.equal(h.el('connect').hidden,true);
  assert.equal(h.el('start').className,'primaryAction');
  assert.equal(h.el('connectionPanel').open,false);
  await h.el('start').onclick();
  assert.equal(h.messages.find(m=>m.type==='START').browserOnly,false);
});
test('active recording keeps Stop first even without a Salesforce connection',async()=>{
  const h=await popup({session:{status:'recording',startedMs:Date.now(),capture:{network:true},apexStatus:'disabled',warnings:[]}});
  assert.equal(h.el('connectionActions').hidden,true);
  assert.equal(h.el('stop').hidden,false);
  assert.equal(h.el('start').hidden,true);
  assert.equal(h.el('actionGroups').firstElementChild,h.el('recordingActions'));
});
test('authorization completion and verification failures keep the correct actions accessible',async()=>{
  const h=await popup({connection:{status:'permission-needed'}});
  assert.equal(h.el('connect').hidden,true);
  assert.equal(h.el('finish').hidden,false);
  assert.equal(h.el('finish').className,'primaryAction');
  assert.equal(h.el('disconnect').hidden,false);
  assert.equal(h.el('connectedDetails').hidden,false);
  vm.runInContext("displayAuth({status:'verification-needed'})",h.context);
  assert.equal(h.el('recheckConnection').hidden,false);
  assert.equal(h.el('connectedDetails').hidden,false);
});
test('successful login server test suggests Connect only when Connect is visible',async()=>{
  const diagnostic={stage:'server-test',code:'reachable'};
  const h=await popup({connection:{status:'disconnected',diagnostic}});
  assert.match(h.el('authDiagnostic').textContent,/Try Connect Salesforce next/);
  vm.runInContext("displayAuth({status:'permission-needed',diagnostic:{stage:'server-test',code:'reachable'}})",h.context);
  assert.ok(!h.el('authDiagnostic').textContent.includes('Try Connect Salesforce next'));
});

test('Connect requests the expected org and identity access within its initial click',async()=>{
  const h=await popup(); await h.el('connect').onclick();
  assert.equal(h.permissionRequests.length,1);
  assert.deepEqual(Array.from(h.permissionRequests[0].origins),['https://acme.my.salesforce.com/*','https://login.salesforce.com/*']);
  assert.equal(h.messages.filter(m=>m.type==='CONNECT').length,1);
  assert.equal(h.messages.filter(m=>m.type==='FINISH').length,0);
});
