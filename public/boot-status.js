// Runs before body parsing and the module graph. Read the existing preferences,
// never a separate startup cache; React keeps writing these same storage keys.
;(() => {
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const storedTheme = read('vaporlensdb.theme');
  const theme = ['light', 'dark', 'system'].includes(storedTheme) ? storedTheme : 'system';
  const language = read('vaporlensdb.language') === 'en' ? 'en' : 'zh';
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = root.dataset.theme;
  root.lang = language;

  try {
    const settings = JSON.parse(read('vaporlensdb.settings') || '{}');
    const width = Number(settings?.sidebarWidth);
    root.style.setProperty('--startup-sidebar-width', `${Number.isFinite(width) ? Math.min(460, Math.max(232, width)) : 288}px`);
    root.dataset.sidebarCollapsed = String(settings?.sidebarCollapsed === true);
  } catch { /* Defaults match the workspace when preferences are unavailable. */ }

  // Fire and forget: appearance hint for native creation on the next launch.
  // The existing localStorage preference remains authoritative on every boot.
  if (window.__TAURI_INTERNALS__?.invoke) {
    void window.__TAURI_INTERNALS__.invoke('sync_window_appearance', { theme, dark })
      .catch(error => console.warn('Unable to synchronize window theme', error));
  }

  let failed = false;
  const updateStatus = () => {
    const status = document.getElementById('startup-status');
    const message = document.getElementById('startup-message');
    if (!status || !message) return false;
    status.dataset.state = failed ? 'error' : 'loading';
    status.setAttribute('aria-busy', String(!failed));
    status.setAttribute('role', failed ? 'alert' : 'status');
    message.textContent = failed
      ? (language === 'en' ? 'Unable to load the workspace. Close and reopen VaporLensDB.' : '无法加载工作区，请关闭并重新打开 VaporLensDB。')
      : (language === 'en' ? 'Loading...' : '加载中...');
    return true;
  };
  // The head script sees the placeholder as the parser creates it; do not wait
  // for DOMContentLoaded, which can wait for the entire module graph.
  const observer = new MutationObserver(() => { if (updateStatus()) observer.disconnect(); });
  observer.observe(root, { childList: true, subtree: true });
  const fail = () => { failed = true; updateStatus(); };
  window.addEventListener('error', event => {
    // A missing image/icon or a browser ResizeObserver notification does not
    // mean the application entry failed. Module and stylesheet failures do.
    const tag = event.target?.tagName?.toLowerCase();
    if (tag && tag !== 'script' && !(tag === 'link' && event.target.rel === 'stylesheet')) return;
    if (/^ResizeObserver loop/.test(event.message || '')) return;
    fail();
  }, true);
  window.addEventListener('unhandledrejection', fail);
})();
