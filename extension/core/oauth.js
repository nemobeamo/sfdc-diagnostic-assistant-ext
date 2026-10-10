import { ToolingClient } from './salesforce.js';
import { pageContext } from './salesforce-context.js';
const idPattern = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const AUTH_KEY = 'salesforceConnection';
const DIAGNOSTIC_KEY = 'salesforceAuthDiagnostic';
export function suggestedLoginOrigin(tabUrl) {
  const context = pageContext(tabUrl);
  return context?.apiHost?.endsWith('.my.salesforce.com') ? 'https://' + context.apiHost : null;
}
export function suggestedLoginFromTabs(activeTab, tabs = []) {
  const active = suggestedLoginOrigin(activeTab?.url);
  if (active) return active;
  // Chrome only exposes URLs for tabs the extension is already allowed to read.
  return [...tabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .map(tab => suggestedLoginOrigin(tab.url)).find(Boolean) || null;
}
// Request known destinations while the Connect click still has user activation.
export function connectionPermissionOrigins(value, tabOrSuggestedUrl) {
  const login = salesforceOrigin(value);
  const org = suggestedLoginOrigin(login) || suggestedLoginOrigin(tabOrSuggestedUrl);
  const identity = login === 'https://test.salesforce.com' || org?.includes('.sandbox.my.salesforce.com')
    ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
  return [...new Set([login, org, identity].filter(Boolean).map(origin=>origin+'/*'))];
}
export class OAuthConnectionError extends Error {
  constructor(message, code, origin, httpStatus) {
    super(message); this.code = code; this.origin = origin; this.httpStatus = httpStatus;
  }
}
function tokenTransportError(error, origin, online) {
  const hostname = new URL(origin).hostname;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new OAuthConnectionError(`Salesforce token exchange timed out at ${hostname}. Check your connection and try again.`, 'timeout', origin);
  if (!online) return new OAuthConnectionError('Your browser appears to be offline. Reconnect to the network and try again.', 'offline', origin);
  return new OAuthConnectionError(`The browser could not complete the token request to ${hostname}. Check extension site access, your VPN/proxy, and the login URL. A blocked redirect can cause this too; try your org’s My Domain URL.`, 'network-or-redirect', origin);
}
const tokenAdvice = {
  invalid_client_id: 'Salesforce did not recognize the consumer key. Check whether credential rotation changed it.',
  invalid_client: 'Salesforce rejected the app credentials. Verify the consumer key and disable Require Secret for Web Server Flow for this public client.',
  invalid_grant: 'Salesforce rejected the authorization code or PKCE verification. Start a new login using the same My Domain URL for authorization and token exchange.',
  invalid_request: 'Salesforce rejected the token request. Check the app callback URL, PKCE setting, and public-client secret policy.',
  unauthorized_client: 'This user or app is not permitted to use this OAuth flow. Check Salesforce app access policies.',
  invalid_scope: 'Salesforce rejected the requested scopes. Enable the api and id scopes for the app.',
  unsupported_grant_type: 'Salesforce does not allow this token flow. Enable Web Server Flow for the app.'
};
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function salesforceOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a Salesforce HTTPS login URL.'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.salesforce.com') || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use a Salesforce HTTPS origin, such as https://login.salesforce.com or your My Domain URL.');
  }
  return url.origin;
}
export async function createPkce(cryptoImpl = crypto) {
  const verifier = base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  return { verifier, challenge, state };
}
export function authorizationUrl({ loginOrigin, clientId, redirectUri, challenge, state }) {
  const url = new URL('/services/oauth2/authorize', salesforceOrigin(loginOrigin));
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    scope: 'api id', code_challenge: challenge, code_challenge_method: 'S256', state });
  return url.href;
}
export function callbackCode(callback, redirectUri, expectedState) {
  let url;
  try { url = new URL(callback); } catch { throw new Error('Salesforce did not return a valid authorization callback.'); }
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash) throw new Error('Unexpected Salesforce callback URL.');
  if (!expectedState || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== expectedState) throw new Error('Authorization state did not match. Please reconnect.');
  if (url.searchParams.has('error')) throw new Error('Salesforce authorization was denied. Check app access and try again.');
  if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) throw new Error('Salesforce did not return an authorization code.');
  return url.searchParams.get('code');
}
export function validateIdentityUrl(value) {
  const url = new URL(value);
  salesforceOrigin(url.origin);
  const parts = url.pathname.split('/');
  if (url.username || url.password || url.port || url.search || url.hash || parts.length !== 4 || parts[1] !== 'id' || !idPattern.test(parts[2]) || !idPattern.test(parts[3])) {
    throw new Error('Salesforce returned an unexpected identity URL.');
  }
  return { url: url.href, orgId: parts[2], userId: parts[3] };
}
export class SalesforceAuth {
  #chrome; #fetch; #clientId; #crypto; #online; #connecting = false; #generation = 0; #writes = Promise.resolve(); #validation;
  constructor({ chromeApi, clientId, fetchImpl = fetch, cryptoImpl = crypto, isOnline = () => globalThis.navigator?.onLine !== false }) {
    this.#chrome = chromeApi; this.#clientId = clientId; this.#fetch = fetchImpl.bind(globalThis); this.#crypto = cryptoImpl;
    this.#online = isOnline;
  }
  get redirectUri() { return this.#chrome.identity.getRedirectURL('salesforce'); }
  async #connection() { return (await this.#chrome.storage.session.get(AUTH_KEY))[AUTH_KEY]; }
  async #diagnostic(value) {
    // Only internally constructed fields: never capture response bodies, request
    // payloads, provider descriptions, authorization codes, or credentials.
    await this.#chrome.storage.session.set({ [DIAGNOSTIC_KEY]: { at: Date.now(), ...value } });
  }
  #mutate(task) {
    const result = this.#writes.then(task); this.#writes = result.catch(() => {}); return result;
  }
  #save(value, generation) {
    return this.#mutate(async () => {
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      await this.#chrome.storage.session.set({ [AUTH_KEY]: value });
    });
  }
  #remove(generation) {
    return this.#mutate(async () => {
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      await this.#chrome.storage.session.remove(AUTH_KEY);
    });
  }
  async status() {
    const c = await this.#connection();
    const diagnostic = (await this.#chrome.storage.session.get(DIAGNOSTIC_KEY))[DIAGNOSTIC_KEY];
    if (!c) return { status: this.#connecting ? 'connecting' : 'disconnected', redirectUri: this.redirectUri, diagnostic };
    return { status: c.status, redirectUri: this.redirectUri, instanceUrl: c.instanceUrl,
      loginOrigin: c.loginOrigin, diagnostic, verifiedAt: c.verifiedAt, apiVersion: c.apiVersion,
      orgId: c.status === 'connected' ? c.orgId : undefined,
      userId: c.status === 'connected' ? c.userId : undefined,
      requiredOrigins: c.status === 'permission-needed' ? [...new Set([c.instanceUrl + '/*', new URL(c.identityUrl).origin + '/*'])] : [] };
  }
  async connect(value) {
    if (this.#connecting) throw new Error('Salesforce login is already open.');
    const loginOrigin = salesforceOrigin(value);
    if (!await this.#chrome.permissions.contains({ origins: [loginOrigin + '/*'] })) throw new Error('Allow access to the selected Salesforce login domain first.');
    this.#connecting = true; const generation = ++this.#generation;
    try {
      await this.#diagnostic({ stage: 'authorization', origin: loginOrigin, message: 'Salesforce login is in progress.' });
      const { verifier, challenge, state } = await createPkce(this.#crypto);
      const url = authorizationUrl({ loginOrigin, clientId: this.#clientId, redirectUri: this.redirectUri, challenge, state });
      let callback;
      try { callback = await this.#chrome.identity.launchWebAuthFlow({ url, interactive: true }); }
      catch { throw new Error('Salesforce login was canceled or could not complete. Verify the app callback and access policy.'); }
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      const code = callbackCode(callback, this.redirectUri, state);
      // Browser site access can change while the Salesforce login window is open.
      if (!await this.#chrome.permissions.contains({ origins: [loginOrigin + '/*'] })) {
        throw new OAuthConnectionError('Your browser no longer grants access to this Salesforce login domain. Select Connect Salesforce again and allow site access.', 'permission-missing', loginOrigin);
      }
      let response;
      try { response = await this.#fetch(loginOrigin + '/services/oauth2/token', { method: 'POST', redirect: 'error',
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: this.#clientId,
          redirect_uri: this.redirectUri, code, code_verifier: verifier }) }); }
      catch (error) { throw tokenTransportError(error, loginOrigin, this.#online()); }
      if (!response.ok) {
        const provider = await response.json().catch(() => null);
        const code = Object.hasOwn(tokenAdvice, provider?.error) ? provider.error : 'token-rejected';
        throw new OAuthConnectionError(tokenAdvice[code] || `Salesforce returned HTTP ${response.status} during token exchange. Check the login domain and app configuration.`, code, loginOrigin, response.status);
      }
      const token = await response.json();
      const instanceUrl = salesforceOrigin(token.instance_url), identity = validateIdentityUrl(token.id);
      if (typeof token.access_token !== 'string' || !token.access_token || /\s/.test(token.access_token) || token.access_token.length > 16000 || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Salesforce returned an unexpected access token.');
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      // Tokens stay in trusted-context session storage, never local storage or evidence.
      await this.#save({ status: 'permission-needed', loginOrigin, instanceUrl, identityUrl: identity.url,
        orgId: identity.orgId, userId: identity.userId, accessToken: token.access_token }, generation);
      const origins = [...new Set([instanceUrl + '/*', new URL(identity.url).origin + '/*'])];
      if (await this.#chrome.permissions.contains({ origins })) {
        await this.#verify(await this.#connection(), generation);
      } else {
        await this.#diagnostic({ stage: 'org-access', origin: loginOrigin, message: 'Salesforce returned an org or identity domain not covered by the initial site-access request. Allow org access to finish connecting.' });
      }
      return this.status();
    } catch (error) {
      const safeError = error instanceof TypeError || error instanceof DOMException || error instanceof SyntaxError
        ? new Error('Salesforce login failed. Check the login domain, network access, and app configuration.') : error;
      if (generation === this.#generation) await this.#diagnostic({ stage: 'failed', origin: loginOrigin,
        code: safeError.code || 'authorization-failed', httpStatus: safeError.httpStatus, message: safeError.message });
      throw safeError;
    } finally { this.#connecting = false; }
  }
  async checkServer(value) {
    const origin = salesforceOrigin(value);
    if (!await this.#chrome.permissions.contains({ origins: [origin + '/*'] })) throw new Error('Grant access to this Salesforce login domain before testing it.');
    let result;
    try {
      // Intentionally incomplete OAuth request. No client ID, secret, code, token,
      // cookie, or PKCE verifier is sent. HTTP 400/401 is an expected reachable result.
      const response = await this.#fetch(origin + '/services/oauth2/token', { method: 'POST', redirect: 'manual',
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code' });
      if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
        result = { stage: 'server-test', code: 'redirected', origin, message: 'The token endpoint redirected this test. Use your org’s My Domain login URL and test again.' };
      } else if (response.status === 400 || response.status === 401) {
        result = { stage: 'server-test', code: 'reachable', origin, httpStatus: response.status,
          message: 'The browser reached the Salesforce token endpoint. The expected rejection contains no credentials.' };
      } else {
        result = { stage: 'server-test', code: 'unexpected-http', origin, httpStatus: response.status,
          message: `The login server returned HTTP ${response.status} to the test. Check that this is your Salesforce My Domain login URL.` };
      }
    } catch (error) {
      const safe = tokenTransportError(error, origin, this.#online());
      result = { stage: 'server-test', code: safe.code, origin, message: safe.message };
    }
    await this.#diagnostic(result); return { ...(await this.status()), diagnostic: result };
  }
  async validate() {
    if (this.#validation) return this.#validation;
    const generation = this.#generation;
    this.#validation = (async () => {
      const c = await this.#connection();
      if (generation !== this.#generation || !c || this.#connecting) return this.status();
      if (c.status === 'permission-needed' && !await this.#chrome.permissions.contains({ origins: [...new Set([c.instanceUrl + '/*', new URL(c.identityUrl).origin + '/*'])] })) return this.status();
      try { await this.#verify(c, generation); } catch { /* Verification saves a safe state and diagnostic. */ }
      return this.status();
    })();
    try { return await this.#validation; } finally { this.#validation = null; }
  }
  async requireConnection(tabUrl) {
    const status = await this.validate();
    if (status.status !== 'connected') throw new Error('Connect and verify the Salesforce External Client App before recording.');
    if (pageContext(tabUrl)?.apiHost !== new URL(status.instanceUrl).hostname) {
      throw new Error('The Salesforce tab does not match the connected org. Connect the External Client App to this tab’s org before recording.');
    }
    return status;
  }
  async finish() {
    const generation = this.#generation;
    const c = await this.#connection();
    if (!c || c.status !== 'permission-needed') throw new Error('Connect Salesforce first.');
    await this.#verify(c, generation);
    return this.status();
  }
  async #verify(c, generation) {
    try {
      const origins = [...new Set([c.instanceUrl + '/*', new URL(c.identityUrl).origin + '/*'])];
      if (!await this.#chrome.permissions.contains({ origins })) {
        await this.#save({ ...c, status: 'permission-needed' }, generation);
        throw new Error('Allow access to the Salesforce org to verify the connection.');
      }
      // Cached authorization is not proof of a currently usable connection.
      await this.#save({ ...c, status: 'verification-needed' }, generation);
      const url = new URL(c.identityUrl); url.searchParams.set('format', 'json');
      const options = { redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + c.accessToken }, signal: AbortSignal.timeout(10000) };
      const identityResponse = await this.#fetch(url.href, options);
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      if (identityResponse.status === 401) {
        await this.#remove(generation); throw new Error('Salesforce authorization expired or was revoked. Reconnect the External Client App.');
      }
      if (!identityResponse.ok) throw new Error('Salesforce identity verification failed. Check app permissions or reconnect.');
      const identity = await identityResponse.json();
      if (identity.organization_id !== c.orgId || identity.user_id !== c.userId) {
        await this.#remove(generation); throw new Error('Salesforce identity did not match the authorized account. Reconnect.');
      }
      const apiVersion = '67.0';
      const api = await this.#fetch(c.instanceUrl + '/services/data/v' + apiVersion + '/', { ...options, signal: AbortSignal.timeout(10000) });
      if (api.status === 401) {
        await this.#remove(generation); throw new Error('Salesforce authorization expired or was revoked. Reconnect the External Client App.');
      }
      if (!api.ok) throw new Error('The External Client App cannot access this org’s Salesforce API. Check the api scope and user access, then recheck.');
      const resources = await api.json();
      if (!resources || typeof resources !== 'object' || Array.isArray(resources)) throw new Error('Salesforce returned an invalid API response.');
      await this.#save({ ...c, status: 'connected', verifiedAt: Date.now(), apiVersion }, generation);
      if (generation !== this.#generation) throw new Error('Connection canceled.');
      await this.#diagnostic({ stage: 'connected', origin: c.loginOrigin, message: 'External Client App connection verified against Salesforce identity and API. Apex capture will use this authorized user.' });
    } catch (error) {
      const safe = error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException
        ? new Error('Could not verify the External Client App connection. Check network access and recheck.') : error;
      if (generation === this.#generation) await this.#diagnostic({ stage: 'verification-failed', origin: c.loginOrigin, message: safe.message });
      throw safe;
    }
  }
  async toolingClient(orgId, userId) {
    const c = await this.#connection();
    if (!c || c.orgId !== orgId || c.userId !== userId) throw new Error('Reconnect the same Salesforce account to retrieve logs or clean up its trace flag.');
    if (!await this.#chrome.permissions.contains({origins:[c.instanceUrl + '/*']})) throw new Error('Salesforce org access is required for Apex capture.');
    return new ToolingClient({instanceUrl:c.instanceUrl, accessToken:c.accessToken, apiVersion:c.apiVersion || '67.0'});
  }
  async disconnect() {
    const generation = ++this.#generation;
    await this.#writes;
    const c = await this.#connection(); await this.#remove(generation);
    await this.#chrome.storage.session.remove(DIAGNOSTIC_KEY);
    let revoked = false;
    if (c?.accessToken) {
      try {
        const r = await this.#fetch(c.loginOrigin + '/services/oauth2/revoke', { method: 'POST', redirect: 'error',
          credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: c.accessToken }) });
        revoked = r.ok;
      } catch { /* Local token removal succeeds even if revocation is unavailable. */ }
    }
    return { ...(await this.status()), revoked };
  }
}
