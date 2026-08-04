  'use strict';

  const CONFIG = window.AION_CONFIG || {};
  const HISTORY_KEY = 'aion.conversations.v2';
  const SETTINGS_KEY = 'aion.settings.v2';
  const MODEL_KEY = 'aion.model.v2';
  const API_KEY_SESSION = 'aion.apiKey.session';
  const MAX_TEXT_FILE = 100_000;
  const MAX_IMAGE_FILE = 900_000;
  const ACCEPTED_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
  ]);

  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'), sidebar: $('sidebar'), openSidebar: $('openSidebar'), closeSidebar: $('closeSidebar'),
    newChat: $('newChat'), conversationList: $('conversationList'), messages: $('messages'),
    composer: $('composer'), prompt: $('prompt'), attachButton: $('attachButton'),
    attachmentList: $('attachmentList'), sendButton: $('sendButton'), stopButton: $('stopButton'),
    webSearchToggle: $('webSearchToggle'), modelSelect: $('modelSelect'), connectionStatus: $('connectionStatus'),
    settingsDialog: $('settingsDialog'), openSettings: $('openSettings'), backendUrl: $('backendUrl'),
    apiKey: $('apiKey'), temperature: $('temperature'), maxTokens: $('maxTokens'),
    saveSettings: $('saveSettings'), clearHistory: $('clearHistory'),
    notesDialog: $('notesDialog'), openNotes: $('openNotes'), noteForm: $('noteForm'),
    noteName: $('noteName'), noteKind: $('noteKind'), noteTags: $('noteTags'), noteValue: $('noteValue'),
    noteSearch: $('noteSearch'), refreshNotes: $('refreshNotes'), notesList: $('notesList'),
    githubDialog: $('githubDialog'), openGithub: $('openGithub'), githubRepository: $('githubRepository'),
    githubArgument: $('githubArgument'), githubOutput: $('githubOutput'), toast: $('toast'),
  };

  const state = {
    conversations: [],
    activeId: null,
    pendingAttachments: [],
    controller: null,
    settings: {
      apiBase: String(CONFIG.apiBase || window.location.origin).replace(/\/+$/, ''),
      temperature: 0.7,
      maxTokens: 1024,
    },
    selectedModel: null,
    modelsLoaded: false,
  };

  function uid(prefix) {
    return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
  }

  function apiKey() {
    try { return sessionStorage.getItem(API_KEY_SESSION) || ''; } catch { return ''; }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (saved.apiBase) state.settings.apiBase = String(saved.apiBase).replace(/\/+$/, '');
      if (Number.isFinite(saved.temperature)) state.settings.temperature = Math.min(2, Math.max(0, saved.temperature));
      if (Number.isInteger(saved.maxTokens)) state.settings.maxTokens = Math.min(4096, Math.max(32, saved.maxTokens));
      const selected = JSON.parse(localStorage.getItem(MODEL_KEY) || 'null');
      if (selected && selected.provider && selected.model) state.selectedModel = selected;
    } catch { /* use defaults */ }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    if (state.selectedModel) localStorage.setItem(MODEL_KEY, JSON.stringify(state.selectedModel));
    else localStorage.removeItem(MODEL_KEY);
  }

  function loadConversations() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(value)) state.conversations = value;
    } catch { state.conversations = []; }
    if (!state.conversations.length) createConversation();
    state.activeId = state.conversations[0].id;
  }

  function saveConversations() {
    const safe = state.conversations.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content || '',
        ts: message.ts,
        decision: message.decision || null,
        model: message.model || null,
        error: message.error || '',
        attachments: message.attachments || [],
        tools: (message.tools || []).map(sanitizeToolForStorage),
      })),
    }));
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(safe)); }
    catch { showToast('Local history is full. Export or delete older conversations.'); }
  }

  function sanitizeToolForStorage(tool) {
    if (!tool || typeof tool !== 'object') return {};
    if (tool.tool === 'web_search') {
      return {
        type: tool.type,
        tool: tool.tool,
        query: tool.query,
        results: (tool.results || []).slice(0, 10).map((item) => ({
          title: item.title, url: item.url, snippet: item.snippet, published_at: item.published_at,
        })),
      };
    }
    return {
      type: tool.type,
      tool: tool.tool,
      repository: tool.repository,
      result: limitObject(tool.result),
      message: tool.message,
    };
  }

  function limitObject(value) {
    try { return JSON.parse(JSON.stringify(value).slice(0, 80_000)); }
    catch { return String(value).slice(0, 80_000); }
  }

  function createConversation() {
    const conversation = {
      id: uid('conversation'), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [],
    };
    state.conversations.unshift(conversation);
    state.activeId = conversation.id;
    saveConversations();
    return conversation;
  }

  function activeConversation() {
    return state.conversations.find((item) => item.id === state.activeId) || null;
  }

  function deleteConversation(id) {
    state.conversations = state.conversations.filter((item) => item.id !== id);
    if (!state.conversations.length) createConversation();
    if (!state.conversations.some((item) => item.id === state.activeId)) state.activeId = state.conversations[0].id;
    saveConversations();
    renderAll();
  }
