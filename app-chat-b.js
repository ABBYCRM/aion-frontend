  function attachmentContent(text, attachments) {
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    for (const attachment of attachments) {
      if (attachment.kind === 'image') parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
      else parts.push({ type: 'text', text: `--- ${attachment.name} ---\n${attachment.text}\n--- end ${attachment.name} ---` });
    }
    return parts;
  }

  async function consumeSse(response, onEvent) {
    if (!response.body) throw new Error('Streaming response body is unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const consumeBlocks = () => {
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        try { onEvent(JSON.parse(data)); } catch { /* ignore malformed event */ }
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeBlocks();
    }
    buffer += decoder.decode();
    if (buffer && !buffer.endsWith('\n\n')) buffer += '\n\n';
    consumeBlocks();
  }

  function scheduleStreamRender() {
    if (state.renderFrame) return;
    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = 0;
      renderMessages();
    });
  }

  function handleStreamEvent(assistant, event) {
    switch (event.type) {
      case 'decision': assistant.decision = event.decision; break;
      case 'tool':
      case 'tool_error': assistant.tools.push(event); break;
      case 'attempt': assistant.model = `${event.provider}/${event.model}`; break;
      case 'attempt_failed': assistant.tools.push(event); break;
      case 'delta': assistant.content += event.text || ''; break;
      case 'done':
        assistant.model = `${event.provider}/${event.model}`;
        assistant.error = '';
        // Auto-speak: if user enabled it, speak the completed reply
        if (state.settings.autoSpeak && assistant.content && !assistant.error) {
          // Defer one tick so the render flushes first
          setTimeout(() => {
            const btn = document.querySelector(`.message[data-id="${assistant.id}"] [data-role="speak"]`);
            if (btn) btn.click();
          }, 60);
        }
        break;
      case 'error': assistant.error = event.message || event.kind || 'Generation failed'; break;
      default: break;
    }
    scheduleStreamRender();
  }

  function stopGeneration() {
    if (state.controller) state.controller.abort();
  }

  function chooseFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = [...ACCEPTED_TYPES].join(',');
    input.addEventListener('change', async () => {
      await ingestFiles([...input.files]);
      input.remove();
    }, { once: true });
    input.click();
  }

  async function ingestFiles(files) {
    let count = state.pendingAttachments.length;
    let totalBytes = state.pendingAttachments.reduce((sum, item) => sum + item.size, 0);
    for (const file of files) {
      if (count >= MAX_ATTACHMENT_COUNT) {
        showToast(`A maximum of ${MAX_ATTACHMENT_COUNT} attachments is allowed.`);
        break;
      }
      if (!ACCEPTED_TYPES.has(file.type) && !file.type.startsWith('text/')) {
        showToast(`${file.name}: unsupported file type`);
        continue;
      }
      const limit = file.type.startsWith('image/') ? MAX_IMAGE_FILE : MAX_TEXT_FILE;
      if (file.size > limit) {
        showToast(`${file.name}: file exceeds the ${Math.round(limit / 1000)} KB limit`);
        continue;
      }
      if (totalBytes + file.size > MAX_TOTAL_ATTACHMENT_BYTES) {
        showToast(`Attachments must total under ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / 1000)} KB.`);
        continue;
      }
      try {
        if (file.type.startsWith('image/')) {
          state.pendingAttachments.push({ name: file.name, type: file.type, size: file.size, kind: 'image', dataUrl: await readFile(file, 'data') });
        } else {
          state.pendingAttachments.push({ name: file.name, type: file.type, size: file.size, kind: 'text', text: await readFile(file, 'text') });
        }
        count += 1;
        totalBytes += file.size;
      } catch (error) {
        showToast(`${file.name}: ${error.message || 'file read failed'}`);
      }
    }
    renderAttachments();
    autosize();
  }

  function readFile(file, mode) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      if (mode === 'data') reader.readAsDataURL(file); else reader.readAsText(file);
    });
  }

  function renderAttachments() {
    dom.attachmentList.replaceChildren();
    dom.attachmentList.hidden = !state.pendingAttachments.length;
    state.pendingAttachments.forEach((attachment, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const name = document.createElement('span');
      name.textContent = attachment.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${attachment.name}`);
      remove.addEventListener('click', () => {
        state.pendingAttachments.splice(index, 1);
        renderAttachments();
        autosize();
      });
      chip.append(name, remove);
      dom.attachmentList.append(chip);
    });
  }

  function autosize() {
    dom.prompt.style.height = 'auto';
    dom.prompt.style.height = `${Math.min(dom.prompt.scrollHeight, 180)}px`;
    dom.sendButton.disabled = Boolean(state.controller) || (!dom.prompt.value.trim() && !state.pendingAttachments.length);
  }
