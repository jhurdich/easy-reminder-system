const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../functions-correct/task-core.js');
const Calendar = require('../calendar-view.js');
const at = value => Date.parse(value);
function task(overrides = {}) {
  const value = { id: 'task', title: 'Planning', date: '2027-01-20', endDate: '2027-01-20',
    startTime: '09:00', endTime: '10:00', timeZone: 'UTC', repeat: 'once', amount: 1,
    allDay: false, done: false, ...overrides };
  value.next = overrides.next || new Date(C.toInstant(value.date, value.allDay ? '00:00' : value.startTime, value.timeZone)).toISOString();
  return value;
}
test('unfinished tasks become overdue at the end, not while they are in progress', () => {
  const r = task();
  assert.equal(Calendar.overdueStart(r, at('2027-01-20T09:30Z')), null);
  assert.equal(Calendar.overdueStart(r, at('2027-01-20T10:00Z')), at(r.next));
  assert.equal(Calendar.dayEntry(r, r.date, 'UTC', at('2027-01-20T09:30Z')).state, 'In progress');
  assert.equal(Calendar.dayEntry(r, r.date, 'UTC', at('2027-01-20T08:30Z')).state, 'Upcoming');
  assert.equal(Calendar.overdueStart({ ...r, done: true }, at('2027-01-21T00:00Z')), null);
});
test('overdue tasks are shown above every month and completed tasks are excluded', () => {
  const old = task({ id: 'old', date: '2026-12-01', endDate: '2026-12-01' });
  const model = Calendar.build([old, task({ done: true }), task({ id: 'future', date: '2027-03-05', endDate: '2027-03-05' })], { month: '2027-03-01', zone: 'UTC', now: at('2027-01-20T12:00Z') });
  assert.deepEqual(model.overdue.map(entry => entry.task.id), ['old']);
  assert.equal(model.days.length, 42);
  assert.equal(model.days.find(day => day.date === '2027-03-05').entries[0].task.id, 'future');
  assert.ok(model.days.every(day => day.entries.every(entry => !entry.task.done)));
});
test('all-day multi-day tasks stay current through their last day in the task time zone', () => {
  const r = task({ allDay: true, endDate: '2027-01-22', timeZone: 'America/New_York' });
  assert.equal(Calendar.overdueStart(r, at('2027-01-23T04:59:59Z')), null);
  assert.equal(Calendar.overdueStart(r, at('2027-01-23T05:00Z')), at(r.next));
  assert.ok(Calendar.dayEntry(r, '2027-01-22', 'Asia/Tokyo', at('2027-01-20T12:00Z')));
  assert.equal(Calendar.dayEntry(r, '2027-01-23', 'Asia/Tokyo', at('2027-01-20T12:00Z')), null);
});
test('timed tasks use the calendar zone and span midnight without an extra ending day', () => {
  const r = task({ startTime: '23:00', endDate: '2027-01-21', endTime: '01:00' });
  assert.ok(Calendar.dayEntry(r, '2027-01-20', 'UTC', at(r.next)));
  assert.ok(Calendar.dayEntry(r, '2027-01-21', 'UTC', at(r.next)));
  assert.equal(Calendar.dayEntry(r, '2027-01-22', 'UTC', at(r.next)), null);
  assert.equal(Calendar.dayEntry(r, '2027-01-20', 'Asia/Tokyo', at(r.next)), null);
  assert.ok(Calendar.dayEntry(r, '2027-01-21', 'Asia/Tokyo', at(r.next)));
  assert.equal(Calendar.dayEntry(task({ endDate: '2027-01-21', endTime: '00:00' }), '2027-01-21', 'UTC', at(r.next)), null);
});
test('daily repeats show upcoming dates and only the latest ended occurrence as overdue', () => {
  const r = task({ date: '2015-01-01', endDate: '2015-01-01', repeat: 'daily' });
  assert.equal(Calendar.overdueStart(r, at('2027-01-20T09:30Z')), at('2027-01-19T09:00Z'));
  assert.equal(Calendar.overdueStart(r, at('2027-01-20T10:00Z')), at('2027-01-20T09:00Z'));
  const entry = Calendar.dayEntry(r, '2027-01-22', 'UTC', at('2027-01-20T12:00Z'));
  assert.equal(entry.start, at('2027-01-22T09:00Z')); assert.equal(entry.state, 'Upcoming');
});
test('monthly 31st and annual leap-day repeats skip invalid dates', () => {
  const monthly = task({ date: '2027-01-31', endDate: '2027-01-31', repeat: 'monthly' });
  assert.equal(Calendar.previousStart(monthly, at('2027-03-01T00:00Z')), at(monthly.next));
  assert.equal(Calendar.dayEntry(monthly, '2027-02-28', 'UTC', at(monthly.next)), null);
  assert.equal(Calendar.dayEntry(monthly, '2027-03-31', 'UTC', at(monthly.next)).start, at('2027-03-31T09:00Z'));
  const yearly = task({ date: '2024-02-29', endDate: '2024-02-29', repeat: 'annually' });
  assert.equal(Calendar.overdueStart(yearly, at('2027-03-01T00:00Z')), at(yearly.next));
  assert.equal(Calendar.dayEntry(yearly, '2028-02-29', 'UTC', at(yearly.next)).start, at('2028-02-29T09:00Z'));
});
test('custom selected dates and date ranges retain the last overdue date after ending', () => {
  const selected = task({ repeat: 'custom', customMode: 'dates', customDates: ['2027-01-20', '2027-01-23'] });
  assert.equal(Calendar.dayEntry(selected, '2027-01-22', 'UTC', at(selected.next)), null);
  assert.equal(Calendar.overdueStart(selected, at('2027-02-01T00:00Z')), at('2027-01-23T09:00Z'));
  const range = task({ repeat: 'custom', customMode: 'range', rangeEnd: '2027-01-22' });
  assert.equal(Calendar.overdueStart(range, at('2027-02-01T00:00Z')), at('2027-01-22T09:00Z'));
  assert.equal(Calendar.dayEntry(range, '2027-01-23', 'UTC', at(range.next)), null);
});
test('recurring tasks follow daylight saving and skip nonexistent wall times', () => {
  const r = task({ date: '2027-03-12', endDate: '2027-03-12', timeZone: 'America/New_York', repeat: 'daily' });
  assert.equal(Calendar.dayEntry(r, '2027-03-15', 'America/New_York', at(r.next)).start, at('2027-03-15T13:00Z'));
  const gap = task({ ...r, next: undefined, startTime: '02:30', endTime: '03:30' });
  assert.equal(Calendar.dayEntry(gap, '2027-03-14', 'America/New_York', at(r.next)), null);
  assert.equal(Calendar.overdueStart(gap, at('2027-03-14T12:00Z')), at('2027-03-13T07:30Z'));
});
test('multi-day repeats calculate overdue by each occurrence end date', () => {
  const r = task({ allDay: true, date: '2027-01-01', endDate: '2027-01-03', repeat: 'daily' });
  assert.equal(Calendar.overdueStart(r, at('2027-01-20T12:00Z')), at('2027-01-17T00:00Z'));
  const timed = task({ date: '2027-01-01', endDate: '2027-01-03', repeat: 'daily' });
  assert.equal(Calendar.overdueStart(timed, at('2027-01-20T09:30Z')), at('2027-01-17T09:00Z'));
});
test('frequent interval repeats are grouped without losing dates to occurrence limits', () => {
  const r = task({ date: '2020-01-01', endDate: '2020-01-01', startTime: '00:00', endTime: '00:01', repeat: 'minutes' });
  const entry = Calendar.dayEntry(r, '2027-01-31', 'UTC', at('2027-01-31T12:30:30Z'));
  assert.equal(entry.start, at('2027-01-31T12:30Z')); assert.equal(entry.state, 'In progress');
  assert.equal(entry.multiple, true);
  assert.equal(Calendar.overdueStart(r, at('2027-01-31T12:30:30Z')), at('2027-01-31T12:29Z'));
});
test('legacy intervals keep their elapsed duration and finished tasks do not fill the calendar', () => {
  const r = { id: 'legacy', title: 'Legacy task', next: '2027-01-01T09:00:00Z', startTime: '09:00', endTime: '10:00', repeat: 'days', amount: 2, timeZone: 'UTC' };
  assert.equal(Calendar.dayEntry(r, '2027-01-03', 'UTC', at(r.next)).end, at('2027-01-03T10:00Z'));
  assert.equal(Calendar.dayEntry(r, '2027-01-02', 'UTC', at(r.next)), null);
  const model = Calendar.build([{ ...r, done: true }], { month: '2027-01-01', now: at(r.next) });
  assert.equal(model.overdue.length, 0); assert.ok(model.days.every(day => !day.entries.length));
});
test('invalid tasks do not prevent valid tasks from appearing; month navigation crosses years', () => {
  const model = Calendar.build([task(), { ...task(), id: 'invalid', next: 'invalid' }], { month: '2027-01-01', now: at('2027-01-20T12:00Z') });
  assert.equal(model.invalid, 1); assert.equal(model.overdue.length, 1);
  assert.equal(Calendar.shiftMonth('2027-01-01', -1), '2026-12-01');
  assert.equal(Calendar.shiftMonth('2027-12-01', 1), '2028-01-01');
});
