const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const root = process.env.APP_ROOT || path.join(__dirname, '..');
const source = readFileSync(path.join(root, 'reminder-system.js'), 'utf8');
const html = readFileSync(path.join(root, 'reminder-system.html'), 'utf8');

// Execute the entire production ES module with isolated Firebase/DOM doubles.
// No network requests, real credentials, or production reminder data are used.
async function startApp({ deferCancellation = false, reminderDocs = [], allowReminderWrites = false,
  nowMs = Date.now(), storage = new Map(), storageBlocked = false, nativeSupported = true,
  notificationPermission = 'granted', permissionRequest, notificationThrows = false,
  supportedTimeZones = Intl.supportedValuesOf?.bind(Intl) } = {}) {
  const events = new Map();
  const documentEvents = new Map();
  const timers = new Map();
  const intervals = new Map();
  let timerId = 0;
  let clock = 0;
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => {
    const classes = new Set();
    return [id, {
      disabled: false, checked: false, dataset: {}, innerHTML: '', textContent: '', value: '', style: {},
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, enabled) {
          const add = enabled === undefined ? !classes.has(value) : enabled;
          if (add) classes.add(value); else classes.delete(value);
        }
      },
      children: [],
      addEventListener() {},
      appendChild(child) { this.children.push(child); child.parent = this; },
      focus() {}, scrollIntoView() {}, reset() {}
    }];
  }));
  let notificationMarkup = '';
  // A native select cannot hold a value without a matching option.
  let selectedTimeZone = '';
  Object.defineProperty(elements.get('timeZone'), 'value', {
    get() { return selectedTimeZone; },
    set(value) {
      const values = [...this.innerHTML.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
      selectedTimeZone = values.includes(value) ? value : '';
    }
  });
  Object.defineProperty(elements.get('notificationRows'), 'innerHTML', {
    get() { return notificationMarkup; },
    set(value) { notificationMarkup = value; this.children = []; }
  });
  for (const id of ['signInBtn', 'facebookSignInBtn']) {
    const label = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)</button>'));
    assert.ok(label, 'The login button exists in the production HTML: ' + id);
    elements.get(id).innerHTML = label[1];
  }
  const calls = { order: [], popups: [], cancelledPopups: [], signouts: 0, redirects: 0, navigations: [], reads: [], writes: [], notifications: [], permissionRequests: 0, nativeCloses: 0 };
  class TestNotification {
    static permission = notificationPermission;
    static async requestPermission() {
      calls.permissionRequests++;
      const permission = permissionRequest ? await permissionRequest() : 'granted';
      this.permission = permission;
      return permission;
    }
    constructor(title, options) {
      if (notificationThrows) throw new TypeError('Notification constructor not supported');
      calls.notifications.push({ title, ...options });
    }
    close() { calls.nativeCloses++; this.onclose?.(); }
  }
  const deferredCancellations = [];
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
      // Firebase's PopupOperation cancels the previous operation on replacement.
      // Deferring its rejection exercises stale completion after the new request.
      if (pendingPopup && !pendingPopup.settled) {
        const previous = pendingPopup;
        calls.cancelledPopups.push(previous.provider);
        const cancel = () => previous.reject({ code: 'auth/cancelled-popup-request' });
        if (deferCancellation) deferredCancellations.push(cancel); else cancel();
      }
      calls.popups.push(provider.providerId);
      return new Promise((resolve, reject) => {
        pendingPopup = {
          provider: provider.providerId, settled: false,
          resolve(value) { this.settled = true; resolve(value); },
          reject(error) { this.settled = true; reject(error); }
        };
      });
    },
    async signInWithRedirect() { calls.redirects++; },
    async signOut() { calls.signouts++; auth.currentUser = null; await authListener(null); },
    getFirestore: () => ({}),
    collection: (db, ...segments) => segments,
    doc: (db, ...segments) => segments,
    async getDocs(ref) {
      calls.reads.push(ref);
      const entries = typeof reminderDocs === 'function' ? await reminderDocs(ref) : reminderDocs;
      return {
        docs: entries.map(entry => {
          const value = entry.data || entry;
          return { id: entry.documentId || value.id, data: () => ({ ...value }) };
        })
      };
    },
    async getDoc() { return { exists: () => false }; },
    async setDoc(ref, value) { if (!allowReminderWrites) assert.fail('Signing in should not write a reminder'); calls.writes.push({ ref, value }); },
    async deleteDoc() { assert.fail('Signing in should not delete a reminder'); },
    serverTimestamp: () => ({}),
    getMessaging: () => ({}), isSupported: async () => false,
    getToken: async () => null, onMessage: () => () => {}
  };
  const context = vm.createContext({
    console, URL, URLSearchParams, crypto: { randomUUID },
    Intl: { DateTimeFormat: Intl.DateTimeFormat, supportedValuesOf: supportedTimeZones },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [nowMs + clock])); }
      static now() { return nowMs + clock; }
    },
    ...(nativeSupported ? { Notification: TestNotification } : {}),
    localStorage: {
      getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return storage.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); storage.set(key, value); }
    },
    document: {
      visibilityState: 'visible',
      getElementById: id => elements.get(id), querySelectorAll: () => [],
      querySelector: () => ({ appendChild() {} }),
      createElement() {
        const nodes = new Map();
        return { dataset: {}, children: [], innerHTML: '', appendChild() {},
          remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
          querySelector(selector) {
            if (!nodes.has(selector)) {
              let value = '0';
              if (selector === '.notification-preset' || selector === '.notification-unit') {
                const name = selector.slice(1);
                const select = this.innerHTML.match(new RegExp('<select class="' + name + '[^\"]*"[^>]*>([\\s\\S]*?)</select>'));
                value = select?.[1].match(/<option value="([^\"]+)" selected>/)?.[1] || '0';
              } else if (selector === '.notification-value') value = this.innerHTML.match(/class="notification-value[^\"]*"[^>]*value="([^\"]+)"/)?.[1] || '0';
              nodes.set(selector, { value, classList: { toggle() {} } });
            }
            return nodes.get(selector);
          }
        };
      },
      addEventListener(type, callback, options = {}) {
        const list = documentEvents.get(type) || [];
        if (options.capture) list.unshift(callback); else list.push(callback);
        documentEvents.set(type, list);
      }
    },
    window: {
      ...(nativeSupported ? { Notification: TestNotification } : {}),
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
    setInterval(callback, delay) { const id = ++timerId; intervals.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => callback()
  });
  // A browser module rejects duplicate declarations; new Function(source) does not.
  const module = new vm.SourceTextModule(source, { context });
  await module.link(specifier => {
    if (specifier.startsWith('./')) return new vm.SourceTextModule(readFileSync(path.join(root, specifier.split('?')[0]), 'utf8'), { context });
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
    elements, calls, storage, notification: TestNotification, taskOptions: context.TaskOptions,
    finishCancellations() { deferredCancellations.splice(0).forEach(cancel => cancel()); },
    click: id => elements.get(id).onclick(),
    async documentClick(dataset, extra = {}) {
      for (const callback of documentEvents.get('click') || []) await callback({ target: { dataset, checked: false, ...extra } });
    },
    dispatch(type, event = {}) {
      const listeners = events.get(type) || [];
      events.set(type, listeners.filter(listener => !listener.once));
      for (const listener of listeners) listener.callback(event);
    },
    async visibility(value) {
      context.document.visibilityState = value;
      for (const callback of documentEvents.get('visibilitychange') || []) await callback();
    },
    tickNotifications() { for (const timer of intervals.values()) if (timer.delay === 15000) timer.callback(); },
    async setUser(uid) {
      auth.currentUser = uid ? { uid, email: uid + '@example.invalid' } : null;
      await authListener(auth.currentUser);
    },
    keepSession(enabled) { const el = elements.get('keepReminderSession'); el.checked = enabled; el.onchange(); },
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
    submit() { return elements.get('form').onsubmit({ preventDefault() {}, target: elements.get('form') }); },
    fail(code, message = 'Provider error') { pendingPopup.reject({ code, message }); }
  };
}

function assertNoNavigationOrSignout(app) {
  assert.equal(app.calls.signouts, 0);
  assert.equal(app.calls.redirects, 0);
  assert.deepEqual(app.calls.navigations, []);
}

const pageReminderNow = Date.parse('2027-01-20T08:50:00Z');
function pageReminder(overrides = {}) {
  return { id: 'page-task', title: 'Review <agenda>', note: '', labels: [], priority: 'medium',
    date: '2027-01-20', endDate: '2027-01-20', next: '2027-01-20T09:00:00Z',
    startTime: '09:00', endTime: '10:00', timeZone: 'UTC', repeat: 'once', amount: 0,
    done: false, notifications: [10, 5], locationType: 'address', location: '123 Main St',
    scheduleVersion: 'one', ...overrides };
}

test('free mode has no Messaging imports, push registration, or notification database writes', async () => {
  assert.doesNotMatch(source, /firebase-messaging\.js|registerPushToken|getToken\(|serviceWorker\.register|notificationTokens/);
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()], notificationPermission: 'default' });
  await app.setUser('test-user');
  assert.equal(app.calls.permissionRequests, 0, 'sign-in never asks for notification permission');
  const reads = app.calls.reads.length;
  await app.click('notificationBtn');
  app.tickNotifications();
  assert.equal(app.calls.permissionRequests, 1);
  assert.equal(app.calls.writes.length, 0);
  assert.equal(app.calls.reads.length, reads, 'checking due alerts does not poll Firestore');
  assert.match(app.elements.get('notificationStatus').textContent, /Page reminders on/);
  assert.doesNotMatch(app.elements.get('notificationStatus').textContent, /Background push/);
});

test('page reminders include task, place and both times and deliver each offset only once', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()] });
  await app.setUser('test-user');
  app.tickNotifications(); assert.equal(app.calls.notifications.length, 0);
  await app.click('notificationBtn');
  app.keepSession(true);
  app.tickNotifications(); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 1);
  for (const text of ['Review <agenda>', '123 Main St', '9:00', '10:00', 'UTC']) {
    assert.ok(app.calls.notifications[0].body.includes(text));
  }
  assert.match(app.elements.get('pageAlertList').innerHTML, /Review &lt;agenda&gt;/);
  assert.doesNotMatch(app.elements.get('pageAlertList').innerHTML, /<agenda>/);
  await app.advance(5 * 60000);
  app.tickNotifications(); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 2);
  assert.notEqual(app.calls.notifications[0].tag, app.calls.notifications[1].tag);
  app.click('clearPageAlerts'); app.tickNotifications();
  assert.equal(app.elements.get('pageAlerts').classList.contains('hidden'), true);
  assert.equal(app.calls.notifications.length, 2, 'dismiss does not re-deliver the occurrence');
});

test('saved preferences and receipts survive reloads without repeating sent occurrences', async () => {
  const storage = new Map();
  const options = { nowMs: pageReminderNow, reminderDocs: [pageReminder()], storage };
  const first = await startApp(options); await first.setUser('test-user');
  await first.click('notificationBtn'); first.keepSession(true);
  const second = await startApp(options); await second.setUser('test-user'); second.tickNotifications();
  assert.equal(second.calls.notifications.length, 0);
  assert.equal(second.elements.get('notificationBtn').textContent, 'Disable page reminders');
  assert.equal(second.elements.get('keepReminderSession').checked, false, 'trusted-device opt-in never persists');
  await second.click('notificationBtn');
  first.dispatch('storage', { key: 'easy-reminder:page-notifications:test-user' });
  assert.equal(first.elements.get('notificationBtn').textContent, 'Enable page reminders');
  assert.equal(first.elements.get('keepReminderSession').checked, false);
});

for (const [label, options] of [
  ['denied permission', { notificationPermission: 'denied' }],
  ['unsupported browser', { nativeSupported: false }],
  ['mobile constructor failure', { notificationThrows: true }],
  ['permission request failure', { notificationPermission: 'default', permissionRequest: async () => { throw new Error('not supported'); } }]
]) test('in-page alerts still work with ' + label, async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()], ...options });
  await app.setUser('test-user'); await app.click('notificationBtn'); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 0);
  assert.equal(app.elements.get('pageAlerts').classList.contains('hidden'), false);
  assert.match(app.elements.get('pageAlertList').innerHTML, /123 Main St/);
  assert.match(app.elements.get('notificationStatus').textContent, /inside this page only/);
});

test('blocked storage keeps page reminders usable and deduplicated for the session', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()], storageBlocked: true });
  await app.setUser('test-user'); await app.click('notificationBtn');
  app.tickNotifications(); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 1);
  assert.match(app.elements.get('notificationStatus').textContent, /storage is unavailable/);
});

test('completed, notification-free and stale tasks do not alert; recent reminders catch up on resume', async () => {
  const docs = [pageReminder({ done: true }), pageReminder({ id: 'silent', notifications: [] }),
    pageReminder({ id: 'stale', next: '2027-01-20T08:00:00Z', startTime: '08:00', notifications: [0] }),
    pageReminder({ id: 'recent', notifications: [5] })];
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: docs });
  await app.setUser('test-user'); await app.click('notificationBtn'); app.keepSession(true);
  assert.equal(app.calls.notifications.length, 0);
  await app.advance(6 * 60000); await app.visibility('visible'); app.dispatch('focus');
  assert.equal(app.calls.notifications.length, 1);
  assert.match(app.calls.notifications[0].tag, /recent/);
});

test('free alerts keep the inactivity timeout unless the user explicitly opts in', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()] });
  await app.setUser('test-user'); await app.click('notificationBtn');
  assert.equal(app.elements.get('keepReminderSession').checked, false);
  await app.advance(90000);
  assert.equal(app.calls.signouts, 1);
  assert.equal(app.elements.get('pageAlerts').classList.contains('hidden'), true);
  assert.equal(app.elements.get('pageAlertList').innerHTML, '');
  assert.ok(app.calls.nativeCloses > 0);
});

test('trusted-tab opt-in survives inactivity, and disabling alerts restores auto sign-out', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()] });
  await app.setUser('test-user'); await app.click('notificationBtn'); app.keepSession(true);
  await app.advance(600000);
  assert.equal(app.calls.signouts, 0);
  assert.match(app.elements.get('notificationStatus').textContent, /tab will stay signed in/);
  await app.click('notificationBtn');
  assert.equal(app.elements.get('keepReminderSession').checked, false);
  await app.advance(90000);
  assert.equal(app.calls.signouts, 1);
  app.tickNotifications(); assert.equal(app.calls.notifications.length, 1);
});

test('unchecking the trusted-tab option restarts the existing inactivity timeout', async () => {
  const app = await startApp(); await app.setUser('test-user');
  await app.click('notificationBtn'); app.keepSession(true);
  await app.advance(180000); app.keepSession(false); await app.advance(90000);
  assert.equal(app.calls.signouts, 1);
});

test('sign-out and account switching cancel pending permission requests and clear private alerts', async () => {
  let resolvePermission;
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder()],
    notificationPermission: 'default', permissionRequest: () => new Promise(resolve => { resolvePermission = resolve; }) });
  await app.setUser('first-user');
  const enabling = app.click('notificationBtn');
  await app.setUser('second-user');
  resolvePermission('granted'); await enabling;
  assert.equal(app.elements.get('notificationBtn').textContent, 'Enable page reminders');
  assert.equal(app.storage.has('easy-reminder:page-notifications:second-user'), false);
  assert.equal(app.calls.notifications.length, 0);
  await app.click('notificationBtn'); app.keepSession(true);
  assert.equal(app.calls.notifications.length, 1);
  await app.setUser(null); app.tickNotifications();
  assert.equal(app.elements.get('pageAlertList').innerHTML, '');
  assert.equal(app.elements.get('keepReminderSession').checked, false);
  await app.setUser('first-user'); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 1);
});

test('a stale reminder load cannot deliver another account’s task after switching users', async () => {
  let resolveOld;
  const storage = new Map([['easy-reminder:page-notifications:new-user', 'enabled']]);
  const app = await startApp({ nowMs: pageReminderNow, storage,
    reminderDocs: ref => ref[1] === 'old-user' ? new Promise(resolve => { resolveOld = resolve; }) : [] });
  const loadingOld = app.setUser('old-user');
  await app.setUser('new-user');
  resolveOld([pageReminder({ title: 'Private old task' })]); await loadingOld;
  app.tickNotifications();
  assert.equal(app.calls.notifications.length, 0);
  assert.doesNotMatch(app.elements.get('list').innerHTML, /Private old task/);
});

test('recent in-page alerts are bounded to ten entries', async () => {
  const reminderDocs = Array.from({ length: 12 }, (_, i) => pageReminder({ id: 'task-' + i }));
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs });
  await app.setUser('test-user'); await app.click('notificationBtn');
  assert.equal((app.elements.get('pageAlertList').innerHTML.match(/<li>/g) || []).length, 10);
  assert.equal(app.calls.nativeCloses, 2);
});

test('a repeating page reminder delivers a distinct next-day occurrence', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder({ repeat: 'daily', notifications: [10] })] });
  await app.setUser('test-user'); await app.click('notificationBtn'); app.keepSession(true);
  assert.equal(app.calls.notifications.length, 1);
  await app.advance(24 * 60 * 60000); app.tickNotifications(); app.tickNotifications();
  assert.equal(app.calls.notifications.length, 2);
  assert.notEqual(app.calls.notifications[0].tag, app.calls.notifications[1].tag);
});

test('a suspended page does not replay alerts older than the recovery window', async () => {
  const app = await startApp({ nowMs: pageReminderNow, reminderDocs: [pageReminder({ notifications: [5] })] });
  await app.setUser('test-user'); await app.click('notificationBtn'); app.keepSession(true);
  await app.advance(11 * 60000); await app.visibility('visible');
  assert.equal(app.calls.notifications.length, 0);
});

test('pending native permission stays single-flight even after the page regains focus', async () => {
  let resolvePermission;
  const app = await startApp({ notificationPermission: 'default', permissionRequest: () => new Promise(resolve => { resolvePermission = resolve; }) });
  await app.setUser('test-user');
  const first = app.click('notificationBtn');
  app.dispatch('focus'); await app.click('notificationBtn');
  assert.equal(app.calls.permissionRequests, 1);
  assert.equal(app.elements.get('notificationBtn').disabled, true);
  resolvePermission('granted'); await first;
  assert.equal(app.elements.get('notificationBtn').disabled, false);
});

test('the HTML loads an ES module that starts both providers and App Check', async () => {
  assert.match(html, /<script type="module" src="reminder-system\.js(?:\?[^\"]+)?"><\/script>/);
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
    assert.equal(app.elements.get(id).disabled, true);
    assert.equal(app.elements.get(otherId).disabled, false, 'The other provider stays available');
    assert.equal(app.elements.get('loginHint').classList.contains('hidden'), false);
    await app.click(id);
    assert.equal(app.calls.popups.length, 1, 'Duplicate clicks on the current provider are ignored');
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

  test(name + ': switching immediately resets the old button and keeps the new attempt pending', async () => {
    const app = await startApp();
    const oldLabel = app.elements.get(id).innerHTML;
    const first = app.click(id);
    const second = app.click(otherId);
    const otherProvider = provider === 'google.com' ? 'facebook.com' : 'google.com';
    assert.deepEqual(app.calls.popups, [provider, otherProvider], 'Switch starts within the second click');
    assert.deepEqual(app.calls.cancelledPopups, [provider]);
    assert.equal(app.elements.get(id).disabled, false);
    assert.equal(app.elements.get(id).innerHTML, oldLabel);
    assert.equal(app.elements.get(otherId).disabled, true);
    await first;
    assert.equal(app.elements.get('authError').textContent, '', 'Replacement cancellation is not an error for the new attempt');
    assert.equal(app.elements.get(otherId).disabled, true, 'Old cleanup cannot reset the new attempt');
    app.dispatch('focus');
    await app.advance(1000);
    assert.equal(app.elements.get(otherId).disabled, true);
    await app.succeed();
    await second;
    assert.equal(app.elements.get('app').classList.contains('hidden'), false);
    assert.equal(app.elements.get('loginHint').classList.contains('hidden'), true);
    for (const key of [id, otherId]) assert.equal(app.elements.get(key).disabled, false);
    assertNoNavigationOrSignout(app);
  });

  test(name + ': rapid switching back ignores cleanup from the earlier attempt at the same provider', async () => {
    const app = await startApp();
    const first = app.click(id);
    const second = app.click(otherId);
    const third = app.click(id);
    await Promise.all([first, second]);
    assert.equal(app.calls.popups.length, 3);
    assert.equal(app.elements.get(id).disabled, true);
    assert.equal(app.elements.get(id).textContent, 'Opening ' + name + '...');
    assert.equal(app.elements.get(otherId).disabled, false);
    assert.equal(app.elements.get('authError').textContent, '');
    await app.succeed();
    await third;
    assert.equal(app.elements.get('loginHint').classList.contains('hidden'), true);
    assertNoNavigationOrSignout(app);
  });

  for (const newestSucceeds of [true, false]) {
    test(name + ': delayed cancellation cannot overwrite the new ' + (newestSucceeds ? 'success' : 'error'), async () => {
      const app = await startApp({ deferCancellation: true });
      const first = app.click(id);
      const second = app.click(otherId);
      if (newestSucceeds) await app.succeed();
      else app.fail('auth/popup-blocked');
      await second;
      const latestMessage = app.elements.get('authError').textContent;
      if (newestSucceeds) assert.equal(latestMessage, '');
      else assert.match(latestMessage, /auth\/popup-blocked/);
      app.finishCancellations();
      await first;
      assert.equal(app.elements.get('authError').textContent, latestMessage);
      assert.equal(app.elements.get('loginHint').classList.contains('hidden'), true);
      for (const key of [id, otherId]) assert.equal(app.elements.get(key).disabled, false);
      assertNoNavigationOrSignout(app);
    });
  }

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


test('one minute of inactivity shows a warning and 30 more seconds signs the user out', async () => {
  const app = await startApp();
  app.click('signInBtn');
  await app.succeed();

  await app.advance(59_999);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), true);
  assert.equal(app.calls.signouts, 0);

  await app.advance(1);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), false);
  assert.equal(app.calls.signouts, 0);

  app.dispatch('mousemove');
  await app.advance(29_999);
  assert.equal(app.calls.signouts, 0);

  await app.advance(1);
  assert.equal(app.calls.signouts, 1);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), true);
  assert.match(app.elements.get('authError').textContent, /1 minute and 30 seconds/);
});

test('Stay signed in closes the warning and starts a new one-minute idle period', async () => {
  const app = await startApp();
  app.click('signInBtn');
  await app.succeed();

  await app.advance(60_000);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), false);

  await app.click('idleStayBtn');
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), true);

  await app.advance(30_000);
  assert.equal(app.calls.signouts, 0);
  await app.advance(29_999);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), true);

  await app.advance(1);
  assert.equal(app.elements.get('idleWarning').classList.contains('hidden'), false);
  assert.equal(app.calls.signouts, 0);
});


test('Edit loads an existing task and saves changes to the same Firestore document', async () => {
  const original = {
    id: 'task-1', title: 'Original task', note: 'Old note', labels: ['work'],
    repeat: 'days', amount: 2, priority: 'high',
    next: '2026-09-20T14:30:00.000Z', done: false
  };
  const app = await startApp({ reminderDocs: [original], allowReminderWrites: true });
  app.click('signInBtn');
  await app.succeed();

  await app.documentClick({ edit: original.id });
  assert.equal(app.elements.get('formTitle').textContent, 'Edit task');
  assert.equal(app.elements.get('saveTaskBtn').textContent, 'Save changes');
  assert.equal(app.elements.get('title').value, original.title);
  assert.equal(app.elements.get('note').value, original.note);
  assert.equal(app.elements.get('repeat').value, original.repeat);
  assert.equal(app.elements.get('amount').value, original.amount);
  assert.equal(app.elements.get('priority').value, original.priority);

  app.elements.get('title').value = 'Updated task';
  app.elements.get('note').value = 'Updated note';
  app.elements.get('labels').value = 'Work, Important';
  await app.submit();

  assert.equal(app.calls.writes.length, 1);
  assert.deepEqual(app.calls.writes[0].ref, ['users', 'test-user', 'reminders', original.id]);
  assert.equal(app.calls.writes[0].value.id, original.id);
  assert.equal(app.calls.writes[0].value.title, 'Updated task');
  assert.equal(app.calls.writes[0].value.note, 'Updated note');
  assert.deepEqual(Array.from(app.calls.writes[0].value.labels), ['work', 'important']);
  assert.equal(app.calls.writes[0].value.done, false);
  assert.equal(app.elements.get('status').textContent, 'Task updated.');
  assert.match(app.elements.get('list').innerHTML, /Updated task/);
  assert.doesNotMatch(app.elements.get('list').innerHTML, /Original task/);
});

test('Cancel closes task editing without writing changes', async () => {
  const original = {
    id: 'task-2', title: 'Keep this task', note: '', labels: [],
    repeat: 'once', amount: 0, priority: 'medium',
    next: '2026-09-21T09:00:00.000Z', done: false
  };
  const app = await startApp({ reminderDocs: [original], allowReminderWrites: true });
  app.click('signInBtn');
  await app.succeed();

  await app.documentClick({ edit: original.id });
  app.elements.get('title').value = 'Do not save this';
  await app.click('cancelAdd');

  assert.equal(app.calls.writes.length, 0);
  assert.equal(app.elements.get('quickAdd').classList.contains('hidden'), true);
  assert.equal(app.elements.get('formTitle').textContent, 'Add a task');
  assert.match(app.elements.get('list').innerHTML, /Keep this task/);
});

test('Edit uses the Firestore document ID when an older stored id field is stale', async () => {
  const app = await startApp({
    reminderDocs: [{
      documentId: 'firestore-task-3',
      data: {
        id: 'stale-task-id', title: 'Migrated task', note: '', labels: [],
        repeat: 'once', amount: 0, priority: 'medium',
        next: '2026-09-22T09:00:00.000Z', done: false
      }
    }],
    allowReminderWrites: true
  });
  app.click('signInBtn');
  await app.succeed();

  await app.documentClick({ edit: 'firestore-task-3' });
  app.elements.get('title').value = 'Migrated task updated';
  await app.submit();

  assert.equal(app.calls.writes.length, 1);
  assert.deepEqual(app.calls.writes[0].ref, ['users', 'test-user', 'reminders', 'firestore-task-3']);
  assert.equal(app.calls.writes[0].value.id, 'firestore-task-3');
  assert.equal(app.calls.writes[0].value.title, 'Migrated task updated');
});

async function formApp() {
  const app = await startApp({ reminderDocs: [{ id: 'expanded', title: 'Team meeting', note: '', labels: [], repeat: 'once', amount: 0, priority: 'medium', next: '2027-01-20T14:00:00Z', startTime: '14:00', endTime: '15:00', done: false }], allowReminderWrites: true });
  app.click('signInBtn'); await app.succeed(); await app.documentClick({ edit: 'expanded' });
  return app;
}
test('time zone is a populated dropdown with friendly choices and the device default', async () => {
  assert.match(html, /<select\b[^>]*id="timeZone"[^>]*required/);
  const app = await startApp(), select = app.elements.get('timeZone');
  const values = [...select.innerHTML.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
  assert.equal(select.value, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.match(select.innerHTML, /This device — /);
  for (const label of ['Eastern Time', 'Central Time', 'Mountain Time', 'Pacific Time', 'Coordinated Universal Time']) assert.ok(select.innerHTML.includes(label));
  for (const zone of Intl.supportedValuesOf('timeZone')) assert.ok(values.includes(zone), zone);
  assert.equal(new Set(values).size, values.length);
});
for (const [name, supportedTimeZones] of [['missing', null], ['throwing', () => { throw new RangeError('Unsupported key'); }]]) {
  test(`time-zone choices remain available with a ${name} enumeration API`, async () => {
    const app = await startApp({ supportedTimeZones }), select = app.elements.get('timeZone');
    for (const zone of ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'UTC']) {
      select.value = zone;
      assert.equal(select.value, zone);
    }
    assert.ok(typeof app.elements.get('signInBtn').onclick === 'function');
  });
}
test('editing and saving retains a saved time-zone alias outside the dropdown list', async () => {
  const original = pageReminder({ timeZone: 'US/Eastern', next: '2027-01-20T14:00:00.000Z' });
  const app = await startApp({ reminderDocs: [original], allowReminderWrites: true, supportedTimeZones: () => [] });
  await app.setUser('test-user');
  await app.documentClick({ edit: original.id });
  assert.equal(app.elements.get('timeZone').value, 'US/Eastern');
  await app.submit();
  assert.equal(app.calls.writes.length, 1);
  assert.equal(app.calls.writes[0].value.timeZone, 'US/Eastern');
  assert.equal(app.calls.writes[0].value.next, original.next);
});
test('changing the dropdown updates the summary and schedules in the selected zone', async () => {
  const app = await formApp(), el = id => app.elements.get(id);
  el('startTime').value = '09:00'; el('endTime').value = '10:00';
  el('timeZone').value = 'America/Chicago'; el('timeZone').onchange();
  assert.match(el('notificationPreview').textContent, /America\/Chicago/);
  await app.submit();
  assert.equal(app.calls.writes[0].value.timeZone, 'America/Chicago');
  assert.equal(app.calls.writes[0].value.next, '2027-01-20T15:00:00.000Z');
});
test('an empty time-zone selection is rejected without silently scheduling in UTC', async () => {
  const app = await formApp();
  app.elements.get('timeZone').value = '';
  await app.submit();
  assert.equal(app.calls.writes.length, 0);
  assert.match(app.elements.get('formError').textContent, /Choose a time zone/);
});
test('expanded form saves all requested metadata and reloads it for editing', async () => {
  const app = await formApp(), el = id => app.elements.get(id);
  for (const [id, value] of Object.entries({ timeZone: 'America/New_York', date: '2027-01-20', endDate: '2027-01-20', startTime: '09:00', endTime: '10:00', location: '123 Main St', locationType: 'address', conferenceType: 'meet', conferenceUrl: 'https://meet.google.com/abc-defg-hij', driveUrl: 'https://drive.google.com/file/d/example', guests: 'person@example.com, other@example.com', category: 'custom', customCategory: 'Community', note: 'Planning notes' })) el(id).value = value;
  el('notificationRows').children[0].querySelector('.notification-preset').value = '5';
  app.click('addNotification');
  el('notificationRows').children[1].querySelector('.notification-preset').value = 'custom';
  el('notificationRows').children[1].querySelector('.notification-value').value = '2';
  el('notificationRows').children[1].querySelector('.notification-unit').value = '60';
  await app.submit();
  assert.equal(app.calls.writes.length, 1);
  const r = app.calls.writes[0].value;
  assert.equal(r.next, '2027-01-20T14:00:00.000Z');
  assert.equal(r.category, 'Community'); assert.equal(r.location, '123 Main St');
  assert.equal(r.conferenceType, 'meet'); assert.equal(r.note, 'Planning notes');
  assert.equal(r.guests.length, 2); assert.deepEqual(Array.from(r.notifications), [120, 5]);
  assert.ok(r.scheduleVersion); assert.ok(r.scheduleUpdatedAt);
  await app.documentClick({ edit: 'expanded' });
  assert.equal(el('timeZone').value, r.timeZone); assert.equal(el('customCategory').value, 'Community');
  assert.equal(el('notificationRows').children.length, 2);
  assert.deepEqual(Array.from(app.taskOptions.read().notifications), [120, 5]);
  assert.match(el('list').innerHTML, /Draft invitation email/);
});
test('all-day form disables time inputs and persists inclusive end dates', async () => {
  const app = await formApp(), el = id => app.elements.get(id);
  el('allDay').checked = true; el('allDay').onchange();
  assert.equal(el('startTime').disabled, true); assert.equal(el('endTime').required, false);
  el('endDate').value = '2027-01-22';
  await app.submit();
  assert.equal(app.calls.writes[0].value.allDay, true);
  assert.equal(app.calls.writes[0].value.endDate, '2027-01-22');
  assert.equal(app.calls.writes[0].value.startTime, '00:00');
});
test('custom-date and range forms produce working schedules', async () => {
  const app = await formApp(), el = id => app.elements.get(id);
  el('repeat').value = 'custom'; el('repeat').onchange();
  assert.equal(el('customRepeatWrap').classList.contains('hidden'), false);
  el('customDate').value = '2027-01-25'; app.click('addCustomDate');
  assert.deepEqual(Array.from(app.taskOptions.read().customDates), ['2027-01-20', '2027-01-25']);
  el('customMode').value = 'range'; el('rangeEnd').value = '2027-01-30'; el('customMode').onchange();
  assert.equal(app.taskOptions.read().rangeEnd, '2027-01-30');
  await app.submit(); assert.equal(app.calls.writes[0].value.repeat, 'custom');
});
test('removing all notifications saves an empty list rather than restoring defaults', async () => {
  const app = await formApp();
  app.elements.get('notificationRows').children[0].querySelector('.remove-notification').onclick();
  await app.submit();
  assert.equal(app.calls.writes[0].value.notifications.length, 0);
  await app.documentClick({ edit: 'expanded' });
  assert.equal(app.elements.get('notificationRows').children.length, 0);
});
test('invalid emails and malicious links show a persistent error without writing', async () => {
  const app = await formApp();
  app.elements.get('guests').value = 'not an email'; await app.submit();
  assert.equal(app.calls.writes.length, 0); assert.match(app.elements.get('formError').textContent, /email/);
  app.elements.get('guests').value = ''; app.elements.get('conferenceType').value = 'meet';
  app.elements.get('conferenceUrl').value = 'javascript:alert(1)'; await app.submit();
  assert.equal(app.calls.writes.length, 0); assert.match(app.elements.get('formError').textContent, /HTTPS/);
});
test('title-only edits preserve schedule identity and completed archive timestamps', async () => {
  const app = await formApp(); await app.submit();
  const version = app.calls.writes[0].value.scheduleVersion;
  await app.documentClick({ edit: 'expanded' }); app.elements.get('title').value = 'Renamed'; await app.submit();
  assert.equal(app.calls.writes[1].value.scheduleVersion, version);
  await app.documentClick({ done: 'expanded' }, { checked: true });
  assert.ok(app.calls.writes[2].value.completedAt);
  await app.documentClick({ edit: 'expanded' }); await app.submit();
  assert.equal(app.calls.writes[3].value.completedAt, app.calls.writes[2].value.completedAt);
});
