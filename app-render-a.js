  function renderSidebar() {
    dom.conversationList.replaceChildren();
    for (const conversation of state.conversations) {
      const item = document.createElement('div');
      item.className = `conversation-item${conversation.id === state.activeId ? ' active' : ''}`;
      const title = document.createElement('span');
      title.className = 'conversation-title';
      title.textContent = conversation.title || 'New chat';
      const remove = document.createElement('button');
      remove.className = 'delete-conversation';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${conversation.title}`);
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        if (confirm(`Delete “${conversation.title}”?`)) deleteConversation(conversation.id);
      });
      item.append(title, remove);
      item.addEventListener('click', () => {
        state.activeId = conversation.id;
        dom.app.classList.remove('sidebar-open');
        renderAll();
      });
      dom.conversationList.append(item);
    }
  }

  function renderMessages() {
    dom.messages.replaceChildren();
    const conversation = activeConversation();
    if (!conversation || !conversation.messages.length) {
      const welcome = document.createElement('div');
      welcome.className = 'welcome';
      welcome.innerHTML = '<h1>AION</h1><p>Authenticated chat with live web search, GitHub repository tools, bounded model failover, and owner-scoped notes.</p>';
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestion-grid';
      [
        '/search latest developments in FastAPI security',
        '/github ABBYCRM/aion-backend-v2 search resolve_model_chain',
        '/github ABBYCRM/aion-frontend file app.js',
        'Explain the architecture of AION and identify the next test to add.',
      ].forEach((text) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.addEventListener('click', () => { dom.prompt.value = text; autosize(); dom.prompt.focus(); });
        suggestions.append(button);
      });
      welcome.append(suggestions);
      dom.messages.append(welcome);
      return;
    }
    for (const message of conversation.messages) dom.messages.append(renderMessage(message));
    requestAnimationFrame(() => { dom.messages.scrollTop = dom.messages.scrollHeight; });
  }

  function renderMessage(message) {
    const wrapper = document.createElement('article');
    wrapper.className = `message ${message.role}`;
    wrapper.dataset.id = message.id;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = message.role === 'user' ? 'U' : 'A';
    const card = document.createElement('div');
    card.className = 'message-card';
    const head = document.createElement('div');
    head.className = 'message-head';
    const author = document.createElement('strong');
    author.textContent = message.role === 'user' ? 'You' : 'AION';
    const time = document.createElement('span');
    time.textContent = new Date(message.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    head.append(author, time);
    card.append(head);

    for (const tool of message.tools || []) card.append(renderTool(tool));

    const content = document.createElement('div');
    content.className = 'message-content';
    if (message.error && !message.content) {
      const error = document.createElement('div');
      error.className = 'error-box';
      error.textContent = message.error;
      content.append(error);
    } else {
      content.innerHTML = renderMarkdown(message.content || '');
      if (message.streaming) {
        const cursor = document.createElement('span');
        cursor.className = 'cursor';
        content.append(cursor);
      }
    }
    card.append(content);

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    if (message.decision) meta.append(makeBadge(message.decision.state, String(message.decision.state || '').toLowerCase()));
    if (message.model) meta.append(makeBadge(message.model));
    if (message.attachments?.length) meta.append(makeBadge(`Attachments: ${message.attachments.map((item) => item.name).join(', ')}`));
    if (message.error && message.content) meta.append(makeBadge(message.error));
    card.append(meta);
    wrapper.append(avatar, card);
    return wrapper;
  }
