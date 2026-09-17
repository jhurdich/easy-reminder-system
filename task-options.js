/* Form helpers; all external sharing requires a separate, explicit user click. */
(function (root) {
  'use strict';
  const C = root.TaskCore, $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const presets = [[0, 'At start time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']];
  const commonZones = new Map([
    ['America/New_York', 'Eastern Time — New York'], ['America/Chicago', 'Central Time — Chicago'],
    ['America/Denver', 'Mountain Time — Denver'], ['America/Los_Angeles', 'Pacific Time — Los Angeles'],
    ['America/Phoenix', 'Arizona — Phoenix'], ['America/Anchorage', 'Alaska — Anchorage'],
    ['Pacific/Honolulu', 'Hawaii — Honolulu'], ['UTC', 'UTC — Coordinated Universal Time'],
    ['America/Toronto', 'Toronto'], ['America/Vancouver', 'Vancouver'],
    ['America/Halifax', 'Atlantic Time — Halifax'], ['America/St_Johns', 'Newfoundland — St. John’s'],
    ['America/Mexico_City', 'Mexico City'], ['America/Sao_Paulo', 'São Paulo'],
    ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['Europe/Berlin', 'Berlin'],
    ['Africa/Johannesburg', 'Johannesburg'], ['Africa/Cairo', 'Cairo'],
    ['Asia/Jerusalem', 'Jerusalem'], ['Asia/Dubai', 'Dubai'], ['Asia/Kolkata', 'India — Kolkata'],
    ['Asia/Kathmandu', 'Nepal — Kathmandu'], ['Asia/Singapore', 'Singapore'],
    ['Asia/Shanghai', 'China — Shanghai'], ['Asia/Tokyo', 'Japan — Tokyo'],
    ['Australia/Perth', 'Perth'], ['Australia/Adelaide', 'Adelaide'], ['Australia/Sydney', 'Sydney'],
    ['Pacific/Auckland', 'Auckland']
  ]);
  let availableZones = [];
  function deviceZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  function renderTimeZones() {
    const local = deviceZone();
    $('timeZone').innerHTML = availableZones.map(zone => {
      const label = commonZones.get(zone) || zone.replace(/_/g, ' ');
      return `<option value="${escape(zone)}">${escape((zone === local ? 'This device — ' : '') + label)}</option>`;
    }).join('');
  }
  function initTimeZones() {
    let supported = [];
    // Older browsers may omit this API or throw for the timeZone key.
    try { if (typeof Intl.supportedValuesOf === 'function') supported = Intl.supportedValuesOf('timeZone'); } catch (_) {}
    availableZones = [...new Set([deviceZone(), ...commonZones.keys(), ...supported])].filter(value => {
      if (typeof value !== 'string' || !value) return false;
      try { C.zone(value); return true; } catch (_) { return false; }
    });
    renderTimeZones();
  }
  function selectTimeZone(value) {
    // Saved aliases need their own option; assigning a missing select value would clear it.
    const zone = C.zone(value);
    if (!availableZones.includes(zone)) { availableZones.push(zone); renderTimeZones(); }
    $('timeZone').value = zone;
  }
  let selectedDates = [];
  function error(message = '') { $('formError').textContent = message; }
  function addNotification(minutes = 10) {
    if ($('notificationRows').children.length >= 20) { error('You can add up to 20 notifications.'); return; }
    const row = document.createElement('div');
    row.className = 'notification-row';
    const known = presets.some(([n]) => n === minutes);
    const unit = minutes && minutes % 1440 === 0 ? 1440 : minutes && minutes % 60 === 0 ? 60 : 1;
    row.innerHTML = '<select class="notification-preset" aria-label="Notification timing">' + presets.map(([n, label]) => `<option value="${n}"${minutes === n ? ' selected' : ''}>${label}</option>`).join('') + `<option value="custom"${known ? '' : ' selected'}>Custom…</option></select><input class="notification-value${known ? ' hidden' : ''}" type="number" min="0" max="525600" step="1" value="${minutes / unit}" aria-label="Custom notification amount"><select class="notification-unit${known ? ' hidden' : ''}" aria-label="Custom notification unit">` + [[1, 'minutes before'], [60, 'hours before'], [1440, 'days before']].map(([n, label]) => `<option value="${n}"${n === unit ? ' selected' : ''}>${label}</option>`).join('') + '</select><button type="button" class="cancel remove-notification" aria-label="Remove notification">Remove</button>';
    row.querySelector('.notification-preset').onchange = event => {
      const custom = event.target.value === 'custom';
      row.querySelector('.notification-value').classList.toggle('hidden', !custom);
      row.querySelector('.notification-unit').classList.toggle('hidden', !custom);
      row.querySelector('.notification-value').disabled = !custom;
      row.querySelector('.notification-unit').disabled = !custom;
    };
    row.querySelector('.notification-value').disabled = known;
    row.querySelector('.notification-unit').disabled = known;
    row.querySelector('.remove-notification').onclick = () => row.remove();
    $('notificationRows').appendChild(row);
  }
  function renderDates() {
    $('customDates').innerHTML = selectedDates.map(date => `<span class="date-chip"><button type="button" class="date-chip-value" data-select-date="${date}" aria-label="Edit custom date ${date}">${date}</button><button type="button" class="date-chip-remove" data-remove-date="${date}" aria-label="Remove ${date}">×</button></span>`).join('');
  }
  function sync() {
    const allDay = $('allDay').checked;
    for (const id of ['startTime', 'endTime']) { $(id).disabled = allDay; $(id).required = false; }
    document.querySelectorAll('.time-field').forEach(el => el.classList.toggle('hidden', allDay));
    const legacy = ['minutes', 'hours', 'days', 'weeks'].includes($('repeat').value);
    $('amountWrap').style.display = legacy ? 'flex' : 'none';
    $('unitWrap').style.display = legacy ? 'flex' : 'none';
    $('unitText').textContent = 'Every ' + $('repeat').value;
    $('customRepeatWrap').classList.toggle('hidden', $('repeat').value !== 'custom');
    $('customDatesWrap').classList.toggle('hidden', $('customMode').value === 'range');
    $('rangeEndWrap').classList.toggle('hidden', $('customMode').value !== 'range');
    $('customDate').disabled = $('repeat').value !== 'custom' || $('customMode').value !== 'dates';
    $('rangeEnd').disabled = $('repeat').value !== 'custom' || $('customMode').value !== 'range';
    $('customCategoryWrap').classList.toggle('hidden', $('category').value !== 'custom');
    $('customCategory').required = false;
    $('addressWrap').classList.toggle('hidden', $('locationType').value === 'online');
    $('conferenceWrap').classList.toggle('hidden', !$('conferenceType').value);
    $('conferenceUrl').required = false;
    $('conferenceUrl').disabled = !$('conferenceType').value;
    $('conferenceUrl').placeholder = $('conferenceType').value === 'zoom' ? 'https://zoom.us/j/...' : 'https://meet.google.com/...';
    $('endDate').min = $('date').value;
    $('customDate').min = $('date').value;
    $('rangeEnd').min = $('date').value;
    syncMapLinks();
    preview();
  }
  function read() {
    const notifications = Array.from($('notificationRows').children).map(row => {
      const value = row.querySelector('.notification-preset').value;
      if (value !== 'custom') return Number(value);
      const raw = row.querySelector('.notification-value').value;
      if (!raw || !Number.isInteger(Number(raw))) throw new Error('Custom notification amounts must be whole numbers.');
      return Number(raw) * Number(row.querySelector('.notification-unit').value);
    });
    const category = $('category').value === 'custom' ? $('customCategory').value.trim() : $('category').value;
    if ($('category').value === 'custom' && !category) throw new Error('Type a custom category.');
    const timeZone = $('timeZone').value.trim() || deviceZone();
    const date = $('date').value || C.parts(Date.now(), timeZone).date;
    const task = {
      schemaVersion: 2, date, endDate: $('endDate').value || date,
      timeZone: C.zone(timeZone), allDay: $('allDay').checked,
      startTime: $('allDay').checked ? '00:00' : ($('startTime').value || '09:00'), endTime: $('allDay').checked ? '00:00' : ($('endTime').value || '10:00'),
      repeat: $('repeat').value, amount: $('repeat').value === 'once' ? 0 : ['minutes', 'hours', 'days', 'weeks'].includes($('repeat').value) ? Number($('amount').value) : 1,
      customMode: $('customMode').value || 'dates', customDates: [...new Set([date, ...selectedDates])].sort(), rangeEnd: $('rangeEnd').value,
      locationType: $('locationType').value, location: $('locationType').value === 'online' ? '' : $('location').value.trim(),
      conferenceType: $('conferenceUrl').value.trim() ? $('conferenceType').value : '', conferenceUrl: $('conferenceType').value && $('conferenceUrl').value.trim() ? C.safeLink($('conferenceUrl').value.trim(), $('conferenceType').value) : '',
      driveUrl: C.safeLink($('driveUrl').value.trim(), 'drive'), guests: C.parseGuests($('guests').value), category, notifications: C.offsets({ notifications })
    };
    task.next = C.validate(task);
    return task;
  }
  function syncMapLinks() {
    const wrap = $('mapLinks'), location = $('location').value.trim();
    if (!wrap) return;
    const encoded = encodeURIComponent(location);
    const google = $('googleMapsLink'), apple = $('appleMapsLink');
    wrap.classList.toggle('hidden', !location || $('locationType').value === 'online');
    if (location) { google.href = `https://www.google.com/maps/search/?api=1&query=${encoded}`; apple.href = `http://maps.apple.com/?address=${encoded}`; }
  }
  function preview() {
    try { $('notificationPreview').textContent = C.summary({ ...read(), title: $('title').value.trim() || 'Your task' }); }
    catch (_) { $('notificationPreview').textContent = 'Add the task, location, and valid dates/times to preview its summary.'; }
  }
  function fill(task = null) {
    const localZone = deviceZone();
    const r = task ? C.normalize(task, localZone) : { timeZone: localZone, date: C.parts(Date.now(), localZone).date, allDay: false, locationType: 'address', notifications: [0], customDates: [], customMode: 'dates' };
    selectTimeZone(r.timeZone);
    for (const id of ['endDate', 'locationType', 'location', 'conferenceType', 'conferenceUrl', 'driveUrl', 'customMode', 'rangeEnd']) $(id).value = r[id] || (id === 'endDate' ? r.date : '');
    $('date').value = r.date;
    $('allDay').checked = Boolean(r.allDay);
    $('guests').value = (r.guests || []).join(', ');
    $('category').value = !r.category ? '' : C.categories.includes(r.category) ? r.category : 'custom';
    $('customCategory').value = C.categories.includes(r.category) ? '' : r.category || '';
    selectedDates = [...(r.customDates || [])];
    renderDates();
    $('notificationRows').innerHTML = '';
    (r.notifications || [0]).forEach(addNotification);
    error();
    sync();
  }
  function init() {
    $('category').innerHTML = '<option value="">No category</option>' + C.categories.map(c => `<option value="${escape(c)}">${escape(c)}</option>`).join('') + '<option value="custom">Custom…</option>';
    initTimeZones();
    $('timeZone').onchange = preview;
    for (const id of ['allDay', 'repeat', 'category', 'customMode', 'locationType', 'conferenceType']) $(id).onchange = sync;
    $('date').onchange = () => { if ($('endDate').value < $('date').value) $('endDate').value = $('date').value; sync(); };
    $('form').addEventListener('input', preview);
    $('location').addEventListener('input', syncMapLinks);
    $('addNotification').onclick = () => addNotification();
    $('addCustomDate').onclick = () => {
      const date = $('customDate').value;
      if (!C.validDate(date) || date < $('date').value) { error('Pick a date on or after the start date.'); return; }
      if (selectedDates.length >= 365 && !selectedDates.includes(date)) { error('Choose up to 366 dates including the start date.'); return; }
      selectedDates = [...new Set([...selectedDates, date])].sort(); $('customDate').value = ''; renderDates(); error();
    };
    $('customDates').onclick = event => { const removeDate = event.target.dataset.removeDate; const selectDate = event.target.dataset.selectDate; if (removeDate) { selectedDates = selectedDates.filter(d => d !== removeDate); renderDates(); } else if (selectDate) { $('customDate').value = selectDate; $('customDate').focus(); } };
    fill();
  }
  function taskDetails(task) {
    const pieces = [task.category, task.locationType === 'online' ? 'Online' : task.location, task.guests?.length ? task.guests.length + ' guest(s)' : '', `${C.offsets(task).length} notification(s)`].filter(Boolean);
    let links = '';
    for (const [url, label, kind] of [[task.conferenceUrl, 'Join video meeting', task.conferenceType], [task.driveUrl, 'Open Drive attachment', 'drive']]) {
      if (!url) continue;
      try { links += `<a href="${escape(C.safeLink(url, kind))}" target="_blank" rel="noopener noreferrer">${label}</a>`; } catch (_) { /* Do not render unsafe stored URLs. */ }
    }
    return `<div class="task-options-meta">${pieces.map(escape).join(' · ')}</div>` + (links ? `<div class="task-links">${links}</div>` : '');
  }
  root.TaskOptions = { init, fill, read, sync, error, preview, taskDetails };
})(globalThis);
