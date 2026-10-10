export const PII_DEFAULTS = Object.freeze({emails:true, phones:true, ssns:true, cards:true, names:true, addresses:true, recordIds:false, customValues:[], customFields:[]});
export const LEGACY_PII_SETTINGS = Object.freeze({...PII_DEFAULTS, phones:false, ssns:false, cards:false, names:false, addresses:false});
export const PII_LABELS = {emails:'Email addresses', phones:'Phone numbers', ssns:'US Social Security numbers', cards:'Payment card numbers', names:'Names in labeled fields', addresses:'Addresses in labeled fields', recordIds:'Salesforce record IDs'};
export function normalizePiiSettings(value = {}) {
  const result = {};
  for (const key of Object.keys(PII_LABELS)) result[key] = typeof value?.[key] === 'boolean' ? value[key] : PII_DEFAULTS[key];
  for (const key of ['customValues','customFields']) {
    const entries = value?.[key] ?? [];
    if (!Array.isArray(entries) || entries.length > 100 || entries.some(s => typeof s !== 'string' || s.trim().length < 2 || s.length > 128 || /[\r\n]/.test(s))) throw new Error('Use up to 100 custom values or field names, each 2–128 characters on one line.');
    result[key] = [...new Set(entries.map(s=>s.trim()))].sort((a,b)=>b.length-a.length);
  }
  return result;
}
export function piiSummary(settings) {
  const s=normalizePiiSettings(settings);
  return {categories:Object.keys(PII_LABELS).filter(k=>s[k]).map(k=>PII_LABELS[k]), customValueCount:s.customValues.length, customFieldCount:s.customFields.length, credentials:'Always filtered', video:'Unredacted', scope:'Text evidence only; best effort'};
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fields = labels => new RegExp('\\b(["\']?(?:' + labels.map(escape).join('|') + ')["\']?\\s*[:=]\\s*)(?:\\[[A-Z_]+\\]|"[^"\\n]*"|\'[^\'\\n]*\'|[^,;\\n}\\]]+)', 'gi');
function validCard(value) {
  const digits=value.replace(/\D/g,'');
  if(digits.length<13 || digits.length>19 || /^(\d)\1+$/.test(digits)) return false;
  let total=0;
  for(let i=digits.length-1, double=false;i>=0;i--,double=!double){let d=Number(digits[i]); if(double){d*=2;if(d>9)d-=9;}total+=d;}
  return total%10===0;
}
export function detectAndRedactPii(value, settings) {
  const s=normalizePiiSettings(settings), counts={}; let text=String(value??'').slice(0,16000);
  const replace=(category,regex,placeholder,accept=()=>true)=>{
    const masks = category === 'customValues' ? [...text.matchAll(/\[[A-Z_]+\]/g)].map(m=>[m.index,m.index+m[0].length]) : [];
    text=text.replace(regex,(match,...args)=>{
      const offset = args[args.length-2];
      if (masks.some(([start,end])=>offset<end && offset+match.length>start) || !accept(match)) return match;
      if (/^\[[A-Z_]+\]$/.test(match)) return match;
      counts[category]=(counts[category]||0)+1;
      return typeof placeholder==='function' ? placeholder(match,args) : placeholder;
    });
  };
  // Custom literal values go first, so a name or address is removed wherever it occurs.
  if(s.customValues.length) replace('customValues',new RegExp(s.customValues.map(value=>(/^\w/.test(value)?'(?<!\\w)':'')+escape(value)+(/\w$/.test(value)?'(?!\\w)':'')).join('|'),'gi'),'[CUSTOM_PII]');
  const fieldReplacement=label=>(match,args)=>args[0]+'['+label+']';
  const notMasked=match=> !/[:=]\s*\[[A-Z_]+\]/.test(match);
  if(s.customFields.length) replace('customFields',fields(s.customFields),fieldReplacement('CUSTOM_PII'),notMasked);
  if(s.names) replace('names',fields(['Name','FirstName','LastName','FullName','ContactName','CustomerName','First Name','Last Name','Full Name']),fieldReplacement('NAME'),notMasked);
  if(s.addresses) replace('addresses',fields(['Address','Street','MailingStreet','BillingStreet','ShippingStreet','PostalAddress','City','PostalCode','ZipCode','MailingCity','BillingCity','ShippingCity','MailingPostalCode','BillingPostalCode','ShippingPostalCode']),fieldReplacement('ADDRESS'),notMasked);
  if(s.emails) replace('emails',/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi,'[EMAIL]');
  if(s.ssns) replace('ssns',/\b(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g,'[SSN]');
  if(s.cards) replace('cards',/\b(?:\d[ -]?){12,18}\d\b/g,'[CARD]',validCard);
  if(s.phones) replace('phones',/(?<![\w])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\w)/g,'[PHONE]');
  if(s.recordIds) replace('recordIds',/\b(?:001|003|005|006|00Q|00D|500)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g,'[RECORD_ID]');
  return {text,counts};
}
