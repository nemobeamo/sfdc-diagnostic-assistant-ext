import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isRecordableUrl} from '../extension/core/capture-policy.js';
import {isSalesforceUrl} from '../extension/core/redact.js';
import {connectionPermissionOrigins, salesforceOrigin, suggestedLoginOrigin, suggestedLoginFromTabs} from '../extension/core/oauth.js';

async function popup({url='https://acme.lightning.force.com/lightning/page/home', connection={status:'disconnected'}, session=null, clipboardError=false}={}) {
  const nodes=new Map();
  const el=id=> {
    if(!nodes.has(id)) nodes.set(id,{hidden:false,disabled:false,dataset:{},value:'https://login.salesforce.com',className:'',children:[],
      focus(){this.focused=true;}, select(){this.selected=true;},
      get firstElementChild(){return this.children[0];},
      insertBefore(node,before){if(node===before)return; this.children=this.children.filter(n=>n!==node); const index=this.children.indexOf(before); this.children.splice(index<0?this.children.length:index,0,node);}
    });
    return nodes.get(id);
  };
  el('actionGroups').children=[el('connectionActions'),el('recordingActions')];
  const tab={id:1,url}; const messages=[],permissionRequests=[],copied=[];
  const source=(await readFile(new URL('../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  const context=vm.createContext({document:{getElementById:el},navigator:{clipboard:{async writeText(value){if(clipboardError)throw new Error('Clipboard unavailable');copied.push(value);}}},renderInlineHelp(){},async mountPiiSettings(){},URL,Date,isRecordableUrl,isSalesforceUrl,connectionPermissionOrigins,salesforceOrigin,suggestedLoginOrigin,suggestedLoginFromTabs,setInterval(){},
    chrome:{tabs:{async query(){return [tab];}},storage:{local:{async get(){return {};},async set(){}}},permissions:{async request(request){permissionRequests.push(request);return true;}},runtime:{async sendMessage(m){messages.push(m);return m.target==='salesforce-auth'?{ok:true,connection}:{ok:true,session};}}}
  });
  vm.runInContext(source,context); await new Promise(resolve=>setImmediate(resolve));
  return {el,messages,context,permissionRequests,copied};
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
  assert.match(h.el('authDiagnostic').textContent,/Select Connect Salesforce to continue/);
  vm.runInContext("displayAuth({status:'permission-needed',diagnostic:{stage:'server-test',code:'reachable'}})",h.context);
  assert.ok(!h.el('authDiagnostic').textContent.includes('Select Connect Salesforce to continue'));
});

test('Connect requests the expected org and identity access within its initial click',async()=>{
  const h=await popup(); await h.el('connect').onclick();
  assert.equal(h.permissionRequests.length,1);
  assert.deepEqual(Array.from(h.permissionRequests[0].origins),['https://acme.my.salesforce.com/*','https://login.salesforce.com/*']);
  assert.equal(h.messages.filter(m=>m.type==='CONNECT').length,1);
  assert.equal(h.messages.filter(m=>m.type==='FINISH').length,0);
});

test('editable login field drives the displayed target and Connect request without changing the recording tab',async()=>{
  const h=await popup();
  h.el('loginOrigin').value='https://another.my.salesforce.com'; h.el('loginOrigin').oninput();
  assert.equal(h.el('connectedOrg').textContent,'Login: https://another.my.salesforce.com');
  assert.equal(h.el('recordedPage').textContent,'Recording tab: https://acme.lightning.force.com');
  await h.el('connect').onclick();
  assert.equal(h.messages.find(m=>m.type==='CONNECT').loginOrigin,'https://another.my.salesforce.com');
  assert.ok(h.permissionRequests[0].origins.includes('https://another.my.salesforce.com/*'));
  assert.equal(h.el('connectedOrg').textContent,'Login: https://another.my.salesforce.com');
});

test('connected identity fields copy each full ID independently and clear on disconnect',async()=>{
  const orgId='00Dbm0000132zZrEAI',userId='005bm00000ZHqu5AAD';
  const h=await popup({connection:{status:'connected',instanceUrl:'https://acme.my.salesforce.com',orgId,userId,verifiedAt:Date.now()}});
  assert.equal(h.el('orgId').value,orgId);
  assert.equal(h.el('userId').value,userId);
  await h.el('copyOrgId').onclick();
  assert.equal(h.el('copyStatus').textContent,'Org ID copied.');
  await h.el('copyUserId').onclick();
  assert.deepEqual(h.copied,[orgId,userId]);
  vm.runInContext("displayAuth({status:'disconnected'})",h.context);
  assert.equal(h.el('authIdentity').hidden,true);
  assert.equal(h.el('orgId').value,'');
  assert.equal(h.el('userId').value,'');
  assert.equal(h.el('copyStatus').textContent,'');
});
test('clipboard failure selects the ID for manual copying',async()=>{
  const h=await popup({clipboardError:true,connection:{status:'connected',instanceUrl:'https://acme.my.salesforce.com',orgId:'00Dbm0000132zZrEAI',userId:'005bm00000ZHqu5AAD',verifiedAt:Date.now()}});
  await h.el('copyOrgId').onclick();
  assert.equal(h.el('orgId').focused,true);
  assert.equal(h.el('orgId').selected,true);
  assert.match(h.el('copyStatus').textContent,/Command\+C.*org id/);
  assert.deepEqual(h.copied,[]);
});

test('additional identity table shows available details and clears them when disconnected',async()=>{
  const h=await popup({connection:{status:'connected',instanceUrl:'https://acme.my.salesforce.com',orgId:'org',userId:'user',verifiedAt:Date.now(),userDetails:{display_name:'Test User',email:'test@example.com',email_verified:false}}});
  assert.equal(h.el('displayName').textContent,'Test User');
  assert.equal(h.el('email').textContent,'test@example.com');
  assert.equal(h.el('emailVerified').textContent,'No');
  assert.equal(h.el('emailVerifiedRow').hidden,false);
  assert.equal(h.el('nicknameRow').hidden,true);
  vm.runInContext("displayAuth({status:'disconnected'})",h.context);
  assert.equal(h.el('email').textContent,'');
  assert.equal(h.el('emailRow').hidden,true);
});
