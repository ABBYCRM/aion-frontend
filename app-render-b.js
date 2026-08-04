  function renderTool(tool) {
    const card = document.createElement('section');
    card.className = 'tool-card';
    const heading = document.createElement('h4');
    if (tool.type === 'attempt_failed') heading.textContent = `Model attempt failed · ${tool.provider}/${tool.model}`;
    else if (tool.type === 'tool_error') heading.textContent = `${tool.tool || 'Tool'} error`;
    else if (tool.tool === 'web_search') heading.textContent = `Web search: ${tool.query}`;
    else heading.textContent = `${tool.tool || 'GitHub'} · ${tool.repository || ''}`;
    card.append(heading);
    if (tool.type === 'tool_error' || tool.type === 'attempt_failed') {
      const detail = document.createElement('div');
      detail.className = tool.type === 'tool_error' ? 'error-box' : 'muted';
      detail.textContent = tool.message || 'Attempt failed';
      card.append(detail);
      return card;
    }
    if (tool.tool === 'web_search') {
      for (const result of tool.results || []) {
        const row = document.createElement('div');
        row.className = 'tool-result';
        const link = document.createElement('a');
        link.textContent = result.title || result.url;
        link.href = safeHttpUrl(result.url) || '#';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const snippet = document.createElement('p');
        snippet.textContent = result.snippet || '';
        row.append(link, snippet);
        card.append(row);
      }
    } else {
      const pre = document.createElement('pre');
      pre.className = 'json-output';
      pre.textContent = JSON.stringify(tool.result, null, 2);
      card.append(pre);
    }
    return card;
  }

  function makeBadge(text, className = '') {
    const badge = document.createElement('span');
    badge.className = `badge ${className}`.trim();
    badge.textContent = text;
    return badge;
  }

  function renderMarkdown(value) {
    let text = escapeHtml(String(value || ''));
    const blocks = [];
    text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, language, code) => {
      const token = `@@BLOCK_${blocks.length}@@`;
      blocks.push(`<pre><code data-language="${escapeHtml(language || 'text')}">${code}</code></pre>`);
      return token;
    });
    text = text
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .split(/\n{2,}/)
      .map((paragraph) => /^(<h\d|@@BLOCK_)/.test(paragraph) ? paragraph : `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('');
    return blocks.reduce((output, block, index) => output.replace(`@@BLOCK_${index}@@`, block), text);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  // ------------------------------------------------------------------
  // Per-message actions: speak (TTS + VTT), download, delete
  // ------------------------------------------------------------------

  // WebVTT timestamp format: HH:MM:SS.mmm
  function formatVttTimestamp(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const ms = Math.floor((seconds % 1) * 1000);
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  // Split a long reply into 1-3 sentence cues for captions. Falls back to
  // word chunks if the reply has no sentence punctuation.
  function buildVttFromText(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    // Try sentence split first
    const sentences = clean.match(/[^.!?。！？\n]+[.!?。！？]+|[^.!?。！？\n]+$/g) || [clean];
    const cues = [];
    let t = 0;
    // Estimate 3.2 words/second for natural TTS cadence
    const wps = 3.2;
    for (const raw of sentences) {
      const s = raw.trim();
      if (!s) continue;
      const words = s.split(/\s+/).length;
      const dur = Math.max(1.2, words / wps);
      cues.push({ start: t, end: t + dur, text: s });
      t += dur;
    }
    let vtt = 'WEBVTT\n\n';
    for (const c of cues) {
      vtt += `${formatVttTimestamp(c.start)} --> ${formatVttTimestamp(c.end)}\n${c.text}\n\n`;
    }
    return vtt;
  }

  function vttDataUrl(vtt) {
    if (!vtt) return '';
    return 'data:text/vtt;charset=utf-8,' + encodeURIComponent(vtt);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadMessageAs(message, format) {
    const ts = new Date(message.ts || Date.now()).toISOString();
    const safeId = String(message.id || 'message').replace(/[^a-z0-9_-]/gi, '_');
    if (format === 'json') {
      const payload = {
        id: message.id, role: message.role, ts: message.ts || null, model: message.model || null,
        decision: message.decision || null, tools: message.tools || [], content: message.content || '',
      };
      downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `aion-${safeId}.json`);
      return;
    }
    let body = message.content || '';
    if (message.tools?.length) {
      body = body + '\n\n---\n\nTool evidence:\n';
      for (const t of message.tools) body += `- ${t.tool || t.type}: ${JSON.stringify(t).slice(0, 200)}\n`;
    }
    if (message.decision) body = body + `\n\n---\n\nDecision: ${message.decision.state} (score ${message.decision.score})\n`;
    downloadBlob(new Blob([body], { type: 'text/markdown' }), `aion-${safeId}.md`);
  }

  function deleteMessage(messageId) {
    const conv = activeConversation();
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    if (!confirm('Delete this message?')) return;
    conv.messages.splice(idx, 1);
    saveConversations();
    renderMessages();
    showToast('Message deleted');
  }

  // Speak a message: try server TTS first, fall back to browser SpeechSynthesis.
  // The server route returns base64 mp3 + we build a VTT track from the message text.
  // If the server call fails or the key is missing, the browser does the speaking
  // (and we still attach captions via the text content).
  async function speakMessage(message, button) {
    const text = (message.content || '').trim();
    if (!text) { showToast('Nothing to speak.'); return; }
    // Stop any in-flight browser speech first
    if (window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch {}
    const original = button.innerHTML;
    button.innerHTML = '<span>…</span>';
    button.disabled = true;
    try {
      // Build the VTT up front so the captions are ready regardless of which TTS wins
      const vtt = buildVttFromText(text);
      if (vtt) message.vttSrc = vttDataUrl(vtt);
      // Try server TTS (OpenAI gpt-4o-mini-tts) for high quality
      const r = await apiFetch('/api/tts', {
        method: 'POST',
        body: JSON.stringify({ text, voice: state.settings.ttsVoice || 'alloy', format: 'mp3' }),
      });
      const payload = await r.json().catch(() => ({}));
      if (r.ok && payload && payload.ok && payload.audio_b64) {
        const bytes = Uint8Array.from(atob(payload.audio_b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        message.audioSrc = URL.createObjectURL(blob);
        saveConversations();
        renderMessages();
        // Find the new audio element + auto-play
        setTimeout(() => {
          const audio = document.querySelector(`.message[data-id="${message.id}"] .message-audio`);
          if (audio) audio.play().catch(() => {});
        }, 50);
        showToast('Speaking via AION voice');
        return;
      }
      // Server unavailable — fall back to browser SpeechSynthesis
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0; u.pitch = 1.0;
        window.speechSynthesis.speak(u);
        showToast('Browser speech (server: ' + (payload?.error || 'unavailable') + ')');
      } else {
        showToast('TTS unavailable: ' + (payload?.error || 'no backend key'));
      }
    } catch (err) {
      showToast('Speak failed: ' + (err.message || err));
    } finally {
      button.innerHTML = original;
      button.disabled = false;
    }
  }
