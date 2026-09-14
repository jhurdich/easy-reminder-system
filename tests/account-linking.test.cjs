const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'account-linking.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'reminder-system.html'), 'utf8');
const makeUser = (uid, providers) => ({ uid, providerData: providers.map(providerId => ({ providerId })) });

async function start(user) {
  const elements = new Map(['verifyAccountBtn', 'linkGoogleBtn', 'linkFacebookBtn', 'linkedProviders', 'linkAccountStatus'].map(id => {
    assert.ok(html.includes('id="' + id + '"'));
    return [id, { disabled: false, textContent: '' }];
  }));
  const auth = { currentUser: user }, calls = [], timers = new Map();
  let listener, pending, now = 1000, timerId = 0;
  const defer = (kind, captured, provider) => {
    calls.push({ kind, uid: captured.uid, provider: provider.providerId });
    return new Promise((resolve, reject) => { pending = { resolve, reject, kind, captured, provider }; });
  };
  const api = {
    GoogleAuthProvider: class { providerId = 'google.com'; },
    FacebookAuthProvider: class { providerId = 'facebook.com'; },
    onAuthStateChanged(instance, cb) { assert.equal(instance, auth); listener = cb; },
    reauthenticateWithPopup: (u, p) => defer('verify', u, p),
    linkWithPopup: (u, p) => defer('link', u, p)
  };
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id) },
    Date: { now: () => now },
    setTimeout(cb, delay) { const id = ++timerId; timers.set(id, { cb, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    assert.equal(specifier, 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js');
    return new vm.SyntheticModule(Object.keys(api), function () {
      for (const [key, value] of Object.entries(api)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  module.namespace.setupAccountLinking(auth);
  listener(user);
  return {
    elements, calls, auth,
    click: id => elements.get(id).onclick(),
    changeUser(next) { auth.currentUser = next; listener(next); },
    resolve(uid = pending.captured.uid) {
      const result = makeUser(uid, pending.captured.providerData.map(p => p.providerId));
      if (pending.kind === 'link') result.providerData.push({ providerId: pending.provider.providerId });
      if (uid === auth.currentUser?.uid) auth.currentUser = result;
      pending.resolve({ user: result });
    },
    reject(code) { pending.reject({ code }); },
    expire() {
      now += 60001;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.cb(); }
    }
  };
}

test('signed-out users cannot verify or link', async () => {
  const app = await start(null);
  await app.click('verifyAccountBtn'); await app.click('linkGoogleBtn');
  assert.deepEqual(app.calls, []);
  for (const id of ['verifyAccountBtn', 'linkGoogleBtn', 'linkFacebookBtn']) assert.equal(app.elements.get(id).disabled, true);
});

for (const [original, target, button] of [
  ['google.com', 'facebook.com', 'linkFacebookBtn'],
  ['facebook.com', 'google.com', 'linkGoogleBtn']
]) {
  test(original + ': verification then explicit linking preserves the UID', async () => {
    const app = await start(makeUser('original-uid', [original]));
    await app.click(button);
    assert.deepEqual(app.calls, [], 'Linking cannot start without verification');
    const verification = app.click('verifyAccountBtn');
    assert.deepEqual(app.calls, [{ kind: 'verify', uid: 'original-uid', provider: original }]);
    assert.equal(app.elements.get(button).disabled, true);
    app.resolve(); await verification;
    assert.equal(app.elements.get(button).disabled, false);
    const linking = app.click(button);
    assert.deepEqual(app.calls[1], { kind: 'link', uid: 'original-uid', provider: target });
    await app.click(button);
    assert.equal(app.calls.length, 2, 'Repeated clicks cannot start concurrent linking');
    app.resolve(); await linking;
    assert.equal(app.auth.currentUser.uid, 'original-uid');
    assert.match(app.elements.get('linkedProviders').textContent, /Google and Facebook/);
    assert.match(app.elements.get('linkAccountStatus').textContent, /No tasks were moved or deleted/);
    for (const id of ['verifyAccountBtn', 'linkGoogleBtn', 'linkFacebookBtn']) assert.equal(app.elements.get(id).disabled, true);
  });

  test(original + ': verification expires before a linking attempt', async () => {
    const app = await start(makeUser('original-uid', [original]));
    const verification = app.click('verifyAccountBtn'); app.resolve(); await verification;
    app.expire(); await app.click(button);
    assert.equal(app.calls.length, 1);
    assert.equal(app.elements.get(button).disabled, true);
    assert.equal(app.elements.get('verifyAccountBtn').disabled, false);
  });

  for (const code of ['auth/credential-already-in-use', 'auth/email-already-in-use', 'auth/popup-closed-by-user', 'auth/popup-blocked']) {
    test(original + ': ' + code + ' does not migrate, delete, or retry automatically', async () => {
      const app = await start(makeUser('original-uid', [original]));
      const verification = app.click('verifyAccountBtn'); app.resolve(); await verification;
      const linking = app.click(button); app.reject(code); await linking;
      assert.equal(app.auth.currentUser.uid, 'original-uid');
      assert.ok(app.elements.get('linkAccountStatus').textContent.includes(code));
      if (code.includes('in-use')) assert.match(app.elements.get('linkAccountStatus').textContent, /Nothing was merged or deleted/);
      assert.equal(app.elements.get('verifyAccountBtn').disabled, false);
      assert.equal(app.elements.get(button).disabled, true, 'A fresh verification is required for retry');
      assert.deepEqual(app.calls.map(c => c.kind), ['verify', 'link']);
    });
  }
}

test('verifying a different UID is rejected', async () => {
  const app = await start(makeUser('original-uid', ['google.com']));
  const pending = app.click('verifyAccountBtn'); app.resolve('different-uid'); await pending;
  assert.match(app.elements.get('linkAccountStatus').textContent, /auth\/user-mismatch/);
  await app.click('linkFacebookBtn'); assert.equal(app.calls.length, 1);
});

test('a cancelled verification never enables linking', async () => {
  const app = await start(makeUser('original-uid', ['google.com']));
  const pending = app.click('verifyAccountBtn'); app.reject('auth/popup-closed-by-user'); await pending;
  assert.equal(app.elements.get('linkFacebookBtn').disabled, true);
  assert.equal(app.elements.get('verifyAccountBtn').disabled, false);
});

for (const phase of ['verify', 'link']) {
  test('sign-out invalidates a late ' + phase + ' result', async () => {
    const app = await start(makeUser('original-uid', ['google.com']));
    let pending = app.click('verifyAccountBtn');
    if (phase === 'link') { app.resolve(); await pending; pending = app.click('linkFacebookBtn'); }
    app.changeUser(null); app.resolve(); await pending;
    assert.equal(app.auth.currentUser, null);
    assert.equal(app.elements.get('linkAccountStatus').textContent, '');
    for (const id of ['verifyAccountBtn', 'linkGoogleBtn', 'linkFacebookBtn']) assert.equal(app.elements.get(id).disabled, true);
  });
}

test('changing accounts revokes verification and ignores stale results', async () => {
  const app = await start(makeUser('old-uid', ['google.com']));
  const pending = app.click('verifyAccountBtn');
  app.changeUser(makeUser('new-uid', ['facebook.com']));
  app.resolve(); await pending; await app.click('linkGoogleBtn');
  assert.equal(app.calls.length, 1);
  assert.equal(app.auth.currentUser.uid, 'new-uid');
  assert.equal(app.elements.get('linkGoogleBtn').disabled, true);
});
