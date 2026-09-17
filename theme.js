/* Apply the saved theme before the page paints, independently of sign-in. */
(function (root) {
  'use strict';
  const key = 'easy-reminder:theme';
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const valid = value => value === 'dark' || value === 'light';
  let preference = null;
  try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch (_) {}
  function apply() {
    const dark = preference ? preference === 'dark' : Boolean(system?.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    for (const id of ['themeToggle', 'loginThemeToggle']) {
      const button = document.getElementById(id);
      if (button) { button.textContent = 'Dark theme'; button.setAttribute('aria-pressed', String(dark)); }
    }
  }
  function set(theme) {
    if (!valid(theme)) return;
    preference = theme;
    try { localStorage.setItem(key, theme); } catch (_) {}
    apply();
  }
  function init() {
    for (const id of ['themeToggle', 'loginThemeToggle']) {
      const button = document.getElementById(id);
      if (button) button.onclick = () => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    }
    apply();
  }
  system?.addEventListener?.('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null; apply();
  });
  root.AppTheme = { set };
  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(globalThis);
