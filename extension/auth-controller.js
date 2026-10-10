import { SalesforceAuth } from './core/oauth.js';
import { SALESFORCE_CLIENT_ID } from './config.js';
export const auth = new SalesforceAuth({ chromeApi: chrome, clientId: SALESFORCE_CLIENT_ID });
// Remove the obsolete opt-in preference; cookie APIs are no longer used.
chrome.storage.local.remove('browserSessionDetectionEnabled').catch(() => {});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'salesforce-auth' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  // Auth does not share the capture queue: an open login must not block Stop.
  let task;
  switch (message.type) {
    case 'STATUS': task = auth.validate(); break;
    case 'RECHECK': task = auth.validate(); break;
    case 'CONNECT': task = auth.connect(message.loginOrigin); break;
    case 'CHECK_SERVER': task = auth.checkServer(message.loginOrigin); break;
    case 'FINISH': task = auth.finish(); break;
    case 'DISCONNECT': task = auth.disconnect(); break;
    default: respond({ ok: false, error: 'Unknown Salesforce connection command.' }); return;
  }
  task.then(connection => respond({ ok: true, connection }), error => respond({ ok: false, error: error.message }));
  return true;
});
