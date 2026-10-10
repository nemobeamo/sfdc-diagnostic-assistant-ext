export function pageContext(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['salesforce.com', 'force.com'].some(domain => url.hostname.endsWith('.' + domain))) return null;
  const hostname = url.hostname;
  if (['login', 'test', 'help', 'www', 'developer', 'trailhead'].some(prefix => hostname === prefix + '.salesforce.com')) return null;
  const visualforce = hostname.match(/^([a-z0-9-]+)--[a-z0-9-]+(\.(?:sandbox|develop|scratch))?\.vf\.force\.com$/i);
  const apiHost = visualforce ? visualforce[1] + (visualforce[2] || '') + '.my.salesforce.com'
    : hostname.endsWith('.lightning.force.com') ? hostname.replace(/\.lightning\.force\.com$/, '.my.salesforce.com')
    : isApiHost(hostname) ? hostname : null;
  return { origin: url.origin, hostname, apiHost };
}
export function isApiHost(hostname) {
  return /^[a-z0-9-]+(?:\.(?:sandbox|develop|scratch))?\.my\.salesforce\.com$/i.test(hostname) || /^[a-z]{2,}\d+\.salesforce\.com$/i.test(hostname);
}
