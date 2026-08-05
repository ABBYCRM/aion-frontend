// app-brain-signal.js
// Visual signal: main AION is talking to Aion-Brain.
// Drop into aion-frontend next to app-core.js. Load AFTER app-core.js, BEFORE app-boot.js.
//
// Depends on globals from app-core.js: dom, state, apiFetch, showToast (optional)
// Adds:
//   - Topbar pill #brainSignal
//   - Poll GET /api/brain/status
//   - SSE handler for type:"brain"
//   - Per-message Brain badge when assistant.brain was active

(function () {
  'use strict';

  const POLL_MS = 15000;

  function ensurePill() {
    if (document.getElementById('brainSignal')) return document.getElementById('brainSignal');
    const host = document.getElementById('connectionStatus')?.parentElement
      || document.querySelector('.topbar');
    if (!host) return null;
    const el = document.createElement('span');
    el.id = 'brainSignal';
    el.className = 'brain-signal checking';
    el.setAttribute('aria-live', 'polite');
    el.title = 'AION ↔ Aion-Brain link';
    el.innerHTML = '<span class="brain-dot" aria-hidden="true"></span><span class="brain-label">BRAIN …</span>';
    // Insert before connection status if possible
    const conn = document.getElementById('connectionStatus');
    if (conn && conn.parentElement === host) host.insertBefore(el, conn);
    else host.appendChild(el);
    return el;
  }

  function setPill(status, detail) {
    const el = ensurePill();
    if (!el) return;
    const label = el.querySelector('.brain-label');
    el.classList.remove('active', 'down', 'disabled', 'checking');
    const s = String(status || 'checking').toLowerCase();
    if (s === 'active' || s === 'reachable' || s === 'ok') {
      el.classList.add('active');
      if (label) label.textContent = detail?.latency_ms != null
        ? `BRAIN ${detail.latency_ms}ms`
        : 'BRAIN';
      el.title = 'AION is linked to Aion-Brain'
        + (detail?.version ? ` · ${detail.version}` : '')
        + (detail?.last_decision ? ` · last ${detail.last_decision}` : '');
    } else if (s === 'down' || s === 'error') {
      el.classList.add('down');
      if (label) label.textContent = 'BRAIN DOWN';
      el.title = detail?.error || 'Aion-Brain unreachable';
    } else if (s === 'disabled' || s === 'skipped') {
      el.classList.add('disabled');
      if (label) label.textContent = 'BRAIN OFF';
      el.title = 'Aion-Brain disabled on this backend';
    } else {
      el.classList.add('checking');
      if (label) label.textContent = 'BRAIN …';
      el.title = 'Checking Aion-Brain link…';
    }
  }

  async function probeBrain() {
    setPill('checking');
    try {
      // Prefer dedicated probe; fall back to continuity-pack if probe missing
      let r = await apiFetch('/api/brain/status');
      if (r.status === 404) {
        // Older backend: treat successful continuity-pack as "unknown brain"
        r = await apiFetch('/api/continuity-pack');
        if (r.ok) {
          setPill('disabled', { error: 'no /api/brain/status on backend yet' });
          return;
        }
        throw new Error('probe failed');
      }
      const body = await r.json().catch(() => ({}));
      const brain = body.brain || body;
      if (!r.ok) {
        setPill('down', { error: body.detail || body.error || r.statusText });
        return;
      }
      if (brain.enabled === false) {
        setPill('disabled');
        return;
      }
      if (brain.reachable === false) {
        setPill('down', { error: brain.error || 'unreachable', latency_ms: brain.latency_ms });
        return;
      }
      setPill('active', {
        latency_ms: brain.latency_ms,
        version: brain.version,
        last_decision: brain.last_decision,
      });
    } catch (e) {
      setPill('down', { error: e.message || 'probe error' });
    }
  }

  /** Call from SSE loop when event.type === 'brain' */
  function onBrainEvent(event) {
    if (!event || typeof event !== 'object') return;
    const status = event.status || (event.ok === false ? 'down' : 'active');
    setPill(status, {
      latency_ms: event.latency_ms,
      error: event.error,
    });
    // Stash on state for the in-flight assistant message
    if (typeof state !== 'undefined') {
      state.lastBrain = {
        status,
        latency_ms: event.latency_ms || null,
        at: Date.now(),
      };
    }
  }

  /** Attach brain info onto assistant message object during SSE */
  function tagAssistantFromBrain(assistant) {
    if (!assistant || typeof state === 'undefined' || !state.lastBrain) return;
    assistant.brain = { ...state.lastBrain };
  }

  /** Render helper: returns a badge node if message used Brain */
  function brainBadge(message) {
    if (!message?.brain || message.brain.status !== 'active') return null;
    const b = document.createElement('span');
    b.className = 'badge brain';
    b.textContent = message.brain.latency_ms != null
      ? `Brain ${message.brain.latency_ms}ms`
      : 'Brain';
    b.title = 'This turn was authorized/streamed via Aion-Brain';
    return b;
  }

  /** Patch: after connection healthCheck, also probe brain */
  function startPolling() {
    ensurePill();
    probeBrain();
    setInterval(probeBrain, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') probeBrain();
    });
  }

  // Expose for app-chat SSE switch + app-render message meta
  window.AION_BRAIN_SIGNAL = {
    onBrainEvent,
    tagAssistantFromBrain,
    brainBadge,
    probeBrain,
    setPill,
    startPolling,
  };

  // Auto-start when DOM ready AND apiFetch is defined.
  // apiFetch lives in app-chat-a.js which loads after us. If we
  // start polling too early, the first probe errors with
  // "apiFetch is not defined" (cosmetic only — pill just shows DOWN
  // for ~200ms then recovers on the next poll).
  function whenReady() {
    if (typeof window.apiFetch === 'function') {
      startPolling();
      return;
    }
    setTimeout(whenReady, 50);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', whenReady);
  } else {
    whenReady();
  }
})();
