/* Tema interno: sigue la apariencia del sistema, sin controles visibles. */
(() => {
  'use strict';

  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const dark = systemTheme.matches;
    const root = document.documentElement;

    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.content = dark ? '#1c1c1e' : '#ffffff';
    }
  }

  applyTheme();

  if (systemTheme.addEventListener) {
    systemTheme.addEventListener('change', applyTheme);
  } else {
    systemTheme.addListener(applyTheme);
  }
})();
