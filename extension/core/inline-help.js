// Shared, locally rendered help; links are optional references, not remote content.
export const inlineHelp = {
  requirements: {
    introduction: 'Browser recording does not need a Salesforce connection or Salesforce permissions. The requirements below apply when you want Apex logs as well.',
    permissions: [
      ['API Enabled', 'Allows the extension to use Salesforce APIs.'],
      ['View All Data', 'Required for Salesforce debug-log access.']
    ],
    permissionNote: 'These permissions apply to the user connected through the extension. Ask your Salesforce admin to approve and assign them; View All Data grants broad org access. Connecting the app does not grant these permissions.',
    items: [
      ['Logging access', 'The user must be allowed to read debug levels, query and create user trace flags, download Apex logs, and remove the temporary trace flags this extension creates. Author Apex is for writing or executing Apex; this extension does neither and does not require it for that purpose.'],
      ['External Client App', 'Your admin must allow this user to authorize the configured app, including any required profile or permission-set assignment. For this extension, configure Web Server Flow with PKCE, API and identity scopes (api and id), and the registered extension callback. Require Secret for Web Server Flow must be off for this browser public client. Do not enter a consumer secret into the extension.'],
      ['Org and account', 'The org must support Apex logging and API access, including the API version used by this extension (67.0). Connect to the same org you are recording, using its My Domain login URL when required by org policy. Sign in through the extension as the user whose Apex activity you want to capture. A browser login alone is not an extension connection.'],
      ['Direct user sign-in', 'Salesforce does not permit OAuth authorization from an administrator’s Login As session. Exit that session and sign in directly as the intended user before connecting; app assignment does not remove this restriction.'],
      ['Debug level', 'If the user has no active trace flag, create a debug level in Salesforce Setup → Debug Logs. This extension prefers SDA_Diagnostic, then SFDC_DevConsole, then the first available level by name. It does not create or edit debug levels. Logging categories must be enabled for the detail you need; levels set to None will not provide that detail.'],
      ['Availability', 'Org API limits, debug-log storage limits, login policies, or expired authorization can prevent capture. A Connected status verifies identity and API access; Apex logging permissions and setup are checked when capture starts. Browser recording remains available if Apex setup fails.']
    ],
    links: [
      ['Salesforce debug-log permissions and setup', 'https://help.salesforce.com/articleView?id=code_add_users_debug_log.htm'],
      ['External Client App OAuth settings', 'https://help.salesforce.com/s/articleView?id=sf.configure_external_client_app_oauth_settings.htm&type=5']
    ]
  },
  capture: {
    introduction: 'The extension records evidence from the tab you select. Available evidence is shown on the review page; browser policy or Salesforce access can leave gaps.',
    items: [
      ['Without a Salesforce connection', 'Tab video; web request URLs, methods, results and timings; console warnings, errors and JavaScript exceptions; page and browser details; and a timeline linking these events by time.'],
      ['With a matching Salesforce connection', 'The same browser evidence, plus verified org/user IDs, the API version, and available Apex debug logs for the connected user. The Salesforce release is not detected.'],
      ['Not collected', 'Network request and response bodies, cookies, query values, and most headers are left out. Microphone audio, other browser tabs, and another user’s browser are not recorded. Some frames and background workers are outside network/console coverage.'],
      ['Privacy and limits', 'PII redaction settings let you select text categories and add custom values or sensitive field names. Text is filtered before saving; you can apply additional rules on the review page. Filtering can miss data, so inspect the results. Video is unredacted and included in the ZIP by default unless you deselect it. Recording stops at 10 minutes or the video size limit of 100 MB. Evidence stays on this device until you choose to share it.']
    ]
  },
  apex: {
    introduction: 'Salesforce creates the server-side logs. The extension uses the Tooling API to enable logging and retrieve the results; it does not run or change your Apex code.',
    ordered: true,
    items: [
      ['Before recording', 'Connect the extension to the org as the user whose transactions you want to trace. This can be a different account from the browser login, so check that they match when reproducing the issue.'],
      ['When recording starts', 'The extension reuses an active user trace flag without changing it. Otherwise, it uses an existing debug level to create a temporary trace flag that expires after 10 minutes. Browser recording starts before Apex setup finishes; wait until Apex is enabled before reproducing the server-side issue.'],
      ['During reproduction', 'Salesforce writes logs when the traced user’s activity executes Apex. The debug level controls which details appear. Transactions running as another user, such as Automated Process, are outside this capture.'],
      ['When recording stops', 'The extension queries logs for the connected user within the capture period and downloads their contents. It tries up to three times to allow for delayed logs, within a 30-second retrieval budget. Transactions starting after you stop are outside the capture window.'],
      ['Review and export', 'Common sensitive text is filtered before logs are saved. Up to 20 matching logs are retrieved; logs over 1 MB are omitted, and saved content is limited to 16,000 characters per log. Shortened or missing content is reported. Readable logs appear in the ZIP’s apex folder; timeline matching is approximate and based only on time.'],
      ['Cleanup', 'The extension attempts to remove only temporary trace flags it created, after checking that they still match its saved settings. Existing traces are untouched. If removal fails, the review page reports pending cleanup and the expiry; reconnecting the same account allows a retry. The extension does not delete Salesforce ApexLog records.']
    ],
    links: [['Salesforce debug levels and trace flags', 'https://help.salesforce.com/s/articleView?id=code_setting_debug_log_levels.htm&language=en_US']]
  }
};
export function renderInlineHelp(target, topic) {
  const help = inlineHelp[topic];
  if (!target || !help) return;
  const intro = document.createElement('p'); intro.textContent = help.introduction;
  target.append(intro);
  if (help.permissions) {
    const panel = document.createElement('section'), title = document.createElement('h3'), permissions = document.createElement('ul'), note = document.createElement('p');
    panel.className = 'requiredPermissions'; title.textContent = 'Required Salesforce user permissions';
    for (const [name, explanation] of help.permissions) {
      const item = document.createElement('li'), label = document.createElement('strong'), text = document.createElement('span');
      label.textContent = name; text.textContent = ' — ' + explanation;
      item.append(label, text); permissions.append(item);
    }
    note.textContent = help.permissionNote; panel.append(title, permissions, note); target.append(panel);
    const setupHeading = document.createElement('h3'); setupHeading.textContent = 'Other Salesforce requirements'; target.append(setupHeading);
  }
  const list = document.createElement(help.ordered ? 'ol' : 'ul');
  for (const [label, text] of help.items) {
    const item = document.createElement('li'), heading = document.createElement('strong'), body = document.createElement('span');
    heading.textContent = label + ': '; body.textContent = text;
    item.append(heading, body); list.append(item);
  }
  target.append(list);
  for (const [label, url] of help.links || []) {
    const paragraph = document.createElement('p'), link = document.createElement('a');
    link.textContent = label; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    paragraph.append(link); target.append(paragraph);
  }
}
