# Salesforce Support Diagnostic Assistant
## User guide — prototype 0.5.0

Use this Chrome extension to record a Salesforce problem and collect browser evidence for your support team. Start a recording, reproduce the issue, review the evidence, and download a ZIP to share through your usual support channel.

**Current version:** this is a development prototype. Browser recording and Salesforce connections still need testing in a loaded Chrome extension against a live org. An External Client App connection is required for full Salesforce diagnostics; browser diagnostics work without it; Apex debug logs are collected when the authorized user has access and a debug level is available. Begin with synthetic data in a sandbox.

## Quick start

1. Open the Salesforce tab where the problem occurs.
2. Open the extension. Connect your External Client App for full diagnostics, or record browser diagnostics without connecting.
3. Select **Start recording** and reproduce the problem.
4. Reopen the extension and select **Stop and review**.
5. Review the video, capture coverage, and diagnostic timeline.
6. Describe the problem under **What went wrong?**
7. Select **Download support ZIP**. Video is included by default; uncheck the recording option to exclude it.
8. Inspect the downloaded package, then attach it to your support case using your organization's approved channel.

**Save the ZIP before starting another recording.** The extension keeps only the latest capture; a new capture replaces the previous stored evidence.

## Install the prototype

You need the extension's project files and Microsoft Edge or Chrome 118 or newer. Salesforce session detection, login-server reachability, and OAuth connection have been verified in Microsoft Edge; video recording, stopping, and saved-video playback have also been verified in Edge; a full live network capture/export run remains pending. Your organization must allow developer-mode extensions and the debugging permission.

1. If you received a project ZIP, extract it first.
2. In Microsoft Edge's address bar, enter `edge://extensions`. In Chrome, use `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the project's **extension** folder—the folder containing `manifest.json`.
6. Confirm that **Salesforce Support Diagnostic Assistant (Prototype)** appears and is enabled.
7. Open Chrome's Extensions menu and pin the extension if you want easier access.

If your organization blocks installation or recording, ask your IT team about the restriction.

## Prepare a reproduction

Sign into Salesforce normally in Chrome and open the affected page. A verified External Client App connection to this org is required for full diagnostics. Browser diagnostics do not require a connection.

Close Developer Tools for the Salesforce tab before recording. Keep the reproduction short and focused: navigate to the affected record or page, perform the action, and capture the result. Avoid entering passwords or displaying sensitive records during the reproduction.

The recording captures the visible contents of the selected tab. It does not record the whole desktop, other tabs, microphone audio, or tab audio. Switching to another tab does not change the selected recording target.

Standard Salesforce HTTPS domains are recognized. A custom company domain may be rejected even if it hosts Salesforce content.

## Support engineer view

Every recording uses the support engineer view: recording preview, issue description, capture coverage, environment, timeline, and network details showing request methods, URLs, status codes, and durations. There is no role selector. This view does not grant Salesforce permissions or connect to another user's browser.

## Record the issue

1. Make the affected Salesforce tab active.
2. Open the extension and select **Start recording**.
3. Look for the **REC** badge and Chrome's debugging banner.
4. Close the extension popup and reproduce the problem in the selected tab. Recording continues when the popup closes.
5. Reopen the extension and select **Stop and review**.

The review page should open in a new tab. If you close it, reopen the extension and select **Open latest evidence**.

Only one capture can run at a time. Recording stops automatically at ten minutes or the 100 MB recording limit. Network requests and timeline events are each limited to 2,000 entries. Check **Capture coverage** for warnings or a `truncated` indication.

Closing the captured tab, canceling Chrome's debugger connection, or restarting Chrome can interrupt capture. Interrupted recordings may contain only partial evidence.

## Review the evidence

### Recording

Play the preview and check what was visible. The video is **unredacted**: text filters do not hide names, record values, or other information shown on screen.

The **Include the unredacted recording in the ZIP** checkbox starts checked. Review the recording before exporting; uncheck it to share browser evidence without video.

### What went wrong?

Describe the steps, expected result, actual result, and any error message. For example:

> I opened a test account, changed its phone number, and selected Save. I expected the updated value to appear. Instead, an error appeared and the old value remained. This happened twice during the recording.

Avoid adding credentials or sensitive customer information. Export your notes before closing the review page; the prototype does not save them as a draft. Your notes are included in `summary.json` when you export.

### Capture coverage

Check this section before sharing. It identifies capture warnings, truncation, omitted evidence, and whether video was available. Apex coverage currently shows `not-connected`; this means Apex logs were not collected, not that Salesforce generated no logs.

### Environment

The snapshot includes a filtered page URL, browser information, capture time, and the External Client App’s verified org/user IDs and API version 67.0. Salesforce release remains unknown.

### Diagnostic timeline

The timeline lists network activity, network failures, console errors/warnings, and uncaught exceptions. Select a timestamp to seek the video near that event. Timing is approximate; a nearby event does not by itself prove the cause of the issue.

## Export and share

Select **Download support ZIP** and locate the file in Chrome's configured download location. Its name begins with `salesforce-diagnostics-`.

| Package file | Contents |
| --- | --- |
| `summary.json` | Issue notes, capture timing, warnings, truncation, and Apex coverage. |
| `environment.json` | Available browser and page information. |
| `apex/*.log` | Redacted Apex logs when available; omitted/truncated logs are explained in the summary. |
| `timeline.json` | Timestamped diagnostic events. |
| `network.har` | Network request/response metadata for support analysis. |
| `README.txt` | Package contents and coverage notes. |
| `recording.webm` | Video, included only when selected and available. |

The HAR excludes request and response bodies, cookies, URL query values, and most headers. It provides total request durations rather than detailed DNS or TLS timings. Some iframe and worker activity may be absent.

Text filters remove some common credentials and email addresses, but they can miss personal or business data. Inspect the exported files before sharing, as well as any included video. The current review page does not provide tools to edit captured events or mask video.

The extension does not upload the ZIP, email it, or create a Salesforce case. Attach the reviewed package yourself through your approved support process. Tell support if capture was interrupted or truncated.

## Delete local evidence

After exporting any evidence you need, select **Delete local evidence** on the review page. This removes the stored capture and disables export in that review page.

Downloaded ZIPs are separate copies and must be deleted separately. Close any other open review tabs to release previews already held in memory. Evidence is stored in the local Chrome profile; it is not an encrypted vault.

## Troubleshooting

If Start recording is disabled, open a normal web tab. Connect and verify the External Client App for full diagnostics. **Recheck connection** confirms whether the saved app token is still usable.

| What you see | What to do |
| --- | --- |
| **Open a Salesforce tab before starting.** | Make the Salesforce HTTPS tab active and try again. Custom domains may not be recognized. |
| **A recording is already active.** | Reopen the extension and select **Stop and review** before starting another capture. |
| Recording cannot start or the debugger is rejected | Close the tab's Developer Tools and try again. Check with IT if enterprise policy blocks recording/debugging. If it still fails, report the displayed message to the project maintainer. |
| **Debugger detached** or interruption warning | Review the partial evidence. Export it if useful, then make a fresh capture with the selected tab kept open. |
| Recording reaches a limit | Export the current capture, then make a shorter reproduction. |
| Video is missing from the ZIP | Check whether you selected the video checkbox and whether **Capture coverage** reports available video. |
| **Evidence is no longer available** or **This session was deleted** | The capture was deleted or replaced. Use **Open latest evidence** for the latest capture, or locate a previously downloaded ZIP. |
| Storage failure or incomplete video | Preserve any available evidence first. Delete unneeded evidence and downloaded files, check available disk space, and retry a shorter capture. |
| Apex logs are missing | Check the Apex debug logs coverage in the review. Verify the authorized user has debug-log/Tooling access, a debug level exists, and the reproduction executed Apex for that user. |
| OAuth token exchange reports a network/redirect failure | Reload the updated extension in Edge, confirm the suggested My Domain login URL, and select **Test login server**. Then retry **Connect Salesforce** with a fresh login. |
| Login-server test succeeds but OAuth is rejected | Check the displayed error and ask your admin to verify the consumer key, callback, PKCE, app access, scopes, and secret policy. |

## Salesforce authentication

Full Salesforce diagnostics require a verified External Client App connection to the org open in the Salesforce tab. Browser diagnostics can run without one. The extension does not read Salesforce login cookies. Tokens remain in extension session storage and are never included in evidence or shown in the popup.

### Connect the External Client App

Browser-session detection and cookie access have been removed. The extension uses only the configured External Client App consumer key and OAuth authorization code flow with PKCE. It does not store a consumer secret or refresh token.

1. Confirm the suggested My Domain login URL in the popup.
2. Select **Connect Salesforce**, allow access to the selected Salesforce domain, and complete the app's authorization flow.
3. The extension verifies org access automatically after login. Reopen the popup if it closed. **Allow org access** appears only if Salesforce returned an unexpected domain that was not included in the initial permission request.
4. Wait for **External Client App connected to …**, with the verified org/user IDs and verification time.
5. Open a Salesforce tab belonging to that org. **Start recording** becomes available.

The popup checks the token against Salesforce identity and authenticated REST API access on opening and every 30 seconds while open. **Recheck connection** performs the same live check. Recording performs another live check and verifies that the tab's canonical My Domain matches the connected org. The environment snapshot includes the verified org/user IDs and API version 67.0.

An expired or revoked token requires reconnecting. Network or API permission failures show an unverified state and disable recording. A connection to a different org cannot enable recording for the current tab. Stop and review remain available for an existing recording, even if the connection becomes unavailable.

Browser restart or extension reload clears the session-only token. Reconnect afterward. **Disconnect Salesforce** clears the local token and attempts revocation. App authorization does not grant extra Salesforce privileges. Apex capture is integrated with recording and export.

## For support engineers receiving a package

Read `summary.json` and its warnings first, then compare the issue description with the timeline and HAR. Review the video if supplied. Treat missing or truncated evidence as a coverage limitation rather than proof that no error occurred. Ask the Salesforce admin for Apex logs when browser evidence is insufficient.

### Recording video only

If the popup says **Recording video only**, another extension has embedded a page in the Salesforce tab and the browser has blocked debugger attachment. The recording still works, but network/HAR and console errors are not collected. The review page and exported summary explain the missing capture. For full diagnostics, use an Edge profile without the extension that embeds the page, or temporarily disable that extension and reload Salesforce before retrying. Other startup errors identify which capture step failed.

After **Delete local evidence** succeeds, the review tab closes automatically. If deletion fails, the tab stays open and displays the error.

### Stop from the recording indicator

While recording, a prominent red indicator appears at the bottom right of the Salesforce page. It shows a pulsing dot, the elapsed time, and **Click to stop**. Click it (or focus it and press Enter) to stop recording and open the evidence review. The indicator disappears when capture stops and returns after supported navigation. With a matching Salesforce connection, leaving Salesforce stops the recording. Without one, capture supports ordinary HTTP/HTTPS pages; browser restrictions may stop capture when navigating to another domain. The indicator is visible in the recorded video. In video-only mode, its label also says **Video only**.

Drag the recording indicator to move it anywhere within the page. Releasing a drag does not stop recording; use a separate click to stop. With the indicator focused, arrow keys move it (Shift + arrow moves farther). Its position stays inside the visible page when the window is resized.

### Login URL auto-population

Opening the popup fills the login URL from the active Salesforce tab. Lightning and supported enhanced Visualforce URLs are converted to their My Domain login origin; an existing My Domain URL is used directly. If the current tab is not Salesforce, the extension tries the most recently used Salesforce tab in the same window whose URL it already has permission to read. Otherwise it uses your saved login URL or the default login.salesforce.com. You can edit the field before connecting. Generic instance URLs do not contain enough information to infer a My Domain, so no org name is guessed. This reads tab URLs only; authentication still requires the External Client App.

## Apex debug-log capture

Apex capture starts with recording and uses the user authorized through the External Client App. Sign into the Salesforce tab as that same user for the reproduction. Selecting a different app user does not capture the browser user's transactions automatically.

The extension first checks for an active user trace flag. It reuses existing flags without changing or deleting them. Otherwise, it picks an existing DebugLevel: `SDA_Diagnostic` first, then `SFDC_DevConsole`, then the first available level alphabetically. It creates a temporary ten-minute trace flag. If no debug level exists, create one in Salesforce Setup → Debug Logs and retry. The extension does not create or change debug levels.

Wait until the popup says **Apex logs: enabled for the authorized user** before reproducing the Apex action. The indicator shows **Preparing Apex** while setup is underway, or **Apex unavailable** if setup fails. Browser recording continues if Apex setup is denied; the reason is recorded in capture coverage.

When you stop, video capture ends first. The extension then makes up to three log-retrieval passes, separated by about two seconds, with a 30-second retrieval budget. It collects transaction start times within the recording/trace window and adds approximate Apex events to the timeline. Transactions starting after Stop, other users' transactions, and logs arriving after these attempts are outside coverage.

Review the **Apex debug logs** section. Successful log bodies are included as `apex/<log-id>.log` in the ZIP. The limit is 20 logs; logs over 1 MB are omitted, and saved text is limited to 16,000 characters per log after common credential/email redaction. Coverage records omissions and truncation. Inspect logs before sharing because text redaction is best effort.

A newly created trace is deleted after retrieval only if its remote user, debug level, start time, expiration, and type still match the saved ownership. Existing flags are never deleted. Failed cleanup remains queued locally and is retried on subsequent popup/capture checks and a one-minute alarm when the same account is connected. Reconnect that account after a browser restart. The trace's original ten-minute expiration is the fallback; administrator changes to a flag may require manual review.

**Empty** means no matching logs were found, which can happen when the action did not run Apex. **Unavailable** means permissions, authentication, configuration, or transport prevented capture. **Partial** means some logs were omitted/truncated or retrieval failed after collecting evidence. Apex capture has automated coverage; a full live-org logging run is still required to validate the org's permissions and policies.

### Connected popup layout

After connecting, the popup shows a compact org summary and a full-width **Start recording** button near the top. **Connection settings** and **Capture details** start collapsed. Expand Connection settings for the account IDs, login-server test, recheck, or disconnect controls. The recording action remains above these details.

### Record video without connecting Salesforce

Open the web tab you want to record, then open the extension and select **Start recording**. Without a Salesforce connection, it collects tab video, redacted network/HAR metadata, console warnings and errors, JavaScript exceptions, browser/page details, and a synchronized diagnostic timeline. Browser restrictions may limit capture; review shows any gaps. Apex logs and verified Salesforce org/user details require a matching External Client App connection. The same movable recording indicator stops capture and opens review. The recording is included in ZIP export by default.

Normal HTTP/HTTPS web tabs are supported. Browser settings, extension pages, local files, and browser-protected pages are not supported. Connecting later does not add Salesforce diagnostics to a video already recording; start a new capture to include them.

### Popup actions and settings

On a Salesforce page without a verified connection, **Connect Salesforce** is the primary blue button. **Record browser diagnostics** is available below it and collects browser evidence without Apex logs. On other web pages, or after connecting, **Start recording** is the primary action. During capture, **Stop and review** takes priority.

Expand **Salesforce connection** to change the suggested login URL or test the login server. Once connected, **Connection settings** contains account details, recheck, and disconnect. Expand **Capture details** for coverage and limits. The layout follows your system's light or dark appearance and supports keyboard navigation with visible focus.

### Understanding the review page

Each section begins with a plain-language explanation based on your recording. The page tells you whether a type of evidence was captured, what an empty result means, and where capture was incomplete. Apex explanations distinguish missing access from no logs found, partial content, and pending cleanup. The network section counts failed or unfinished requests; browser warnings and errors have their own section and also appear in the timeline.

If no video was saved, video inclusion and video navigation are unavailable. The download explanation confirms that the ZIP stays on your device until you share it through your usual support process.

### Inline setup and capture help

In the popup, expand **Salesforce requirements** for user permissions, app authorization, org/API access, and debug-level setup. **Capture details** lists browser and Salesforce evidence, omitted data, privacy behavior, and recording limits. **How Apex capture works** explains trace setup, the connected user, retrieval, log limits, and cleanup.

The same requirements and workflow help appears inside **Apex debug logs** on the review page. **Capture coverage** includes the complete capture list. Salesforce reference links open in a new tab; the help itself works offline.

### Configure PII detection and removal

Open **PII redaction settings** in the popup. Select the categories to remove: email addresses, common phone formats, US Social Security numbers, payment card numbers, names or addresses in labeled fields, and optional Salesforce record IDs. Names and addresses in ordinary sentences are not reliably detected automatically.

Add **Custom values to remove**, one per line, to remove specific names, addresses, or identifiers wherever they appear as matching text. Add **Sensitive field names**, such as EmployeeCode, to remove values following those labels. Rules are literal and case-insensitive; they do not accept regular expressions. Up to 100 values and 100 field names are supported, each 2–128 characters. Custom rules remain on this device and are not exported.

Use **Preview redaction** with an optional sample to see placeholders and detected-match counts. The sample is not saved. Select **Save redaction settings** to use these settings for future recordings; a recording already in progress keeps its original settings. Apex log bodies and browser text are filtered before saving. Credential filtering remains enabled even if you switch off a PII category.

On the review page, expand **Configure PII redaction**, change the rules, and select **Apply redaction** to update this saved evidence and future recording preferences. Previously removed text cannot be restored. Inspect the updated logs, browser messages, and other evidence before export. The ZIP includes the category settings and custom-rule counts, but excludes custom values and field names. Older recordings show their original email/credential filtering until you apply new rules.

Text redaction is best effort. Phone detection covers common 10-digit formats with an optional country code; add custom values for other formats. Card candidates must pass a checksum, but detection can still miss data or mask unrelated values. Video is not redacted and remains included by default unless you deselect it.
