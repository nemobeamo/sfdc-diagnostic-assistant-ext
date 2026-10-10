import { normalizePiiSettings } from './pii.js';
import { redactText, redactUrl } from './redact.js';
export function redactStructuredText(value, settings) {
  if (Array.isArray(value)) return value.map(item=>redactStructuredText(item,settings));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactStructuredText(v,settings)]));
  return typeof value==='string' ? /^https?:\/\//.test(value) ? redactUrl(value,settings) : redactText(value,settings) : value;
}
export function redactEvidence(session, settings) {
  const config=normalizePiiSettings(settings), result=structuredClone(session);
  const text=value=>redactText(value,config);
  const tree=value=>redactStructuredText(value,config);
  result.redaction=config;
  result.environment=tree(result.environment);
  result.warnings=(result.warnings||[]).map(text);
  result.requests=(result.requests||[]).map(r=>({...r,url:redactUrl(r.url,config),requestHeaders:tree(r.requestHeaders),responseHeaders:tree(r.responseHeaders),error:r.error?text(r.error):r.error,mimeType:text(r.mimeType||'')}));
  result.timeline=(result.timeline||[]).map(e=>({...e,detail:tree(e.detail)}));
  if(result.apex){
    // Leave ownership IDs/timestamps intact for safe trace cleanup.
    if(result.apex.reason)result.apex.reason=text(result.apex.reason);
    result.apex.warnings=(result.apex.warnings||[]).map(text);
    result.apex.logs=(result.apex.logs||[]).map(log=>({...log,...(typeof log.body==='string'?{body:text(log.body)}:{})}));
  }
  return result;
}
