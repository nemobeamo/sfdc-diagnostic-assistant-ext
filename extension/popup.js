import { mountPiiSettings } from './pii-settings.js';
import { renderInlineHelp } from './core/inline-help.js';
import { isSalesforceUrl } from './core/redact.js';
import { isRecordableUrl } from './core/capture-policy.js';
import { connectionPermissionOrigins, salesforceOrigin, suggestedLoginOrigin, suggestedLoginFromTabs } from './core/oauth.js';
let connection, activeTab, checkingConnection = true, loginSuggestion, captureActive = false;
const matchesOrg = () => connection?.status === 'connected' && suggestedLoginOrigin(activeTab?.url) === connection.instanceUrl;
const updateStart = () => { el('start').disabled = checkingConnection || !isRecordableUrl(activeTab?.url); };
const el = id => document.getElementById(id);
mountPiiSettings(el('piiSettings')).catch(e => { el('piiSettings').textContent = e.message; });
for (const topic of ['requirements', 'capture', 'apex']) renderInlineHelp(el(topic + 'Help'), topic);
const send = async message => {
  const r = await chrome.runtime.sendMessage({ target: 'controller', ...message });
  if (!r?.ok) throw new Error(r?.error || 'Extension unavailable'); return r;
};
function updateHierarchy() {
  const prioritizeConnection = !captureActive && connection?.status !== 'connected' && isSalesforceUrl(activeTab?.url);
  el('connect').className = prioritizeConnection ? 'primaryAction' : 'secondary';
  el('finish').className = prioritizeConnection ? 'primaryAction' : 'secondary';
  el('start').className = prioritizeConnection ? 'secondary' : 'primaryAction';
  el('start').textContent = prioritizeConnection ? 'Record browser diagnostics' : 'Start recording';
  el('connectionActions').hidden = captureActive;
  const groups = el('actionGroups');
  groups.insertBefore(el(prioritizeConnection ? 'connectionActions' : 'recordingActions'), groups.firstElementChild);
  el('headline').textContent = captureActive ? 'Recording the issue' : prioritizeConnection ? 'Connect for full diagnostics' : 'Capture the issue';
  el('intro').textContent = captureActive ? 'Stop when you have reproduced the issue.' : prioritizeConnection ? 'Add Apex logs to your browser recording.' : matchesOrg() ? 'Browser evidence and Apex logs, together.' : 'Record browser evidence in one step.';
}
async function refresh() {
  const { session } = await send({ type: 'STATUS' });
  const active = session && ['starting', 'recording', 'stopping'].includes(session.status);
  captureActive = !!active; updateHierarchy();
  el('start').hidden = !!active; updateStart(); el('stop').hidden = !active;
  el('review').hidden = !session || !!active;
  el('status').textContent = session?.status === 'stopping' ? session.apexStatus === 'disabled' ? 'Recording stopped. Saving browser evidence…' : 'Recording stopped. Collecting Apex logs and cleaning up…' : active ? (session.capture?.network === false ? 'Recording video only · ' : 'Recording · ') + Math.floor((Date.now() - session.startedMs) / 1000) + ' seconds' + '\nApex logs: ' + (session.apexStatus === 'recording' ? 'enabled for the authorized user' : session.apexStatus || 'preparing') + (session.warnings.length ? '\n' + session.warnings.join(' ') : '') : 'Ready when you are.';
}
for (const [id, type] of [['start', 'START'], ['stop', 'STOP'], ['review', 'REVIEW']]) {
  el(id).onclick = async () => {
    el(id).disabled = true;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await send({ type, tabId: tab.id, browserOnly: !matchesOrg() }); await refresh();
    } catch (e) { el('status').textContent = e.message; }
    finally { if (id === 'start') updateStart(); else el(id).disabled = false; }
  };
}
refresh().catch(e => { el('status').textContent = e.message; });

let loginEdited = false;
function displayLoginTarget() {
  if (connection?.status === 'connected') {
    el('connectedOrg').textContent = 'Connected org: ' + connection.instanceUrl;
  } else {
    try { el('connectedOrg').textContent = 'Login: ' + salesforceOrigin(el('loginOrigin').value); }
    catch { el('connectedOrg').textContent = 'Enter a valid Salesforce login URL below.'; }
  }
  el('connectedOrg').title = el('connectedOrg').textContent;
  el('recordedPage').textContent = isRecordableUrl(activeTab?.url) ? 'Recording tab: ' + new URL(activeTab.url).origin : 'Open a web tab to record browser evidence.';
}
el('loginOrigin').oninput = () => { loginEdited = true; displayLoginTarget(); };
async function authSend(message) {
  const reply = await chrome.runtime.sendMessage({ target: 'salesforce-auth', ...message });
  if (!reply?.ok) throw new Error(reply?.error || 'Salesforce connection unavailable.');
  return reply.connection;
}
function displayAuth(c) {
  const wasConnected = connection?.status === 'connected';
  const connected = c.status === 'connected';
  connection = c; checkingConnection = false; updateStart();
  if (connected && !wasConnected) el('connectionPanel').open = false;
  el('connectionSummary').textContent = connected ? 'Connection settings' : 'Salesforce connection';
  el('intro').hidden = false;
  el('captureDescription').textContent = matchesOrg() ? 'Records this Salesforce tab with available network, console, and Apex evidence. Permissions and browser policy may limit coverage.' : 'Records this tab with available network activity, console errors, and browser details. Connect Salesforce to add Apex logs and verified org/user details.';
  el('loginHint').hidden = connected;
  el('authStatus').hidden = connected;
  el('connectionLabel').textContent = connected ? 'Connected to Salesforce' : 'Browser diagnostics';
  el('connectionLabel').dataset.connected = String(connected);

  el('connectedDetails').hidden = !['connected', 'permission-needed', 'connecting', 'verification-needed'].includes(c.status);
  el('captureControls').hidden = false;
  el('recheckConnection').hidden = !['connected', 'verification-needed'].includes(c.status);
  el('authIdentity').hidden = c.status !== 'connected';
  const details = connected ? c.userDetails || {} : {};
  el('orgId').value = connected ? c.orgId || '' : '';
  el('userId').value = connected ? c.userId || '' : '';
  el('copyStatus').textContent = '';
  const identityValues = {displayName: details.display_name, username: details.username, email: details.email,
    nickname: details.nick_name, timezone: details.timezone, locale: details.locale,
    emailVerified: typeof details.email_verified === 'boolean' ? (details.email_verified ? 'Yes' : 'No') : '',
    apiVersion: connected ? c.apiVersion : ''};
  for (const [id, value] of Object.entries(identityValues)) {
    el(id).textContent = typeof value === 'string' ? value : '';
    el(id + 'Row').hidden = !el(id).textContent;
  }
  el('verifiedAt').textContent = connected ? 'Verified: ' + new Date(c.verifiedAt).toLocaleTimeString() : '';
  if (c.loginOrigin && !loginEdited && !loginSuggestion) el('loginOrigin').value = c.loginOrigin;
  el('authDiagnostic').hidden = !c.diagnostic || connected && c.diagnostic.stage === 'connected';
  el('connect').disabled = c.status === 'connecting';
  el('connect').hidden = c.status === 'connected' || c.status === 'permission-needed';
  el('authDiagnostic').textContent = c.diagnostic?.stage === 'server-test' && c.diagnostic.code === 'reachable'
    ? 'Login server is reachable.' + (el('connect').hidden || captureActive ? '' : ' Select Connect Salesforce to continue.')
    : c.diagnostic?.message || '';
  el('finish').hidden = c.status !== 'permission-needed';
  el('disconnect').hidden = !['connected', 'permission-needed', 'connecting', 'verification-needed'].includes(c.status);
  el('loginOrigin').disabled = c.status !== 'disconnected';
  el('authStatus').textContent = c.status === 'connected' ? 'External Client App connected to ' + new URL(c.instanceUrl).hostname + (matchesOrg() ? '.' : '. Open this org’s tab to include Apex logs.')
    : c.status === 'permission-needed' ? 'Login complete. Select Allow org access to verify your account.'
    : c.status === 'connecting' ? 'Complete Salesforce login in the authorization window, then reopen this popup.'
    : c.status === 'verification-needed' ? 'Connection could not be verified. Recheck or reconnect to include Apex logs.'
    : 'Connect to include Apex logs. You can still record browser evidence without connecting.';
  displayLoginTarget(); updateHierarchy();
}
el('connect').onclick = async () => {
  el('connect').disabled = true;
  try {
    const loginOrigin = salesforceOrigin(el('loginOrigin').value);
    const origins = connectionPermissionOrigins(loginOrigin, activeTab?.url && suggestedLoginOrigin(activeTab.url) ? activeTab.url : loginSuggestion);
    const allowed = await chrome.permissions.request({ origins });
    if (!allowed) throw new Error('Salesforce site access was not granted.');
    await chrome.storage.local.set({ preferredOAuthOrigin: loginOrigin });
    el('authDiagnostic').hidden = true;
    el('authStatus').textContent = 'Complete Salesforce login. The extension will verify the connection automatically.';
    displayAuth(await authSend({ type: 'CONNECT', loginOrigin }));
  } catch (error) {
    try { displayAuth(await authSend({type:'STATUS'})); } catch { /* Keep the original connection failure. */ }
    el('authStatus').textContent = error.message;
  }
  finally { el('connect').disabled = false; }
};
el('finish').onclick = async () => {
  el('finish').disabled = true;
  try {
    const allowed = await chrome.permissions.request({ origins: connection.requiredOrigins });
    if (!allowed) throw new Error('Org access was not granted; connection is not verified.');
    displayAuth(await authSend({ type: 'FINISH' }));
  } catch (error) { el('authStatus').textContent = error.message; }
  finally { el('finish').disabled = false; }
};
el('disconnect').onclick = async () => {
  el('disconnect').disabled = true;
  try {
    const c = await authSend({ type: 'DISCONNECT' }); displayAuth(c);
    if (!c.revoked) el('authStatus').textContent = 'Local connection cleared. Server revocation was not confirmed; revoke app access in Salesforce if needed.';
  } catch (error) { el('authStatus').textContent = error.message; }
  finally { el('disconnect').disabled = false; }
};
async function initializeAuth() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); activeTab = tab;
  const { preferredOAuthOrigin } = await chrome.storage.local.get('preferredOAuthOrigin');
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const suggestion = suggestedLoginFromTabs(tab, tabs); loginSuggestion = suggestion;
  if (!loginEdited) {
    if (suggestion) el('loginOrigin').value = suggestion;
    else if (preferredOAuthOrigin) {
      try { el('loginOrigin').value = salesforceOrigin(preferredOAuthOrigin); } catch { /* Ignore an invalid saved origin. */ }
    }
  }
  displayAuth(await authSend({ type: 'STATUS' }));
}
initializeAuth().catch(error => { displayAuth({status:'disconnected'}); el('authStatus').textContent = error.message; });
async function recheckConnection() {
  checkingConnection = true; updateStart(); el('connectionLabel').textContent = 'Checking connection…'; el('authStatus').textContent = 'Verifying External Client App connection…';
  try { displayAuth(await authSend({ type: 'RECHECK' })); }
  catch (error) { displayAuth({status:'disconnected'}); el('authStatus').textContent = error.message; }
  finally { checkingConnection = false; updateStart(); }
}
el('recheckConnection').onclick = recheckConnection;
setInterval(() => { if (!checkingConnection && connection?.status === 'connected') recheckConnection(); }, 30000);
el('testLogin').onclick = async () => {
  el('testLogin').disabled = true;
  try {
    const loginOrigin = salesforceOrigin(el('loginOrigin').value);
    const allowed = await chrome.permissions.request({ origins: [loginOrigin + '/*'] });
    if (!allowed) throw new Error('Allow access to this login URL, then try again.');
    displayAuth(await authSend({ type: 'CHECK_SERVER', loginOrigin }));
  } catch (error) { el('authStatus').textContent = error.message; }
  finally { el('testLogin').disabled = false; }
};

for (const [buttonId, fieldId, label] of [['copyOrgId', 'orgId', 'Org ID'], ['copyUserId', 'userId', 'User ID']]) {
  el(buttonId).onclick = async () => {
    const field = el(fieldId);
    if (!field.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      el('copyStatus').textContent = label + ' copied.';
    } catch {
      field.focus(); field.select();
      el('copyStatus').textContent = 'Press Ctrl+C (Command+C on Mac) to copy the selected ' + label.toLowerCase() + '.';
    }
  };
}
