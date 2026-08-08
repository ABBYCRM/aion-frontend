// Aion Code tab — single search bar + 4 corpus tiles + result cards.
//
// The previous design was a 5-tab form (Syntax / Scenarios / Tasks / Books /
// Drill) with per-tab <select> filters that only a corpus engineer could
// use. v2.8.5 replaces that with:
//
//   1. One big search bar — type a query, hit Enter, Aion searches all
//      4 corpora in parallel and shows the results below.
//   2. 4 corpus tiles — always visible. Each shows its name, count, and
//      a one-liner explaining what's in it, plus a per-corpus "Browse"
//      button. Syntax and Scenarios have a Language <select> inline.
//   3. 4 result sections — populated as the user searches or browses.
//      Each card has the corpus id (click to copy) plus type-specific
//      body content.
//
// This is still the Aion Code tab: it calls /api/skills/run and never
// invokes the LLM. Every row is a real row from a real corpus.

// NOTE: This file is intentionally NOT wrapped in an IIFE — the other
// AION PWA scripts (app-chat-a.js, app-render-*.js, app-tools.js, etc.)
// all expose their helpers (apiFetch, dom, state, escapeHtml, etc.) at
// the top level so any later script can call them. The old Aion Code
// file followed the same convention. If you wrap this in an IIFE the
// closure will not see apiFetch and loadLanguagesIntoTiles() will fail
// silently.

// ----- public entry points -------------------------------------------

  function openCodeDialog() {
    if (!dom.codeDialog) return;
    if (!dom.codeDialog.open) dom.codeDialog.showModal();
    if (state.languagesLoaded !== true) {
      loadLanguagesIntoTiles();
      state.languagesLoaded = true;
    }
  }

  // ----- state + dom map -----------------------------------------------

  const state = { languagesLoaded: false };

  // ----- language list loaders (fill the two per-corpus selects) ------

  async function loadLanguagesIntoTiles() {
    setStatus('Loading corpora…');
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
      const syn = await synR.json();
      const scn = await scnR.json();
      const langs = (syn.data?.technologies) || [];
      const scenariosLangs = (scn.data?.languages) || [];

      fillLanguageSelect(dom.codeSyntaxLanguage, langs, 'technology', 'display', 'count');
      fillLanguageSelect(dom.codeScenariosLanguage, scenariosLangs, 'language', 'technology', 'count');

      // Update the tile counts (short, never truncate)
      if (dom.codeSyntaxCount) dom.codeSyntaxCount.textContent = `${langs.length} langs · 900k`;
      if (dom.codeScenariosCount) dom.codeScenariosCount.textContent = `${scenariosLangs.length} langs · 2.9M`;
      if (dom.codeTasksCount) dom.codeTasksCount.textContent = '5,000 tasks';
      if (dom.codeBooksCount) dom.codeBooksCount.textContent = '39 books';

      setStatus('Press Enter or click Search to query all four corpora at once.');
    } catch (err) {
      setStatus(`Load failed: ${err.message}`);
    }
  }

  function fillLanguageSelect(select, items, valueKey, labelKey, countKey) {
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    for (const item of items) {
      const opt = document.createElement('option');
      const value = item[valueKey];
      const label = item[labelKey] || value;
      const count = item[countKey];
      opt.value = value;
      opt.textContent = count != null ? `${label} (${count.toLocaleString()})` : label;
      select.appendChild(opt);
    }
    if (prev && items.find((i) => i[valueKey] === prev)) select.value = prev;
  }

  // ----- the one big search -------------------------------------------

  async function runGlobalSearch() {
    const query = dom.codeSearchInput?.value?.trim();
    if (!query) {
      setStatus('Type a query to search all four corpora.');
      dom.codeSearchInput?.focus();
      return;
    }
    setStatus(`Searching all corpora for "${query}"…`);
    hideAllResults();

    // Run the four searches in parallel. Each one is independent — if a
    // corpus errors out, we still show the other three. The user sees
    // the union of real rows.
    const [syntax, scenarios, tasks, books] = await Promise.allSettled([
      searchSyntax({ query }),
      searchScenarios({ query }),
      searchTasks({ query }),
      searchBooks({ query }),
    ]);

    const totalHits =
      (syntax.status === 'fulfilled' ? syntax.value.hits.length : 0) +
      (scenarios.status === 'fulfilled' ? scenarios.value.hits.length : 0) +
      (tasks.status === 'fulfilled' ? tasks.value.hits.length : 0) +
      (books.status === 'fulfilled' ? books.value.hits.length : 0);

    setStatus(
      totalHits > 0
        ? `${totalHits} real row(s) across all corpora for "${query}". Click any id to copy.`
        : `No rows in any corpus match "${query}". Try a different phrasing — the corpora are the source of truth, so an empty result means no real row matched.`
    );
  }

  // ----- per-corpus search/browse ------------------------------------

  async function searchSyntax({ query }) {
    const tech = dom.codeSyntaxLanguage?.value;
    if (!tech) return { hits: [], note: 'no language selected' };
    // The syntax corpus is a per-language file. We post-filter the
    // results client-side by the query (the corpus itself is 100k lines
    // per language — there are no full-text indexes for ad-hoc terms).
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({
        skill_id: 'syntax.browse',
        args: { technology: tech, limit: 200 },  // over-fetch; we filter
      }),
    });
    const data = await r.json();
    const all = data?.data?.snippets || [];
    const q = query.toLowerCase();
    const hits = all.filter((s) => (s.snippet || '').toLowerCase().includes(q)).slice(0, 20);
    renderSyntaxList(hits);
    setResultMeta('syntax', `${hits.length} of ${all.length} in ${tech} match "${query}".`);
    showResult('syntax', hits.length > 0);
    return { hits };
  }

  async function browseSyntax() {
    const tech = dom.codeSyntaxLanguage?.value;
    if (!tech) {
      setStatus('Pick a language to browse syntax.');
      return;
    }
    setStatus(`Browsing syntax for ${tech}…`);
    hideAllResults();
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({ skill_id: 'syntax.browse', args: { technology: tech, limit: 12 } }),
    });
    const data = await r.json();
    const hits = data?.data?.snippets || [];
    renderSyntaxList(hits);
    setResultMeta('syntax', `${hits.length} snippet(s) from ${tech} (showing first 12 of ${data?.data?.total_in_technology || '?'}).`);
    showResult('syntax', hits.length > 0);
    setStatus(`Showing ${hits.length} syntax snippet(s) from ${tech}.`);
  }

  async function searchScenarios({ query }) {
    const lang = dom.codeScenariosLanguage?.value;
    if (!lang) return { hits: [], note: 'no language selected' };
    try {
      const r = await apiFetch('/api/skills/run', {
        method: 'POST',
        body: JSON.stringify({
          skill_id: 'extra.scenarios.search',
          args: { language: lang, query, limit: 12 },
        }),
      });
      const data = await r.json();
      if (data?.ok === false) {
        setResultMeta('scenarios', data.message || 'Search unavailable.');
        showResult('scenarios', false);
        return { hits: [] };
      }
      const hits = data?.data?.hits || data?.data?.results || [];
      renderScenariosList(hits);
      setResultMeta('scenarios', `${hits.length} scenario(s) for "${query}" in ${lang}.`);
      showResult('scenarios', hits.length > 0);
      return { hits };
    } catch (err) {
      setResultMeta('scenarios', `Scenarios: ${err.message}`);
      showResult('scenarios', false);
      return { hits: [] };
    }
  }

  async function browseScenarios() {
    const lang = dom.codeScenariosLanguage?.value;
    if (!lang) {
      setStatus('Pick a language to browse scenarios.');
      return;
    }
    setStatus(`Browsing scenarios for ${lang}…`);
    hideAllResults();
    // The browse case uses a no-op query — we just want the first N
    // scenarios. extra.scenarios.search with empty query returns the
    // head of the file.
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({ skill_id: 'extra.scenarios.search', args: { language: lang, query: '', limit: 12 } }),
    });
    const data = await r.json();
    if (data?.ok === false) {
      setResultMeta('scenarios', data.message || 'Search unavailable.');
      showResult('scenarios', false);
      setStatus(`Scenarios: ${data.message || 'unavailable'}`);
      return;
    }
    const hits = data?.data?.hits || data?.data?.results || [];
    renderScenariosList(hits);
    setResultMeta('scenarios', `${hits.length} scenario(s) from ${lang}.`);
    showResult('scenarios', hits.length > 0);
    setStatus(`Showing ${hits.length} scenario(s) from ${lang}.`);
  }

  async function searchTasks({ query }) {
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({
        skill_id: 'coding.tasks.search',
        args: { query, limit: 8 },
      }),
    });
    const data = await r.json();
    const hits = data?.data?.hits || [];
    renderTasksList(hits);
    setResultMeta('tasks', `${hits.length} task(s) for "${query}".`);
    showResult('tasks', hits.length > 0);
    return { hits };
  }

  async function browseTasks() {
    setStatus('Browsing task catalog…');
    hideAllResults();
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({ skill_id: 'coding.tasks.catalog', args: { limit: 8 } }),
    });
    const data = await r.json();
    const hits = data?.data?.tasks || data?.data?.results || data?.data?.hits || [];
    renderTasksList(hits);
    setResultMeta('tasks', `${hits.length} task(s) from catalog (first page of 5,000).`);
    showResult('tasks', hits.length > 0);
    setStatus(`Showing ${hits.length} task(s) from the catalog.`);
  }

  async function searchBooks({ query }) {
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({
        skill_id: 'coding.books.search',
        args: { query, limit: 8 },
      }),
    });
    const data = await r.json();
    const hits = data?.data?.hits || [];
    renderBooksList(hits);
    setResultMeta('books', `${hits.length} book(s) for "${query}".`);
    showResult('books', hits.length > 0);
    return { hits };
  }

  async function browseBooks() {
    setStatus('Browsing book catalog…');
    hideAllResults();
    const r = await apiFetch('/api/skills/run', {
      method: 'POST',
      body: JSON.stringify({ skill_id: 'coding.books.catalog', args: { limit: 39 } }),
    });
    const data = await r.json();
    const hits = data?.data?.books || data?.data?.results || data?.data?.hits || [];
    renderBooksList(hits);
    setResultMeta('books', `${hits.length} book(s) from catalog.`);
    showResult('books', hits.length > 0);
    setStatus(`Showing ${hits.length} book(s) from the catalog.`);
  }

  // ----- result rendering ---------------------------------------------

  function showResult(name, hasContent) {
    const section = document.querySelector(`.code-result-section[data-result="${name}"]`);
    if (!section) return;
    section.hidden = !hasContent;
  }
  function hideAllResults() {
    document.querySelectorAll('.code-result-section').forEach((s) => { s.hidden = true; });
  }
  function setResultMeta(name, text) {
    const el = document.getElementById(`code${capitalize(name)}Meta`);
    if (el) el.textContent = text || '';
  }
  function setStatus(text) {
    if (dom.codeSearchStatus) dom.codeSearchStatus.textContent = text || '';
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function emptyState(text) {
    return `<p class="code-empty-state">${escapeHtml(text)}</p>`;
  }

  // Syntax: one-line code snippet + construct tag.
  function renderSyntaxList(snippets) {
    if (!dom.codeSyntaxList) return;
    if (!snippets.length) {
      dom.codeSyntaxList.innerHTML = emptyState('No syntax snippets match. The corpus is the source of truth — try a different word or pick another language.');
      return;
    }
    dom.codeSyntaxList.innerHTML = snippets.map((s) => {
      const id = s.id || `${s.technology}/${s.construct}/${s.seq || ''}`;
      return `
        <article class="code-card">
          <header class="code-card-head">
            <span class="code-card-id" data-copy-id="${escapeAttr(id)}" role="button" tabindex="0" title="Click to copy id">${escapeHtml(id)}</span>
            <span class="code-card-meta">
              <span class="chip">${escapeHtml(s.construct || 'snippet')}</span>
              <span>${escapeHtml(s.display || s.technology || '')}</span>
            </span>
          </header>
          <pre class="code-snippet">${escapeHtml(s.snippet || s.text || '')}</pre>
        </article>
      `;
    }).join('');
  }

  // Scenarios: action / constraint / failure-mode paragraphs.
  // The real keys are `action`, `constraint`, `failure_mode` (or `failure`).
  function renderScenariosList(hits) {
    if (!dom.codeScenariosList) return;
    if (!hits.length) {
      dom.codeScenariosList.innerHTML = emptyState('No scenarios match. Scenarios are organized by language — try a different one, or phrase the query more broadly.');
      return;
    }
    dom.codeScenariosList.innerHTML = hits.map((h) => {
      const id = h.id || '';
      const action = h.action || h.task || h.scenario || '';
      const constraint = h.constraint || h.constraints || '';
      const failure = h.failure_mode || h.failure || '';
      return `
        <article class="code-card">
          <header class="code-card-head">
            <span class="code-card-id" data-copy-id="${escapeAttr(id)}" role="button" tabindex="0" title="Click to copy id">${escapeHtml(id)}</span>
            <span class="code-card-meta">
              ${h.concept ? `<span class="chip">${escapeHtml(h.concept)}</span>` : ''}
              ${h.domain ? `<span class="chip">${escapeHtml(h.domain)}</span>` : ''}
            </span>
          </header>
          <div class="code-card-body">
            ${action ? `<p>${escapeHtml(action)}</p>` : '<p class="code-empty">No action recorded.</p>'}
            ${constraint ? `<p><strong>Constraint:</strong> ${escapeHtml(constraint)}</p>` : ''}
            ${failure ? `<p><strong>Failure mode:</strong> ${escapeHtml(failure)}</p>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // Tasks: the structured CSV row. Real fields:
  //   id, domain, task_type, system, title, objective, context_name,
  //   principal_risks, edge_cases, required_validation.
  function renderTasksList(hits) {
    if (!dom.codeTasksList) return;
    if (!hits.length) {
      dom.codeTasksList.innerHTML = emptyState('No tasks match. The CSV is the source of truth — try a broader query.');
      return;
    }
    dom.codeTasksList.innerHTML = hits.map((t) => {
      const id = t.id || '';
      const title = t.title || t.system || '';
      return `
        <article class="code-card">
          <header class="code-card-head">
            <span class="code-card-id" data-copy-id="${escapeAttr(id)}" role="button" tabindex="0" title="Click to copy id">${escapeHtml(id)}</span>
            <span class="code-card-meta">
              ${t.domain ? `<span class="chip">${escapeHtml(t.domain)}</span>` : ''}
              ${t.task_type ? `<span class="chip">${escapeHtml(t.task_type)}</span>` : ''}
            </span>
          </header>
          <div class="code-card-body">
            <p class="code-title">${escapeHtml(title)}</p>
            ${t.objective ? `<p>${escapeHtml(t.objective)}</p>` : ''}
            ${t.principal_risks ? `<p><strong>Risks:</strong> ${escapeHtml(t.principal_risks)}</p>` : ''}
            ${t.edge_cases ? `<p><strong>Edge cases:</strong> ${escapeHtml(t.edge_cases)}</p>` : ''}
            ${t.required_validation ? `<p><strong>Validation:</strong> ${escapeHtml(t.required_validation)}</p>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // Books: title with link + structured meta.
  function renderBooksList(hits) {
    if (!dom.codeBooksList) return;
    if (!hits.length) {
      dom.codeBooksList.innerHTML = emptyState('No books match. The 39-book catalog is the source of truth — try a topic like "python", "DDD", "compilers".');
      return;
    }
    dom.codeBooksList.innerHTML = hits.map((b) => {
      const meta = b.meta || b;
      const id = meta.book_id || b.id || '';
      const title = meta.title || b.text?.split('\n')[0]?.replace(/^BOOK:\s*/, '') || '';
      const level = meta.level || '';
      const topics = Array.isArray(meta.topics) ? meta.topics.join(', ') : (meta.topics || '');
      const langs = Array.isArray(meta.languages) ? meta.languages.join(', ') : (meta.languages || '');
      const url = meta.url_primary || meta.url || '';
      return `
        <article class="code-card">
          <header class="code-card-head">
            <span class="code-card-id" data-copy-id="${escapeAttr(id)}" role="button" tabindex="0" title="Click to copy id">${escapeHtml(id)}</span>
            <span class="code-card-meta">
              ${level ? `<span class="chip">${escapeHtml(level)}</span>` : ''}
              ${meta.year ? `<span>${escapeHtml(String(meta.year))}</span>` : ''}
            </span>
          </header>
          <div class="code-card-body">
            <p class="code-title">
              ${url
                ? `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
                : escapeHtml(title)}
            </p>
            ${topics ? `<p><strong>Topics:</strong> ${escapeHtml(topics)}</p>` : ''}
            ${langs ? `<p><strong>Languages:</strong> ${escapeHtml(langs)}</p>` : ''}
            ${url ? `<a class="code-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }

  // ----- utilities -----------------------------------------------------

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/javascript:/gi, '').replace(/"/g, '&quot;');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  function flashCopied(el) {
    const orig = el.textContent;
    el.textContent = '✓ Copied';
    el.style.color = 'var(--ok)';
    setTimeout(() => {
      el.textContent = orig;
      el.style.color = '';
    }, 1200);
  }

  // ----- wiring --------------------------------------------------------

  function wireCodeDialog() {
    // The hero search bar
    if (dom.codeSearchForm) {
      dom.codeSearchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        runGlobalSearch();
      });
    }

    // Per-corpus browse buttons
    if (dom.codeSyntaxBrowse) dom.codeSyntaxBrowse.addEventListener('click', browseSyntax);
    if (dom.codeScenariosBrowse) dom.codeScenariosBrowse.addEventListener('click', browseScenarios);
    if (dom.codeTasksBrowse) dom.codeTasksBrowse.addEventListener('click', browseTasks);
    if (dom.codeBooksBrowse) dom.codeBooksBrowse.addEventListener('click', browseBooks);

    // The Code tab is opened via the data-action="code" tab-bar elements
    // (sidebar + mobile). The tab-bar's openTab() calls
    // window.AION_CODE.openCodeDialog() — we don't wire a click handler
    // here because that path is already taken.

    // Copy-on-click (delegated on the results area so it works for any
    // future result section we add)
    const results = document.querySelector('.code-results');
    if (results) {
      results.addEventListener('click', async (e) => {
        const target = e.target.closest('.code-card-id');
        if (!target) return;
        const id = target.getAttribute('data-copy-id');
        if (!id) return;
        const ok = await copyToClipboard(id);
        if (ok) flashCopied(target);
      });
      results.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target.closest('.code-card-id');
        if (!target) return;
        e.preventDefault();
        const id = target.getAttribute('data-copy-id');
        if (!id) return;
        const ok = await copyToClipboard(id);
        if (ok) flashCopied(target);
      });
    }
  }

  // Expose to the global namespace so app-boot.js's tab-bar can call
  // openCodeDialog() (the tab-bar data-action="code" handler).
  window.AION_CODE = {
    openCodeDialog,
    runGlobalSearch,
    browseSyntax, browseScenarios, browseTasks, browseBooks,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireCodeDialog);
  } else {
    wireCodeDialog();
  }
