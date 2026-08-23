// byanca
(() => {
  'use strict';

  if (window.__ephDiagnosticsV16) return;
  window.__ephDiagnosticsV16 = true;

  const api = window.easyPeasyHammer;
  const captured = [];
  const MAX = 5000;
  const originals = {};
  let renderTimer = null;

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = 'diagnostics-v16.css';
  document.head.appendChild(style);

  const textOf = value => {
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };

  function record(level, args, source = 'console') {
    const message = [...args].map(textOf).join(' ');
    if (!message) return;
    captured.push({ at: Date.now(), level, source, message });
    if (captured.length > MAX) captured.splice(0, captured.length - MAX);
    if (dialog?.open) scheduleRender();
  }

  for (const method of ['log', 'info', 'warn', 'error']) {
    originals[method] = console[method].bind(console);
    console[method] = (...args) => {
      record(method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'normal', args, 'console');
      originals[method](...args);
    };
  }

  window.addEventListener('error', event => record('error', [event.error || `${event.message} @ ${event.filename || ''}:${event.lineno || 0}`], 'window'));
  window.addEventListener('unhandledrejection', event => record('error', [event.reason || 'Unhandled promise rejection'], 'promise'));

  const dialog = document.createElement('dialog');
  dialog.id = 'ephDiagnosticsDialog';
  dialog.className = 'eph-diagnostics-dialog';
  dialog.innerHTML = `
    <div class="eph-diagnostics-shell">
      <div class="eph-diagnostics-header">
        <div><strong>Logs</strong><span>Paste these logs to a developer when something breaks.</span></div>
        <button id="ephDiagnosticsClose" type="button" title="Close">×</button>
      </div>
      <div id="ephDiagnosticsSummary" class="eph-diagnostics-summary"></div>
      <div id="ephDiagnosticsList" class="eph-diagnostics-list"></div>
      <div class="eph-diagnostics-actions">
        <button id="ephDiagnosticsClear" type="button">Clear captured logs</button>
        <button id="ephDiagnosticsCopy" type="button" class="primary">Copy logs to paste</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const list = dialog.querySelector('#ephDiagnosticsList');
  const summary = dialog.querySelector('#ephDiagnosticsSummary');

  function appRecords() {
    const rows = [];
    try {
      for (const item of S?.logs || []) {
        rows.push({ at: 0, displayTime: item.time || '', level: item.kind === 'warning' ? 'warning' : item.kind === 'error' ? 'error' : 'normal', source: 'editor', message: String(item.message || '') });
      }
    } catch {}
    return rows;
  }

  function allRecords() {
    const output = [];
    const seen = new Set();
    for (const item of [...appRecords(), ...captured]) {
      const key = `${item.displayTime || Math.floor((item.at || 0) / 1000)}|${item.level}|${item.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(item);
    }
    return output.slice(-MAX);
  }

  function environmentText() {
    const map = S?.project?.vmapPath || 'No map open';
    const stream = window.EPH_LARGE_STREAM?.state?.();
    let gpu = '';
    try {
      const gl = S?.viewport?.renderer?.getContext?.();
      const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter?.(gl.RENDERER) || '';
    } catch {}
    return [
      `Map: ${map}`,
      `Objects in editor: ${Number(S?.objects?.length || 0).toLocaleString()}`,
      stream?.active ? `Streamed map: ${stream.loaded} resident / ${stream.entries} indexed (${stream.pending} pending)` : 'Streamed map: no',
      gpu ? `GPU: ${gpu}` : '',
    ].filter(Boolean).join('\n');
  }

  function render() {
    if (!dialog.open) return;
    summary.textContent = environmentText();
    const rows = allRecords();
    const pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'eph-log-empty';
      empty.textContent = 'No logs yet.';
      list.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of rows) {
      const row = document.createElement('div');
      row.className = `eph-log-row ${item.level === 'warning' ? 'warning' : item.level === 'error' ? 'error' : 'normal'}`;
      const time = item.displayTime || (item.at ? new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
      row.textContent = `${time ? `[${time}] ` : ''}${item.message}`;
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
    if (pinned) list.scrollTop = list.scrollHeight;
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 120);
  }

  function reportText() {
    return [
      'EasyPeasyHammer diagnostic log',
      new Date().toISOString(),
      environmentText(),
      '',
      ...allRecords().map(item => {
        const time = item.displayTime || (item.at ? new Date(item.at).toISOString() : '');
        return `${time ? `[${time}] ` : ''}${String(item.level || 'normal').toUpperCase()}: ${item.message}`;
      }),
    ].join('\n');
  }

  function open() {
    if (!dialog.open) dialog.showModal();
    render();
  }

  dialog.querySelector('#ephDiagnosticsClose').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.querySelector('#ephDiagnosticsClear').onclick = () => { captured.length = 0; try { S.logs = []; renderBottom?.(); } catch {} render(); };
  dialog.querySelector('#ephDiagnosticsCopy').onclick = async () => {
    try { await api?.copyText?.(reportText()); toast?.('Logs copied — paste them to a developer'); }
    catch { toast?.('Could not copy logs'); }
  };

  const viewMenu = document.getElementById('viewMenu');
  if (viewMenu && !document.getElementById('ephOpenDiagnostics')) {
    const button = document.createElement('button');
    button.id = 'ephOpenDiagnostics';
    button.type = 'button';
    button.textContent = 'Logs';
    button.onclick = () => { closeMenus?.(); open(); };
    viewMenu.appendChild(button);
  }

  window.EPH_DIAGNOSTICS = { open, record, copy: () => api?.copyText?.(reportText()), text: reportText };
})();
