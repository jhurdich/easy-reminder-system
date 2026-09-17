/* Local search only: task details are never sent to a search service. */
(function (root) {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const matches = (text, query) => normalize(query).trim().split(/\s+/).every(word => normalize(text).includes(word));
  function taskText(task) {
    return [task.title, task.note, task.location, task.locationType === 'online' ? 'online' : '',
      task.category, ...(task.labels || []), ...(task.guests || []), task.conferenceType,
      task.conferenceUrl, task.driveUrl, task.date, task.endDate, task.next, task.startTime,
      task.endTime, task.timeZone, task.priority, task.repeat, task.allDay ? 'all day' : '',
      task.done ? 'archived completed' : 'active'].filter(Boolean).join(' ');
  }
  const matchesTask = (task, query) => matches(taskText(task), query);
  function rank(title, query) {
    const text = normalize(title), q = normalize(query).trim();
    return text === q ? 0 : text.startsWith(q) ? 1 : text.includes(q) ? 2 : 3;
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function init({ getTasks, getActions, isSignedIn, openTask, onQuery }) {
    const input = document.getElementById('search'), panel = document.getElementById('searchPopup');
    const list = document.getElementById('searchResults'), status = document.getElementById('searchStatus');
    let results = [], active = -1, opened = false;
    function close() {
      opened = false; active = -1; results = [];
      panel.classList.add('hidden'); list.innerHTML = ''; status.textContent = '';
      input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
    }
    function refresh(onlyIfOpen = false) {
      if (onlyIfOpen && !opened) return;
      const query = input.value.trim();
      if (!query || !isSignedIn() || document.activeElement !== input) { close(); return; }
      const tasks = getTasks().filter(task => matchesTask(task, query))
        .sort((a, b) => rank(a.title, query) - rank(b.title, query) || a.title.localeCompare(b.title));
      const actions = getActions().filter(action => matches(action.title + ' ' + action.keywords + ' actions functions features', query))
        .sort((a, b) => rank(a.title, query) - rank(b.title, query));
      results = [
        ...tasks.map(task => ({ title: task.title, detail: [task.done ? 'Archived task' : 'Task', task.category,
          task.date || task.next?.slice(0, 10), task.locationType === 'online' ? 'Online' : task.location].filter(Boolean).join(' · '), run: () => openTask(task.id) })),
        ...actions.map(action => ({ ...action, detail: 'Action · ' + action.detail }))
      ];
      active = -1; opened = true;
      input.removeAttribute('aria-activedescendant'); input.setAttribute('aria-expanded', 'true');
      panel.classList.remove('hidden');
      list.innerHTML = results.map((result, i) => `<div id="search-option-${i}" class="search-option" role="option" aria-selected="false" data-search-index="${i}"><strong>${escape(result.title)}</strong><span>${escape(result.detail)}</span></div>`).join('');
      document.getElementById('searchNoResults').classList.toggle('hidden', results.length > 0);
      document.getElementById('searchHint').textContent = results.length ? 'Use ↑ ↓ and Enter, or choose a result.' : 'Try a task name, location, category, or feature such as “notifications”.';
      status.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'} and ${actions.length} action${actions.length === 1 ? '' : 's'} found.`;
    }
    function choose(index) {
      if (!isSignedIn() || !opened || !results[index]) return;
      const result = results[index];
      input.value = ''; close(); onQuery(''); result.run();
    }
    function highlight(index) {
      active = index;
      list.querySelectorAll('[role="option"]').forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
      const option = document.getElementById('search-option-' + active);
      if (option) { input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' }); }
    }
    input.oninput = () => { onQuery(input.value); refresh(); };
    input.onfocus = () => refresh();
    input.onblur = close;
    input.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') close();
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!opened) refresh();
        if (results.length) highlight(event.key === 'ArrowDown' ? (active + 1) % results.length : (active < 0 ? results.length - 1 : (active - 1 + results.length) % results.length));
      } else if (event.key === 'Enter' && opened && active >= 0) { event.preventDefault(); choose(active); }
    };
    // Keep the combobox focused until a mouse/touch selection has been handled.
    list.onpointerdown = event => { if (event.target.closest('[data-search-index]')) event.preventDefault(); };
    list.onclick = event => { const option = event.target.closest('[data-search-index]'); if (option) choose(Number(option.dataset.searchIndex)); };
    document.addEventListener('click', event => { if (!event.target.closest?.('#searchWrap')) close(); });
    return { refresh, close, reset() { input.value = ''; close(); } };
  }
  root.TaskSearch = { init, matchesTask };
})(globalThis);
