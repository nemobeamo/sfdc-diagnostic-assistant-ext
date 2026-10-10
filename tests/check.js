import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.permissions.includes('identity'));
assert.deepEqual(manifest.optional_host_permissions, ['https://*.salesforce.com/*', 'https://*.force.com/*']);
assert.ok(!manifest.optional_permissions?.includes('cookies'), 'Cookie access has been removed');
assert.ok(!manifest.permissions.includes('cookies'), 'Cookie access must remain optional');
assert.ok(manifest.key, 'Stable extension public key is required for the OAuth callback');
for (const path of [manifest.background.service_worker, manifest.action.default_popup, 'offscreen.html', 'review.html']) await readFile('extension/' + path);
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) await check(path);
    else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const source = await readFile(path, 'utf8');
      const imports = [...source.matchAll(/^import (?:.*? from )?['"]([^'"]+)['"]/gm)];
      for (const [, specifier] of imports) await readFile(new URL(specifier, new URL('../' + path, import.meta.url)));
    }
  }
}
await check('extension'); console.log('Manifest paths and extension JavaScript syntax passed.');
