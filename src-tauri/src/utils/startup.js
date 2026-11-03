// Only installed when VAPORLENSDB_STARTUP_TRACE points to a local log.
;(() => {
  const invoke = (...args) => window.__TAURI_INTERNALS__.invoke(...args);
  const seen = new Set();
  const pending = [];
  const flush = () => {
    if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
    for (const payload of pending.splice(0)) void invoke('startup_trace', payload).catch(() => {});
  };
  const mark = (stage, metrics = {}) => {
    if (seen.has(stage) && stage !== 'layout' && !stage.startsWith('perf_') && !stage.startsWith('ipc_')) return;
    seen.add(stage);
    const epochMs = performance.timeOrigin + performance.now();
    pending.push({ stage, epochMs, metrics });
    queueMicrotask(flush);
  };
  window.__vaporStartupMark = mark;
  mark('document_start');
  addEventListener('error', event => mark('window_error', {
    resizeObserver: /ResizeObserver loop/.test(event.message || '') ? 1 : 0,
    resource: event.target instanceof Element ? 1 : 0,
    image: event.target?.tagName === 'IMG' ? 1 : 0,
    script: event.target?.tagName === 'SCRIPT' ? 1 : 0,
    stylesheet: event.target?.tagName === 'LINK' && event.target.rel === 'stylesheet' ? 1 : 0,
  }), true);
  addEventListener('unhandledrejection', () => mark('promise_rejected'));
  let queued = false;
  const nativeSamples = new Set();
  const nativeTheme = stage => {
    if (nativeSamples.has(stage)) return;
    nativeSamples.add(stage);
    void invoke('plugin:window|theme', { label: 'main' })
      .then(theme => mark(stage, { dark: theme === 'dark' ? 1 : 0 })).catch(() => {});
  };
  const layout = () => {
    queued = false;
    const home = document.querySelector('.ide-workspace h1')?.closest('section');
    const cards = home?.querySelectorAll('section[aria-label] button') ?? [];
    const content = home?.getBoundingClientRect();
    if (document.getElementById('startup-status')) {
      mark('loading_interface');
      const shell = document.querySelector('.startup-shell');
      if (shell) mark('skeleton_layout', { top: shell.querySelector('.shell-top').getBoundingClientRect().height, sidebar: shell.querySelector('.shell-sidebar').getBoundingClientRect().width, content: shell.querySelector('.startup-workspace').getBoundingClientRect().width });
      nativeTheme('loading_native_theme');
    }
    let overflow = 0;
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      for (const span of card.querySelectorAll('span')) {
        const r = span.getBoundingClientRect();
        if (r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.top < box.top - 1) overflow++;
      }
    }
    mark('layout', { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, contentWidth: content?.width ?? 0, cardCount: cards.length, rows: new Set([...cards].map(card => Math.round(card.getBoundingClientRect().top))).size, overflow, dark: document.documentElement.dataset.theme === 'dark' ? 1 : 0, english: document.documentElement.lang === 'en' ? 1 : 0 });
    if (home && !document.querySelector('.app-splash-grid')) {
      mark('home_interactive', { width: innerWidth, contentWidth: content.width });
      nativeTheme('home_native_theme');
      requestAnimationFrame(() => mark('first_interface', { resources: performance.getEntriesByType('resource').length }));
    }
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(layout); } };
  // Opt-in frame probe distinguishes a missing entry placeholder from a
  // later React handoff. A rAF sample is not proof of physical screen paint.
  const probe = () => {
    const root = document.getElementById('root');
    if (root && !root.firstElementChild) mark('empty_root_frame');
    if (document.querySelector('.ide-top-bar')) { mark('react_shell_frame'); return; }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
  const observer = new MutationObserver(schedule);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  addEventListener('resize', schedule);
  addEventListener('DOMContentLoaded', () => { mark('dom_loaded'); schedule(); });
  // Numeric, opt-in interaction probes. No labels, field values, SQL, IDs or
  // credentials leave the renderer. Present-at-rAF is not physical screen paint.
  let interaction = 0, inputAt = 0, category = 0, sampleQueued = false;
  let previousFrame = 0, framesRemaining = 0, frameGaps = [];
  const sample = () => {
    sampleQueued = false;
    if (!interaction) return;
    mark('perf_frame', {
      interaction, category, latencyMs: performance.now() - inputAt,
      forms: document.querySelectorAll('.connection-form').length,
      cells: document.querySelectorAll('.data-grid-cell').length,
      columns: document.querySelectorAll('.data-grid-column').length,
      treeRows: document.querySelectorAll('[data-tree-row]').length,
      connections: document.querySelectorAll('[data-connection-id]').length,
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    });
  };
  const queueSample = () => {
    if (!sampleQueued) { sampleQueued = true; requestAnimationFrame(() => requestAnimationFrame(sample)); }
  };
  const frame = time => {
    if (previousFrame) frameGaps.push(time - previousFrame);
    previousFrame = time;
    if (--framesRemaining > 0) requestAnimationFrame(frame);
    else {
      frameGaps.sort((a, b) => a - b);
      mark('perf_frame_gaps', { interaction, category, count: frameGaps.length,
        medianMs: frameGaps[Math.floor(frameGaps.length / 2)] ?? 0,
        maxMs: frameGaps.at(-1) ?? 0 });
      previousFrame = 0; frameGaps = [];
    }
  };
  for (const [eventName, code] of [['click', 1], ['keydown', 2], ['input', 3], ['scroll', 4]]) {
    addEventListener(eventName, () => {
      interaction++; category = code; inputAt = performance.now();
      mark('perf_input', { interaction, category });
      queueSample();
      if (!framesRemaining) { framesRemaining = 30; requestAnimationFrame(frame); }
    }, { capture: true, passive: true });
  }
  new MutationObserver(queueSample).observe(document, { subtree: true, childList: true });
})();
