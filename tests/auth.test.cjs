const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = process.env.APP_ROOT || path.join(__dirname, '..');
const source = readFileSync(path.join(root, 'reminder-system.js'), 'utf8');
const html = readFileSync(path.join(root, 'reminder-system.html'), 'utf8');

// Execute the entire production ES module with isolated Firebase/DOM doubles.
// No network requests, real credentials, or production reminder data are used.
async function startApp() {
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  let clock = 0;
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const classes = new Set();
    return [id, {
      disabled: false, innerHTML: '', textContent: '', value: '', style: {},
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, enabled) {
          const add = enabled === undefined ? !classes.has(value) : enabled;
          if (add) classes.add(value); else classes.delete(value);
        }
      },
      focus() {}, scrollIntoView() {}, reset() {}
    }];
  }));
  for (const id of ['signInBtn', 'facebookSignInBtn']) {
    const label = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</button>'));
    assert.ok(label, 'The login button exists in the production HTML: ' + id);
    elements.get(id).innerHTML = label[1];
  }
  const calls = { order: [], popups: [], signouts: 0, redirects: 0, navigations: [], reads: [] };
  let authListener;
  let pendingPopup;
  const auth = { currentUser: null };
  class GoogleAuthProvider { providerId = 'google.com'; }
  class FacebookAuthProvider { providerId = 'facebook.com'; }
  class ReCaptchaEnterpriseProvider { constructor(siteKey) { this.siteKey = siteKey; } }
  const firebase = {
    initializeApp(config) { calls.order.push('app'); return config; },
    initializeAppCheck(app, options) {
      calls.order.push('app-check'); calls.appCheck = options; return {};
    },
    ReCaptchaEnterpriseProvider,
    getAuth() { calls.order.push('auth'); return auth; },
    GoogleAuthProvider, FacebookAuthProvider,
    onAuthStateChanged(instance, callback) { assert.equal(instance, auth); authListener = callback; },
    signInWithPopup(instance, provider) {
      assert.equal(instance, auth);
      calls.popups.push(provider.providerId);
      return new Promise((resolve, reject) => { pendingPopup = { resolve, reject }; });
    },
    async signInWithRedirect() { calls.redirects++; },
    async signOut() { calls.signouts++; auth.currentUser = null; await authListener(null); },
    getFirestore: () => ({}),
    collection: (db, ...segments) => segments,
    doc: (db, ...segments) => segments,
    async getDocs(ref) { calls.reads.push(ref); return { docs: [] }; },
    async getDoc() { return { exists: () => false }; },
    async setDoc() { assert.fail('Signing in should not write a reminder'); },
    async deleteDoc() { assert.fail('Signing in should not delete a reminder'); },
    serverTimestamp: () => ({})
  };
  const context = vm.createContext({
    console,
    document: { getElementById: id => elements.get(id), querySelectorAll: () => [], addEventListener() {} },
    window: {
      addEventListener(type, callback, options = {}) {
        const listeners = events.get(type) || [];
        listeners.push({ callback, once: options.once }); events.set(type, listeners);
      },
      location: { pathname: '/reminder-system.html', replace: url => calls.navigations.push(url) },
      scrollTo() {}
    },
    // Third-party storage can be restricted. Authentication must still initialize.
    sessionStorage: {
      getItem() { throw new Error('Storage access denied'); },
      setItem() { throw new Error('Storage access denied'); },
      removeItem() { throw new Error('Storage access denied'); }
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => callback()
  });
  // A browser module rejects duplicate declarations; new Function(source) does not.
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    assert.match(specifier, /^https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-[a-z-]+\.js$/);
    const names = Object.keys(firebase);
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, firebase[name]);
    }, { context });
  });
  await module.evaluate();
  assert.equal(typeof authListener, 'function', 'Auth state listener is installed');
  await authListener(null);
  return {
    elements, calls,
    click: id => elements.get(id).onclick(),
    dispatch(type) {
      const listeners = events.get(type) || [];
      events.set(type, listeners.filter(listener => !listener.once));
      for (const listener of listeners) listener.callback();
    },
    async advance(ms) {
      const target = clock + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; clock = timer.at; timers.delete(id); await timer.callback();
      }
      clock = target;
    },
    async succeed() {
      auth.currentUser = { uid: 'test-user', email: 'test@example.invalid' };
      await authListener(auth.currentUser);
      pendingPopup.resolve({ user: auth.currentUser });
    },
    fail(code, message = 'Provider error') { pendingPopup.reject({ code, message }); }
  };
}

function assertNoNavigationOrSignout(app) {
  assert.equal(app.calls.signouts, 0);
  assert.equal(app.calls.redirects, 0);
  assert.deepEqual(app.calls.navigations, []);
}

test('the HTML loads an ES module that starts both providers and App Check', async () => {
  assert.match(html, /<script type="module" src="reminder-system\.js"><\/script>/);
  const app = await startApp();
  for (const id of ['signInBtn', 'facebookSignInBtn']) assert.equal(typeof app.elements.get(id).onclick, 'function');
  assert.deepEqual(app.calls.order, ['app', 'app-check', 'auth']);
  assert.equal(app.calls.appCheck.isTokenAutoRefreshEnabled, true);
  assert.ok(app.calls.appCheck.provider.siteKey);
  assert.equal(app.elements.get('app').classList.contains('hidden'), true);
  assert.equal(app.elements.get('loginGate').classList.contains('hidden'), false);
});

for (const [id, provider, name, otherId] of [
  ['signInBtn', 'google.com', 'Google', 'facebookSignInBtn'],
  ['facebookSignInBtn', 'facebook.com', 'Facebook', 'signInBtn']
]) {
  test(name + ': starts a popup synchronously and survives a focus change while pending', async () => {
    const app = await startApp();
    const labels = [id, otherId].map(key => app.elements.get(key).innerHTML);
    const attempt = app.click(id);
    assert.deepEqual(app.calls.popups, [provider], 'The SDK is called before yielding the click gesture');
    for (const key of [id, otherId]) assert.equal(app.elements.get(key).disabled, true);
    await app.click(otherId);
    assert.equal(app.calls.popups.length, 1, 'A second provider cannot cancel the pending popup');
    app.dispatch('focus');
    await app.advance(1000);
    assert.equal(app.elements.get('authError').textContent, '');
    assert.equal(app.elements.get(id).disabled, true);
    assertNoNavigationOrSignout(app);
    await app.succeed();
    await attempt;
    assert.equal(app.elements.get('loginGate').classList.contains('hidden'), true);
    assert.equal(app.elements.get('app').classList.contains('hidden'), false);
    assert.deepEqual(app.calls.reads, [['users', 'test-user', 'reminders']]);
    for (const [index, key] of [id, otherId].entries()) {
      assert.equal(app.elements.get(key).disabled, false);
      assert.equal(app.elements.get(key).innerHTML, labels[index]);
    }
    assertNoNavigationOrSignout(app);
  });

  for (const code of ['auth/popup-closed-by-user', 'auth/popup-blocked', 'auth/internal-error', 'auth/operation-not-supported-in-this-environment']) {
    test(name + ': ' + code + ' displays a retryable error without navigation', async () => {
      const app = await startApp();
      const labels = [id, otherId].map(key => app.elements.get(key).innerHTML);
      const attempt = app.click(id);
      app.fail(code, '<img src=x onerror=alert(1)>');
      await attempt;
      const error = app.elements.get('authError');
      assert.ok(error.textContent.startsWith(name + ' login failed [' + code + ']:'));
      assert.equal(error.innerHTML, '', 'Untrusted provider error text is not assigned as HTML');
      if (code === 'auth/popup-blocked') assert.match(error.textContent, /Allow popups/);
      for (const [index, key] of [id, otherId].entries()) {
        assert.equal(app.elements.get(key).disabled, false);
        assert.equal(app.elements.get(key).innerHTML, labels[index]);
      }
      assertNoNavigationOrSignout(app);
      const retry = app.click(id);
      assert.equal(error.textContent, '');
      assert.deepEqual(app.calls.popups, [provider, provider]);
      await app.succeed();
      await retry;
      assert.equal(app.elements.get('app').classList.contains('hidden'), false);
    });
  }
}

const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
const directives = new Map(csp.split(';').filter(part => part.trim()).map(part => {
  const [name, ...sources] = part.trim().split(/\s+/); return [name, sources];
}));

test('CSP admits the documented Firebase popup and reCAPTCHA script sources', () => {
  const scripts = directives.get('script-src');
  for (const required of ["'self'", 'https://www.gstatic.com', 'https://apis.google.com', 'https://www.google.com/recaptcha/']) {
    assert.ok(scripts.includes(required), 'Missing script source: ' + required);
  }
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:', 'https://www.google.com']) {
    assert.ok(!scripts.includes(forbidden), 'Overly broad script source: ' + forbidden);
  }
});

test('CSP admits reCAPTCHA frames and retains the other security directives', () => {
  const frames = directives.get('frame-src');
  assert.ok(frames.includes('https://recaptcha.google.com/recaptcha/'));
  assert.ok(frames.includes('https://www.google.com'));
  assert.ok(frames.includes('https://*.firebaseapp.com'));
  assert.ok(directives.get('connect-src').includes('https://www.google.com'));
  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('base-uri'), ["'none'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'self'"]);
  assert.ok(directives.has('upgrade-insecure-requests'));
});
