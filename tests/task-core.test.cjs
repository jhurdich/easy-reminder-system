const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../functions-correct/task-core.js');
function task(overrides = {}) {
  const r = { id: 'test', title: 'Design review', note: 'Discuss the plan', date: '2026-09-20', endDate: '2026-09-20',
    startTime: '09:00', endTime: '10:00', allDay: false, timeZone: 'America/New_York', repeat: 'once', amount: 0,
    category: 'Work', location: '123 Main St', locationType: 'address', notifications: [10, 5], customMode: 'dates', customDates: [], rangeEnd: '', ...overrides };
  r.next = C.validate(r);
  return r;
}
test('converts selected time zone, including fractional-hour offsets', () => {
  assert.equal(new Date(C.toInstant('2026-09-20', '09:00', 'America/New_York')).toISOString(), '2026-09-20T13:00:00.000Z');
  assert.equal(new Date(C.toInstant('2026-09-20', '09:00', 'Asia/Kathmandu')).toISOString(), '2026-09-20T03:15:00.000Z');
});
test('rejects invalid dates, zones, end times and spring-forward gaps', () => {
  assert.throws(() => C.toInstant('2026-02-30', '09:00', 'UTC'));
  assert.throws(() => C.toInstant('2026-09-20', '09:00', 'Not/AZone'));
  assert.throws(() => task({ endTime: '08:00' }), /Ending/);
  assert.throws(() => C.toInstant('2026-03-08', '02:30', 'America/New_York'), /does not exist/);
});
test('fall-back ambiguity consistently selects the earlier instant', () => {
  assert.equal(new Date(C.toInstant('2026-11-01', '01:30', 'America/New_York')).toISOString(), '2026-11-01T05:30:00.000Z');
});
test('daily wall-clock recurrence follows daylight-saving changes', () => {
  const r = task({ date: '2026-03-07', endDate: '2026-03-07', repeat: 'daily', amount: 1 });
  const list = C.occurrences(r, Date.parse('2026-03-07'), Date.parse('2026-03-10')).map(n => new Date(n).toISOString());
  assert.deepEqual(list, ['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z']);
});
test('nonexistent recurring spring-forward wall times are skipped', () => {
  const r = task({ date: '2026-03-07', endDate: '2026-03-07', startTime: '02:30', endTime: '03:30', repeat: 'daily', amount: 1 });
  assert.equal(C.occurrences(r, Date.parse('2026-03-07'), Date.parse('2026-03-10')).length, 2);
});
test('weekly repeats keep the weekday', () => {
  const r = task({ repeat: 'weekly', amount: 1 });
  assert.deepEqual(C.occurrences(r, Date.parse('2026-09-20'), Date.parse('2026-10-05')).map(n => C.parts(n, r.timeZone).date), ['2026-09-20', '2026-09-27', '2026-10-04']);
});
test('monthly 31st skips short months instead of drifting', () => {
  const r = task({ date: '2026-01-31', endDate: '2026-01-31', repeat: 'monthly', amount: 1 });
  assert.deepEqual(C.occurrences(r, Date.parse('2026-01-01'), Date.parse('2026-05-01')).map(n => C.parts(n, r.timeZone).date), ['2026-01-31', '2026-03-31']);
});
test('February 29 annual repeats happen only in leap years', () => {
  const r = task({ date: '2024-02-29', endDate: '2024-02-29', repeat: 'annually', amount: 1 });
  assert.equal(C.occurrences(r, Date.parse('2025-01-01'), Date.parse('2029-01-01')).length, 1);
});
test('custom dates and inclusive date ranges work', () => {
  const r = task({ repeat: 'custom', amount: 1, customDates: ['2026-09-20', '2026-09-23'] });
  assert.equal(C.occurrences(r, Date.parse('2026-09-20'), Date.parse('2026-10-01')).length, 2);
  r.customMode = 'range'; r.rangeEnd = '2026-09-22';
  assert.equal(C.occurrences(r, Date.parse('2026-09-20'), Date.parse('2026-10-01')).length, 3);
});
test('all-day events use exclusive next-day end across DST', () => {
  const r = task({ date: '2026-03-08', endDate: '2026-03-08', allDay: true });
  assert.equal(C.endInstant(r) - Date.parse(r.next), 23 * 3600000);
  assert.match(C.summary(r), /All day/);
  const url = new URL(C.calendarUrl(r));
  assert.equal(url.searchParams.get('dates'), '20260308/20260309');
});
test('overnight and multi-day timed tasks preserve end date', () => {
  const r = task({ endDate: '2026-09-21', startTime: '23:00', endTime: '01:00' });
  assert.equal(C.endInstant(r) - Date.parse(r.next), 2 * 3600000);
});
test('alerts fire before start, independently, with stable delivery IDs', () => {
  const r = task();
  const atTen = Date.parse(r.next) - 10 * 60000;
  assert.equal(C.dueNotifications(r, atTen).length, 1);
  assert.equal(C.dueNotifications(r, atTen)[0].minutes, 10);
  assert.equal(C.dueNotifications(r, atTen)[0].id, C.dueNotifications(r, atTen + 1000)[0].id);
  const later = C.dueNotifications(r, Date.parse(r.next) - 4 * 60000);
  assert.equal(later.length, 1); assert.equal(later[0].minutes, 5);
});
test('disabled alerts, completed tasks, stale and pre-creation alerts do not send', () => {
  const r = task({ notifications: [0] }), now = Date.parse(r.next);
  assert.equal(C.dueNotifications({ ...r, notifications: [] }, now).length, 0);
  assert.equal(C.dueNotifications({ ...r, done: true }, now).length, 0);
  assert.equal(C.dueNotifications(r, now + 6 * 60000).length, 0);
  assert.equal(C.dueNotifications({ ...r, scheduleUpdatedAt: new Date(now + 1000).toISOString() }, now + 2000).length, 0);
});
test('next repeat can notify a day early, before the current occurrence', () => {
  const r = task({ repeat: 'daily', amount: 1, notifications: [1440] });
  const due = C.dueNotifications(r, Date.parse(r.next));
  assert.equal(due.length, 1);
  assert.equal(due[0].start, Date.parse(r.next) + C.DAY);
});
test('legacy tasks retain default alerts and fixed interval behavior', () => {
  const r = { next: '2026-03-07T14:00:00Z', repeat: 'days', amount: 1, startTime: '09:00', endTime: '10:00' };
  assert.deepEqual(C.offsets(r), [0]);
  assert.equal(C.occurrences(r, Date.parse(r.next) + C.DAY, Date.parse(r.next) + C.DAY)[0], Date.parse(r.next) + C.DAY);
  assert.equal(C.endInstant(r) - Date.parse(r.next), 3600000);
});
test('summary contains task, address/online, both times and the selected zone', () => {
  const r = task();
  const text = C.summary(r);
  for (const value of ['Design review', '123 Main St', '9:00', '10:00', 'America/New_York']) assert.ok(text.includes(value));
  assert.match(C.summary({ ...r, locationType: 'online' }), /Online/);
});
test('links, guest emails and timing are validated', () => {
  assert.equal(C.safeLink('https://us02web.zoom.us/j/123', 'zoom'), 'https://us02web.zoom.us/j/123');
  for (const url of ['javascript:alert(1)', 'https://meet.google.com.evil.test/abc', 'https://user:pass@meet.google.com/abc']) assert.throws(() => C.safeLink(url, 'meet'));
  assert.throws(() => C.safeLink('https://evil.test/drive', 'drive'));
  assert.deepEqual(C.parseGuests('A@example.com; a@example.com\nb@example.com'), ['a@example.com', 'b@example.com']);
  assert.throws(() => C.parseGuests('person@example.com?bcc=bad@example.com'));
  assert.throws(() => C.offsets({ notifications: [-5] }));
  assert.throws(() => C.offsets({ notifications: [0.5] }));
  assert.deepEqual(C.offsets({ notifications: [10, 10, 5] }), [10, 5]);
});
test('invitation draft is encoded and carries the complete task summary', () => {
  const r = task({ guests: ['person@example.com'], conferenceUrl: 'https://meet.google.com/abc-defg-hij', driveUrl: 'https://drive.google.com/file/d/example' });
  const url = new URL(C.invitationUrl(r));
  assert.equal(url.protocol, 'mailto:');
  assert.ok(url.searchParams.get('body').includes(r.location));
  assert.ok(url.searchParams.get('body').includes(r.conferenceUrl));
  assert.ok(url.searchParams.get('body').includes(r.driveUrl));
  assert.equal(new URL(C.calendarUrl(r)).searchParams.get('add'), 'person@example.com');
});

test('upcoming occurrence advances a series and ends a finite custom schedule', () => {
  const r = task({ repeat: 'monthly', amount: 1 });
  assert.equal(C.parts(C.nextStart(r, Date.parse('2026-10-01')), r.timeZone).date, '2026-10-20');
  const custom = task({ repeat: 'custom', amount: 1, customMode: 'range', rangeEnd: '2026-09-23' });
  assert.equal(C.nextStart(custom, Date.parse('2026-09-24')), null);
});
