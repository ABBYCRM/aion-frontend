  'use strict';

  // Aion Code tab — direct access to the 4 code corpora:
  //   1. syntax      (9 languages × 100k token-level patterns)
  //   2. scenarios   (29 languages × 100k engineering scenarios)
  //   3. tasks       (5,000 structured engineering tasks)
  //   4. books       (39 open coding books)
  //   5. drill       (auto-routes by intent, like the chat Phase B)
  //
  // This tab is the "Code workspace" of the Aion frontend. It does NOT
  // install Cline or any other agent. It calls the same /api/skills/run
  // endpoint the operator/admin already uses; the LLM is never invoked.
  // Every result row is a real row from a real corpus (CSV/RAG/on-disk
  // txt). The model never invents a CT- id, a book title, or a snippet.

  function openCodeDialog() {
    if (!dom.codeDialog) return;
    if (!dom.codeDialog.open) dom.codeDialog.showModal();
    // Lazy-load the language lists the first time the tab is opened.
    if (state.codeLanguagesLoaded !== true) {
      loadCodeLanguages();
      state.codeLanguagesLoaded = true;
    }
  }

  function setCodeTab(name) {
    document.querySelectorAll('.code-tab').forEach((tab) => {
      const active = tab.dataset.codeTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.code-panel').forEach((panel) => {
      panel.hidden = panel.dataset.codePanel !== name;
    });
  }

  // ---------- language list loaders (call /api/skills/run list/browse) -----

  async function loadCodeLanguages() {
    // syntax.list + extra.scenarios.list in parallel
    try {
      const [synR, scnR] = await Promise.all([
        apiFetch('/api/skills/run', {
          method: 'POST',
          body: JSON.stringify({ skill_id: 'syntax.list', args: {} }),
        }),
        apiFetch('/api/skills/run', {
          method: 'POST',
          body: JSON.stringify({ skill_id: 'extra.scenarios.list', args: {} }),
        }),
      ]);
      const synData = await synR.json();
      const scnData = await scnR.json();
      populateSelectFromList(dom.codeSyntaxLanguage, synData?.data?.technologies || synData?.data?.list || []);
      populateSelectFromList(dom.codeScenariosLanguage, scnData?.data?.languages || scnData?.data?.list || []);
      if (dom.codeSyntaxStatus) {
        const synCount = (synData?.data?.technologies || synData?.data?.list || []).length;
        dom.codeSyntaxStatus.textContent = `${synCount} languages, 100k snippets each.`;
      }
      if (dom.codeScenariosStatus) {
        const scnCount = (scnData?.data?.languages || scnData?.data?.list || []).length;
        dom.codeScenariosStatus.textContent = `${scnCount} languages, 100k scenarios each.`;
      }
    } catch (err) {
      if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = `Load failed: ${err.message}`;
      if (dom.codeScenariosStatus) dom.codeScenariosStatus.textContent = `Load failed: ${err.message}`;
    }
  }

  function populateSelectFromList(select, items) {
    if (!select) return;
    select.innerHTML = '';
    for (const item of items) {
      const opt = document.createElement('option');
      // items can be:
      //   - "python" (string)
      //   - ["python", 100000] (tuple)
      //   - {technology, display, count} (syntax.list shape)
      //   - {slug, name, count} or {language, count} (extra.scenarios.list shape)
      if (typeof item === 'string') {
        opt.value = item;
        opt.textContent = item;
      } else if (Array.isArray(item)) {
        opt.value = item[0];
        opt.textContent = item[1] != null ? `${item[0]} (${item[1]})` : item[0];
      } else {
        const slug = item.technology || item.slug || item.name || item.language || item.id || String(item);
        const display = item.display || item.label || slug;
        const count = item.count;
        opt.value = slug;
        opt.textContent = count != null ? `${display} (${count})` : display;
      }
      select.appendChild(opt);
    }
  }

  // ---------- syntax tab -------------------------------------------------

  async function codeSyntaxBrowse() {
    const tech = dom.codeSyntaxLanguage?.value;
    if (!tech) { if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = 'Pick a language.'; return; }
    const construct = dom.codeSyntaxConstruct?.value || '';
    if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'syntax.browse',
          args: { technology: tech, construct: construct || undefined, limit: 20 },
        }),
      });
      const data = await r.json();
      const snippets = data?.data?.snippets || data?.data?.results || data?.data?.hits || [];
      renderSyntaxList(snippets);
      if (dom.codeSyntaxStatus) {
        const after = data?.data?.total_after_filter;
        const inFile = data?.data?.total_in_technology;
        dom.codeSyntaxStatus.textContent = `${snippets.length} snippet(s). ${after != null ? `${after} match the filter` : ''}${inFile != null ? ` out of ${inFile} in ${tech}.` : '.'}`;
      }
    } catch (err) {
      if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = `Browse failed: ${err.message}`;
    }
  }

  async function codeSyntaxGet() {
    const tech = dom.codeSyntaxLanguage?.value;
    const id = dom.codeSyntaxId?.value?.trim();
    if (!tech || !id) { if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = 'Pick a language and enter an id.'; return; }
    if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'syntax.get',
          args: { technology: tech, id: id },
        }),
      });
      const data = await r.json();
      const snippet = data?.data?.snippet || data?.data;
      if (dom.codeSyntaxSnippet) {
        dom.codeSyntaxSnippet.hidden = false;
        dom.codeSyntaxSnippet.textContent = JSON.stringify(snippet, null, 2);
      }
      if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = `id=${id} loaded.`;
    } catch (err) {
      if (dom.codeSyntaxStatus) dom.codeSyntaxStatus.textContent = `Get failed: ${err.message}`;
    }
  }

  function renderSyntaxList(snippets) {
    if (!dom.codeSyntaxList) return;
    dom.codeSyntaxList.innerHTML = '';
    if (!snippets.length) {
      dom.codeSyntaxList.innerHTML = '<p class="muted">No snippets for this filter.</p>';
      return;
    }
    for (const s of snippets) {
      const row = document.createElement('div');
      row.className = 'stack-row';
      const id = s.id || `${s.technology || ''}/${s.construct || ''}/${s.seq || ''}`;
      const text = s.snippet || s.text || s.code || JSON.stringify(s);
      row.innerHTML = `
        <div class="stack-row-head">
          <code class="stack-row-id">${escapeHtml(id)}</code>
          <span class="muted">${escapeHtml(s.construct || '')}</span>
        </div>
        <pre class="json-output">${escapeHtml(text.slice(0, 600))}${text.length > 600 ? '\n…' : ''}</pre>
      `;
      dom.codeSyntaxList.appendChild(row);
    }
  }

  // ---------- scenarios tab ----------------------------------------------

  async function codeScenariosSearch() {
    const lang = dom.codeScenariosLanguage?.value;
    const query = dom.codeScenariosQuery?.value?.trim();
    if (!lang) { if (dom.codeScenariosStatus) dom.codeScenariosStatus.textContent = 'Pick a language.'; return; }
    if (!query) { if (dom.codeScenariosStatus) dom.codeScenariosStatus.textContent = 'Enter a query.'; return; }
    if (dom.codeScenariosStatus) dom.codeScenariosStatus.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'extra.scenarios.search',
          args: { language: lang, query, limit: 15 },
        }),
      });
      const data = await r.json();
      const hits = data?.data?.hits || data?.data?.results || [];
      renderScenariosList(hits);
      if (dom.codeScenariosStatus) {
        dom.codeScenariosStatus.textContent = `${hits.length} real scenario(s) for "${query}" in ${lang}.`;
      }
    } catch (err) {
      if (dom.codeScenariosStatus) dom.codeScenariosStatus.textContent = `Search failed: ${err.message}`;
    }
  }

  function renderScenariosList(hits) {
    if (!dom.codeScenariosList) return;
    dom.codeScenariosList.innerHTML = '';
    if (!hits.length) {
      dom.codeScenariosList.innerHTML = '<p class="muted">No scenarios match. The corpus is the source of truth; an empty result means the operator corpus has no row for that query.</p>';
      return;
    }
    for (const h of hits) {
      const row = document.createElement('div');
      row.className = 'stack-row';
      const id = h.id || '';
      const concept = h.concept || h.domain || '';
      const action = h.action || '';
      const constraint = h.constraint || '';
      const failure = h.failure || '';
      row.innerHTML = `
        <div class="stack-row-head">
          <code class="stack-row-id">${escapeHtml(id)}</code>
          <span class="muted">${escapeHtml(concept)}</span>
        </div>
        <p><strong>Action:</strong> ${escapeHtml(action)}</p>
        <p><strong>Constraint:</strong> ${escapeHtml(constraint)}</p>
        <p><strong>Failure mode:</strong> ${escapeHtml(failure)}</p>
      `;
      dom.codeScenariosList.appendChild(row);
    }
  }

  // ---------- tasks tab --------------------------------------------------

  async function codeTasksSearch() {
    const query = dom.codeTasksQuery?.value?.trim();
    if (!query) { if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = 'Enter a query.'; return; }
    if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'coding.tasks.search',
          args: { query, limit: 15 },
        }),
      });
      const data = await r.json();
      const hits = data?.data?.hits || data?.data?.results || [];
      renderTasksList(hits);
      if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = `${hits.length} task(s) for "${query}".`;
    } catch (err) {
      if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = `Search failed: ${err.message}`;
    }
  }

  async function codeTasksCatalog() {
    if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = 'Loading catalog…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({ skill_id: 'coding.tasks.catalog', args: { limit: 50 } }),
      });
      const data = await r.json();
      const hits = data?.data?.tasks || data?.data?.results || data?.data?.hits || [];
      renderTasksList(hits);
      if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = `${hits.length} task(s) from catalog.`;
    } catch (err) {
      if (dom.codeTasksStatus) dom.codeTasksStatus.textContent = `Catalog failed: ${err.message}`;
    }
  }

  function renderTasksList(hits) {
    if (!dom.codeTasksList) return;
    dom.codeTasksList.innerHTML = '';
    if (!hits.length) {
      dom.codeTasksList.innerHTML = '<p class="muted">No tasks match. The CSV is the source of truth.</p>';
      return;
    }
    for (const t of hits) {
      const row = document.createElement('div');
      row.className = 'stack-row';
      const id = t.id || '';
      const title = t.title || '';
      const objective = t.objective || t.description || '';
      const tags = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');
      row.innerHTML = `
        <div class="stack-row-head">
          <code class="stack-row-id">${escapeHtml(id)}</code>
          <span class="muted">${escapeHtml(tags)}</span>
        </div>
        <p><strong>${escapeHtml(title)}</strong></p>
        <p>${escapeHtml(objective)}</p>
      `;
      dom.codeTasksList.appendChild(row);
    }
  }

  // ---------- books tab --------------------------------------------------

  async function codeBooksSearch() {
    const query = dom.codeBooksQuery?.value?.trim();
    if (!query) { if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = 'Enter a query.'; return; }
    if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = 'Loading…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'coding.books.search',
          args: { query, limit: 15 },
        }),
      });
      const data = await r.json();
      const hits = data?.data?.hits || data?.data?.results || [];
      renderBooksList(hits);
      if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = `${hits.length} book(s) for "${query}".`;
    } catch (err) {
      if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = `Search failed: ${err.message}`;
    }
  }

  async function codeBooksCatalog() {
    if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = 'Loading catalog…';
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({ skill_id: 'coding.books.catalog', args: { limit: 50 } }),
      });
      const data = await r.json();
      const hits = data?.data?.books || data?.data?.results || data?.data?.hits || [];
      renderBooksList(hits);
      if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = `${hits.length} book(s) from catalog.`;
    } catch (err) {
      if (dom.codeBooksStatus) dom.codeBooksStatus.textContent = `Catalog failed: ${err.message}`;
    }
  }

  function renderBooksList(hits) {
    if (!dom.codeBooksList) return;
    dom.codeBooksList.innerHTML = '';
    if (!hits.length) {
      dom.codeBooksList.innerHTML = '<p class="muted">No books match. The catalog JSON is the source of truth.</p>';
      return;
    }
    for (const b of hits) {
      // search returns {text, meta:{title,level,url_primary,...}} ; catalog returns the flat book
      const meta = b.meta || b;
      const title = meta.title || '';
      const id = meta.book_id || b.id || '';
      const level = meta.level || '';
      const topic = meta.topic || '';
      const url = meta.url_primary || meta.url || '';
      const desc = (meta.description || b.text || '').slice(0, 200);
      const row = document.createElement('div');
      row.className = 'stack-row';
      row.innerHTML = `
        <div class="stack-row-head">
          <code class="stack-row-id">${escapeHtml(id)}</code>
          <span class="muted">${escapeHtml(level)} · ${escapeHtml(topic)}</span>
        </div>
        <p><strong><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></strong></p>
        <p class="muted">${escapeHtml(desc)}</p>
      `;
      dom.codeBooksList.appendChild(row);
    }
  }

  // ---------- drill tab (intent router, same as chat Phase B) ------------

  async function codeDrillRun() {
    const text = dom.codeDrillQuery?.value?.trim();
    if (!text) { if (dom.codeDrillStatus) dom.codeDrillStatus.textContent = 'Enter a prompt.'; return; }
    if (dom.codeDrillStatus) dom.codeDrillStatus.textContent = 'Routing…';
    if (!dom.codeDrillList) return;
    dom.codeDrillList.innerHTML = '';
    // The backend already has _gather_corpus_evidence in app/main.py. We
    // could expose it as a /api/code/evidence endpoint, but the simplest
    // path is to re-use the chat SSE stream and pluck out the tool
    // events. Tradeoff: a tiny /api/code/evidence endpoint is cleaner
    // and avoids LLM involvement. Below we use the per-corpus skills
    // directly with regex priority matching the chat (most specific first).
    const m = text.match(/\b(go|rust|python|typescript|javascript|java|php|ruby|swift|kotlin|c#|csharp)\b/i);
    const langAlias = { go: 'go', rust: 'rust', python: 'python', typescript: 'typescript', javascript: 'javascript', java: 'java', php: 'php', ruby: 'ruby', swift: 'swift', kotlin: 'kotlin', 'c#': 'c_sharp', csharp: 'c_sharp' };
    const lang = m ? langAlias[m[1].toLowerCase()] : null;
    const routedTo = [];
    if (lang) {
      routedTo.push(['extra.scenarios.search', { language: lang, query: text, limit: 5 }]);
    }
    if (/drill|interview|practice\s+task|coding\s+task/i.test(text)) {
      routedTo.push(['coding.tasks.search', { query: text, limit: 5 }]);
    }
    if (/book|textbook|recommend|cite/i.test(text)) {
      routedTo.push(['coding.books.search', { query: text, limit: 5 }]);
    }
    if (!routedTo.length) {
      // Fall back: send to extra.scenarios.search with the first known
      // language, or to coding.tasks.search if no language is in the text.
      routedTo.push(['coding.tasks.search', { query: text, limit: 5 }]);
    }
    const allHits = [];
    for (const [skillId, args] of routedTo) {
      try {
        const r = await apiFetch('/api/skills/run', {
          method: 'POST',
          body: JSON.stringify({ skill_id: skillId, args }),
        });
        const data = await r.json();
        const hits = data?.data?.hits || data?.data?.results || [];
        allHits.push({ skill: skillId, hits });
      } catch (err) {
        allHits.push({ skill: skillId, error: err.message });
      }
    }
    renderDrillList(allHits, text);
    if (dom.codeDrillStatus) {
      const total = allHits.reduce((n, r) => n + (r.hits?.length || 0), 0);
      dom.codeDrillStatus.textContent = `${total} real row(s) from ${allHits.length} corpus/corpora.`;
    }
  }

  function renderDrillList(routed, query) {
    if (!dom.codeDrillList) return;
    if (!routed.length) return;
    const header = document.createElement('p');
    header.className = 'muted';
    header.textContent = `Routed "${query}" by intent — most-specific corpus first.`;
    dom.codeDrillList.appendChild(header);
    for (const r of routed) {
      const blockHeader = document.createElement('h3');
      blockHeader.textContent = `${r.skill}${r.hits ? ` (${r.hits.length} hits)` : ` (error: ${r.error})`}`;
      dom.codeDrillList.appendChild(blockHeader);
      if (!r.hits) continue;
      if (!r.hits.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No rows. The corpus is the source of truth.';
        dom.codeDrillList.appendChild(empty);
        continue;
      }
      // Reuse renderers
      const wrap = document.createElement('div');
      wrap.className = 'stack-list';
      dom.codeDrillList.appendChild(wrap);
      // Re-route by skill id
      if (r.skill === 'extra.scenarios.search') {
        // render into wrap via a temporary list trick: just re-call render
        // into wrap by swapping dom.codeScenariosList
        const prev = dom.codeScenariosList;
        dom.codeScenariosList = wrap;
        renderScenariosList(r.hits);
        dom.codeScenariosList = prev;
      } else if (r.skill === 'coding.tasks.search') {
        const prev = dom.codeTasksList;
        dom.codeTasksList = wrap;
        renderTasksList(r.hits);
        dom.codeTasksList = prev;
      } else if (r.skill === 'coding.books.search') {
        const prev = dom.codeBooksList;
        dom.codeBooksList = wrap;
        renderBooksList(r.hits);
        dom.codeBooksList = prev;
      }
    }
  }

  // ---------- utilities ---------------------------------------------------

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/javascript:/gi, '');
  }

  function wireCodeDialog() {
    if (!dom.openCode) return;
    dom.openCode.addEventListener('click', openCodeDialog);
    // tab switcher
    document.querySelectorAll('.code-tab').forEach((tab) => {
      tab.addEventListener('click', () => setCodeTab(tab.dataset.codeTab));
    });
    // syntax
    if (dom.codeSyntaxBrowse) dom.codeSyntaxBrowse.addEventListener('click', codeSyntaxBrowse);
    if (dom.codeSyntaxGet) dom.codeSyntaxGet.addEventListener('click', codeSyntaxGet);
    // scenarios
    if (dom.codeScenariosSearch) dom.codeScenariosSearch.addEventListener('click', codeScenariosSearch);
    if (dom.codeScenariosQuery) {
      dom.codeScenariosQuery.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); codeScenariosSearch(); }
      });
    }
    // tasks
    if (dom.codeTasksSearch) dom.codeTasksSearch.addEventListener('click', codeTasksSearch);
    if (dom.codeTasksCatalog) dom.codeTasksCatalog.addEventListener('click', codeTasksCatalog);
    if (dom.codeTasksQuery) {
      dom.codeTasksQuery.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); codeTasksSearch(); }
      });
    }
    // books
    if (dom.codeBooksSearch) dom.codeBooksSearch.addEventListener('click', codeBooksSearch);
    if (dom.codeBooksCatalog) dom.codeBooksCatalog.addEventListener('click', codeBooksCatalog);
    if (dom.codeBooksQuery) {
      dom.codeBooksQuery.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); codeBooksSearch(); }
      });
    }
    // drill
    if (dom.codeDrillRun) dom.codeDrillRun.addEventListener('click', codeDrillRun);
    if (dom.codeDrillQuery) {
      dom.codeDrillQuery.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); codeDrillRun(); }
      });
    }
  }
