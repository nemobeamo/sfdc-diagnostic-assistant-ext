import { redactEvidence, redactStructuredText } from './core/pii-evidence.js';
import { mountPiiSettings } from './pii-settings.js';
import { piiSummary, LEGACY_PII_SETTINGS } from './core/pii.js';
import { renderInlineHelp } from './core/inline-help.js';
import { reviewExplanations } from './core/review-explanations.js';
import { apexSummary, apexFiles } from './core/apex-capture.js';
import { getSession, getChunks } from './core/store.js';
import { toHar } from './core/evidence.js';
import { redactText } from './core/redact.js';
import { makeZip } from './core/zip.js';
const el = id => document.getElementById(id);
for (const topic of ['requirements', 'capture', 'apex']) renderInlineHelp(el(topic + 'Help'), topic);
const id = new URL(location.href).searchParams.get('id');
let session, videoBlob, previewUrl, piiMounted = false;
const sharedApex = () => redactStructuredText(apexSummary(session.apex), session.redaction || LEGACY_PII_SETTINGS);
const json = value => JSON.stringify(value, null, 2);
async function load() {
  session = await getSession(id);
  if (!session) throw new Error('Evidence is no longer available. Only the latest session is retained.');
  if (!['ready', 'error'].includes(session.status)) throw new Error('Stop the recording before reviewing evidence.');
  session = redactEvidence(session, session.redaction || LEGACY_PII_SETTINGS);
  const chunks = await getChunks(id);
  videoBlob = new Blob(chunks.map(c => c.blob), { type: 'video/webm' });
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  el('apexLogs').replaceChildren(); el('timeline').replaceChildren();
  previewUrl = URL.createObjectURL(videoBlob); el('video').src = previewUrl;
  el('piiSummary').textContent = json(piiSummary(session.redaction || LEGACY_PII_SETTINGS));
  if (!piiMounted) {
    piiMounted = true;
    await mountPiiSettings(el('piiSettings'), {initial:session.redaction || LEGACY_PII_SETTINGS, existing:true, onSave:async settings=>{
      const reply=await chrome.runtime.sendMessage({target:'controller',type:'REDACT',id,settings});
      if(!reply?.ok)throw new Error(reply?.error || 'Redaction could not be applied.');
      await load();
    }});
  }
  const hasVideo = videoBlob.size > 0;
  for (const [section, explanation] of Object.entries(reviewExplanations(session, hasVideo))) el(section + 'Explanation').textContent = explanation;
  el('video').hidden = !hasVideo;
  el('includeVideo').disabled = !hasVideo;
  if (!hasVideo) el('includeVideo').checked = false;
  el('console').textContent = json(session.timeline.filter(e => e.kind.startsWith('console-') || e.kind === 'exception'));
  el('status').textContent = session.requests.length + ' requests · ' + session.timeline.length + ' timeline events';
  el('captureWarnings').hidden = !session.warnings.length;
  el('captureWarnings').textContent = session.warnings.join(' ');
  el('coverage').textContent = json({ capture: session.capture, warnings: session.warnings, truncated: !!session.truncated, apex: sharedApex(),
    omitted: ['Request and response bodies', 'Cookies', 'Query values', 'Most headers', 'Out-of-process frames and worker targets'],
    video: chunks.length ? 'Recorded; export optional' : 'Unavailable', textRedaction: 'Best effort; inspect all evidence before sharing' });
  el('apexCoverage').textContent = json(sharedApex());
  for (const log of session.apex?.logs || []) {
    if (typeof log.body !== 'string') continue;
    const detail = document.createElement('details'), heading = document.createElement('summary'), body = document.createElement('pre');
    heading.textContent = log.id + ' · ' + log.startedAt + (log.truncated ? ' · truncated' : '');
    body.textContent = log.body; detail.append(heading, body); el('apexLogs').append(detail);
  }
  el('environment').textContent = json(session.environment);
  el('network').textContent = json(session.requests.map(r => ({ method: r.method, url: r.url, status: r.status, elapsedMs: r.elapsed })));
  for (const e of [...session.timeline].sort((a, b) => a.offsetMs - b.offsetMs)) {
    const row = document.createElement('tr'), time = document.createElement('td'), button = document.createElement('button');
    button.className = 'secondary'; button.disabled = !hasVideo; button.textContent = (e.offsetMs / 1000).toFixed(2) + 's';
    button.onclick = () => { el('video').currentTime = Math.max(0, (Date.parse(e.at) - session.videoStartedMs) / 1000); };
    time.append(button); row.append(time);
    for (const text of [e.kind, json(e.detail)]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
    el('timeline').append(row);
  }
  el('export').disabled = false;
}
el('export').onclick = async () => {
  el('export').disabled = true;
  try {
    // Recheck existence because a new capture or deletion invalidates older review tabs.
    const fresh = await getSession(id);
    if (!fresh) throw new Error('This session was deleted.');
    session = redactEvidence(fresh, fresh.redaction || LEGACY_PII_SETTINGS);
    const includeVideo = el('includeVideo').checked;
    const files = { ...apexFiles(session.apex), 'network.har': json(toHar(session)), 'timeline.json': json(session.timeline),
      'environment.json': json(session.environment), 'summary.json': json({ schemaVersion: 1, id,
        startedAt: new Date(session.startedMs).toISOString(), videoStartedMs: session.videoStartedMs,
        endedMs: session.endedMs, warnings: session.warnings, truncated: !!session.truncated,
        capture: session.capture, apex: sharedApex(), redaction:piiSummary(session.redaction || LEGACY_PII_SETTINGS), includeVideo, notes: redactText(el('notes').value, session.redaction || LEGACY_PII_SETTINGS) }),
      'README.txt': 'Local diagnostic evidence. Text redaction is best effort. Video is unredacted.\nHAR contains metadata only; bodies/cookies are omitted. Missing Apex logs are explained in summary.json.\nTimeline offsets are relative to summary.startedAt. Video starts at summary.videoStartedMs.\nInspect all files before sending to support. No files were uploaded by this extension.\n' };
    if (includeVideo && videoBlob.size) files['recording.webm'] = new Uint8Array(await videoBlob.arrayBuffer());
    const zip = makeZip(files), url = URL.createObjectURL(zip), a = document.createElement('a');
    a.href = url; a.download = 'salesforce-diagnostics-' + id + '.zip'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    el('status').textContent = 'ZIP download requested. Review the package before sharing.';
  } catch (e) { el('status').textContent = e.message; }
  finally { el('export').disabled = false; }
};
el('delete').onclick = async () => {
  const r = await chrome.runtime.sendMessage({ target: 'controller', type: 'DELETE', id });
  if (!r?.ok) { el('status').textContent = r?.error || 'Delete failed'; return; }
  URL.revokeObjectURL(previewUrl); el('video').removeAttribute('src'); el('video').load();
  el('export').disabled = true; el('delete').disabled = true; el('status').textContent = 'Local evidence deleted.';
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
};
window.addEventListener('pagehide', () => URL.revokeObjectURL(previewUrl));
load().catch(e => { el('status').textContent = e.message; });
