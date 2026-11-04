// Opt-in local lifecycle evidence. Never log field values, SQL, keys or raw errors.
;(() => {
  const pending = [];
  const seen = new Set();
  let sent = 0;
  const flush = () => {
    if (typeof window.__TAURI_INTERNALS__?.invoke !== 'function') return;
    for (const payload of pending.splice(0)) void window.__TAURI_INTERNALS__.invoke('startup_trace', payload).catch(() => {});
  };
  const mark = (stage, metrics = {}, details) => {
    if (sent >= 1200 || (seen.has(stage) && !stage.startsWith('perf_') && !stage.startsWith('ipc_'))) return;
    seen.add(stage); sent++;
    pending.push({ stage, epochMs: performance.timeOrigin + performance.now(), metrics, ...(details ? { details } : {}) });
    if (pending.length > 128) pending.shift();
    queueMicrotask(flush);
  };
  window.__vaporStartupMark = mark;
  const state = () => ({ hidden: document.visibilityState === 'hidden' ? 1 : 0, focused: document.hasFocus() ? 1 : 0 });
  mark('document_start', state());

  // All text fields below come from finite templates or bundled source positions.
  // Unknown messages are wholly redacted; regex-removing passwords alone cannot
  // guarantee that an arbitrary error did not echo SQL or editor/IME contents.
  const safeLocation = value => {
    if (typeof value !== 'string') return '[redacted location]';
    try {
      const url = new URL(value, location.href);
      const app = new URL(location.href);
      if (url.protocol !== app.protocol || url.host !== app.host || url.username || url.password) return '[external or opaque location]';
      const path = url.pathname;
      if (['/', '/index.html', '/boot-status.js', '/favicon.png', '/probe.html', '/probe.js'].includes(path) || /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,12}\.(js|css|svg|png|woff2|ttf)$/.test(path)) return `app:${path}`;
      return '[redacted app location]';
    } catch { return '[redacted location]'; }
  };
  const safeMessage = value => {
    if (typeof value !== 'string') return '[non-string message redacted]';
    if (/ResizeObserver loop/.test(value)) return 'ResizeObserver loop [details redacted]';
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(value)) return 'Dynamic module import failed [details redacted]';
    if (/not allowed|not permitted|permission denied/i.test(value)) return 'Operation not permitted [details redacted]';
    if (/is not a function/.test(value)) return 'Value is not a function [expression redacted]';
    if (/undefined is not an object|null is not an object|Cannot read properties of/.test(value)) return 'Cannot access null or undefined [expression redacted]';
    if (/is not defined/.test(value)) return 'Reference is not defined [expression redacted]';
    if (/^Load failed$|^Failed to fetch$|^NetworkError/.test(value)) return 'Network or resource load failed [details redacted]';
    if (/^Script error\.?$/.test(value)) return 'Script error [details unavailable]';
    return '[unknown message redacted]';
  };
  const names = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'DOMException', 'AbortError', 'SecurityError', 'NotAllowedError', 'InvalidStateError', 'NetworkError', 'UnknownError']);
  const elementNames = new Set(['img', 'image', 'svg', 'use', 'link', 'script', 'style', 'iframe', 'video', 'audio', 'source']);
  const safeStack = value => {
    if (typeof value !== 'string') return [];
    return value.split('\n').slice(0, 16).flatMap(line => {
      const match = line.match(/((?:tauri|https?):\/\/[^\s)]+?):(\d+):(\d+)\)?$/);
      if (!match) return [];
      return [`${safeLocation(match[1])}:${Number(match[2])}:${Number(match[3])}`];
    });
  };
  let errors = 0;
  const errorDetails = (kind, reason, resource, filename, line = 0, column = 0) => {
    const name = typeof reason?.name === 'string' && names.has(reason.name) ? reason.name : '[redacted type]';
    return { kind, name, element: 'none', locationClass: 'unknown', message: kind === 'resource' ? 'Resource failed to load [details redacted]' : safeMessage(typeof reason === 'string' ? reason : reason?.message),
      location: safeLocation(resource || filename), line: Number(line) || 0, column: Number(column) || 0, stack: safeStack(reason?.stack) };
  };
  addEventListener('error', event => {
    if (++errors > 20) return;
    const resource = event.target instanceof Element ? event.target : null;
    const href = resource?.currentSrc || resource?.src || resource?.href;
    const url = typeof href === 'string' ? href : typeof href?.baseVal === 'string' ? href.baseVal : undefined;
    const details = errorDetails(resource ? 'resource' : 'javascript', event.error || { message: event.message }, url, event.filename, event.lineno, event.colno);
    if (resource) {
      const tag = resource.localName || resource.tagName?.toLowerCase();
      details.element = elementNames.has(tag) ? tag : 'other';
      try {
        if (!url) throw new TypeError();
        const parsed = new URL(url, location.href), app = new URL(location.href);
        details.locationClass = parsed.protocol === app.protocol && parsed.host === app.host ? 'app' : ['data:', 'blob:'].includes(parsed.protocol) ? parsed.protocol.slice(0, -1) : 'external';
      } catch { /* Only the finite unknown classification is logged. */ }
    }
    mark('perf_error', { resource: resource ? 1 : 0, image: resource?.tagName === 'IMG' ? 1 : 0, script: resource?.tagName === 'SCRIPT' ? 1 : 0, stylesheet: resource?.tagName === 'LINK' && resource.rel === 'stylesheet' ? 1 : 0, icon: resource?.tagName === 'LINK' && /icon/.test(resource.rel) ? 1 : 0 }, details);
  }, true);
  addEventListener('unhandledrejection', event => {
    if (++errors <= 20) mark('perf_error', { rejection: 1 }, errorDetails('promise', event.reason));
  });

  // No perpetual frame loop. Each event requests at most one rAF, carries its
  // own immutable request ID, and is capped while hidden. Callback gaps are not
  // click latency or proof that pixels reached the screen.
  let request = 0, outstanding = 0;
  const requestFrame = category => {
    if (outstanding >= 8) return;
    const id = ++request;
    outstanding++;
    mark('perf_raf_requested', { request: id, category, ...state() });
    requestAnimationFrame(() => {
      outstanding--;
      mark('perf_frame', { request: id, category, ...state() });
    });
  };
  for (const [code, name] of ['visibilitychange', 'focus', 'blur', 'pageshow', 'pagehide', 'freeze', 'resume'].entries()) {
    addEventListener(name, event => {
      mark('perf_visibility', { event: code + 1, persisted: event.persisted ? 1 : 0, ...state() });
      requestFrame(code + 10);
    }, true);
  }
  let interaction = 0;
  for (const [name, code] of [['pointerdown', 1], ['click', 2], ['keydown', 3]]) {
    addEventListener(name, event => {
      const target = event.target;
      mark('perf_input', { interaction: ++interaction, category: code, ...state(),
        editable: target?.matches?.('input,textarea,[contenteditable="true"]') ? 1 : 0,
        draft: target?.dataset?.sqlLoadingDraft ? 1 : 0,
        newSql: name === 'keydown' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key?.toLowerCase() === 'n' ? 1 : 0 });
      requestFrame(code);
    }, { capture: true, passive: true });
  }
  // Bounded boot-only observer. Disconnect at shell commit; no ongoing DOM
  // traversal on Monaco mutations, table scroll or result streaming.
  let bootQueued = false;
  const bootObserver = new MutationObserver(() => {
    if (bootQueued) return;
    bootQueued = true;
    queueMicrotask(() => {
      bootQueued = false;
      if (document.querySelector('.ide-top-bar')) {
        mark('shell_committed', state());
        bootObserver.disconnect();
        requestAnimationFrame(() => { mark('react_shell_frame', state()); mark('first_interface', state()); });
      }
    });
  });
  bootObserver.observe(document, { subtree: true, childList: true });
  addEventListener('DOMContentLoaded', () => { mark('dom_loaded', state()); flush(); requestFrame(20); });

  // Explicit experimental gate only; never a product workaround or fixed delay.
  // A real input/composition event releases the selected first-loading boundary.
  // Allows IME readiness overlap to be proved rather than inferred from speed.
  const config = window.__vaporDiagnosticGateConfig;
  if (typeof config === 'string') {
    const [phase, trigger] = config.split('-');
    let resolveGate, used = false, released = false;
    window.__vaporDiagnosticEditorGate = name => {
      if (name !== phase || used) return undefined;
      used = true;
      if (released) return undefined;
      mark('perf_editor_gate', { phase: phase === 'workspace' ? 1 : 2, waiting: 1, composition: trigger === 'composition' ? 1 : 0 });
      return new Promise(resolve => { resolveGate = resolve; });
    };
    addEventListener(trigger === 'composition' ? 'compositionstart' : 'input', event => {
      if (released || event.target?.dataset?.sqlLoadingDraft !== phase) return;
      released = true;
      mark('perf_editor_gate', { phase: phase === 'workspace' ? 1 : 2, waiting: 0, composition: trigger === 'composition' ? 1 : 0 });
      resolveGate?.(); resolveGate = null;
    }, true);
  }
  let editorEvents = 0;
  for (const [code, name] of ['focusin', 'focusout', 'beforeinput', 'input', 'compositionstart', 'compositionend', 'select'].entries()) {
    addEventListener(name, event => {
      const target = event.target;
      const phase = target?.dataset?.sqlLoadingDraft;
      if (!phase || ++editorEvents > 120) return;
      mark('perf_editor_input', { event: code + 1, phase: phase === 'workspace' ? 1 : 2,
        length: target.value.length, start: target.selectionStart, end: target.selectionEnd,
        composing: event.isComposing ? 1 : 0, focused: document.activeElement === target ? 1 : 0 });
    }, true);
  }
})();
