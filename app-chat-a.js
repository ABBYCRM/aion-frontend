  function apiUrl(path) {
    return `${state.settings.apiBase}${path}`;
  }

  async function apiFetch(path, options = {}, requireAuth = true) {
    const headers = new Headers(options.headers || {});
    if (requireAuth) {
      const key = apiKey();
      if (!key) {
        openSettingsDialog();
        throw new Error('Enter an AION API key in Settings.');
      }
      headers.set('X-AION-Key', key);
    }
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(apiUrl(path), { ...options, headers });
    if (response.status === 401) {
      openSettingsDialog();
      throw new Error('Authentication failed. Check the AION API key.');
    }
    return response;
  }

  async function healthCheck() {
    try {
      const response = await apiFetch('/healthz', {}, false);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dom.connectionStatus.textContent = apiKey() ? 'Connected' : 'API key required';
      dom.connectionStatus.className = `connection ${apiKey() ? 'ok' : ''}`;
    } catch {
      dom.connectionStatus.textContent = 'Backend unavailable';
      dom.connectionStatus.className = 'connection error';
    }
  }

  async function loadModels() {
    if (!apiKey()) return;
    try {
      const response = await apiFetch('/api/models/all');
      const payload = await response.json();
      if (!response.ok) throw new Error(detail(payload, response));
      const previous = state.selectedModel ? `${state.selectedModel.provider}::${state.selectedModel.model}` : '';
      dom.modelSelect.replaceChildren(new Option('Default failover chain', ''));
      const groups = new Map();
      for (const item of payload.flat || []) {
        if (!groups.has(item.provider)) groups.set(item.provider, []);
        groups.get(item.provider).push(item.model);
      }
      for (const [provider, models] of groups) {
        const group = document.createElement('optgroup');
        group.label = provider;
        for (const model of models) group.append(new Option(model, `${provider}::${model}`));
        dom.modelSelect.append(group);
      }
      dom.modelSelect.value = previous;
      if (previous && dom.modelSelect.value !== previous) {
        state.selectedModel = null;
        saveSettings();
      }
      state.modelsLoaded = true;
    } catch (error) {
      showToast(error.message);
    }
  }

  function detail(payload, response) {
    return payload?.detail || payload?.error?.message || response.statusText || `HTTP ${response.status}`;
  }

  async function sendMessage() {
    if (state.controller) return;
    const conversation = activeConversation() || createConversation();
    const text = dom.prompt.value.trim();
    const attachments = [...state.pendingAttachments];
    if (!text && !attachments.length) return;

    const userMessage = {
      id: uid('message'), role: 'user', content: text || '(attachment)', ts: Date.now(),
      attachments: attachments.map(({ name, type, size }) => ({ name, type, size })),
    };
    conversation.messages.push(userMessage);
    if (conversation.messages.length === 1) conversation.title = (text || attachments[0]?.name || 'New chat').slice(0, 60);
    const assistant = { id: uid('message'), role: 'assistant', content: '', ts: Date.now(), tools: [], streaming: true };
    conversation.messages.push(assistant);
    conversation.updatedAt = Date.now();

    dom.prompt.value = '';
    state.pendingAttachments = [];
    renderAttachments();
    autosize();
    saveConversations();
    renderAll();

    const history = conversation.messages
      .filter((message) => message.id !== assistant.id)
      .slice(-30)
      .map((message) => ({ role: message.role, content: message.content }));
    if (attachments.length) history[history.length - 1].content = attachmentContent(text, attachments);

    const payload = {
      messages: history,
      temperature: state.settings.temperature,
      max_tokens: state.settings.maxTokens,
      web_search: dom.webSearchToggle.checked,
    };
    if (state.selectedModel) {
      payload.provider = state.selectedModel.provider;
      payload.model = state.selectedModel.model;
    }

    state.controller = new AbortController();
    dom.sendButton.hidden = true;
    dom.stopButton.hidden = false;
    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: state.controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(detail(body, response));
      }
      await consumeSse(response, (event) => handleStreamEvent(assistant, event));
    } catch (error) {
      if (error.name !== 'AbortError') assistant.error = error.message;
    } finally {
      assistant.streaming = false;
      state.controller = null;
      dom.sendButton.hidden = false;
      dom.stopButton.hidden = true;
      saveConversations();
      renderMessages();
      autosize();
    }
  }
