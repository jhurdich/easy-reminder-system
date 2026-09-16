const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../functions-correct/task-core.js');
const source = readFileSync(path.join(__dirname, '../functions-correct/index.js'), 'utf8');

test('free-plan deployment contains only Firestore rules and cannot deploy functions', () => {
  const config = JSON.parse(readFileSync(path.join(__dirname, '../firebase-deploy.json'), 'utf8'));
  assert.deepEqual(config, { firestore: { rules: 'firestore.rules' } });
});

test('backend targets the reviewed Admin 14 and compatible Functions 7 releases', () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '../functions-correct/package.json'), 'utf8'));
  assert.equal(pkg.dependencies['firebase-admin'], '14.4.0');
  assert.equal(pkg.dependencies['firebase-functions'], '7.4.0');
  assert.equal(pkg.scripts.check, 'node check-sdk.cjs');
});

function scheduler({ enabled = true, tokens = ['token-a', 'token-b'], responder, done = false } = {}) {
  let now = Date.parse('2027-01-20T08:50:00Z');
  let initialized = false;
  const imports = [];
  const sent = [], errors = [];
  const store = new Map();
  const reminderPath = 'users/owner/reminders/task';
  store.set(reminderPath, { id: 'task', title: 'Review', date: '2027-01-20', endDate: '2027-01-20', next: '2027-01-20T09:00:00Z', startTime: '09:00', endTime: '10:00', timeZone: 'UTC', repeat: 'once', amount: 0, done, notifications: [10, 5], location: '123 Main St', scheduleVersion: 'one' });
  store.set('users/owner/settings/notifications', { enabled });
  tokens.forEach((token, i) => store.set('users/owner/notificationTokens/t' + i, { token }));
  function ref(p) {
    return { path: p, id: p.split('/').at(-1), get parent() { return ref(p.split('/').slice(0, -1).join('/')); }, collection: name => ref(p + '/' + name), doc: name => ref(p + '/' + name),
      async delete() { store.delete(p); },
      async get() {
        if (p.endsWith('notificationTokens')) return { docs: [...store.keys()].filter(k => k.startsWith(p + '/')).map(snapshot) };
        return snapshot(p);
      }
    };
  }
  function snapshot(p) { return { id: p.split('/').at(-1), ref: ref(p), exists: store.has(p), data: () => structuredClone(store.get(p)) }; }
  const db = {
    collectionGroup: () => ({ where: () => ({ get: async () => ({ docs: [snapshot(reminderPath)] }) }) }),
    runTransaction: async fn => fn({ get: async r => snapshot(r.path), set: (r, value) => store.set(r.path, structuredClone(value)), update: (r, value) => store.set(r.path, { ...store.get(r.path), ...structuredClone(value) }) })
  };
  const exports = {};
  vm.runInNewContext(source, {
    exports, Date: class extends Date { static now() { return now; } },
    require(name) {
      imports.push(name);
      if (name === './task-core.js') return core;
      if (name === 'node:crypto') return crypto;
      if (name === 'firebase-functions/v2/scheduler') return { onSchedule: (cadence, fn) => fn };
      if (name === 'firebase-functions/logger') return { error: (...e) => errors.push(e) };
      if (name === 'firebase-admin/app') return { initializeApp() { assert.equal(initialized, false); initialized = true; } };
      if (name === 'firebase-admin/firestore') return { getFirestore() { assert.ok(initialized); return db; } };
      if (name === 'firebase-admin/messaging') return { getMessaging() { assert.ok(initialized); return { async sendEachForMulticast(payload) {
        sent.push(payload);
        return { responses: payload.tokens.map(token => responder ? responder(token, sent.length) : { success: true }) };
      } }; } };
      throw new Error('Unexpected dependency ' + name);
    }
  });
  return { run: exports.sendDueReminderNotifications, sent, store, errors, imports, initialized, reminderPath, setNow: value => { now = Date.parse(value); } };
}
test('backend initializes modular Admin services without the removed namespace API', () => {
  const s = scheduler();
  assert.equal(s.initialized, true);
  for (const name of ['firebase-admin/app', 'firebase-admin/firestore', 'firebase-admin/messaging', 'firebase-functions/logger']) {
    assert.ok(s.imports.includes(name));
  }
  assert.equal(s.imports.includes('firebase-admin'), false);
  assert.equal(s.sent.length, 0);
});

test('installed SDK check verifies the export without invoking the scheduled job', () => {
  let calls = 0;
  function job() { calls++; }
  job.run = () => { calls++; };
  job.__endpoint = { platform: 'gcfv2', scheduleTrigger: { schedule: 'every 1 minutes' } };
  const logs = [];
  vm.runInNewContext(readFileSync(path.join(__dirname, '../functions-correct/check-sdk.cjs'), 'utf8'), {
    require(name) {
      if (name === 'node:assert/strict') return assert;
      if (name === './index.js') return { sendDueReminderNotifications: job };
      throw new Error('Unexpected dependency ' + name);
    },
    console: { log: message => logs.push(message) }
  });
  assert.equal(calls, 0);
  assert.equal(logs.length, 1);
});
test('push sends task, location and both times once for each configured offset', async () => {
  const s = scheduler(); await s.run(); await s.run();
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0].notification, undefined);
  for (const text of ['Review', '123 Main St', '9:00', '10:00', 'UTC']) assert.ok(s.sent[0].data.body.includes(text));
  assert.equal(s.sent[0].data.userId, 'owner');
  s.setNow('2027-01-20T08:56:00Z'); await s.run();
  assert.equal(s.sent.length, 2); assert.notEqual(s.sent[0].data.deliveryId, s.sent[1].data.deliveryId);
  assert.deepEqual(s.errors, []);
});
test('transient failures retry only recipients that did not succeed', async () => {
  const s = scheduler({ responder: (token, attempt) => token === 'token-b' && attempt === 1 ? { success: false, error: { code: 'messaging/internal-error' } } : { success: true } });
  await s.run(); await s.run(); await s.run();
  assert.equal(s.sent.length, 2);
  assert.deepEqual(Array.from(s.sent[1].tokens), ['token-b']);
});
test('expired tokens are removed using the actual document references', async () => {
  const s = scheduler({ responder: () => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } }) });
  await s.run(); await s.run();
  assert.equal(s.sent.length, 1);
  assert.equal(s.store.has('users/owner/notificationTokens/t0'), false);
});
test('disabled accounts, completed tasks, and tokenless accounts do not send', async () => {
  for (const options of [{ enabled: false }, { done: true }, { tokens: [] }]) {
    const s = scheduler(options); await s.run(); assert.equal(s.sent.length, 0);
  }
});
test('overlapping scheduler runs respect delivery leases', async () => {
  const s = scheduler();
  s.store.set(s.reminderPath + '/notificationState/delivery', { leaseId: 'another-job', leaseUntil: Date.parse('2027-01-20T08:52:00Z') });
  await s.run(); assert.equal(s.sent.length, 0);
  assert.equal(s.store.get(s.reminderPath + '/notificationState/delivery').leaseId, 'another-job');
});
test('FCM sends batches of at most 500 devices', async () => {
  const s = scheduler({ tokens: Array.from({ length: 501 }, (_, i) => 'token-' + i) });
  await s.run();
  assert.deepEqual(s.sent.map(p => p.tokens.length), [500, 1]);
});
test('service worker displays one data-only notification and resolves click URL safely', async () => {
  const shown = [], listeners = {}, opened = [];
  let background;
  vm.runInNewContext(readFileSync(path.join(__dirname, '../reminder-worker.js'), 'utf8'), {
    URL, importScripts() {},
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: fn => { background = fn; } }) },
    self: { location: { href: 'https://example.test/easy-reminder-system/reminder-worker.js' }, addEventListener: (type, fn) => { listeners[type] = fn; }, registration: { showNotification: (title, options) => shown.push({ title, options }) } },
    clients: { matchAll: async () => [], openWindow: url => opened.push(url) }
  });
  await background({ data: { title: 'Review', body: 'Summary', deliveryId: 'unique' } });
  await background({ notification: { title: 'Already displayed by FCM' } });
  assert.equal(shown.length, 1); assert.equal(shown[0].options.body, 'Summary');
  let completion;
  listeners.notificationclick({ notification: { close() {}, data: { url: 'https://untrusted.invalid' } }, waitUntil: p => { completion = p; } });
  await completion; assert.equal(opened[0], 'https://example.test/easy-reminder-system/reminder-system.html');
});
