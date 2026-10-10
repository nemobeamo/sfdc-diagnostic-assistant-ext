import { PII_LABELS, normalizePiiSettings, detectAndRedactPii } from './core/pii.js';
import { redactCredentials } from './core/redact.js';
export async function mountPiiSettings(target, {initial, onSave, existing = false} = {}) {
  if(!target)return;
  const saved=initial ?? (await chrome.storage.local.get('piiSettings')).piiSettings;
  const config=normalizePiiSettings(saved);
  const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const form=node('div'), controls={};
  form.className='piiSettings';
  form.append(node('p',existing?'Apply these settings to this evidence and future recordings. Previously removed text cannot be restored.':'Choose which text to replace with placeholders in future recordings. Changes do not affect a recording already in progress.'));
  for(const [key,title] of Object.entries(PII_LABELS)){
    const label=node('label'), checkbox=node('input');checkbox.type='checkbox';checkbox.checked=config[key];
    checkbox.id='pii-'+key;controls[key]=checkbox;label.append(checkbox,node('span',title));form.append(label);
  }
  for(const [key,title,help] of [['customValues','Custom values to remove','One exact value per line, such as a customer name or address. Matches ignore case.'],['customFields','Sensitive field names','One field name per line, such as EmployeeCode. Values after that field’s = or : are removed.']]){
    const label=node('label',title), input=node('textarea');input.id='pii-'+key;input.value=config[key].join('\n');input.maxLength=12900;label.htmlFor=input.id;controls[key]=input;
    form.append(label,input,node('p',help));
  }
  form.append(node('p','Names and addresses are detected in labeled fields, not every sentence. Phone detection covers common 10-digit formats with an optional country code. Add exact values for other formats. Custom rules stay on this device and are not included in the ZIP. Credentials are always filtered. Video is not changed.'));
  const sampleLabel=node('label','Try a sample (optional)'), sample=node('textarea'), output=node('pre'), counts=node('p');sample.id='pii-sample';sample.maxLength=16000;sampleLabel.htmlFor=sample.id;
  const preview=node('button','Preview redaction'), save=node('button',existing?'Apply redaction':'Save redaction settings'), status=node('p');status.setAttribute('role','status');preview.type=save.type='button';preview.className='secondary';
  const read=()=>normalizePiiSettings(Object.fromEntries(Object.entries(controls).map(([k,e])=>[k,e.type==='checkbox'?e.checked:e.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)])));
  preview.onclick=()=>{
    try{const result=detectAndRedactPii(redactCredentials(sample.value),read());output.textContent=result.text;counts.textContent=Object.entries(result.counts).map(([key,n])=>(PII_LABELS[key]||'Custom rules')+': '+n).join(' · ')||'No PII matches detected. This does not guarantee the sample contains no sensitive data.';status.textContent='Preview only. The sample is not saved.';}catch(e){status.textContent=e.message;}
  };
  save.onclick=async()=>{
    save.disabled=true;
    try{const settings=read();if(onSave)await onSave(settings);await chrome.storage.local.set({piiSettings:settings});status.textContent=existing?'Redaction applied. Review the updated evidence before sharing.':'Saved. These settings apply to the next recording.';}
    catch(e){status.textContent=e.message;}finally{save.disabled=false;}
  };
  form.append(sampleLabel,sample,preview,counts,output,save,status);target.append(form);
}
