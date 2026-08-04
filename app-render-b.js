
  function renderTool(tool) {
    const card = document.createElement('section');
    card.className = 'tool-card';
    const heading = document.createElement('h4');
    heading.textContent = tool.type === 'tool_error' ? `${tool.tool || 'Tool'} error` : tool.tool === 'web_search' ? `Web search: ${tool.query}` : `${tool.tool || 'GitHub'} · ${tool.repository || ''}`;
    card.append(heading);
    if (tool.type === 'tool_error') {
      const error = document.createElement('div');
      error.className = 'error-box';
      error.textContent = tool.message || 'Tool failed';
      card.append(error);
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
