/* Shared, dependency-free calendar logic: loaded by the browser and Firebase. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const categories = ['Home', 'Work', 'Personal', 'Family', 'Religion', 'Health', 'Finances', 'Errands', 'Shopping', 'Travel', 'Learning', 'Fitness', 'Social', 'Admin', 'Planning', 'Someday / Maybe'];
  const formatters = new Map();
  function zone(value) {
    const result = value || 'UTC';
    try { new Intl.DateTimeFormat('en', { timeZone: result }).format(); } catch (_) { throw new Error('Choose a valid time zone.'); }
    return result;
  }
  function parts(instant, timeZone = 'UTC') {
    if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone: zone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }));
    const p = Object.fromEntries(formatters.get(timeZone).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, second: Number(p.second) };
  }
  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }
  function addDays(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10); }
  function dayDiff(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY); }
  function toInstant(date, time, timeZone) {
    zone(timeZone);
    if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Choose a valid date and time.');
    const wall = Date.parse(date + 'T' + time + ':00Z');
    const candidates = new Set();
    // Sample both sides of offset transitions, then verify the requested wall time.
    for (const sample of [wall - DAY, wall, wall + DAY]) {
      const p = parts(sample, timeZone);
      const offset = Date.parse(p.date + 'T' + p.time + ':00Z') - sample;
      const candidate = wall - offset;
      const local = parts(candidate, timeZone);
      if (local.date === date && local.time === time) candidates.add(candidate);
    }
    if (!candidates.size) throw new Error('This time does not exist in that time zone because the clocks change. Choose another time.');
    // At the autumn clock change, use the earlier occurrence of an ambiguous time.
    return Math.min(...candidates);
  }
  function safeLink(value, kind = '') {
    if (!value) return '';
    let url;
    try { url = new URL(value); } catch (_) { throw new Error('Enter a complete HTTPS link.'); }
    if (url.protocol !== 'https:' || url.username || url.password || value.length > 2000) throw new Error('Enter a valid HTTPS link.');
    if (kind === 'drive' && !['drive.google.com', 'docs.google.com'].includes(url.hostname)) throw new Error('Use a Google Drive or Google Docs attachment link.');
    if (kind === 'meet' && url.hostname !== 'meet.google.com') throw new Error('Use a meet.google.com video link.');
    if (kind === 'zoom' && !['zoom.us', 'zoom.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) throw new Error('Use a Zoom video link.');
    return url.href;
  }
  function parseGuests(value) {
    const result = [...new Set(String(value || '').split(/[,;\n]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
    if (result.length > 50 || result.some(s => s.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(s))) throw new Error('Enter valid guest emails separated by commas (up to 50).');
    return result;
  }
  function offsets(task) {
    const values = Array.isArray(task.notifications) ? task.notifications : [0];
    if (values.length > 20 || values.some(n => !Number.isInteger(n) || n < 0 || n > 525600)) throw new Error('Use up to 20 notifications, from 0 minutes to 365 days before.');
    return [...new Set(values)].sort((a, b) => b - a);
  }
  function normalize(task, fallbackZone = 'UTC') {
    const timeZone = zone(task.timeZone || fallbackZone);
    const start = Date.parse(task.next);
    const p = parts(start, timeZone);
    const nextHour = parts(start + 3600000, timeZone);
    return { ...task, timeZone, date: task.date || p.date, endDate: task.endDate || (task.endTime && task.endTime <= (task.startTime || p.time) ? addDays(p.date, 1) : p.date),
      startTime: task.startTime || p.time, endTime: task.endTime || nextHour.time,
      allDay: Boolean(task.allDay), locationType: task.locationType || 'address', location: task.location || '',
      conferenceType: task.conferenceType || '', conferenceUrl: task.conferenceUrl || '', driveUrl: task.driveUrl || '',
      guests: task.guests || [], category: task.category || '', notifications: offsets(task), customDates: task.customDates || [], customMode: task.customMode || 'dates', rangeEnd: task.rangeEnd || '' };
  }
  function endInstant(task, start = Date.parse(task.next)) {
    if (!task.date) {
      if (!task.startTime || !task.endTime) return start + 3600000;
      const minutes = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
      const difference = (minutes(task.endTime) - minutes(task.startTime) + 1440) % 1440;
      return start + (difference || 1440) * 60000;
    }
    const date = parts(start, task.timeZone).date;
    const days = dayDiff(task.endDate || task.date, task.date);
    return toInstant(addDays(date, days + (task.allDay ? 1 : 0)), task.allDay ? '00:00' : task.endTime, task.timeZone);
  }
  function validate(task) {
    zone(task.timeZone);
    if (!validDate(task.date) || !validDate(task.endDate) || task.endDate < task.date) throw new Error('End date must be on or after the start date.');
    if (!['once', 'daily', 'weekly', 'monthly', 'annually', 'custom', 'minutes', 'hours', 'days', 'weeks'].includes(task.repeat)) throw new Error('Choose a repeat option.');
    if (!Number.isInteger(task.amount) || task.amount < 0 || task.amount > 100000) throw new Error('Repeat interval must be a whole number from 1 to 100000.');
    if (task.repeat !== 'once' && task.amount < 1) throw new Error('Repeat interval must be at least 1.');
    if (task.allDay && ['minutes', 'hours'].includes(task.repeat)) throw new Error('All-day tasks cannot repeat by minutes or hours.');
    const start = toInstant(task.date, task.allDay ? '00:00' : task.startTime, task.timeZone);
    if (endInstant(task, start) <= start) throw new Error('Ending time must be after starting time.');
    offsets(task);
    if (task.repeat === 'custom') {
      if (task.customMode === 'range') {
        if (!validDate(task.rangeEnd) || task.rangeEnd < task.date || dayDiff(task.rangeEnd, task.date) > 365) throw new Error('Choose a custom date range of up to 366 days, ending on or after the start date.');
      } else if (!task.customDates.length || task.customDates.length > 366 || task.customDates.some(d => !validDate(d) || d < task.date)) throw new Error('Add custom dates on or after the start date (up to 366).');
    }
    if (task.category.length > 60 || task.location.length > 500) throw new Error('Use a category of up to 60 characters and an address of up to 500.');
    return new Date(start).toISOString();
  }
  function matchesDate(task, date) {
    const diff = dayDiff(date, task.date);
    if (diff < 0) return false;
    const n = Number(task.amount) || 1;
    if (task.repeat === 'once') return diff === 0;
    if (task.repeat === 'daily' || task.repeat === 'days') return diff % n === 0;
    if (task.repeat === 'weekly' || task.repeat === 'weeks') return diff % (n * 7) === 0;
    if (task.repeat === 'monthly') {
      const [y, m, d] = date.split('-').map(Number), [ay, am, ad] = task.date.split('-').map(Number);
      return d === ad && ((y - ay) * 12 + m - am) % n === 0;
    }
    if (task.repeat === 'annually') return date.slice(5) === task.date.slice(5) && (Number(date.slice(0, 4)) - Number(task.date.slice(0, 4))) % n === 0;
    if (task.repeat === 'custom') return task.customMode === 'range' ? date <= task.rangeEnd : task.customDates.includes(date);
    return false;
  }
  function occurrences(task, from, to) {
    const anchor = Date.parse(task.next);
    if (!Number.isFinite(anchor) || to < anchor || from > to) return [];
    const fixed = { minutes: 60000, hours: 3600000, days: DAY, weeks: DAY * 7 };
    if (['minutes', 'hours'].includes(task.repeat) || (!task.date && fixed[task.repeat])) {
      const step = (Number(task.amount) || 1) * fixed[task.repeat];
      const first = Math.max(0, Math.ceil((from - anchor) / step)), last = Math.floor((to - anchor) / step);
      const result = [];
      for (let i = first; i <= last && result.length < 10000; i++) result.push(anchor + i * step);
      return result;
    }
    if (task.repeat === 'once') return anchor >= from && anchor <= to ? [anchor] : [];
    const r = normalize(task);
    const first = parts(Math.max(from, anchor), r.timeZone).date, last = parts(to, r.timeZone).date;
    const result = [];
    for (let date = first, count = 0; date <= last && count < 3660; date = addDays(date, 1), count++) {
      if (!matchesDate(r, date)) continue;
      try {
        const start = toInstant(date, r.allDay ? '00:00' : r.startTime, r.timeZone);
        if (start >= from && start <= to) result.push(start);
      } catch (_) { /* A recurring wall time missing at the spring transition is skipped. */ }
    }
    return result;
  }
  function dueNotifications(task, now, grace = 5 * 60000) {
    if (task.done) return [];
    const result = [];
    for (const minutes of offsets(task)) {
      for (const start of occurrences(task, now - grace + minutes * 60000, now + minutes * 60000)) {
        const scheduled = start - minutes * 60000;
        // Do not backfill alerts that predate creation or the latest schedule edit.
        if (task.scheduleUpdatedAt && scheduled < Date.parse(task.scheduleUpdatedAt)) continue;
        const id = `${task.scheduleVersion || 'legacy'}:${start}:${minutes}`;
        result.push({ id, start, minutes, scheduled });
      }
    }
    return result.sort((a, b) => a.scheduled - b.scheduled);
  }
  function nextStart(task, after = Date.now()) {
    const anchor = Date.parse(task.next);
    if (task.done || task.repeat === 'once' || anchor >= after) return anchor;
    const fixed = { minutes: 60000, hours: 3600000, days: DAY, weeks: DAY * 7 };
    if (['minutes', 'hours'].includes(task.repeat) || (!task.date && fixed[task.repeat])) {
      const step = (Number(task.amount) || 1) * fixed[task.repeat];
      return anchor + Math.ceil((after - anchor) / step) * step;
    }
    const r = normalize(task);
    for (let date = parts(after, r.timeZone).date, i = 0; i < 3660; i++, date = addDays(date, 1)) {
      if (r.repeat === 'custom' && (r.customMode === 'range' ? date > r.rangeEnd : date > r.customDates[r.customDates.length - 1])) break;
      if (!matchesDate(r, date)) continue;
      try { const next = toInstant(date, r.allDay ? '00:00' : r.startTime, r.timeZone); if (next >= after) return next; } catch (_) {}
    }
    return null;
  }
  function summary(task, start = Date.parse(task.next)) {
    const timeZone = task.timeZone || 'UTC';
    const fmt = value => new Date(value).toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
    const where = task.locationType === 'online' ? 'Online' : task.location || (task.conferenceUrl ? 'Online' : 'Location not specified');
    const timing = task.allDay ? `${parts(start, timeZone).date}${task.endDate && task.endDate !== task.date ? ' – ' + parts(endInstant(task, start) - 1, timeZone).date : ''} · All day` : `${fmt(start)} – ${fmt(endInstant(task, start))}`;
    return `${String(task.title || 'Task').slice(0, 100)}\n${where.slice(0, 160)}\n${timing} (${timeZone})`;
  }
  function repeatLabel(task) {
    const labels = { once: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annually: 'Annually', custom: task.customMode === 'range' ? 'Daily through ' + task.rangeEnd : 'Custom dates' };
    return labels[task.repeat] || `Every ${task.amount} ${task.repeat}`;
  }
  function details(task) { return [summary(task), task.note, repeatLabel(task), task.conferenceUrl && 'Video: ' + task.conferenceUrl, task.driveUrl && 'Attachment: ' + task.driveUrl].filter(Boolean).join('\n\n'); }
  function calendarUrl(task) {
    const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dates = task.allDay ? task.date.replace(/-/g, '') + '/' + addDays(task.endDate, 1).replace(/-/g, '') : stamp(task.next) + '/' + stamp(endInstant(task));
    const p = new URLSearchParams({ action: 'TEMPLATE', text: task.title, dates, details: details(task), location: task.locationType === 'online' ? task.conferenceUrl || 'Online' : task.location || '', ctz: task.timeZone || 'UTC' });
    if (task.guests?.length) p.set('add', task.guests.join(','));
    return 'https://calendar.google.com/calendar/render?' + p;
  }
  function invitationUrl(task) {
    const recipients = parseGuests((task.guests || []).join(','));
    if (!recipients.length) throw new Error('Add at least one guest email first.');
    const p = new URLSearchParams({ subject: 'Invitation: ' + task.title, body: details(task) + '\n\nAdd to Google Calendar: ' + calendarUrl(task) });
    return 'mailto:' + recipients.map(encodeURIComponent).join(',') + '?' + p.toString().replace(/\+/g, '%20');
  }
  const api = { DAY, categories, zone, parts, validDate, addDays, dayDiff, toInstant, safeLink, parseGuests, offsets, normalize, endInstant, validate, matchesDate, occurrences, dueNotifications, nextStart, summary, repeatLabel, details, calendarUrl, invitationUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaskCore = api;
})(globalThis);
