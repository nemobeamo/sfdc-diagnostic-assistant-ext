# Practical implementation plan

Version 0.3.1 adds OAuth My Domain suggestions, credential-free token-endpoint tests, revalidation of browser host permission after login, specific timeout/offline/HTTP rejection messages, and safe session-only diagnostics that remain visible after popup closure. Automated tests pass; the user-reported network failure has not been reproduced in Microsoft Edge because Computer Use access is currently unavailable. Live verification remains required.

Version 0.4.0 removes browser-session detection and cookie permission. The configured External Client App is now required for recording. Live identity and authenticated API checks, current-tab org matching, revoked-token handling, and captured org/user metadata are implemented. OAuth connection and recheck passed in Edge; API version negotiation remains pending; Tooling capture integration is implemented in 0.5.0.

## Increment 1 — Browser capture foundation (scaffolded)

Deliver a loadable MV3 extension with tab recording, debugger network/console collection, timestamp normalization, local storage, evidence review, support engineer presentation, and ZIP export. Use a metadata-only HAR policy and explicit optional unredacted video.

Acceptance: start from a Salesforce tab, close the popup, navigate and reproduce an issue, then stop. ZIP opens with ordinary archive tools; timeline/video offsets match approximately; HTTP failures and console errors appear; missing Apex coverage is explicit; deletion removes stored evidence. Automated core tests pass, and manual Chrome smoke tests pass.

Status: source scaffold and automated core tests are complete. Loaded-Chrome acceptance testing remains pending.

## Increment 2 — Authenticated Salesforce integration (in progress)

Version 0.2.0 implements PKCE login, callback/state validation, exact-domain optional host permissions, identity verification, session-only tokens, and disconnect/revocation. See [SALESFORCE_SETUP.md](SALESFORCE_SETUP.md). OAuth connection and org-to-tab matching are implemented; API version discovery remains pending; Tooling capture integration is implemented in 0.5.0.

1. Configure a development External Client App, stable extension ID/redirect, sandbox user, debug level, and permission set. Document deployment policies for production and sandbox orgs.
2. Add identity/optional exact-origin permissions and PKCE login with state checking. Keep access tokens in session-only storage, segregated from evidence; avoid refresh tokens in the initial pilot.
3. Discover identity, canonical instance, org ID, user ID, and supported API version. Refuse tracing when the authorized org differs from the captured tab. Report release only when known from a reliable source.
4. Connect `ToolingClient` to the controller. Preflight permissions; create a bounded trace before capture and continue browser-only capture with a clear coverage message if Apex preflight fails.
5. Persist owned trace IDs and expiry, poll for delayed Apex logs after stop, cap log count/size, filter body text, and attach logs plus timing metadata to export. Retry cleanup of owned flags; never delete or alter someone else's flags.

Acceptance: test a permitted support identity and an ordinary user without log permissions; both produce accurate coverage. Exercise sandbox login, token expiry, cancellation, denied app access, an existing trace, no Apex execution, delayed logs, API limits, and cleanup failure. No token appears in IndexedDB evidence or ZIP.

## Increment 3 — Runtime hardening

- Add explicit session reconciliation for worker re-entry during transitions and vanished offscreen documents.
- Bound pending CDP queues, batch database writes, and report dropped events. Current arrays are capped but queued events can still grow under heavy load.
- Add recording pause/resume. The accessible elapsed-time indicator and tab-visible stop control are implemented in 0.3.5. Verify action-start user activation timing on all supported Chrome versions.
- Upgrade iframe/worker coverage using Chrome 125 flat sessions if pilot issues require it. Include target identity in the event model and avoid duplicate events.
- Test storage quota exhaustion, tab closure, debugger detachment, browser restart, extension reload, recording limits, repeated start/stop clicks, and stale review tabs.
- Add org-specific redaction rules and evidence editing/omission. Consider optional response bodies only after a separately reviewed privacy policy and byte limits.

Acceptance: failure injection demonstrates that capture terminates, evidence is labeled incomplete, and repeated sessions do not retain old chunks or attach multiple debuggers. No rendering of captured HTML or script is possible.

## Increment 4 — Controlled pilot and release

Run a small internal Salesforce sandbox pilot with IT-approved debugger permission. Review Chrome Web Store disclosure requirements and enterprise extension/DLP policy, add deployment documentation, and measure diagnostic usefulness. Keep upload, Case creation, microphone capture, AI analysis, and remote support pairing outside the initial pilot.

Acceptance: documented auth installation, permissions, retention, and known omissions; verified Chrome runtime matrix; reviewed privacy behavior; confirmed trace cleanup; support engineers can open packages without installing the extension.

## Manual Chrome smoke test

Use synthetic sandbox records and synthetic errors for initial validation.

| Scenario | Expected result |
| --- | --- |
| Open a non-Salesforce tab | Start rejected with a clear message |
| Start on Salesforce, close popup | Recording continues with REC badge |
| Navigate within tab | Video and new network requests continue |
| Trigger a 403/500 or console error | Timestamped failure in timeline and HAR |
| URL has token/query value | Query value absent from stored/exported URL |
| Stop and review | Debugger detached, final video chunk saved, review opens |
| Default export | ZIP contains evidence but no video |
| Opt into video export | Playable WebM included; clearly labeled unredacted |
| Support mode | Additional network details visible; no implied permission elevation |
| Open DevTools or cancel debugger | Capture ends and package shows interruption |
| Close captured tab | Capture ends; evidence can still be reviewed |
| Ten minutes / 100 MB | Automatic stop with reason, no unbounded recording |
| Exceed event/request cap | Truncation explicitly reported |
| Restart Chrome mid-session | Previous session marked interrupted; never silently resumed |
| Start another session | Previous stored evidence removed; stale review cannot export/delete the new session |
| Delete | Stored chunks and evidence removed; export disabled in that review |

Automated checks currently cover filtering, network timing/error/redirect conversion, evidence caps, ZIP structure/CRC, trusted Salesforce origins, trace ownership, trace expiration, existing trace preservation, and safe permission-error reporting. Browser recording, IndexedDB transactions, user activation, debugger policy, and OAuth need runtime/integration validation.

0.5.0 completion: authorized-user Apex capture, reuse of existing traces, existing DebugLevel selection, temporary trace creation, bounded retrieval, redaction, timeline/ZIP integration, and durable ownership cleanup retries are implemented and covered by automated tests. A live sandbox validation run remains required.
