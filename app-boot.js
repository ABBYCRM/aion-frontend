  function renderAll() {
    renderSidebar();
    renderMessages();
    renderAttachments();
    autosize();
  }

  function closeSidebar() {
    dom.app.classList.remove('sidebar-open');
  }

  // Map tab-bar action → index + open behavior. Single source of truth for
  // both the sidebar tab bar (radios) and the mobile bottom bar (buttons).
  const TAB_ACTIONS = {
    media:    { index: 0, open: () => { if (typeof openMediaDialog === 'function') openMediaDialog(); else if (dom.mediaDialog) dom.mediaDialog.showModal(); } },
    vault:    { index: 1, open: () => { if (dom.vaultDialog) dom.vaultDialog.showModal(); } },
    github:   { index: 2, open: () => { if (dom.githubDialog) dom.githubDialog.showModal(); } },
    code:     { index: 3, open: () => { if (typeof window.AION_CODE?.openCodeDialog === 'function') window.AION_CODE.openCodeDialog(); else if (dom.codeDialog) dom.codeDialog.showModal(); } },
    notes:    { index: 4, open: () => { if (dom.notesDialog) { dom.notesDialog.showModal(); if (typeof loadNotes === 'function') loadNotes(); } } },
    settings: { index: 5, open: () => { if (typeof openSettingsDialog === 'function') openSettingsDialog(); } },
  };

  // Keep both tab bars in sync with the currently active action.
  function setActiveTab(index) {
    document.querySelectorAll('.tab-bar').forEach((bar) => {
      bar.setAttribute('data-active', String(index));
      // Drive the radio in the sidebar version so :has() CSS also fires.
      const radio = bar.querySelector(`#tab-${index}`);
      if (radio) radio.checked = true;
      // Mark the active button on mobile (no radios there).
      bar.querySelectorAll('[data-action]').forEach((btn, i) => {
        if (i === index) btn.setAttribute('aria-current', 'true');
        else btn.removeAttribute('aria-current');
      });
    });
  }

  function openTab(action) {
    const tab = TAB_ACTIONS[action];
    if (!tab) return;
    setActiveTab(tab.index);
    tab.open();
    closeSidebar();  // on mobile, tapping a tab also closes the drawer
  }

  // When a dialog closes (cancel, X, backdrop, escape), reset the active
  // tab to 0 so the pill returns to Media — the first item. The chat
  // surface has no tab representation, so "no tab" maps to the default
  // position. (If you prefer the pill to disappear entirely on chat,
  // set data-active to -1 in the CSS rule above; we keep it visible to
  // make the next action obvious.)
  function resetActiveTab() {
    setActiveTab(0);
  }

  function bindEvents() {
    dom.newChat.addEventListener('click', () => { createConversation(); renderAll(); dom.prompt.focus(); closeSidebar(); });
    dom.openSidebar.addEventListener('click', () => dom.app.classList.add('sidebar-open'));
    dom.closeSidebar.addEventListener('click', () => closeSidebar());
    // Backdrop tap closes the mobile sidebar.
    dom.app.addEventListener('click', (event) => {
      if (!dom.app.classList.contains('sidebar-open')) return;
      if (window.matchMedia('(max-width: 800px)').matches) {
        // Click outside the sidebar = close.
        if (!event.target.closest('#sidebar') && !event.target.closest('#openSidebar')) {
          closeSidebar();
        }
      }
    });
    // Esc also closes the mobile sidebar.
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dom.app.classList.contains('sidebar-open')) closeSidebar();
    });
    dom.composer.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });
    dom.prompt.addEventListener('input', autosize);
    dom.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    });
    dom.prompt.addEventListener('paste', async (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) await ingestFiles(files);
    });
    dom.attachButton.addEventListener('click', chooseFiles);
    dom.stopButton.addEventListener('click', stopGeneration);
    dom.modelSelect.addEventListener('change', () => {
      const [provider, ...modelParts] = dom.modelSelect.value.split('::');
      state.selectedModel = provider && modelParts.length ? { provider, model: modelParts.join('::') } : null;
      saveSettings();
    });
    if (dom.openSettings) dom.openSettings.addEventListener('click', openSettingsDialog);
    dom.saveSettings.addEventListener('click', persistSettings);
    // Live-sync the temperature <output> as the slider moves.
    if (dom.temperature && dom.temperatureValue) {
      const syncTemp = () => { dom.temperatureValue.textContent = Number(dom.temperature.value).toFixed(1); };
      dom.temperature.addEventListener('input', syncTemp);
      syncTemp();
    }
    if (dom.refreshPolicy) dom.refreshPolicy.addEventListener('click', () => { refreshPolicy(); });
    dom.clearHistory.addEventListener('click', () => {
      if (!confirm('Clear all locally stored conversations?')) return;
      localStorage.removeItem(HISTORY_KEY);
      state.conversations = [];
      createConversation();
      renderAll();
      showToast('Local history cleared.');
    });
    if (dom.openNotes) dom.openNotes.addEventListener('click', () => { dom.notesDialog.showModal(); loadNotes(); });
    dom.noteForm.addEventListener('submit', addNote);
    dom.refreshNotes.addEventListener('click', loadNotes);
    dom.noteSearch.addEventListener('input', debounce(loadNotes, 250));
    if (dom.openGithub) dom.openGithub.addEventListener('click', () => dom.githubDialog.showModal());
    if (typeof wireCodeDialog === 'function') wireCodeDialog();
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => { $(button.dataset.closeDialog).close(); resetActiveTab(); });
    });
    document.querySelectorAll('[data-github-action]').forEach((button) => {
      button.addEventListener('click', () => runGithubAction(button.dataset.githubAction));
    });

    // Tab bars (sidebar + mobile bottom). Clicking a tab opens its dialog
    // AND moves the sliding pill. The radios in the sidebar version also
    // drive the pill via :has() CSS, but the click handler is what runs
    // the open() logic. For labels (sidebar), we DON'T preventDefault so
    // the radio gets checked. For buttons (mobile), we don't need to
    // preventDefault either (button type="button" doesn't submit), so we
    // can call openTab in both cases.
    document.querySelectorAll('.tab-bar [data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTab(btn.dataset.action);
      });
    });
    // Native close on any <dialog> resets the active tab so the pill
    // returns to the default position.
    document.querySelectorAll('dialog').forEach((d) => {
      d.addEventListener('close', () => { resetActiveTab(); });
    });
    // Esc also closes dialogs natively, and the close event fires, which
    // already resets the tab. So we don't need a separate Esc handler here.

    window.addEventListener('online', healthCheck);
    window.addEventListener('offline', healthCheck);
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function boot() {
    loadSettings();
    loadConversations();
    bindEvents();
    if (typeof bindMediaEvents === 'function') bindMediaEvents();
    if (typeof bindGalleryVaultEvents === 'function') bindGalleryVaultEvents();
    renderAll();
    healthCheck();
    if (apiKey()) loadModels(); else openSettingsDialog();
    setInterval(healthCheck, 30_000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
