# Salesforce Support Diagnostic Assistant

Chrome Manifest V3 prototype and implementation plan. Diagnostic evidence stays local; External Client App OAuth enables full Salesforce diagnostics; browser diagnostics work without a connection. No build tools, packages, remote scripts, or backend are needed for this scaffold.

For installation, recording, reviewing, exporting, and troubleshooting, see the [User guide](outputs/USER_GUIDE.md).

Version 0.5.0 improves OAuth troubleshooting: the active Salesforce tab suggests its My Domain login origin, the popup remembers an explicitly selected origin, and **Test login server** checks the endpoint without credentials. Timeout, offline, permission loss, redirects in the server test, and known Salesforce rejection codes have separate messages. Diagnostics survive popup closure in session-only storage and exclude codes, tokens, and provider response bodies. Version 0.5.0 fixes native fetch binding in the background worker. Live Edge testing confirmed the credential-free login-server test and OAuth code exchange followed by Salesforce identity verification.

Version 0.5.0 removes browser-session detection and cookie access. The configured External Client App is the only Salesforce connection method. The popup verifies identity and authenticated API access live and shows verified org/user IDs. Full diagnostics require a connection matching the current Salesforce tab; browser diagnostics do not. **Recheck connection** checks again; recording also performs a live check. No consumer secret or refresh token is stored. See [Salesforce setup](docs/SALESFORCE_SETUP.md).

## Try the prototype

1. Open `edge://extensions` in Microsoft Edge (or `chrome://extensions` in Chrome 118 or newer) and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `extension` folder.
3. Open a Salesforce HTTPS tab, close that tab's DevTools, and click the extension.
4. Connect and verify the configured **External Client App** in the popup, then select **Start recording**. Chrome shows a debugging banner.
5. Reproduce an issue, reopen the extension, and choose **Stop and review**.
6. Preview the recording and inspect the timeline. Select **Include the unredacted recording** only if appropriate, then download the ZIP.

There is no upload or messaging feature. A new capture replaces the previous session. You can delete local evidence from the review page. Browser-profile storage is not an encrypted vault; video previews already opened in other tabs can remain in memory until those tabs close.

## Implemented foundation

- Tab video recording through an offscreen document; no microphone or audio capture.
- Debugger-based network metadata capture with HAR 1.2 export, HTTP failures, redirects, incomplete requests, and total request durations.
- Console errors, warnings, assertions, and uncaught exceptions from the main debugger target.
- Shared timeline with UTC timestamps, relative offsets, and seekable video preview.
- Environment snapshot: sanitized page URL, browser version/user agent, and capture time.
- Text filters for common credentials/emails; query values, cookies, bodies, and arbitrary headers are omitted at collection time.
- Local ZIP export containing a summary, environment, HAR, timeline, and optional WebM.
- Support engineer review for every recording, including network details. This view does not change Salesforce permissions.
- Ten-minute / 100 MB video caps, 2,000-request and 2,000-event caps, and visible truncation warnings.
- Salesforce OAuth login with PKCE, state/callback validation, exact-domain optional Chrome permissions, identity verification, session-only tokens, and disconnect/revocation.
- Live app-token validation, expired/revoked token detection, same-org recording gate, and verified org/user metadata in captured evidence.
- Standalone Tooling API adapter with bounded trace creation, protection of existing trace flags, log retrieval, and cleanup of flags created by that client.

## Pending before a real pilot

External Client App OAuth is the only connection method. Redacted Apex logs are included in ZIP export when available. Verified org/user IDs and API version 67.0 are attached to captured evidence; Salesforce release remains unknown. The Apex workflow is tested with simulated Tooling responses; live-org Apex capture still requires validation.

The browser UI is scaffolded but has not been exercised in a loaded Chrome extension. The manual smoke test and release gates are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). This is a development prototype, not a production-ready release.

Text redaction is best effort. Names, addresses, business data, opaque tokens, and sensitive URL path segments can remain. Video is unredacted and excluded from export by default. HAR lacks response bodies, detailed DNS/TLS timings, and complete out-of-process iframe/worker coverage.

## Project structure

```text
extension/
  manifest.json        Permissions and MV3 entry points
  background.js        Serialized session lifecycle and CDP collection
  auth-controller.js   Separate OAuth message handling
  config.js            Public Salesforce consumer key
  offscreen.js         MediaRecorder and durable video chunks
  popup.*              Start/stop capture controls
  review.*             Preview, timeline, local deletion and ZIP export
  core/
    salesforce-context.js Salesforce URL and My Domain mapping
    evidence.js        Bounded evidence model and HAR projection
    oauth.js           PKCE, authorization, identity verification and revocation
    redact.js          Collection-time text and URL filters
    salesforce.js      Tooling API adapter (not wired to UI)
    store.js           Shared IndexedDB evidence storage
    zip.js             ZIP STORE writer
docs/
  ARCHITECTURE.md
  IMPLEMENTATION_PLAN.md
  SALESFORCE_SETUP.md
tests/
  core.test.js
  check.js
```

Run `npm test` and `npm run check` with Node 20+. No install step is needed. Chrome runtime behavior still requires manual verification on a Salesforce sandbox.

Version 0.5.0 fixes incompatible tab-video constraints. If another extension embeds an extension page in Salesforce and blocks debugger attachment, video recording continues with an explicit warning: network/HAR and console capture are unavailable. Other debugger failures still stop startup. Live Edge verification confirmed start, stop, and saved-video playback in this fallback mode.

Version 0.5.0 adds a red bottom-right recording indicator with a timer and click-to-stop action, verified in Edge. A top-frame isolated script is injected only into the captured Salesforce tab using scripting plus existing tab access. It can inspect/stop only its own active session; it cannot start capture, delete evidence, or access Salesforce credentials. Navigation restores the indicator within Salesforce; leaving Salesforce stops capture.

Live Edge validation of 0.5.0 confirmed disconnected recording is disabled, External Client App identity/API verification enables recording for the matching org, and **Recheck connection** temporarily disables recording until verification succeeds.

Version 0.5.0 integrates Apex capture for the OAuth-authorized user: reuse active trace flags; otherwise select an existing DebugLevel and create a ten-minute trace. Stop retrieves up to 20 logs with three bounded polling passes, redacts/truncates their bodies, adds timeline entries, exports apex/*.log, and cleans only matching owned traces. Token-free cleanup ownership persists for retry after worker interruption. Existing flags are never edited or deleted. Apex failures preserve browser recording with explicit coverage.

Version 0.5.4 adds disconnected video-only capture on ordinary HTTP/HTTPS tabs. It skips debugger/network/console capture and all Apex setup/retrieval. The movable stop indicator, review, and ZIP export still work. Browser settings, extension pages, and other restricted pages cannot be recorded.

Version 0.5.5 expands disconnected recording to all available browser evidence: video, redacted network/HAR metadata, console errors and warnings, JavaScript exceptions, browser/page snapshot, and timeline. Only Apex logs and verified Salesforce org/user details require a matching External Client App connection.

Version 0.5.6 refreshes the popup using Apple's Human Interface Guidelines for hierarchy, layout, buttons, and typography. On a disconnected Salesforce page, Connect Salesforce is the first, prominent action, while browser recording remains secondary. Recording takes priority on other web pages and connected orgs; Stop takes priority during capture. Connection settings and capture details are grouped in collapsed disclosures. The popup uses system fonts, consistent control sizes, visible keyboard focus, and automatic light/dark appearance.

Version 0.5.7 adds plain-language, evidence-aware explanations to every review section: video, issue description, Apex logs, capture coverage, environment, network, browser warnings/errors, timeline, and download/share. Explanations distinguish unavailable capture from an empty result and explain partial logs, unfinished requests, timing limits, and local-only downloads. Video inclusion and timeline seeking are disabled when no video was saved.

Version 0.5.8 adds shared inline help to the popup and evidence review. Expand Salesforce requirements, Capture details, and How Apex capture works for user permissions, External Client App setup, captured/omitted evidence, connected-user tracing, retrieval limits, and cleanup behavior. Help includes Salesforce documentation links and distinguishes identity/API verification from debug-log access.

Version 0.5.9 makes API Enabled and View All Data prominent individual bullets in a highlighted required-permissions block, separate from other Salesforce requirements, in both popup and review help.

Version 0.6.0 adds configurable local PII redaction. The popup's PII redaction settings control email, common phone formats, US SSNs, Luhn-validated card numbers, labeled names/addresses, optional common Salesforce record IDs, and custom literal values or field names. A local preview reports matches without storing the sample. Each capture snapshots its rules and filters browser text and Apex bodies before persistence. Review can apply rules to already-saved evidence through the serialized controller, preserving private trace ownership needed for cleanup. Export reloads the latest saved rules and includes a category/count summary, never the custom rule values. Credentials remain filtered; video stays unredacted. Names/addresses are pattern-based rather than general natural-language recognition.

Version 0.6.1 combines the normal Salesforce connection flow: Connect requests known exact login/org/identity domains during its initial click, and OAuth automatically verifies identity and API access after token exchange. Pending connections finish automatically when validation finds that access has been granted. An unexpected returned org/identity domain still requires the existing exact-domain permission fallback.

Version 0.6.2 adds an original blue cloud-and-pulse icon in 16, 32, 48, and 128-pixel transparent PNG sizes, registered for toolbar and extension management. Original artwork and design prompt are included under outputs.
