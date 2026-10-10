import test from 'node:test';
import assert from 'node:assert/strict';
import {detectAndRedactPii, normalizePiiSettings, piiSummary} from '../extension/core/pii.js';
import {redactText} from '../extension/core/redact.js';
import {redactEvidence} from '../extension/core/pii-evidence.js';
import {captureEvent,toHar} from '../extension/core/evidence.js';
import {ToolingClient} from '../extension/core/salesforce.js';
test('common PII is detected and removed, while non-card numbers and Salesforce IDs survive by default',()=>{
  const result=detectAndRedactPii('a@example.com +1 (415) 555-0198 123-45-6789 4111 1111 1111 1111 1234567890123456 001123456789012ABC');
  assert.equal(result.text,'[EMAIL] [PHONE] [SSN] [CARD] 1234567890123456 001123456789012ABC');
  assert.deepEqual(result.counts,{emails:1,ssns:1,cards:1,phones:1});
});
test('names and addresses mask labeled values, not arbitrary words or unrelated keys',()=>{
  const input='FullName="Alice Jones", MailingStreet=123 Main St; City=Boston\nDeveloperName=SDA_Diagnostic\nAlice Jones visited Boston';
  const result=detectAndRedactPii(input);
  assert.equal(result.text,'FullName=[NAME], MailingStreet=[ADDRESS]; City=[ADDRESS]\nDeveloperName=SDA_Diagnostic\nAlice Jones visited Boston');
  assert.equal(detectAndRedactPii(result.text).text,result.text);
});
test('custom values are literal, case insensitive, and preserve opaque placeholders on repeated application',()=>{
  const config={customValues:['A+B (Clinic)','Alice Jones','NAME'],customFields:['Employee.Code']};
  const input='a+b (clinic): Alice Jones\nEmployee.Code="EMP-007"; OtherCode=EMP-008\nFullName=Jane Doe';
  const result=detectAndRedactPii(input,config);
  assert.equal(result.text,'[CUSTOM_PII]: [CUSTOM_PII]\nEmployee.Code=[CUSTOM_PII]; OtherCode=EMP-008\nFullName=[NAME]');
  assert.equal(detectAndRedactPii(result.text,config).text,result.text);
});
test('category switches preserve selected PII but never disable credential filtering',()=>{
  const settings={emails:false,phones:false,ssns:false,cards:false,names:false,addresses:false,recordIds:true};
  assert.equal(redactText('a@example.com 415-555-0198 password=private Bearer abc 001123456789012ABC',settings),'a@example.com 415-555-0198 password=[REDACTED] Bearer [REDACTED] [RECORD_ID]');
});
test('invalid or excessive custom rules fail validation; exported settings contain no private rules',()=>{
  for(const input of [{customValues:['x']},{customFields:['a\nb']},{customValues:Array(101).fill('Alice')},{customValues:['a'.repeat(129)]}]) assert.throws(()=>normalizePiiSettings(input));
  const summary=JSON.stringify(piiSummary({customValues:['Alice Jones'],customFields:['EmployeeCode']}));
  assert.ok(!summary.includes('Alice Jones')&&!summary.includes('EmployeeCode'));
  assert.equal(JSON.parse(summary).customValueCount,1);
});
test('browser events are sanitized before storing and HAR export uses the sanitized values',()=>{
  const s={startedMs:Date.now(),timeline:[],requests:[],redaction:normalizePiiSettings({customValues:['Alice Jones']})};
  captureEvent(s,'Runtime.consoleAPICalled',{type:'error',args:[{value:'Alice Jones 415-555-0198'}]});
  captureEvent(s,'Network.requestWillBeSent',{requestId:'req',wallTime:Date.now()/1000,timestamp:1,request:{url:'https://example.com/Alice%20Jones?password=secret',method:'GET',headers:{Authorization:'Bearer private',accept:'Alice Jones'}}});
  assert.equal(s.timeline[0].detail.message,'[CUSTOM_PII] [PHONE]');
  assert.equal(s.requests[0].requestHeaders[0].value,'[CUSTOM_PII]');
  assert.ok(!JSON.stringify(toHar(s)).includes('secret'));
  assert.ok(!s.requests[0].url.includes('Alice'));
});
test('re-redaction removes existing log and console PII while preserving cleanup ownership and evidence identity',()=>{
  const s={id:'evidence',status:'ready',environment:{page:'https://example.com',userId:'005123456789012ABC'},timeline:[{kind:'exception',at:'2026-01-01',offsetMs:1,detail:{message:'Alice Jones'}}],requests:[],warnings:[],apex:{ownership:{id:'trace',userId:'005123456789012ABC'},logs:[{id:'070123456789012',body:'Alice Jones 415-555-0198'}]}};
  const sanitized=redactEvidence(s,{customValues:['Alice Jones'],recordIds:true});
  assert.equal(sanitized.apex.logs[0].body,'[CUSTOM_PII] [PHONE]');
  assert.equal(sanitized.environment.userId,'[RECORD_ID]');
  assert.deepEqual(sanitized.apex.ownership,s.apex.ownership);
  assert.equal(sanitized.id,s.id); assert.equal(sanitized.timeline[0].at,s.timeline[0].at);
  assert.equal(s.apex.logs[0].body,'Alice Jones 415-555-0198');
});
test('Tooling log bodies use the capture settings before being returned to storage',async()=>{
  const client=new ToolingClient({instanceUrl:'https://acme.my.salesforce.com',accessToken:'token',apiVersion:'67.0',fetchImpl:async url=>url.includes('/query/')?new Response(JSON.stringify({done:true,records:[{Id:'070123456789012',StartTime:new Date().toISOString(),LogLength:30,Status:'Success'}]}),{status:200}):new Response('Alice Jones 415-555-0198',{status:200})});
  const logs=await client.retrieveLogs({userId:'005123456789012',startMs:0,endMs:Date.now(),redaction:{customValues:['Alice Jones']}});
  assert.equal(logs[0].body,'[CUSTOM_PII] [PHONE]');
});

test('URL sanitization preserves escaped path separators while removing decoded PII',async()=>{
  const {redactUrl}=await import('../extension/core/redact.js');
  const url=redactUrl('https://example.com/a%2Fb/Alice%20Jones?email=hidden',{customValues:['Alice Jones']});
  assert.ok(url.includes('/a%2Fb/'));
  assert.ok(!url.includes('Alice')&&!url.includes('hidden'));
});
