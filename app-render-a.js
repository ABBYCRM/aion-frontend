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
      welcome.innerHTML = '<h1>AION</h1><p>Authenticated chat with live web search, allowlisted GitHub repository tools, bounded model failover, and optional owner-scoped notes.</p>';
      const suggestions = document.createElement('div');
      suggestions.className = 'suggestion-grid';
      [
        '/search latest developments in FastAPI security',
        '/github ABBYCRM/aion-backend-v2 search resolve_model_chain',
        '/github ABBYCRM/aion-frontend file app-chat-a.js',
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

    // DEFER notice — visible when a tool was requested and errored so
    // the user sees the kernel's refusal BEFORE the model has a chance to
    // bury it in prose. Sits at the top of the card.
    if (message.decision && message.decision.state === 'DEFER') {
      const deferNotice = document.createElement('div');
      deferNotice.className = 'defer-notice';
      // Prefer the structured failure block from the kernel (kind, next_step)
      // over the tool_error string — it carries the operator-facing
      // remediation hint with the actual repo name embedded.
      const failure = message.decision.failure || {};
      const toolErr = (message.tools || []).find((t) => t.type === 'tool_error');
      if (failure.kind || toolErr) {
        const title = document.createElement('div');
        title.className = 'defer-title';
        // Title: humanize the failure.kind when present
        const kindLabel = failure.kind ? failure.kind.replace(/_/g, ' ').toUpperCase() : null;
        const toolName = failure.tool || (toolErr && toolErr.tool) || 'tool';
        title.textContent = kindLabel ? `Refused — ${kindLabel}` : `Refused — ${toolName} failed`;
        const detail = document.createElement('div');
        detail.className = 'defer-detail';
        detail.textContent = (toolErr && toolErr.message) || failure.errors?.[0] || 'Tool returned an error';
        deferNotice.append(title, detail);
        if (failure.next_step) {
          const hint = document.createElement('div');
          hint.className = 'defer-hint';
          hint.textContent = `Fix: ${failure.next_step}`;
          deferNotice.append(hint);
        } else {
          const hint = document.createElement('div');
          hint.className = 'defer-hint';
          if ((toolName || '').toLowerCase().includes('github')) {
            hint.textContent = 'Fix: add the repository to GITHUB_ALLOWED_REPOSITORIES, attach the README, or paste the text.';
          } else if ((toolName || '').toLowerCase().includes('search')) {
            hint.textContent = 'Fix: configure a search API key or rephrase the question.';
          } else {
            hint.textContent = 'Fix: see the error above. The kernel will not bluff an answer.';
          }
          deferNotice.append(hint);
        }
      } else {
        const title = document.createElement('div');
        title.className = 'defer-title';
        title.textContent = 'Deferred — not enough evidence to answer yet';
        deferNotice.append(title);
      }
      card.append(deferNotice);
    }

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

    // TTS audio element for this message (only rendered when message has been spoken at least once)
    if (message.audioSrc) {
      const audio = document.createElement('audio');
      audio.className = 'message-audio';
      audio.src = message.audioSrc;
      audio.controls = true;
      // Attach VTT track if we generated cues for this message
      if (message.vttSrc) {
        const track = document.createElement('track');
        track.kind = 'captions';
        track.label = 'English';
        track.srclang = 'en';
        track.src = message.vttSrc;
        track.default = true;
        audio.appendChild(track);
        // Show a small caption status indicator
        const cap = document.createElement('div');
        cap.className = 'caption-status';
        cap.textContent = 'Captions available';
        card.append(audio, cap);
      } else {
        card.append(audio);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    if (message.decision) meta.append(makeBadge(message.decision.state, String(message.decision.state || '').toLowerCase()));
    if (message.brain && window.AION_BRAIN_SIGNAL) {
      const bb = window.AION_BRAIN_SIGNAL.brainBadge(message);
      if (bb) meta.append(bb);
    }
    if (message.model) meta.append(makeBadge(message.model));
    // v2.8.12 — answer mirror self-check badge. When the audit didn't
    // pass, surface a "Self-check: weak" pill. Click for the 5-axis
    // breakdown. When the user prompt was very long, the audit may
    // short-circuit with "You probably already had this" instead.
    if (message.selfCheck) {
      const sc = message.selfCheck;
      let label, kind;
      if (sc.userKnewAlready) {
        label = 'Self-check: you probably had this';
        kind = 'info';
      } else if (sc.passed) {
        label = 'Self-check: ok';
        kind = 'ok';
      } else {
        label = `Self-check: weak (attempts ${sc.attempts})`;
        kind = 'weak';
      }
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = `meta-badge self-check self-check-${kind}`;
      badge.title = `Audited by ${sc.auditor || 'unknown'} — value_added=${sc.valueAdded ?? '?'} grounded=${sc.grounded ?? '?'} honest=${sc.honest ?? '?'} novel=${sc.novel ?? '?'}` +
        (sc.missingItems && sc.missingItems.length ? `\nMissing: ${sc.missingItems.join(', ')}` : '') +
        (sc.weakItems && sc.weakItems.length ? `\nWeak: ${sc.weakItems.join(', ')}` : '');
      badge.textContent = label;
      meta.append(badge);
    }
    // v2.8.12 — post-stream style badge. Shows the 2-pass diff
    // (no-ai-slop + adhd). Tiny pill on the right.
    if (message.styleApply) {
      const sa = message.styleApply;
      const parts = [];
      if (sa.slopPatternsCaught) parts.push(`${sa.slopPatternsCaught} slop`);
      if (sa.closersStripped) parts.push(`${sa.closersStripped} closers`);
      if (sa.timeEstimatesRewritten) parts.push(`${sa.timeEstimatesRewritten} times`);
      if (parts.length === 0) parts.push('clean');
      const badge = document.createElement('span');
      badge.className = 'meta-badge style-apply';
      badge.title = `Post-stream style pass: ${sa.skill}`;
      badge.textContent = `Styled: ${parts.join(', ')}`;
      meta.append(badge);
    }
    if (message.attachments?.length) meta.append(makeBadge(`Attachments: ${message.attachments.map((item) => item.name).join(', ')}`));
    if (message.error && message.content) meta.append(makeBadge(message.error));
    card.append(meta);

    // Action toolbar — only for assistant messages with content, never while streaming
    if (message.role === 'assistant' && message.content && !message.streaming) {
      card.append(buildMessageActions(message));
    }

    wrapper.append(avatar, card);
    return wrapper;
  }

  // Build the per-message action bar (Copy / Download / Speak / Delete)
  function buildMessageActions(message) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'msg-action';
    copyBtn.title = 'Copy message';
    copyBtn.setAttribute('aria-label', 'Copy message');
    copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content || '');
        const original = copyBtn.querySelector('span').textContent;
        copyBtn.querySelector('span').textContent = 'Copied';
        setTimeout(() => { copyBtn.querySelector('span').textContent = original; }, 1200);
      } catch { showToast('Copy failed'); }
    });
    actions.append(copyBtn);

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'msg-action';
    downloadBtn.title = 'Download as .md';
    downloadBtn.setAttribute('aria-label', 'Download as markdown');
    downloadBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg><span>.md</span>';
    downloadBtn.addEventListener('click', () => downloadMessageAs(message, 'md'));
    actions.append(downloadBtn);

    const downloadJsonBtn = document.createElement('button');
    downloadJsonBtn.type = 'button';
    downloadJsonBtn.className = 'msg-action';
    downloadJsonBtn.title = 'Download as .json';
    downloadJsonBtn.setAttribute('aria-label', 'Download as JSON');
    downloadJsonBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span>.json</span>';
    downloadJsonBtn.addEventListener('click', () => downloadMessageAs(message, 'json'));
    actions.append(downloadJsonBtn);

    const speakBtn = document.createElement('button');
    speakBtn.type = 'button';
    speakBtn.className = 'msg-action';
    speakBtn.dataset.role = 'speak';
    speakBtn.title = 'Speak this message';
    speakBtn.setAttribute('aria-label', 'Speak this message');
    speakBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span>Speak</span>';
    speakBtn.addEventListener('click', () => speakMessage(message, speakBtn));
    actions.append(speakBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'msg-action danger';
    delBtn.title = 'Delete message';
    delBtn.setAttribute('aria-label', 'Delete message');
    delBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg><span>Delete</span>';
    delBtn.addEventListener('click', () => deleteMessage(message.id));
    actions.append(delBtn);

    return actions;
  }
