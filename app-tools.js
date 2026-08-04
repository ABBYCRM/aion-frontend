  function openSettingsDialog() {
    dom.backendUrl.value = state.settings.apiBase;
    dom.backendUrl.readOnly = !CONFIG.allowCustomApiBase;
    dom.apiKey.value = apiKey();
    dom.temperature.value = String(state.settings.temperature);
    dom.maxTokens.value = String(state.settings.maxTokens);
    dom.persistHistory.checked = state.settings.persistHistory;
    dom.useNotes.checked = state.settings.useNotes;
    dom.autoSpeak.checked = !!state.settings.autoSpeak;
    if (dom.ttsVoiceSetting) dom.ttsVoiceSetting.value = state.settings.ttsVoice || 'alloy';
    if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
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
    try { sessionStorage.setItem(API_KEY_SESSION, dom.apiKey.value.trim()); } catch { /* ignored */ }
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
    const card = document.createElement('article');
    card.className = 'stack-item';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `${item.name} · ${item.kind}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.className = 'danger-button';
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete note “${item.name}”?`)) return;
      const response = await apiFetch(`/api/notes/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!response.ok) showToast(detail(await response.json().catch(() => ({})), response));
      await loadNotes();
    });
    header.append(title, remove);
    const value = document.createElement('p');
    value.textContent = item.value;
    const tags = document.createElement('small');
    tags.textContent = (item.tags || []).join(', ');
    card.append(header, value, tags);
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
