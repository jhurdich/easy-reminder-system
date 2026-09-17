/* Calendar display uses the existing task schedules; it does not write reminders. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' && module.exports ? require('./functions-correct/task-core.js') : root.TaskCore;
  const steps = { minutes: 60000, hours: 3600000, days: C.DAY, weeks: 7 * C.DAY };
  const boundsCache = new Map();
  const fixed = task => ['minutes', 'hours'].includes(task.repeat) || (!task.date && Boolean(steps[task.repeat]));
  const step = task => (Number(task.amount) || 1) * steps[task.repeat];
  function endAt(task, start) {
    // Interval repeats keep the original elapsed duration, including overnight tasks.
    if (fixed(task)) {
      const anchor = Date.parse(task.next);
      return start + Math.max(60000, C.endInstant(task, anchor) - anchor);
    }
    return C.endInstant(task, start);
  }
  function monthDate(year, month, day) {
    const d = new Date(0); d.setUTCFullYear(year, month, day); d.setUTCHours(12, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  function shiftMonth(month, amount) {
    const [y, m] = month.split('-').map(Number);
    return monthDate(y, m - 1 + amount, 1);
  }
  function previousDate(task, limit) {
    if (limit < task.date) return null;
    const amount = Number(task.amount) || 1, diff = C.dayDiff(limit, task.date);
    if (['daily', 'days', 'weekly', 'weeks'].includes(task.repeat)) {
      const interval = amount * (['weekly', 'weeks'].includes(task.repeat) ? 7 : 1);
      return C.addDays(task.date, Math.floor(diff / interval) * interval);
    }
    if (task.repeat === 'custom') {
      if (task.customMode === 'range') return limit < task.rangeEnd ? limit : task.rangeEnd;
      return task.customDates.filter(d => d >= task.date && d <= limit).sort().pop() || null;
    }
    const [ay, am, ad] = task.date.split('-').map(Number), [y, m] = limit.split('-').map(Number);
    let cycle = task.repeat === 'monthly' ? Math.floor(((y - ay) * 12 + m - am) / amount) : Math.floor((y - ay) / amount);
    // Invalid month-end/leap-day dates are skipped, just as in the shared scheduler.
    for (let tries = 0; cycle >= 0 && tries < 48; cycle--, tries++) {
      const date = task.repeat === 'monthly' ? monthDate(ay, am - 1 + cycle * amount, ad) : monthDate(ay + cycle * amount, am - 1, ad);
      if (date <= limit && date >= task.date && C.matchesDate(task, date)) return date;
    }
    return null;
  }
  function previousStart(task, before) {
    const anchor = Date.parse(task.next);
    if (!Number.isFinite(anchor) || anchor > before) return null;
    if (!task.repeat || task.repeat === 'once') return anchor;
    if (fixed(task)) return anchor + Math.floor((before - anchor) / step(task)) * step(task);
    const r = C.normalize(task), local = C.parts(before, r.timeZone);
    let limit = local.date;
    for (let tries = 0; tries < 48; tries++) {
      const date = previousDate(r, limit);
      if (!date) return null;
      try {
        const start = C.toInstant(date, r.allDay ? '00:00' : r.startTime, r.timeZone);
        if (start <= before && start >= anchor) return start;
      } catch (_) { /* Skip a nonexistent wall time at a daylight-saving transition. */ }
      limit = C.addDays(date, -1);
    }
    return null;
  }
  function overdueStart(task, now) {
    if (task.done) return null;
    const anchor = Date.parse(task.next);
    if (!task.repeat || task.repeat === 'once') return endAt(task, anchor) <= now ? anchor : null;
    if (fixed(task)) return previousStart(task, now - (endAt(task, anchor) - anchor));
    const r = C.normalize(task), local = C.parts(now, r.timeZone);
    const days = C.dayDiff(r.endDate, r.date) + (r.allDay ? 1 : 0);
    let limit = C.addDays(local.date, -days);
    if (local.time < (r.allDay ? '00:00' : r.endTime)) limit = C.addDays(limit, -1);
    const before = C.toInstant(limit, '23:59', r.timeZone) + 59999;
    let start = previousStart(task, before);
    while (start !== null && endAt(task, start) > now) start = previousStart(task, start - 1);
    return start;
  }
  function dayBounds(date, zone) {
    const cacheKey = zone + ':' + date;
    if (boundsCache.has(cacheKey)) return boundsCache.get(cacheKey);
    // Most dates start at midnight; some time zones advance clocks at midnight.
    function boundary(day) {
      try { return C.toInstant(day, '00:00', zone); } catch (_) {
        let low = Date.parse(day + 'T00:00:00Z') - 2 * C.DAY, high = low + 4 * C.DAY;
        while (high - low > 1) { const mid = Math.floor((low + high) / 2); if (C.parts(mid, zone).date < day) low = mid; else high = mid; }
        return high;
      }
    }
    const result = [boundary(date), boundary(C.addDays(date, 1))];
    if (boundsCache.size > 2000) boundsCache.clear();
    boundsCache.set(cacheKey, result); return result;
  }
  function dayEntry(task, date, zone, now) {
    const [from, to] = dayBounds(date, task.allDay ? task.timeZone : zone);
    const last = previousStart(task, to - 1);
    if (last === null || endAt(task, last) <= from) return null;
    let start = last;
    // For frequent repeats, show the current or next occurrence on today's date.
    if (now >= from && now < to) {
      const current = previousStart(task, now);
      if (current !== null && endAt(task, current) > now) start = current;
      else { const next = C.nextStart(task, now); if (next !== null && next >= now && next < to) start = next; }
    }
    const previous = previousStart(task, last - 1);
    const end = endAt(task, start);
    return { task, start, end, multiple: previous !== null && endAt(task, previous) > from,
      state: end <= now ? 'Overdue' : start <= now ? 'In progress' : 'Upcoming' };
  }
  function build(tasks, { month, zone = 'UTC', now = Date.now() }) {
    C.zone(zone);
    const today = C.parts(now, zone).date, first = month.slice(0, 7) + '-01';
    const start = C.addDays(first, -new Date(first + 'T12:00:00Z').getUTCDay());
    const active = tasks.filter(task => !task.done).map(task => ({ ...task, timeZone: task.timeZone || zone }));
    const invalid = new Set(), overdue = [];
    for (const task of active) {
      try {
        if (!Number.isFinite(Date.parse(task.next))) throw new Error('Invalid date');
        const due = overdueStart(task, now);
        if (due !== null) overdue.push({ task, start: due, end: endAt(task, due), state: 'Overdue' });
      } catch (_) { invalid.add(task.id); }
    }
    overdue.sort((a, b) => a.end - b.end || a.task.title.localeCompare(b.task.title));
    const days = Array.from({ length: 42 }, (_, i) => {
      const date = C.addDays(start, i), entries = [];
      for (const task of active) {
        if (invalid.has(task.id)) continue;
        try { const entry = dayEntry(task, date, zone, now); if (entry) entries.push(entry); } catch (_) { invalid.add(task.id); }
      }
      entries.sort((a, b) => Number(b.task.allDay) - Number(a.task.allDay) || a.start - b.start || a.task.title.localeCompare(b.task.title));
      return { date, entries, today: date === today, outside: date.slice(0, 7) !== first.slice(0, 7) };
    });
    return { today, days, overdue, invalid: invalid.size };
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function init({ getTasks, onOpen }) {
    const $ = id => document.getElementById(id), zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    let selected = C.parts(Date.now(), zone).date, month = selected.slice(0, 7) + '-01';
    const dateLabel = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeLabel = instant => new Date(instant).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
    function row(entry) {
      const { task, start, end } = entry;
      const timing = task.allDay ? C.parts(start, task.timeZone).date + ' – ' + C.parts(end - 1, task.timeZone).date + ' · All day'
        : new Date(start).toLocaleString('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }) + ' – ' + new Date(end).toLocaleString('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' });
      const detail = [task.locationType === 'online' ? 'Online' : task.location, task.category, task.repeat !== 'once' ? C.repeatLabel(task) : ''].filter(Boolean).join(' · ');
      return `<li class="calendar-task"><button type="button" class="calendar-task-open" data-calendar-task="${escape(task.id)}"><strong>${escape(task.title)}</strong><span>${escape(timing)}</span>${detail ? `<span>${escape(detail)}</span>` : ''}${entry.multiple ? '<span>Multiple occurrences on this date; showing the current, next, or last occurrence.</span>' : ''}</button><span class="calendar-state ${entry.state === 'Overdue' ? 'is-overdue' : ''}">${escape(entry.state)}</span></li>`;
    }
    function render() {
      const focusedDate = document.activeElement?.dataset?.calendarDay;
      const model = build(getTasks(), { month, zone });
      $('calendarZone').textContent = 'Times shown in ' + zone + '. All-day tasks keep their scheduled dates.';
      $('calendarMonth').textContent = new Date(month + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
      $('calendarOverdueCount').textContent = String(model.overdue.length);
      $('calendarOverdueList').innerHTML = model.overdue.map(row).join('');
      $('calendarOverdueEmpty').classList.toggle('hidden', model.overdue.length > 0);
      $('calendarError').textContent = model.invalid ? 'Some tasks have invalid dates. Check those tasks in Inbox.' : '';
      $('calendarGrid').innerHTML = model.days.map(day => `<button type="button" class="calendar-day${day.outside ? ' outside-month' : ''}${day.today ? ' is-today' : ''}" data-calendar-day="${day.date}" aria-pressed="${day.date === selected}"${day.today ? ' aria-current="date"' : ''} aria-label="${escape(dateLabel(day.date))}, ${day.entries.length} task${day.entries.length === 1 ? '' : 's'}"><span class="calendar-day-number">${Number(day.date.slice(-2))}</span>${day.entries.length ? `<span class="calendar-day-count">${day.entries.length} task${day.entries.length === 1 ? '' : 's'}</span>` : ''}<span class="calendar-day-preview" aria-hidden="true">${day.entries.slice(0, 2).map(entry => `<span class="${entry.state === 'Overdue' ? 'is-overdue' : ''}">${escape((entry.task.allDay ? 'All day' : timeLabel(entry.start)) + ' · ' + entry.task.title)}</span>`).join('')}${day.entries.length > 2 ? `<span>+${day.entries.length - 2} more</span>` : ''}</span></button>`).join('');
      const day = model.days.find(d => d.date === selected);
      $('calendarDayTitle').textContent = dateLabel(selected);
      $('calendarDayList').innerHTML = (day?.entries || []).map(row).join('');
      $('calendarDayEmpty').classList.toggle('hidden', Boolean(day?.entries.length));
      if (focusedDate) Array.from($('calendarGrid').querySelectorAll('[data-calendar-day]')).find(button => button.dataset.calendarDay === focusedDate)?.focus();
    }
    $('calendarPrevious').onclick = () => { month = shiftMonth(month, -1); selected = month; render(); };
    $('calendarNext').onclick = () => { month = shiftMonth(month, 1); selected = month; render(); };
    $('calendarToday').onclick = () => { selected = C.parts(Date.now(), zone).date; month = selected.slice(0, 7) + '-01'; render(); };
    $('calendarView').onclick = event => {
      const day = event.target.closest('[data-calendar-day]'), task = event.target.closest('[data-calendar-task]');
      if (day) { selected = day.dataset.calendarDay; render(); $('calendarDayTitle').focus(); }
      else if (task) onOpen(task.dataset.calendarTask);
    };
    return { render, reset() {
      selected = C.parts(Date.now(), zone).date; month = selected.slice(0, 7) + '-01';
      for (const id of ['calendarOverdueList', 'calendarGrid', 'calendarDayList']) $(id).innerHTML = '';
      $('calendarOverdueCount').textContent = '0'; $('calendarError').textContent = '';
    } };
  }
  const api = { build, dayEntry, overdueStart, previousStart, endAt, shiftMonth, init };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaskCalendar = api;
})(globalThis);
