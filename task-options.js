/* Form helpers; all external sharing requires a separate, explicit user click. */
(function (root) {
  'use strict';
  const C = root.TaskCore, $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const presets = [[0, 'At start time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']];
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
    $('customDates').innerHTML = selectedDates.map(date => `<button type="button" data-remove-date="${date}" aria-label="Remove ${date}">${date} ×</button>`).join('');
  }
  function sync() {
    const allDay = $('allDay').checked;
    for (const id of ['startTime', 'endTime']) { $(id).disabled = allDay; $(id).required = !allDay; }
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
    $('customCategory').required = $('category').value === 'custom';
    $('addressWrap').classList.toggle('hidden', $('locationType').value === 'online');
    $('conferenceWrap').classList.toggle('hidden', !$('conferenceType').value);
    $('conferenceUrl').required = Boolean($('conferenceType').value);
    $('conferenceUrl').disabled = !$('conferenceType').value;
    $('conferenceUrl').placeholder = $('conferenceType').value === 'zoom' ? 'https://zoom.us/j/...' : 'https://meet.google.com/...';
    $('endDate').min = $('date').value;
    $('customDate').min = $('date').value;
    $('rangeEnd').min = $('date').value;
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
    const task = {
      schemaVersion: 2, date: $('date').value, endDate: $('endDate').value || $('date').value,
      timeZone: C.zone($('timeZone').value.trim()), allDay: $('allDay').checked,
      startTime: $('allDay').checked ? '00:00' : $('startTime').value, endTime: $('allDay').checked ? '00:00' : $('endTime').value,
      repeat: $('repeat').value, amount: $('repeat').value === 'once' ? 0 : ['minutes', 'hours', 'days', 'weeks'].includes($('repeat').value) ? Number($('amount').value) : 1,
      customMode: $('customMode').value, customDates: [...new Set([$('date').value, ...selectedDates])].sort(), rangeEnd: $('rangeEnd').value,
      locationType: $('locationType').value, location: $('locationType').value === 'online' ? '' : $('location').value.trim(),
      conferenceType: $('conferenceType').value, conferenceUrl: $('conferenceType').value ? C.safeLink($('conferenceUrl').value.trim(), $('conferenceType').value) : '',
      driveUrl: C.safeLink($('driveUrl').value.trim(), 'drive'), guests: C.parseGuests($('guests').value), category, notifications: C.offsets({ notifications })
    };
    if (task.conferenceType && !task.conferenceUrl) throw new Error('Paste the meeting link, or choose None for video conferencing.');
    task.next = C.validate(task);
    return task;
  }
  function preview() {
    try { $('notificationPreview').textContent = C.summary({ ...read(), title: $('title').value.trim() || 'Your task' }); }
    catch (_) { $('notificationPreview').textContent = 'Add the task, location, and valid dates/times to preview its summary.'; }
  }
  function fill(task = null) {
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const r = task ? C.normalize(task, localZone) : { timeZone: localZone, date: C.parts(Date.now(), localZone).date, allDay: false, locationType: 'address', notifications: [0], customDates: [], customMode: 'dates' };
    for (const id of ['timeZone', 'endDate', 'locationType', 'location', 'conferenceType', 'conferenceUrl', 'driveUrl', 'customMode', 'rangeEnd']) $(id).value = r[id] || (id === 'endDate' ? r.date : '');
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
    const zones = [...new Set(['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone, ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'])])];
    $('timeZones').innerHTML = zones.map(z => `<option value="${escape(z)}"></option>`).join('');
    for (const id of ['allDay', 'repeat', 'category', 'customMode', 'locationType', 'conferenceType']) $(id).onchange = sync;
    $('date').onchange = () => { if ($('endDate').value < $('date').value) $('endDate').value = $('date').value; sync(); };
    $('form').addEventListener('input', preview);
    $('addNotification').onclick = () => addNotification();
    $('addCustomDate').onclick = () => {
      const date = $('customDate').value;
      if (!C.validDate(date) || date < $('date').value) { error('Pick a date on or after the start date.'); return; }
      if (selectedDates.length >= 365 && !selectedDates.includes(date)) { error('Choose up to 366 dates including the start date.'); return; }
      selectedDates = [...new Set([...selectedDates, date])].sort(); $('customDate').value = ''; renderDates(); error();
    };
    $('customDates').onclick = event => { const date = event.target.dataset.removeDate; if (date) { selectedDates = selectedDates.filter(d => d !== date); renderDates(); } };
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
