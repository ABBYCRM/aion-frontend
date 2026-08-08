  function openSettingsDialog() {
    dom.backendUrl.value = state.settings.apiBase;
    dom.backendUrl.readOnly = !CONFIG.allowCustomApiBase;
    dom.apiKey.value = apiKey();
    dom.temperature.value = String(state.settings.temperature);
    if (dom.temperatureValue) dom.temperatureValue.textContent = Number(state.settings.temperature).toFixed(1);
    dom.maxTokens.value = String(state.settings.maxTokens);
    dom.persistHistory.checked = state.settings.persistHistory;
    dom.useNotes.checked = state.settings.useNotes;
    dom.autoSpeak.checked = !!state.settings.autoSpeak;
    if (dom.ttsVoiceSetting) dom.ttsVoiceSetting.value = state.settings.ttsVoice || 'alloy';
    if (dom.forgetApiKeyOnClose) dom.forgetApiKeyOnClose.checked = state.settings.forgetApiKeyOnClose;
    if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
    refreshPolicy();
  }

  async function refreshPolicy() {
    // Render runtime policy into the status panel. The endpoint requires
    // the user AION key, which is already set at this point.
    // Re-entrancy guard: if apiFetch triggers openSettingsDialog (e.g.
    // because the key was missing at the moment of the call), that
    // callback chain re-enters refreshPolicy. We bail after the first
    // attempt to break the cycle.
    if (refreshPolicy._inFlight) return;
    refreshPolicy._inFlight = true;
    const setText = (id, value, cls) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = value;
      el.classList.remove('is-ok', 'is-warn', 'is-bad');
      if (cls) el.classList.add(cls);
    };
    setText('policyBackend', '…', 'muted');
    setText('policyBrain', '…', 'muted');
    setText('policyGhToken', '…', 'muted');
    setText('policyGhApp', '…', 'muted');
    setText('policyGhAllow', '…', 'muted');
    setText('policyGhWrite', '…', 'muted');
    setText('policyCors', '…', 'muted');
    try {
      const r = await apiFetch('/api/policy', {}, true);
      if (!r.ok) {
        setText('policyBackend', `http ${r.status}`, 'is-bad');
        return;
      }
      const body = await r.json();
      const gh = body.github || {};
      const brain = body.brain || {};
      const cors = body.cors || {};
      setText('policyBackend', `${body.environment || '?'} · v${body.app_version || '?'}`, 'is-ok');
      setText('policyBrain', brain.enabled ? `${(brain.url || '').replace(/^https?:\/\//, '')}` : 'disabled', brain.enabled ? 'is-ok' : 'is-warn');
      setText('policyGhToken', gh.token_configured ? 'configured' : 'missing', gh.token_configured ? 'is-ok' : 'is-bad');
      setText('policyGhApp', gh.app_configured ? 'configured' : 'not configured', gh.app_configured ? 'is-ok' : 'is-warn');
      const allowMode = gh.allowlist_mode || (gh.allowed_repositories && gh.allowed_repositories.length ? 'restricted' : 'allow_all');
      const allowText = allowMode === 'allow_all' ? 'allow all (empty)' : `${(gh.allowed_repositories || []).length} repo${(gh.allowed_repositories || []).length === 1 ? '' : 's'}`;
      setText('policyGhAllow', allowText, allowMode === 'allow_all' ? 'is-warn' : 'is-ok');
      setText('policyGhWrite', gh.write_enabled ? 'enabled' : 'disabled (read-only)', gh.write_enabled ? 'is-warn' : 'is-ok');
      setText('policyCors', (cors.origins || []).join(', ') || '—', 'is-ok');
    } catch (e) {
      setText('policyBackend', 'unreachable', 'is-bad');
    } finally {
      refreshPolicy._inFlight = false;
    }
  }

  function persistSettings() {
    let backend = CONFIGURED_API_BASE;
    if (CONFIG.allowCustomApiBase) {
      try { backend = normalizeApiBase(dom.backendUrl.value.trim()); }
      catch (error) { showToast(error.message); return; }
      if (!apiBaseAllowed(backend)) { showToast('Backend origin is not allowed by this build.'); return; }
    }
    state.settings.apiBase = backend;
    state.settings.temperature = Math.min(2, Math.max(0, Number(dom.temperature.value) || 0.7));
    state.settings.maxTokens = Math.min(4096, Math.max(32, Number(dom.maxTokens.value) || 1024));
    state.settings.persistHistory = dom.persistHistory.checked;
    state.settings.useNotes = dom.useNotes.checked;
    state.settings.autoSpeak = dom.autoSpeak.checked;
    if (dom.ttsVoiceSetting) state.settings.ttsVoice = dom.ttsVoiceSetting.value || 'alloy';
    if (dom.forgetApiKeyOnClose) state.settings.forgetApiKeyOnClose = dom.forgetApiKeyOnClose.checked;
    const key = dom.apiKey.value.trim();
    try { localStorage.setItem(API_KEY_LOCAL, key); } catch { /* ignored */ }
    if (state.settings.forgetApiKeyOnClose) {
      try { sessionStorage.setItem(API_KEY_LOCAL, key); } catch { /* ignored */ }
      try { localStorage.removeItem(API_KEY_LOCAL); } catch { /* ignored */ }
    }
    if (!state.settings.persistHistory) localStorage.removeItem(HISTORY_KEY);
    saveSettings();
    healthCheck();
    loadModels();
    showToast('Settings saved.');
  }

  async function loadNotes() {
    dom.notesList.textContent = 'Loading…';
    try {
      const statusResponse = await apiFetch('/api/notes/status');
      const statusPayload = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(detail(statusPayload, statusResponse));
      if (!statusPayload.available) {
        dom.notesList.textContent = 'Notes are not configured on this backend deployment.';
        return;
      }
      const query = encodeURIComponent(dom.noteSearch.value.trim());
      const response = await apiFetch(`/api/notes?q=${query}&limit=100`);
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      dom.notesList.replaceChildren();
      if (!payload.items.length) dom.notesList.textContent = 'No notes.';
      for (const item of payload.items) dom.notesList.append(renderNote(item));
    } catch (error) { dom.notesList.textContent = error.message; }
  }

  function renderNote(item) {
    // v2.8.6 — note card with id chip + kind chip + value + tags + actions
    // (matches the Vault card style for visual consistency).
    const card = document.createElement('article');
    card.className = 'note-card';

    // Header: name (left) + kind chip (right)
    const head = document.createElement('header');
    head.className = 'note-card-head';
    const idEl = document.createElement('span');
    idEl.className = 'note-card-id';
    idEl.textContent = item.name;
    head.append(idEl);
    const meta = document.createElement('span');
    meta.className = 'note-card-meta';
    const kindChip = document.createElement('span');
    kindChip.className = 'chip';
    kindChip.textContent = item.kind;
    meta.append(kindChip);
    if (item.created_at) {
      const date = new Date(item.created_at * (item.created_at < 1e12 ? 1000 : 1));
      const stamp = document.createElement('span');
      stamp.style.fontFamily = 'var(--mono)';
      stamp.style.fontSize = '11px';
      stamp.textContent = date.toLocaleDateString();
      meta.append(stamp);
    }
    head.append(meta);
    card.append(head);

    // Body: value + tags
    const body = document.createElement('div');
    body.className = 'note-card-body';
    if (item.value) {
      const value = document.createElement('p');
      value.style.fontFamily = 'var(--mono)';
      value.style.fontSize = '13px';
      value.style.whiteSpace = 'pre-wrap';
      value.style.wordBreak = 'break-word';
      value.style.color = 'var(--text)';
      // Truncate very long values for the card; the chat detail view shows full
      const truncated = item.value.length > 600 ? item.value.slice(0, 600) + '…' : item.value;
      value.textContent = truncated;
      body.append(value);
    }
    if (item.tags && item.tags.length) {
      const tagsLine = document.createElement('p');
      tagsLine.style.fontSize = '11px';
      tagsLine.style.color = 'var(--muted)';
      tagsLine.innerHTML = `<strong style="color: var(--text-2)">Tags:</strong> ${item.tags.map(escapeHtml).join(', ')}`;
      body.append(tagsLine);
    }
    card.append(body);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'note-card-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.className = 'danger';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete note “${item.name}”?`)) return;
      const response = await apiFetch(`/api/notes/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!response.ok) showToast(detail(await response.json().catch(() => ({})), response));
      await loadNotes();
    });
    actions.append(del);
    card.append(actions);
    return card;
  }

  async function addNote(event) {
    event.preventDefault();
    const body = {
      name: dom.noteName.value.trim(),
      kind: dom.noteKind.value,
      value: dom.noteValue.value,
      tags: dom.noteTags.value.split(',').map((value) => value.trim()).filter(Boolean),
    };
    try {
      const response = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      dom.noteForm.reset();
      await loadNotes();
      showToast('Note added.');
    } catch (error) { showToast(error.message); }
  }

  // Top-level entry point for the Notes dialog so the tab-bar data-action
  // handler can call it. Same pattern as openVaultDialog / openMediaDialog.
  function openNotesDialog() {
    if (!dom.notesDialog) return;
    if (!dom.notesDialog.open) dom.notesDialog.showModal();
    loadNotes();
  }

  async function runGithubAction(action) {
    const repository = dom.githubRepository.value.trim();
    const argument = dom.githubArgument.value.trim();
    const routes = {
      repository: ['/api/github/repository', { repository }],
      issues: ['/api/github/issues', { repository }],
      file: ['/api/github/file', { repository, path: argument }],
      search: ['/api/github/search', { repository, query: argument, limit: 20 }],
    };
    if (!repository) { showToast('Enter an allowlisted owner/repository.'); return; }
    if ((action === 'file' || action === 'search') && !argument) {
      showToast('Enter a path or search query.');
      return;
    }
    dom.githubOutput.textContent = 'Loading…';
    try {
      const [path, body] = routes[action];
      const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      dom.githubOutput.textContent = JSON.stringify(payload, null, 2);
    } catch (error) { dom.githubOutput.textContent = error.message; }
  }

  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { dom.toast.hidden = true; }, 3200);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
