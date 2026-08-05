  function renderAll() {
    renderSidebar();
    renderMessages();
    renderAttachments();
    autosize();
  }

  function closeSidebar() {
    dom.app.classList.remove('sidebar-open');
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
    dom.openSettings.addEventListener('click', openSettingsDialog);
    dom.saveSettings.addEventListener('click', persistSettings);
    if (dom.refreshPolicy) dom.refreshPolicy.addEventListener('click', () => { refreshPolicy(); });
    dom.clearHistory.addEventListener('click', () => {
      if (!confirm('Clear all locally stored conversations?')) return;
      localStorage.removeItem(HISTORY_KEY);
      state.conversations = [];
      createConversation();
      renderAll();
      showToast('Local history cleared.');
    });
    dom.openNotes.addEventListener('click', () => { dom.notesDialog.showModal(); loadNotes(); });
    dom.noteForm.addEventListener('submit', addNote);
    dom.refreshNotes.addEventListener('click', loadNotes);
    dom.noteSearch.addEventListener('input', debounce(loadNotes, 250));
    dom.openGithub.addEventListener('click', () => dom.githubDialog.showModal());
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => $(button.dataset.closeDialog).close());
    });
    document.querySelectorAll('[data-github-action]').forEach((button) => {
      button.addEventListener('click', () => runGithubAction(button.dataset.githubAction));
    });
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
