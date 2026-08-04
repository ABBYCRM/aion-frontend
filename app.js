/* =============================================================
   AION — Frontend client
   Streaming chat, history, TTS, voice input, file upload,
   per-message + thread download, PWA install.
   ============================================================= */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  const STORAGE_KEY = 'aion.conversations.v1';
  const SETTINGS_KEY = 'aion.settings.v1';
  const API_BASE_KEY = 'aion.apiBase.v1';
  // Default: the AION backend on DigitalOcean.
  // Override at runtime by setting localStorage['aion.apiBase.v1'] = 'https://api.your-domain.com'
  // — or via the Settings panel.
  const DEFAULT_API_BASE = 'https://aion-backend-v2-jszgl.ondigitalocean.app';
  const MAX_TITLE = 60;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB per file
  const ACCEPTED_FILES = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'text/plain', 'text/markdown', 'text/csv',
    'application/json',
    'application/pdf',
  ];

  function apiBase() {
    try {
      const v = localStorage.getItem(API_BASE_KEY);
      if (v && /^https?:\/\//.test(v)) return v.replace(/\/+$/, '');
    } catch (e) { /* ignore */ }
    return DEFAULT_API_BASE;
  }
  function apiUrl(path) {
    return apiBase() + path;
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  const state = {
    conversations: [],   // [{id, title, createdAt, updatedAt, messages: [{role, content, parts?, decision?, model?, ts, attachments?}]}]
    activeId: null,
    streaming: null,     // AbortController
    settings: {
      temperature: 0.7,
      maxTokens: 2048,
      autoTts: false,
      voiceName: '',
      voiceRate: 1.0,
    },
    models: { primary: '', chain: [], providers: {} },
    recognition: null,
    tts: { speaking: false, utterance: null },
    pendingAttachments: [],  // [{name, size, type, kind, dataUrl?, text?}]
  };

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'),
    sidebar: $('sidebar'),
    messages: $('messages'),
    composer: $('composer'),
    prompt: $('prompt'),
    sendBtn: $('sendBtn'),
    stopBtn: $('stopBtn'),
    micBtn: $('micBtn'),
    ttsBtn: $('ttsBtn'),
    newChatBtn: $('newChatBtn'),
    openSidebarBtn: $('openSidebarBtn'),
    closeSidebarBtn: $('closeSidebarBtn'),
    convList: $('conversationList'),
    kernelBtn: $('kernelBtn'),
    kernelPanel: $('kernelPanel'),
    kernelBody: $('kernelBody'),
    settingsBtn: $('settingsBtn'),
    settingsPanel: $('settingsPanel'),
    attachBtn: $('attachBtn'),
    attachments: $('attachments'),
    tempRange: $('tempRange'),
    tempValue: $('tempValue'),
    maxTokensRange: $('maxTokensRange'),
    maxTokensValue: $('maxTokensValue'),
    voiceSelect: $('voiceSelect'),
    rateRange: $('rateRange'),
    rateValue: $('rateValue'),
    autoTts: $('autoTts'),
    clearAllBtn: $('clearAllBtn'),
    apiBaseInput: $('apiBaseInput'),
    connectionDot: $('connectionDot'),
    modelName: $('modelName'),
    decisionBadge: $('decisionBadge'),
    toast: $('toast'),
  };

  // ------------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------------
  function loadConversations() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (e) { /* ignore */ }
    return [];
  }
  function saveConversations() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations)); }
    catch (e) { console.warn('save failed', e); }
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); }
    catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const now = () => Date.now();
  function formatModelLabel(provider, model, short = false) {
    if (!model) return provider || '';
    // Avoid double provider prefix when model id already starts with provider/
    if (model.startsWith(`${provider}/`)) {
      return short ? model.split('/').pop() : model;
    }
    return short ? model.split('/').pop() : `${provider}/${model}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg, ms = 2400) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { dom.toast.hidden = true; }, ms);
  }

  function activeConv() {
    return state.conversations.find(c => c.id === state.activeId) || null;
  }

  function newConversation() {
    const conv = {
      id: uid('conv'),
      title: 'New chat',
      createdAt: now(),
      updatedAt: now(),
      messages: [],
    };
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    saveConversations();
    return conv;
  }

  function deleteConversation(id) {
    const idx = state.conversations.findIndex(c => c.id === id);
    if (idx < 0) return;
    state.conversations.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = state.conversations[0]?.id || null;
    }
    if (state.conversations.length === 0) newConversation();
    saveConversations();
    renderAll();
  }

  function clearAllConversations() {
    if (!confirm('Delete all conversations? This cannot be undone.')) return;
    state.conversations = [];
    newConversation();
    showToast('All conversations cleared');
  }

  // ------------------------------------------------------------------
  // Markdown + code-block rendering (minimal, no external deps)
  // ------------------------------------------------------------------
  function renderMarkdown(src) {
    if (!src) return '';
    let s = escapeHtml(src);

    // fenced code blocks
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const safe = code.replace(/<\/code>/g, '&lt;/code&gt;');
      return `<pre><button class="copy-btn" data-copy>copy</button><code class="lang-${lang || 'text'}">${safe}</code></pre>`;
    });
    // inline code
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // bold / italic
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<em>$2</em>');
    // headings
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // lists
    s = s.replace(/(^|\n)((?:- .+(?:\n|$))+)/g, (m, pre, block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^- /, '')}</li>`).join('');
      return `${pre}<ul>${items}</ul>`;
    });
    s = s.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (m, pre, block) => {
      const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
      return `${pre}<ol>${items}</ol>`;
    });
    // blockquote
    s = s.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // paragraphs (split on blank lines)
    s = s.split(/\n{2,}/).map(p => {
      p = p.trim();
      if (!p) return '';
      if (/^<(h\d|ul|ol|pre|blockquote|table)/.test(p)) return p;
      return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
    }).join('\n');
    return s;
  }

  // ------------------------------------------------------------------
  // Sidebar
  // ------------------------------------------------------------------
  function renderSidebar() {
    dom.convList.innerHTML = '';
    if (state.conversations.length === 0) {
      newConversation();
    }
    for (const conv of state.conversations) {
      const el = document.createElement('div');
      el.className = 'conv-item' + (conv.id === state.activeId ? ' active' : '');
      el.dataset.id = conv.id;
      el.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="conv-title"></span>
        <button class="conv-del" title="Delete conversation" aria-label="Delete conversation">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      `;
      el.querySelector('.conv-title').textContent = conv.title || 'New chat';
      el.addEventListener('click', (e) => {
        if (e.target.closest('.conv-del')) return;
        state.activeId = conv.id;
        renderAll();
      });
      el.querySelector('.conv-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${conv.title || 'New chat'}"?`)) {
          deleteConversation(conv.id);
        }
      });
      dom.convList.appendChild(el);
    }
  }

  // ------------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------------
  function renderMessages() {
    const conv = activeConv();
    dom.messages.innerHTML = '';
    if (!conv || conv.messages.length === 0) {
      renderWelcome();
      return;
    }
    const inner = document.createElement('div');
    inner.className = 'messages-inner';
    for (const m of conv.messages) inner.appendChild(renderMessage(m));
    dom.messages.appendChild(inner);
    scrollToBottom();
  }

  function renderWelcome() {
    const w = document.createElement('div');
    w.className = 'welcome';
    w.innerHTML = `
      <h1>AION</h1>
      <p>Adaptive Intelligence Operating Nexus. Ask anything. I commit to evidence, defer what's uncertain, and reject what violates the kernel.</p>
      <div class="suggestions">
        <button class="suggestion" data-suggest="Explain how the AION kernel's 7 laws apply to a credit decision in plain English.">How the 7 laws apply to a credit decision</button>
        <button class="suggestion" data-suggest="Write a Python function that signs an HTTP request with HMAC-SHA256 and verify it in tests.">HMAC-SHA256 request signing in Python</button>
        <button class="suggestion" data-suggest="Plan a 14-day launch for an agentic runtime: backend, frontend, deploy, and observability.">14-day launch plan for an agentic runtime</button>
        <button class="suggestion" data-suggest="Compare streaming chat over SSE vs WebSocket for an LLM UI. Pick one and justify it.">SSE vs WebSocket for LLM streaming</button>
      </div>
    `;
    dom.messages.appendChild(w);
    w.querySelectorAll('.suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        dom.prompt.value = btn.dataset.suggest;
        autosize();
        dom.prompt.focus();
      });
    });
  }

  function renderMessage(m) {
    const el = document.createElement('div');
    el.className = 'msg ' + m.role + (m.streaming ? ' streaming' : '');
    el.dataset.id = m.id;
    const avatar = m.role === 'user' ? 'YOU' : 'A';
    el.innerHTML = `
      <div class="avatar">${escapeHtml(avatar)}</div>
      <div class="body">
        <div class="author">${m.role === 'user' ? 'You' : 'AION'}</div>
        <div class="content">${renderMarkdown(m.content || '')}${m.role === 'assistant' && m.streaming ? '<span class="cursor"></span>' : ''}</div>
        <div class="meta"></div>
        <div class="actions"></div>
      </div>
    `;
    const meta = el.querySelector('.meta');
    if (m.role === 'assistant') {
      if (m.decision) {
        const cls = (m.decision.state || '').toLowerCase();
        meta.insertAdjacentHTML('beforeend', `<span class="badge ${cls}">${escapeHtml(m.decision.state)}</span>`);
      }
      if (m.model) {
        meta.insertAdjacentHTML('beforeend', `<span class="badge model">${escapeHtml(m.model)}</span>`);
      }
      if (m.errors && m.errors.length) {
        meta.insertAdjacentHTML('beforeend', `<span class="badge" title="${escapeHtml(m.errors.map(e => `${e.model}: ${e.kind}`).join(' | '))}">↻ ${m.errors.length} failover</span>`);
      }
      if (m.usage && m.usage.total_tokens) {
        meta.insertAdjacentHTML('beforeend', `<span>${m.usage.total_tokens} tok</span>`);
      }
      if (m.latency_ms) {
        meta.insertAdjacentHTML('beforeend', `<span>${(m.latency_ms / 1000).toFixed(1)}s</span>`);
      }
    } else if (m.role === 'user' && m.attachments && m.attachments.length) {
      const names = m.attachments.map(a => a.name).join(', ');
      meta.insertAdjacentHTML('beforeend', `<span>📎 ${escapeHtml(names)}</span>`);
    }
    if (m.ts) {
      const t = new Date(m.ts);
      meta.insertAdjacentHTML('beforeend', `<span>${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>`);
    }
    const actions = el.querySelector('.actions');
    const copyBtn = makeActionBtn('Copy', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>', () => {
      navigator.clipboard.writeText(m.content || '').then(() => showToast('Copied'));
    });
    const dlBtn = makeActionBtn('Download', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>', () => {
      downloadMessage(m);
    });
    const speakBtn = makeActionBtn('Speak', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>', () => {
      speak(m.content || '');
    });
    const delBtn = makeActionBtn('Delete', '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>', () => {
      const conv = activeConv();
      if (!conv) return;
      const idx = conv.messages.findIndex(x => x.id === m.id);
      if (idx >= 0) {
        conv.messages.splice(idx, 1);
        saveConversations();
        renderMessages();
        showToast('Message deleted');
      }
    });
    actions.append(copyBtn, dlBtn, speakBtn, delBtn);
    el.querySelectorAll('pre .copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.parentElement.querySelector('code');
        navigator.clipboard.writeText(code.textContent).then(() => {
          btn.textContent = 'copied';
          setTimeout(() => { btn.textContent = 'copy'; }, 1200);
        });
      });
    });
    return el;
  }

  function makeActionBtn(label, svg, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg + `<span>${label}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  function scrollToBottom(smooth = true) {
    dom.messages.scrollTo({ top: dom.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ------------------------------------------------------------------
  // File upload
  // ------------------------------------------------------------------
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }
  async function pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = ACCEPTED_FILES.join(',');
      // race the change event against a short timeout so headless browsers
      // (and users who cancel) don't hang the whole send flow.
      let done = false;
      const finish = (files) => { if (!done) { done = true; resolve(files); } };
      input.onchange = () => finish(Array.from(input.files || []));
      setTimeout(() => finish([]), 250);
      try { input.click(); } catch { finish([]); }
    });
  }
  async function attachmentsToContentParts(text, attachments) {
    const parts = [{ type: 'text', text: text || '' }];
    for (const a of attachments || []) {
      if (a.kind === 'image') {
        parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      } else {
        // text-based attachment → embed as a fenced block in the text part
        parts[0].text += `\n\n--- ${a.name} ---\n${a.text}\n--- end ${a.name} ---`;
      }
    }
    return parts;
  }
  async function ingestFiles(files) {
    const out = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        showToast(`Skipped ${f.name}: >10MB`); continue;
      }
      if (!ACCEPTED_FILES.includes(f.type) && !f.type.startsWith('text/')) {
        showToast(`Skipped ${f.name}: unsupported type ${f.type}`); continue;
      }
      const isImage = f.type.startsWith('image/');
      const att = { name: f.name, size: f.size, type: f.type, kind: isImage ? 'image' : 'text' };
      if (isImage) {
        att.dataUrl = await readFileAsDataURL(f);
      } else {
        att.text = await readFileAsText(f);
        if (att.text.length > 200_000) {
          att.text = att.text.slice(0, 200_000) + '\n\n[...truncated...]';
        }
      }
      out.push(att);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Streaming chat
  // ------------------------------------------------------------------
  async function addPendingFiles() {
    const files = await pickFiles();
    if (!files || files.length === 0) return;
    const ingested = await ingestFiles(files);
    state.pendingAttachments.push(...ingested);
    renderPendingAttachments();
    autosize();
  }
  function renderPendingAttachments() {
    if (!dom.attachments) return;
    if (state.pendingAttachments.length === 0) {
      dom.attachments.hidden = true;
      dom.attachments.innerHTML = '';
      return;
    }
    dom.attachments.hidden = false;
    dom.attachments.innerHTML = state.pendingAttachments.map((a, i) => `
      <span class="att-chip" data-i="${i}">
        <span class="att-icon">${a.kind === 'image' ? '🖼' : '📄'}</span>
        <span class="att-name"></span>
        <span class="att-size"></span>
        <button type="button" class="att-rm" data-rm="${i}" aria-label="Remove attachment">×</button>
      </span>
    `).join('');
    dom.attachments.querySelectorAll('.att-chip').forEach((el, i) => {
      const a = state.pendingAttachments[i];
      el.querySelector('.att-name').textContent = a.name;
      el.querySelector('.att-size').textContent = humanSize(a.size);
    });
    dom.attachments.querySelectorAll('.att-rm').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.rm);
        state.pendingAttachments.splice(i, 1);
        renderPendingAttachments();
        autosize();
      });
    });
  }
  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function sendMessage() {
    if (state.streaming) return;
    const conv = activeConv() || newConversation();
    const text = dom.prompt.value.trim();
    const attachments = state.pendingAttachments.slice();
    if (!text && attachments.length === 0) return;

    // build user message — multimodal if attachments present
    const userMsg = {
      id: uid('msg'),
      role: 'user',
      content: text || '(attachment)',
      parts: attachments.length ? await attachmentsToContentParts(text, attachments) : null,
      attachments: attachments.length ? attachments.map(a => ({ name: a.name, size: a.size, type: a.type, kind: a.kind })) : null,
      ts: now(),
    };
    conv.messages.push(userMsg);
    dom.prompt.value = '';
    state.pendingAttachments = [];
    renderPendingAttachments();
    autosize();

    // auto-title
    if (conv.messages.length === 1) {
      conv.title = (text || attachments[0]?.name || 'New chat').slice(0, MAX_TITLE);
    }
    conv.updatedAt = now();

    // placeholder assistant message
    const asstMsg = {
      id: uid('msg'),
      role: 'assistant',
      content: '',
      decision: null,
      model: null,
      ts: now(),
      streaming: true,
    };
    conv.messages.push(asstMsg);
    saveConversations();
    renderSidebar();
    renderMessages();

    // start stream — apply the .streaming class to the DOM element
    state.streaming = new AbortController();
    dom.sendBtn.hidden = true;
    dom.stopBtn.hidden = false;
    dom.decisionBadge.hidden = true;
    setConn('warn');
    const asstEl = dom.messages.querySelector(`.msg[data-id="${asstMsg.id}"]`);
    if (asstEl) asstEl.classList.add('streaming');

    try {
      // Build wire payload from conversation history (strip client-only fields)
      const wire = conv.messages
        .filter(m => m.id !== asstMsg.id)
        .slice(-30) // last 30 turns
        .map(m => {
          if (m.parts) return { role: m.role, content: m.parts };
          return { role: m.role, content: m.content };
        });

      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: wire,
          temperature: state.settings.temperature,
          max_tokens: state.settings.maxTokens,
          stream: true,
        }),
        signal: state.streaming.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'HTTP ' + res.status } }));
        asstMsg.content = `**Error:** ${err.error?.message || res.statusText}`;
        asstMsg.streaming = false;
        renderMessages();
        return;
      }
      setConn('ok');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          handleStreamEvent(asstMsg, evt, conv);
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        asstMsg.content = (asstMsg.content || '') + `\n\n**Error:** ${e.message}`;
      }
    } finally {
      asstMsg.streaming = false;
      saveConversations();
      state.streaming = null;
      dom.sendBtn.hidden = false;
      dom.stopBtn.hidden = true;
      const aEl = dom.messages.querySelector(`.msg[data-id="${asstMsg.id}"]`);
      if (aEl) aEl.classList.remove('streaming');
      renderMessages();
      if (state.settings.autoTts && asstMsg.content) speak(asstMsg.content);
    }
  }

  function handleStreamEvent(asstMsg, evt, conv) {
    switch (evt.type) {
      case 'decision':
        asstMsg.decision = evt.decision;
        dom.decisionBadge.hidden = false;
        dom.decisionBadge.className = 'decision-badge ' + (evt.decision.state || '').toLowerCase();
        dom.decisionBadge.textContent = `KERNEL ${evt.decision.state} · score ${evt.decision.score?.toFixed(2)}`;
        break;
      case 'attempt':
        asstMsg.model = formatModelLabel(evt.provider, evt.model);
        dom.modelName.textContent = formatModelLabel(evt.provider, evt.model, true);
        break;
      case 'open':
        dom.modelName.textContent = formatModelLabel(evt.provider, evt.model, true);
        break;
      case 'delta':
        asstMsg.content = (asstMsg.content || '') + (evt.text || '');
        // in-place render: cheapest path = replace last message DOM
        const last = dom.messages.querySelector(`.msg[data-id="${asstMsg.id}"] .content`);
        if (last) {
          last.innerHTML = renderMarkdown(asstMsg.content) + '<span class="cursor"></span>';
          scrollToBottom(false);
        } else {
          console.warn('[AION-EVT] delta: no .content found for', asstMsg.id);
        }
        break;
      case 'done':
        asstMsg.usage = evt.usage;
        asstMsg.latency_ms = evt.latency_ms;
        asstMsg.model = formatModelLabel(evt.provider, evt.model);
        break;
      case 'error':
        // Don't pollute user-visible content with failover errors.
        // Track them on the message so the kernel panel / audit can show them.
        asstMsg.errors = asstMsg.errors || [];
        asstMsg.errors.push({ kind: evt.kind, message: evt.message, model: evt.model, provider: evt.provider });
        break;
    }
  }

  function stopStreaming() {
    if (state.streaming) {
      state.streaming.abort();
      showToast('Stopped');
    }
  }

  // ------------------------------------------------------------------
  // Download
  // ------------------------------------------------------------------
  function triggerDownload(filename, content, mime = 'text/plain') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
  function downloadMessage(m) {
    const ext = m.role === 'user' ? 'user' : 'assistant';
    const ts = new Date(m.ts || now()).toISOString().replace(/[:.]/g, '-');
    const safe = (m.content || '').slice(0, 32).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'message';
    triggerDownload(`aion_${ts}_${ext}_${safe}.md`, m.content || '', 'text/markdown');
  }
  function downloadThread(format = 'md') {
    const conv = activeConv();
    if (!conv) return;
    const safeTitle = (conv.title || 'thread').replace(/[^\w]+/g, '_').slice(0, 60) || 'thread';
    const ts = new Date(conv.createdAt || now()).toISOString().replace(/[:.]/g, '-');
    if (format === 'json') {
      const data = JSON.stringify(conv, null, 2);
      triggerDownload(`aion_${ts}_${safeTitle}.json`, data, 'application/json');
    } else {
      const lines = [
        `# ${conv.title}`,
        ``,
        `*Created ${new Date(conv.createdAt).toLocaleString()}*`,
        `*Updated ${new Date(conv.updatedAt).toLocaleString()}*`,
        `*${conv.messages.length} message(s)*`,
        ``,
        `---`,
        ``,
      ];
      for (const m of conv.messages) {
        const when = new Date(m.ts).toLocaleString();
        const who = m.role === 'user' ? '## You' : '## AION';
        lines.push(`${who} — ${when}`);
        if (m.decision) lines.push(`*Kernel: **${m.decision.state}** · score ${m.decision.score?.toFixed(2)}*`);
        if (m.model) lines.push(`*Model: ${m.model}*`);
        if (m.attachments && m.attachments.length) {
          lines.push(`*Attachments: ${m.attachments.map(a => a.name).join(', ')}*`);
        }
        lines.push(``);
        lines.push(m.content || '');
        lines.push(``);
        lines.push(`---`);
        lines.push(``);
      }
      triggerDownload(`aion_${ts}_${safeTitle}.md`, lines.join('\n'), 'text/markdown');
    }
    showToast(`Thread downloaded (${format.toUpperCase()})`);
  }

  // ------------------------------------------------------------------
  // Speech (TTS + STT)
  // ------------------------------------------------------------------
  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices();
    dom.voiceSelect.innerHTML = '';
    if (voices.length === 0) {
      const opt = document.createElement('option');
      opt.value = ''; opt.textContent = 'No voices available';
      dom.voiceSelect.appendChild(opt);
      return;
    }
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' · default' : ''}`;
      if (v.name === state.settings.voiceName) opt.selected = true;
      dom.voiceSelect.appendChild(opt);
    }
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find(v => v.name === state.settings.voiceName);
    if (v) u.voice = v;
    u.rate = state.settings.voiceRate;
    u.onend = () => { state.tts.speaking = false; dom.ttsBtn.setAttribute('aria-pressed', 'false'); };
    u.onerror = () => { state.tts.speaking = false; dom.ttsBtn.setAttribute('aria-pressed', 'false'); };
    state.tts.utterance = u;
    state.tts.speaking = true;
    dom.ttsBtn.setAttribute('aria-pressed', 'true');
    speechSynthesis.speak(u);
  }
  function stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    state.tts.speaking = false;
    dom.ttsBtn.setAttribute('aria-pressed', 'false');
  }
  function toggleTtsGlobal() {
    if (state.tts.speaking) { stopSpeaking(); }
    else if (activeConv()?.messages.length) {
      const last = [...activeConv().messages].reverse().find(m => m.role === 'assistant' && m.content);
      if (last) speak(last.content);
      else showToast('No assistant reply to read');
    }
  }
  function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      dom.micBtn.disabled = true;
      dom.micBtn.title = 'Voice input not supported in this browser';
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    let final = '';
    rec.onresult = (e) => {
      let interim = '';
      final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      dom.prompt.value = (dom.prompt.dataset.voiceBase || '') + final + interim;
      autosize();
    };
    rec.onend = () => {
      dom.micBtn.classList.remove('mic-recording');
      if (final) {
        dom.prompt.value = (dom.prompt.dataset.voiceBase || '') + final;
        autosize();
      }
      delete dom.prompt.dataset.voiceBase;
    };
    rec.onerror = (e) => {
      dom.micBtn.classList.remove('mic-recording');
      showToast(`Mic: ${e.error || 'error'}`);
    };
    state.recognition = rec;
  }
  function toggleMic() {
    if (!state.recognition) return;
    if (dom.micBtn.classList.contains('mic-recording')) {
      state.recognition.stop();
      return;
    }
    dom.prompt.dataset.voiceBase = dom.prompt.value ? dom.prompt.value + ' ' : '';
    state.recognition.start();
    dom.micBtn.classList.add('mic-recording');
  }

  // ------------------------------------------------------------------
  // Kernel panel
  // ------------------------------------------------------------------
  async function openKernelPanel() {
    dom.kernelPanel.hidden = false;
    dom.kernelBody.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const [ready, cp, models] = await Promise.all([
        fetch(apiUrl('/readyz')).then(r => r.json()),
        fetch(apiUrl('/api/continuity-pack')).then(r => r.json()),
        fetch(apiUrl('/api/models')).then(r => r.json()),
      ]);
      state.models = { primary: models.primary, chain: models.chain, providers: models.providers || {} };
      dom.modelName.textContent = (models.primary || 'aion').split('/').pop();
      renderKernelBody(ready, cp, models);
    } catch (e) {
      dom.kernelBody.innerHTML = `<p class="muted">Failed to load kernel state: ${escapeHtml(e.message)}</p>`;
    }
  }
  function renderKernelBody(ready, cp, models) {
    const laws = ['Reality','Continuity','Fidelity','Lattice','Epistemic','Perpetuity','Decision'];
    const providerRows = Object.entries(ready.providers || {}).map(([k, v]) => {
      const cls = v.ok ? 'pass' : 'fail';
      const status = v.ok ? 'OK' : 'FAIL';
      return `<div class="law-row ${cls}"><span class="law-name">${escapeHtml(k)}</span><span class="law-status">${status}</span><span class="law-note">${escapeHtml(String(v.model_count || v.error || ''))}</span></div>`;
    }).join('');
    const lawRows = laws.map(l => `<div class="law-row pass"><span class="law-name">${l}</span><span class="law-status">ENFORCED</span><span class="law-note">active on every turn</span></div>`).join('');
    const modelList = (models.chain || []).map(m => `<div class="kv"><span class="k">${escapeHtml(m)}</span><span class="v">${
      (m === models.primary) ? 'primary' : 'fallback'
    }</span></div>`).join('');
    dom.kernelBody.innerHTML = `
      <div class="kernel-section">
        <h3>Continuity pack</h3>
        <div class="kv"><span class="k">system</span><span class="v">${escapeHtml(cp.system_name)}</span></div>
        <div class="kv"><span class="k">class</span><span class="v">${escapeHtml(cp.identity_class)}</span></div>
        <div class="kv"><span class="k">architecture</span><span class="v">${escapeHtml(cp.architecture_type)}</span></div>
        <div class="kv"><span class="k">version</span><span class="v">${escapeHtml(ready.version || '')}</span></div>
      </div>
      <div class="kernel-section">
        <h3>Providers (live probe)</h3>
        ${providerRows || '<p class="muted">No providers configured.</p>'}
      </div>
      <div class="kernel-section">
        <h3>Model chain</h3>
        ${modelList}
      </div>
      <div class="kernel-section">
        <h3>7 Prime Operating Laws</h3>
        ${lawRows}
      </div>
      <div class="kernel-section">
        <h3>Decision protocol</h3>
        <ol style="padding-left:18px;margin:0;font-size:12.5px;color:var(--text-2);">
          <li>goal_identification</li>
          <li>constraint_analysis</li>
          <li>uncertainty_estimation</li>
          <li>risk_evaluation</li>
          <li>leverage_detection</li>
          <li>reversibility_check</li>
          <li>evidence_strength</li>
          <li>downstream_consequences</li>
        </ol>
        <p class="muted" style="margin-top:8px;font-size:12px;">Resolves to <strong>COMMIT</strong> / <strong>DEFER</strong> / <strong>REJECT</strong>.</p>
      </div>
    `;
  }

  // ------------------------------------------------------------------
  // Settings panel
  // ------------------------------------------------------------------
  function openSettingsPanel() {
    dom.tempRange.value = state.settings.temperature;
    dom.tempValue.textContent = Number(state.settings.temperature).toFixed(2);
    dom.maxTokensRange.value = state.settings.maxTokens;
    dom.maxTokensValue.textContent = state.settings.maxTokens;
    dom.rateRange.value = state.settings.voiceRate;
    dom.rateValue.textContent = Number(state.settings.voiceRate).toFixed(2);
    dom.autoTts.checked = !!state.settings.autoTts;
    if (dom.apiBaseInput) {
      dom.apiBaseInput.value = (() => {
        try { return localStorage.getItem(API_BASE_KEY) || ''; } catch { return ''; }
      })();
      dom.apiBaseInput.placeholder = DEFAULT_API_BASE;
    }
    populateVoices();
    dom.settingsPanel.hidden = false;
  }
  function bindSettings() {
    dom.tempRange.addEventListener('input', () => {
      state.settings.temperature = Number(dom.tempRange.value);
      dom.tempValue.textContent = state.settings.temperature.toFixed(2);
      saveSettings();
    });
    dom.maxTokensRange.addEventListener('input', () => {
      state.settings.maxTokens = Number(dom.maxTokensRange.value);
      dom.maxTokensValue.textContent = state.settings.maxTokens;
      saveSettings();
    });
    dom.rateRange.addEventListener('input', () => {
      state.settings.voiceRate = Number(dom.rateRange.value);
      dom.rateValue.textContent = state.settings.voiceRate.toFixed(2);
      saveSettings();
    });
    dom.voiceSelect.addEventListener('change', () => {
      state.settings.voiceName = dom.voiceSelect.value;
      saveSettings();
    });
    dom.autoTts.addEventListener('change', () => {
      state.settings.autoTts = dom.autoTts.checked;
      saveSettings();
    });
    if (dom.apiBaseInput) {
      dom.apiBaseInput.addEventListener('change', () => {
        const v = dom.apiBaseInput.value.trim();
        try {
          if (v) localStorage.setItem(API_BASE_KEY, v);
          else localStorage.removeItem(API_BASE_KEY);
        } catch { /* ignore */ }
        showToast('Backend URL saved. Reloading…');
        setTimeout(() => location.reload(), 600);
      });
    }
    dom.clearAllBtn.addEventListener('click', clearAllConversations);
  }

  // ------------------------------------------------------------------
  // Download thread button (we add a small toolbar in the topbar)
  // ------------------------------------------------------------------
  function bindDownloadMenu() {
    // add a "Download" button to topbar actions dynamically
    const actions = document.querySelector('.topbar-actions');
    if (!actions) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-icon';
    btn.title = 'Download thread';
    btn.setAttribute('aria-label', 'Download thread');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>';
    btn.addEventListener('click', () => {
      const fmt = confirm('OK = Markdown (.md), Cancel = JSON (.json)') ? 'md' : 'json';
      downloadThread(fmt);
    });
    actions.insertBefore(btn, actions.firstChild);
  }

  // ------------------------------------------------------------------
  // Composer autosize
  // ------------------------------------------------------------------
  function autosize() {
    dom.prompt.style.height = 'auto';
    dom.prompt.style.height = Math.min(dom.prompt.scrollHeight, 200) + 'px';
    const has = dom.prompt.value.trim().length > 0;
    dom.sendBtn.disabled = !has || !!state.streaming;
  }

  // ------------------------------------------------------------------
  // Connection dot
  // ------------------------------------------------------------------
  function setConn(state_) {
    dom.connectionDot.className = 'dot ' + (state_ || '');
  }
  async function healthCheck() {
    try {
      const r = await fetch(apiUrl('/healthz'));
      setConn(r.ok ? 'ok' : 'err');
    } catch { setConn('err'); }
  }

  // ------------------------------------------------------------------
  // Render all
  // ------------------------------------------------------------------
  function renderAll() {
    renderSidebar();
    renderMessages();
    autosize();
  }

  // ------------------------------------------------------------------
  // Bind events
  // ------------------------------------------------------------------
  function bind() {
    dom.composer.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    dom.prompt.addEventListener('input', autosize);
    if (dom.attachBtn) dom.attachBtn.addEventListener('click', addPendingFiles);

    // drag & drop files onto the prompt
    ['dragenter', 'dragover'].forEach(ev =>
      dom.prompt.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dom.composer.style.borderColor = 'var(--accent)'; })
    );
    ['dragleave', 'drop'].forEach(ev =>
      dom.prompt.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dom.composer.style.borderColor = ''; })
    );
    dom.prompt.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) {
        const ingested = await ingestFiles(files);
        state.pendingAttachments.push(...ingested);
        renderPendingAttachments();
        autosize();
      }
    });
    // also support paste of images into the prompt
    dom.prompt.addEventListener('paste', async (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) {
        const ingested = await ingestFiles(files);
        state.pendingAttachments.push(...ingested);
        renderPendingAttachments();
        autosize();
      }
    });
    dom.prompt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });
    dom.stopBtn.addEventListener('click', stopStreaming);
    dom.micBtn.addEventListener('click', toggleMic);
    dom.ttsBtn.addEventListener('click', toggleTtsGlobal);
    dom.newChatBtn.addEventListener('click', () => { newConversation(); renderAll(); });
    dom.openSidebarBtn.addEventListener('click', () => dom.app.dataset.sidebar = 'open');
    dom.closeSidebarBtn.addEventListener('click', () => dom.app.dataset.sidebar = 'closed');
    dom.kernelBtn.addEventListener('click', openKernelPanel);
    dom.settingsBtn.addEventListener('click', openSettingsPanel);
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => {
        dom.kernelPanel.hidden = true;
        dom.settingsPanel.hidden = true;
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dom.kernelPanel.hidden = true;
        dom.settingsPanel.hidden = true;
      }
    });
    if ('speechSynthesis' in window) {
      speechSynthesis.onvoiceschanged = populateVoices;
    }
    bindSettings();
    bindDownloadMenu();
    initRecognition();
    window.addEventListener('online', () => { setConn('ok'); showToast('Online'); });
    window.addEventListener('offline', () => { setConn('err'); showToast('Offline'); });
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot() {
    loadSettings();
    state.conversations = loadConversations();
    if (state.conversations.length === 0) newConversation();
    else state.activeId = state.conversations[0].id;
    bind();
    renderAll();
    healthCheck();
    setInterval(healthCheck, 30000);

    // PWA install prompt
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      showToast('Install AION as an app: use your browser menu → Install', 5000);
    });

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
