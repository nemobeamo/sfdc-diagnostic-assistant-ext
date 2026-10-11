# Salesforce connection setup — prototype 0.5.0

## Microsoft Edge OAuth troubleshooting

Use `edge://extensions` to reload the extension, then reopen the popup on your Salesforce tab. The extension now suggests your org's My Domain login URL, such as `https://your-org.my.salesforce.com` or `https://your-org--sandbox.sandbox.my.salesforce.com`. Confirm or edit that suggestion before connecting. Use the org's canonical My Domain HTTPS origin, not its Lightning hostname or a URL with a page path. The extension uses the same selected origin for authorization and token exchange.

**Test login server** requests browser access to the selected origin and sends an intentionally incomplete token request. No consumer key/secret, authorization code, token, cookie, or PKCE verifier is sent. HTTP 400/401 means the endpoint was reached; it does not prove that the app is configured correctly. A detected redirect prompts you to try My Domain. The plugin keeps strict redirect rejection for the real token exchange so credentials cannot be forwarded to an unchecked destination.

The old message “Salesforce token exchange could not reach the login server” covered multiple causes. Version 0.5.0 distinguishes timeouts, offline state, lost site permission, and Salesforce HTTP rejection codes. An otherwise unexplained fetch failure remains **network-or-redirect** because the Fetch API does not reveal enough detail to establish the cause. It can also reflect browser policy, a VPN/proxy, certificate problems, or endpoint restrictions. Do not bypass browser certificate/security warnings.

If the test succeeds but Connect fails, verify the consumer key after rotation, the exact popup callback, PKCE, Web Server Flow, the public-client secret setting, scopes, and user/app access policy. Start a fresh login after changes; old authorization codes must not be reused. Safe diagnostic messages remain visible after reopening the popup.

For a still-unexplained failure, inspect the extension's background service worker in Edge's extension management page. Check the token request's network status; do not share its request body, authorization callback URL, cookies, or token response. A short error such as a network failure code, or the plugin's safe diagnostic message, is sufficient for further investigation. Live Edge testing found an Illegal invocation error from calling native fetch with the wrong receiver. Version 0.5.0 binds fetch to the global context in OAuth and Tooling API requests. OAuth login and identity verification have passed in Edge.

## External Client App connection

Version 0.5.0 removes browser-session detection and cookie permission. The configured External Client App is the only connection method, and a live verified connection is required for full Salesforce diagnostics. Browser diagnostics do not require a connection. OAuth uses the public consumer key in `extension/config.js` and PKCE; no consumer secret is stored.

## Configure the External Client App

1. Enable OAuth and Web Server Flow.
2. Enable **Require Proof Key for Code Exchange (PKCE) Extension for Supported Authorization Flows**.
3. Disable **Require Secret for Web Server Flow** for this browser public client.
4. Add **Manage user data via APIs (`api`)** and the identity scope **Access the identity URL service (`id`, `profile`, `email`, `address`, `phone`)**. The extension requests `api id`, does not request refresh tokens, and does not retain profile email/name values.
5. Register this exact callback:

   ```text
   https://ojmjkgpcppohbfpndjggobhmdcdkagnd.chromiumapp.org/salesforce
   ```

6. Apply the app's access policy to the intended test users. OAuth does not grant API or debug-log privileges by itself.

The manifest contains a public extension key to keep the unpacked extension ID stable across local installs. It is not a Salesforce credential or private signing key. The popup also displays the callback; verify that it matches the app registration. A future Chrome Web Store build may need a different callback tied to its store extension ID.

Salesforce documents these policies in [External Client App OAuth settings](https://help.salesforce.com/s/articleView?id=sf.configure_external_client_app_oauth_settings.htm&type=5) and the [Web Server Flow](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5). Chrome documents [identity redirect URLs and launchWebAuthFlow](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Connect from Chrome

1. Reload the extension at `edge://extensions` in Microsoft Edge (or `chrome://extensions` in Chrome) after installing this update. If upgrading from 0.1.0, its extension ID changes from the earlier path-derived ID to the stable manifest ID. Earlier local evidence may remain under the old extension identity; export/delete it before replacing an existing install.
2. Open the extension’s **Salesforce connection** section.
3. Confirm the suggested My Domain HTTPS origin or enter it yourself. Generic `https://login.salesforce.com` and `https://test.salesforce.com` origins remain accepted, but may not suit your org's login policies. Do not enter a Lightning page URL or add a URL path.
4. Select **Connect Salesforce** and approve browser access to the selected login, expected org, and standard identity domains if prompted.
5. Complete Salesforce login/SSO and authorize the app.
6. Identity and API verification run automatically after login. Reopen the extension popup if it closed during authorization.
7. If Salesforce returned an unexpected domain outside the initial request, use **Allow org access** to grant that exact domain and finish verification. This is a fallback.
8. Confirm the popup says **External Client App connected to …** and shows verified org/user IDs.

Version 0.6.1 requests known exact domains during the Connect click so normal login finishes without a second extension action. The selected My Domain takes priority; generic login uses the known Salesforce tab or suggested org. A standard login/test identity host is also included. The browser still controls its permission prompt. If Salesforce returns an unanticipated org or identity host, only that exceptional flow needs the fallback org-access action; completed authorization remains in session storage.

## Current scope

Connection verification checks both the authorized org/user identity and authenticated REST API access at version 67.0. Verification runs on popup opening, every 30 seconds while the popup is open, on **Recheck connection**, and before recording. An invalid token is removed; temporary network/API failures leave the connection unverified and full diagnostics disabled; browser diagnostics remain available. The capture tab's canonical My Domain must match the app's returned instance URL. Custom/Visualforce aliases without that mapping can capture browser evidence but cannot enable Apex capture.

Verified org/user IDs and API version are included in the environment snapshot. Apex log capture is implemented; browser pairing is still pending. Existing recordings can always be stopped/reviewed when authorization is unavailable.

No refresh token or consumer secret is stored. Browser restart or extension reload clears the session token; reconnect afterward. **Disconnect Salesforce** removes the local token and attempts server-side revocation. If revocation is unavailable, the popup reports that it was not confirmed; revoke app access in Salesforce if needed. Chrome host permission grants remain until removed through Chrome extension settings.

## Validate in a sandbox

- Verify a permitted user can authorize and finish identity verification.
- Deny authorization, deny either Chrome permission prompt, and close the login window: no false connected state should appear.
- Verify the exact callback and PKCE/secret policies when token exchange fails.
- Verify app access policies and identity scope if account verification fails.
- Disconnect, restart Chrome, and confirm that reconnect is required.
- Check that exported evidence contains no authorization code, access token, PKCE verifier, or consumer secret.

Automated tests exercise simulated OAuth/token/identity responses. A live Salesforce login and Chrome permission/user-activation behavior still need verification with your configured app.

URL auto-population supports Lightning, existing My Domain, and enhanced Visualforce hosts, including sandbox/developer suffixes. Visualforce mappings follow [Salesforce’s My Domain URL formats](https://help.salesforce.com/s/articleView?id=xcloud.domain_name_url_formats.htm&type=5). When the active tab is not Salesforce, the most recently used accessible Salesforce tab in the same window is considered. URLs hidden by browser permissions are skipped.

## Apex capture requirements

Version 0.5.0 runs Tooling API capture with the authorized account. That user needs access to query DebugLevel/TraceFlag/ApexLog, create a user TraceFlag, retrieve ApexLog bodies, and delete the extension's trace flags. API scope alone does not add these Salesforce privileges. See Salesforce's [debug-log permissions](https://help.salesforce.com/s/articleView?id=code_debug_log.htm&language=en_US&type=5) and [trace creation with existing debug levels](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_apex_trace_create.html).

Configure an existing debug level, preferably `SDA_Diagnostic`, for the intended detail. The extension also recognizes `SFDC_DevConsole` and otherwise selects the first available level. It never creates or edits DebugLevel records. Existing active trace flags take precedence and are left untouched.

Test in a sandbox: connect as the same user signed into the recorded tab, start capture, wait for Apex enablement, execute a known Apex-backed action, stop, inspect redacted Apex files and timeline, and confirm an extension-created trace is removed. Test permission denial, expired tokens, existing flags, no Apex execution, and cleanup failure. These cases are covered with simulated Tooling responses; live-org Apex capture has not been performed during implementation.

## Inline help requirements

The extension now presents these requirements in the popup and evidence review. The authorized user needs **API Enabled** for API access and **View All Data** for debug-log access, as described in Salesforce's [debug logging setup](https://help.salesforce.com/articleView?id=code_add_users_debug_log.htm) and [debug log levels](https://help.salesforce.com/s/articleView?id=code_setting_debug_log_levels.htm&language=en_US). Author Apex is associated with executing or editing Apex; this extension does neither. The authorized account must be allowed to perform the specific Tooling operations listed above. The org's administrator should approve these permissions and the External Client App access policy. Connected status verifies identity and REST API access; it does not certify all Apex permissions or setup.

The app must have the documented public-client Web Server Flow/PKCE configuration, API and identity scopes, and correct callback. The org must support the configured API version and Apex logging. An existing debug level is needed when no trace is active; the selected categories must enable the desired logging detail. Browser recording remains available without these Salesforce requirements.

## Login As sessions cannot authorize OAuth

If Salesforce shows Insufficient Privileges during Connect even though the user has app access, check whether an administrator used Login As. Salesforce blocks OAuth authorization from impersonated sessions. Exit Login As and let the user sign in directly with their own username/SSO. See [Salesforce Login Access considerations](https://help.salesforce.com/s/articleView?id=sf.identity_login_access.htm&language=en_US&type=5).

The login field is the source of truth for authorization and token exchange. The popup now displays its selected origin prominently as Login. The Lightning host belongs to the tab being recorded and is labeled separately under Capture details. These hosts normally differ even within the same org.
