import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewExplanations} from '../extension/core/review-explanations.js';
const base = {requests:[],timeline:[],warnings:[],capture:{network:true,console:true},environment:{},apex:{status:'disabled',logs:[]}};
test('browser-only evidence explains missing Salesforce details without claiming missing browser capture',()=>{
  const text=reviewExplanations(base,true);
  assert.match(text.video,/included in the ZIP by default/);
  assert.match(text.apex,/not collected/);
  assert.match(text.environment,/Verified Salesforce org and user IDs are unavailable/);
  assert.match(text.network,/enabled, but no web requests were saved/);
  assert.match(text.console,/does not rule out a problem/);
  assert.match(text.package,/does not send anything/);
});
test('partial Apex and browser errors describe the saved evidence and capture limits',()=>{
  const text=reviewExplanations({...base,requests:[{status:500,finished:true},{status:0,finished:false}],timeline:[{kind:'exception'}],warnings:['capture warning'],truncated:true,environment:{orgId:'org',userId:'user'},apex:{status:'partial',cleanup:'pending',logs:[{id:'log',body:'redacted',truncated:true},{id:'omitted',omitted:true}]}},true);
  assert.match(text.apex,/1 Apex log with readable content is/);
  assert.match(text.apex,/partial record/); assert.match(text.apex,/not been confirmed/);
  assert.match(text.network,/1 request returned an error/); assert.match(text.network,/1 request had no completed result/);
  assert.match(text.console,/1 browser warning or error was/);
  assert.match(text.coverage,/some browser events were left out/);
  assert.match(text.environment,/may differ from the browser account/);
});
test('unavailable video and browser capture never imply evidence was collected',()=>{
  const text=reviewExplanations({...base,capture:{network:false,console:false},apex:{status:'unavailable',logs:[]}},false);
  assert.match(text.video,/No video was saved/);
  assert.match(text.network,/Network capture was unavailable/);
  assert.match(text.console,/were not captured/);
  assert.match(text.timeline,/Video navigation is unavailable/);
  assert.match(text.package,/No video will be included/);
});
test('empty and interrupted Apex explain the outcome and preserve available log context',()=>{
  assert.match(reviewExplanations({...base,apex:{status:'empty',logs:[]}},true).apex,/no Apex logs were found/);
  assert.match(reviewExplanations({...base,apex:{status:'interrupted',logs:[{body:'saved'}]}},true).apex,/1 log can still be reviewed/);
});
test('every contextual explanation has a matching review page destination',async()=>{
  const html=await readFile(new URL('../extension/review.html',import.meta.url),'utf8');
  for(const section of Object.keys(reviewExplanations(base,true))) assert.ok(html.includes('id="'+section+'Explanation"'),section);
});
