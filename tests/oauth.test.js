import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { connectionPermissionOrigins, createPkce, authorizationUrl, callbackCode, salesforceOrigin, validateIdentityUrl, SalesforceAuth, suggestedLoginOrigin, suggestedLoginFromTabs } from '../extension/core/oauth.js';
const redirect = 'https://test.chromiumapp.org/salesforce';
const orgId = '00D123456789012', userId = '005123456789012';
const identityUrl = `https://login.salesforce.com/id/${orgId}/${userId}`;
test('PKCE S256 matches the RFC 7636 vector and uses independent random state', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const cryptoImpl = { subtle: webcrypto.subtle, getRandomValues: target => { target.set(Buffer.from(verifier, 'base64url')); return target; } };
  const result = await createPkce(cryptoImpl); assert.equal(result.verifier, verifier);
  assert.equal(result.challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const random = await createPkce(webcrypto); assert.equal(random.verifier.length, 43); assert.notEqual(random.state, random.verifier);
});
test('authorization requests only public-client scopes and S256', () => {
  const url = new URL(authorizationUrl({ loginOrigin: 'https://test.salesforce.com', clientId: 'public-client', redirectUri: redirect, challenge: 'challenge', state: 'state' }));
  assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'api id'); assert.ok(!url.searchParams.has('client_secret'));
});
test('callback rejects mismatched state, wrong path, denial and duplicate codes', () => {
  assert.equal(callbackCode(redirect + '?state=s&code=c', redirect, 's'), 'c');
  for (const value of [redirect + '?state=x&code=c', redirect + '/wrong?state=s&code=c', redirect + '?state=s&error=access_denied', redirect + '?state=s&code=c&code=d', redirect + '?state=s&state=s&code=c']) {
    assert.throws(() => callbackCode(value, redirect, 's'));
  }
});
test('login and identity destinations reject untrusted origins and URL credentials', () => {
  for (const url of ['https://salesforce.com.evil.example', 'http://login.salesforce.com', 'https://user:pass@login.salesforce.com', 'https://login.salesforce.com:444', 'https://login.salesforce.com/path']) assert.throws(() => salesforceOrigin(url));
  assert.equal(salesforceOrigin('https://acme.my.salesforce.com/'), 'https://acme.my.salesforce.com');
  assert.equal(validateIdentityUrl(identityUrl).orgId, orgId);
  assert.throws(() => validateIdentityUrl('https://evil.example/id/' + orgId + '/' + userId));
  assert.throws(() => validateIdentityUrl(identityUrl + '?token=anything'));
});
function harness({ deny = false, badState = false, tokenFailure = false, badIdentity = false, revoked = true, fetchError = false, providerError, isOnline, losePermission = false, apiDenied = false, authError, identityDetails = {} } = {}) {
  const session = {}, calls = [], allowed = new Set(['https://login.salesforce.com/*']);
  const chromeApi = {
    identity: { getRedirectURL: () => redirect, async launchWebAuthFlow({ url }) {
      if (authError) throw authError;
      if (deny) throw new Error('raw provider detail');
      const state = new URL(url).searchParams.get('state');
      if (losePermission) allowed.clear();
      return redirect + '?code=auth-code&state=' + (badState ? 'wrong' : state);
    } },
    storage: { session: { async get(key) { return { [key]: structuredClone(session[key]) }; },
      async set(values) { Object.assign(session, structuredClone(values)); }, async remove(key) { delete session[key]; } } },
    permissions: { async contains({ origins }) { return origins.every(origin => allowed.has(origin)); } }
  };
  const fetchImpl = async function (url, options) {
    assert.equal(this, globalThis, 'fetch must retain the browser global receiver');
    calls.push({ url, options });
    if (fetchError) throw fetchError === true ? new Error('raw token private-token') : fetchError;
    if (url.endsWith('/token')) return tokenFailure || providerError ? Response.json({ error: providerError, error_description: 'private error payload' }, { status: 400 })
      : Response.json({ access_token: 'private-token', instance_url: 'https://acme.my.salesforce.com', id: identityUrl, token_type: 'Bearer' });
    if (url.endsWith('/services/data/v67.0/')) return apiDenied ? new Response('private details', {status:403}) : Response.json({sobjects:'/services/data/v67.0/sobjects'});
    if (url.endsWith('/revoke')) return new Response(null, { status: revoked ? 200 : 503 });
    return Response.json({ ...identityDetails, organization_id: badIdentity ? '00D999999999999' : orgId, user_id: userId });
  };
  return { auth: new SalesforceAuth({ chromeApi, clientId: 'public-client', fetchImpl, cryptoImpl: webcrypto, isOnline }), session, calls, allowed };
}
test('connect exchanges a code without a secret, then requires exact org host permission', async () => {
  const h = harness(); const status = await h.auth.connect('https://login.salesforce.com');
  assert.equal(status.status, 'permission-needed'); assert.ok(!JSON.stringify(status).includes('private-token'));
  const body = h.calls[0].options.body; assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier').length, 43); assert.equal(body.get('client_secret'), null); assert.equal(h.calls[0].options.redirect, 'error');
  await assert.rejects(h.auth.finish(), /Allow access/); assert.equal(h.calls.length, 1);
  h.allowed.add('https://acme.my.salesforce.com/*');
  const connected = await h.auth.finish(); assert.equal(connected.status, 'connected'); assert.equal(connected.orgId, orgId);
  assert.ok(!JSON.stringify(connected).includes('private-token'));
  assert.equal(h.calls[1].options.headers.Authorization, 'Bearer private-token');
});
test('cancellation, state mismatch and token errors do not store credentials or expose provider details', async () => {
  for (const options of [{ deny: true }, { badState: true }, { tokenFailure: true }, { fetchError: true }]) {
    const h = harness(options);
    await assert.rejects(h.auth.connect('https://login.salesforce.com'), error => !error.message.includes('private') && !error.message.includes('raw provider'));
    assert.equal(h.session.salesforceConnection, undefined); assert.equal((await h.auth.status()).status, 'disconnected');
    assert.ok(!JSON.stringify(h.session).includes('private-token'));
    assert.ok(!JSON.stringify(h.session).includes('auth-code'));
  }
});
test('identity mismatch cannot become connected', async () => {
  const h = harness({ badIdentity: true }); await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*');
  await assert.rejects(h.auth.finish(), /did not match/); assert.equal((await h.auth.status()).status, 'disconnected');
});
test('disconnect clears local tokens even if server revocation fails', async () => {
  for (const revoked of [true, false]) {
    const h = harness({ revoked }); await h.auth.connect('https://login.salesforce.com');
    const result = await h.auth.disconnect(); assert.equal(result.revoked, revoked); assert.equal(result.status, 'disconnected');
    assert.equal(Object.keys(h.session).length, 0);
  }
});
test('disconnect during identity verification cannot restore the connection', async () => {
  const session = {}; let releaseIdentity, identityStarted;
  const started = new Promise(resolve => { identityStarted = resolve; });
  const identityResult = new Promise(resolve => { releaseIdentity = resolve; });
  const chromeApi = {
    identity: { getRedirectURL: () => redirect, async launchWebAuthFlow({ url }) { return redirect + '?code=c&state=' + new URL(url).searchParams.get('state'); } },
    storage: { session: { async get(key) { return { [key]: structuredClone(session[key]) }; }, async set(values) { Object.assign(session, structuredClone(values)); }, async remove(key) { delete session[key]; } } },
    permissions: { async contains() { return true; } }
  };
  const auth = new SalesforceAuth({ chromeApi, clientId: 'client', cryptoImpl: webcrypto, fetchImpl: async url => {
    if (url.endsWith('/token')) return Response.json({ access_token: 'private-token', instance_url: 'https://acme.my.salesforce.com', id: identityUrl, token_type: 'Bearer' });
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
    identityStarted(); return identityResult;
  } });
  const finishing = auth.connect('https://login.salesforce.com'); await started;
  await auth.disconnect(); releaseIdentity(Response.json({ organization_id: orgId, user_id: userId }));
  await assert.rejects(finishing, /canceled/); assert.equal((await auth.status()).status, 'disconnected');
  assert.equal(Object.keys(session).length, 0);
});
test('active Lightning tab suggests a canonical My Domain OAuth endpoint', () => {
  assert.equal(suggestedLoginOrigin('https://acme.lightning.force.com/lightning/page/home'), 'https://acme.my.salesforce.com');
  assert.equal(suggestedLoginOrigin('https://acme--dev.sandbox.lightning.force.com'), 'https://acme--dev.sandbox.my.salesforce.com');
  assert.equal(suggestedLoginOrigin('https://acme-dev-ed.develop.my.salesforce.com'), 'https://acme-dev-ed.develop.my.salesforce.com');
  assert.equal(suggestedLoginOrigin('https://example.com'), null);
});
test('token transport failures distinguish timeout, offline and unknown network/redirect failures', async () => {
  for (const [options, expected] of [
    [{ fetchError: new DOMException('sensitive timeout body', 'TimeoutError') }, 'timeout'],
    [{ fetchError: true, isOnline: () => false }, 'offline'],
    [{ fetchError: true }, 'network-or-redirect']
  ]) {
    const h = harness(options); await assert.rejects(h.auth.connect('https://login.salesforce.com'), error => error.code === expected);
    const status = await h.auth.status(); assert.equal(status.diagnostic.code, expected);
    assert.ok(!JSON.stringify(status).includes('sensitive') && !JSON.stringify(status).includes('private-token'));
  }
});
test('host permission is rechecked after the login window before sending the code', async () => {
  const h = harness({ losePermission: true });
  await assert.rejects(h.auth.connect('https://login.salesforce.com'), error => error.code === 'permission-missing');
  assert.equal(h.calls.length, 0);
});
test('known Salesforce token rejection codes produce targeted advice without raw descriptions', async () => {
  for (const code of ['invalid_client_id', 'invalid_client', 'invalid_grant', 'invalid_scope']) {
    const h = harness({ providerError: code });
    await assert.rejects(h.auth.connect('https://login.salesforce.com'), error => error.code === code && !error.message.includes('private error'));
    assert.equal((await h.auth.status()).diagnostic.httpStatus, 400);
  }
});
test('login server test sends no credentials and identifies reachable or redirected endpoints', async () => {
  for (const [response, expected] of [[new Response('', { status: 400 }), 'reachable'], [{ type: 'opaqueredirect', status: 0 }, 'redirected'], [new Response('', { status: 503 }), 'unexpected-http']]) {
    let request;
    const session = {};
    const auth = new SalesforceAuth({ clientId: 'public-client', cryptoImpl: webcrypto,
      chromeApi: { permissions: { async contains() { return true; } }, identity: { getRedirectURL: () => redirect },
        storage: { session: { async get(key) { return { [key]: session[key] }; }, async set(values) { Object.assign(session, values); } } } },
      fetchImpl: async (url, options) => { request = { url, ...options }; return response; } });
    const result = await auth.checkServer('https://acme.my.salesforce.com'); assert.equal(result.diagnostic.code, expected);
    assert.equal(request.redirect, 'manual'); assert.equal(request.credentials, 'omit'); assert.equal(request.body, 'grant_type=authorization_code');
    assert.equal(request.headers.Authorization, undefined); assert.equal(session.salesforceConnection, undefined);
  }
});

test('live app validation detects revoked tokens and transient failures without claiming connected', async () => {
  for (const failure of ['revoked', 'offline', 'forbidden']) {
    const h = harness(); await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*');
    await h.auth.finish();
    // The injected transport reads this flag through a mutable fixture option.
    h.session.salesforceConnection.accessToken = failure;
    const auth = new SalesforceAuth({clientId:'public-client', cryptoImpl:webcrypto, chromeApi: {
      identity:{getRedirectURL:()=>redirect}, permissions:{async contains(){return true;}},
      storage:{session:{async get(key){return {[key]:h.session[key]};}, async set(v){Object.assign(h.session,v);}, async remove(key){delete h.session[key];}}}
    }, fetchImpl: async () => {
      if(failure === 'offline') throw new TypeError('private details');
      return new Response('private details', {status:failure === 'revoked' ? 401 : 403});
    }});
    const status = await auth.validate();
    assert.equal(status.status, failure === 'revoked' ? 'disconnected' : 'verification-needed');
    assert.ok(!JSON.stringify(status).includes('private details'));
    assert.equal(h.session.salesforceConnection === undefined, failure === 'revoked');
  }
});
test('capture requires a live app connection matching the Salesforce tab and saves verified metadata', async () => {
  const h = harness(); await assert.rejects(h.auth.requireConnection('https://acme.lightning.force.com'), /Connect and verify/);
  await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*'); await h.auth.finish();
  const status = await h.auth.requireConnection('https://acme.lightning.force.com/lightning/page/home');
  assert.equal(status.status, 'connected'); assert.equal(status.apiVersion,'67.0'); assert.ok(status.verifiedAt);
  assert.ok(h.calls.some(c=>c.url.endsWith('/services/data/v67.0/') && c.options.headers.Authorization === 'Bearer private-token'));
  assert.ok(!JSON.stringify(status).includes('private-token'));
  await assert.rejects(h.auth.requireConnection('https://other.lightning.force.com'), /does not match/);
});

test('permission loss invalidates usable connection status', async () => {
  const h = harness(); await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*'); await h.auth.finish();
  h.allowed.delete('https://acme.my.salesforce.com/*');
  assert.equal((await h.auth.validate()).status, 'permission-needed');
  await assert.rejects(h.auth.requireConnection('https://acme.lightning.force.com'), /Connect and verify/);
});

test('valid identity with denied Salesforce API access cannot become connected', async () => {
  const h = harness({apiDenied:true}); await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*');
  await assert.rejects(h.auth.finish(), /cannot access this org/);
  const status = await h.auth.validate(); assert.equal(status.status, 'verification-needed');
  assert.ok(!JSON.stringify(status).includes('private details'));
});

test('login auto-population recognizes My Domain, developer, sandbox and Visualforce URLs', () => {
  for (const [url, expected] of [
    ['https://acme.lightning.force.com/lightning/r/Account/123/view', 'https://acme.my.salesforce.com'],
    ['https://acme--qa.sandbox.lightning.force.com', 'https://acme--qa.sandbox.my.salesforce.com'],
    ['https://acme-dev-ed.develop.lightning.force.com', 'https://acme-dev-ed.develop.my.salesforce.com'],
    ['https://acme--c.vf.force.com/apex/Test', 'https://acme.my.salesforce.com'],
    ['https://acme--qa--package.sandbox.vf.force.com/apex/Test', 'https://acme--qa.sandbox.my.salesforce.com'],
    ['https://acme.my.salesforce.com/lightning/page/home', 'https://acme.my.salesforce.com']
  ]) assert.equal(suggestedLoginOrigin(url), expected);
  for (const url of ['https://login.salesforce.com', 'https://na123.salesforce.com', 'https://acme.lightning.force.com.evil.example', 'http://acme.lightning.force.com', 'https://user:pass@acme.my.salesforce.com']) assert.equal(suggestedLoginOrigin(url), null);
});
test('auto-population prioritizes the current Salesforce tab then the most recently used visible org', () => {
  const tabs = [{url:'https://old.lightning.force.com', lastAccessed:1}, {url:'https://recent.my.salesforce.com', lastAccessed:2}, {lastAccessed:3}];
  assert.equal(suggestedLoginFromTabs({url:'https://active.lightning.force.com'}, tabs), 'https://active.my.salesforce.com');
  assert.equal(suggestedLoginFromTabs({url:'https://example.com'}, tabs), 'https://recent.my.salesforce.com');
  assert.equal(suggestedLoginFromTabs({url:'https://example.com'}, [{id:1}]), null);
});

test('Tooling transport is only available to the authorized account and keeps its token private', async () => {
  const h = harness(); await h.auth.connect('https://login.salesforce.com'); h.allowed.add('https://acme.my.salesforce.com/*'); await h.auth.finish();
  const client = await h.auth.toolingClient(orgId,userId);
  assert.ok(client.base.includes('/tooling')); assert.ok(!JSON.stringify(client).includes('private-token'));
  await assert.rejects(h.auth.toolingClient('00D999999999999',userId), /same Salesforce account/);
  await assert.rejects(h.auth.toolingClient(orgId,'005999999999999'), /same Salesforce account/);
});

test('Connect requests exact known login, org and identity hosts without Salesforce-wide grants',()=>{
  assert.deepEqual(connectionPermissionOrigins('https://login.salesforce.com','https://acme.lightning.force.com/lightning/page/home'),['https://login.salesforce.com/*','https://acme.my.salesforce.com/*']);
  assert.deepEqual(connectionPermissionOrigins('https://acme--qa.sandbox.my.salesforce.com','https://other.lightning.force.com'),['https://acme--qa.sandbox.my.salesforce.com/*','https://test.salesforce.com/*']);
  assert.deepEqual(connectionPermissionOrigins('https://acme.my.salesforce.com','https://other.lightning.force.com'),['https://acme.my.salesforce.com/*','https://login.salesforce.com/*']);
  assert.throws(()=>connectionPermissionOrigins('https://evil.example'));
});
test('pregranted org access completes identity and API verification inside Connect',async()=>{
  const h=harness(); h.allowed.add('https://acme.my.salesforce.com/*');
  const connected=await h.auth.connect('https://login.salesforce.com');
  assert.equal(connected.status,'connected'); assert.equal(connected.orgId,orgId);
  assert.equal(h.calls.length,3); assert.ok(!JSON.stringify(connected).includes('private-token'));
});
test('pending connection automatically verifies after org permission becomes available',async()=>{
  const h=harness(); await h.auth.connect('https://login.salesforce.com');
  assert.equal((await h.auth.validate()).status,'permission-needed');
  h.allowed.add('https://acme.my.salesforce.com/*');
  assert.equal((await h.auth.validate()).status,'connected');
});
test('automatic verification cannot claim connected with invalid identity or denied API access',async()=>{
  for(const options of [{badIdentity:true},{apiDenied:true}]){
    const h=harness(options); h.allowed.add('https://acme.my.salesforce.com/*');
    await assert.rejects(h.auth.connect('https://login.salesforce.com'));
    assert.notEqual((await h.auth.status()).status,'connected');
  }
});

test('authorization failures retain safe browser categories without exposing provider details',async()=>{
  for(const [message,code] of [
    ['Authorization page could not be loaded. private-token','authorization-page-load-failed'],
    ['The user did not approve access.','authorization-canceled'],
    ['Did not redirect to the right URL.','authorization-redirect-failed'],
    ['Identity API is disabled in incognito windows.','authorization-private-window'],
    ['raw provider details private-token','authorization-failed']
  ]){
    const h=harness({authError:new Error(message)});
    await assert.rejects(h.auth.connect('https://login.salesforce.com'),error=>error.code===code && !error.message.includes('private-token'));
    assert.equal((await h.auth.status()).diagnostic.code,code);
    assert.equal(h.calls.length,0);
  }
});

test('verification retains only bounded user details from the existing identity response',async()=>{
  const h=harness({identityDetails:{display_name:'Test User',username:'test@example.com',email:'test@example.com',nick_name:'tester',timezone:'America/New_York',locale:'en_US',email_verified:false,photos:{picture:'private-url'},access_token:'provider-secret',addr_street:'private address'}});
  await h.auth.connect('https://login.salesforce.com');
  h.allowed.add('https://acme.my.salesforce.com/*');
  const status=await h.auth.finish();
  assert.deepEqual(status.userDetails,{display_name:'Test User',username:'test@example.com',email:'test@example.com',nick_name:'tester',timezone:'America/New_York',locale:'en_US',email_verified:false});
  assert.equal(h.calls.length,3,'profile details add no requests');
  assert.ok(!JSON.stringify(h.session).includes('private address'));
  assert.ok(!JSON.stringify(status).includes('provider-secret'));
  await h.auth.disconnect();
  assert.equal((await h.auth.status()).userDetails,undefined);
});
