const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { ASSETS, buildHosting } = require('../scripts/build-hosting.cjs');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
const rule = config.hosting.headers[0];
const headers = new Map(rule.headers.map(h => [h.key, h.value]));

test('hosting applies security headers to app routes, not Firebase OAuth helper routes', () => {
  const routes = new RegExp(rule.regex);
  for (const asset of ['', ...ASSETS]) assert.ok(routes.test('/' + asset));
  for (const helper of ['/__/auth/iframe', '/__/auth/handler', '/__/firebase/init.json']) assert.ok(!routes.test(helper));
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
  assert.equal(headers.get('Cache-Control'), 'no-cache');
  assert.ok(headers.get('Strict-Transport-Security').startsWith('max-age='));
  assert.ok(!headers.has('Cross-Origin-Opener-Policy'), 'Do not break popup authentication with a restrictive COOP');
});

test('hosting CSP preserves the working policy and adds response-level frame protection', () => {
  const html = fs.readFileSync(path.join(root, 'reminder-system.html'), 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(headers.get('Content-Security-Policy'), csp + "; frame-ancestors 'none'");
  assert.ok(!config.firestore, 'Hosting deployment must not implicitly publish Firestore rules');
  assert.equal(config.hosting.public, '.firebase-hosting-public');
  assert.deepEqual(config.hosting.predeploy, ['node scripts/build-hosting.cjs']);
});

test('build stages only public assets and refuses unexpected staging files', t => {
  const fixture = fs.mkdtempSync(path.join(root, '.hosting-test-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  // Synthetic assets test packaging without loading any production user data.
  for (const asset of ASSETS) fs.writeFileSync(path.join(fixture, asset), 'fixture: ' + asset);
  fs.writeFileSync(path.join(fixture, 'firestore.rules'), 'private test fixture');
  fs.writeFileSync(path.join(fixture, '.env'), 'test-secret');
  const output = buildHosting(fixture);
  assert.deepEqual(fs.readdirSync(output).sort(), [...ASSETS].sort());
  for (const asset of ASSETS) assert.equal(fs.readFileSync(path.join(output, asset), 'utf8'), 'fixture: ' + asset);
  fs.writeFileSync(path.join(output, 'unexpected.txt'), 'do not overwrite');
  assert.throws(() => buildHosting(fixture), /Unexpected staging entry/);
  assert.equal(fs.readFileSync(path.join(output, 'unexpected.txt'), 'utf8'), 'do not overwrite');
});
