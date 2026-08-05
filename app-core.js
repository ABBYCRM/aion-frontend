  'use strict';

  const CONFIG = window.AION_CONFIG || {};
  const HISTORY_KEY = 'aion.conversations.v2';
  const SETTINGS_KEY = 'aion.settings.v2';
  const MODEL_KEY = 'aion.model.v2';
  const API_KEY_LOCAL = 'aion.apiKey.local';
  const API_KEY_FORGET_KEY = 'aion.apiKey.forgetOnClose';
  const MAX_TEXT_FILE = Number(CONFIG.maxTextFileBytes) || 100_000;
  const MAX_IMAGE_FILE = Number(CONFIG.maxImageBytes) || 900_000;
  const MAX_ATTACHMENT_COUNT = Number(CONFIG.maxAttachmentCount) || 6;
  const MAX_TOTAL_ATTACHMENT_BYTES = Number(CONFIG.maxTotalAttachmentBytes) || 1_200_000;
  const ACCEPTED_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'text/plain', 'text/markdown', 'text/csv', 'application/json',
  ]);
  const CONFIGURED_API_BASE = normalizeApiBase(CONFIG.apiBase || window.location.origin);
  const ALLOWED_API_ORIGINS = new Set(
    (CONFIG.allowedApiOrigins || [CONFIGURED_API_BASE]).map((value) => new URL(value).origin),
  );

  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'), sidebar: $('sidebar'), openSidebar: $('openSidebar'), closeSidebar: $('closeSidebar'),
    newChat: $('newChat'), conversationList: $('conversationList'), messages: $('messages'),
    composer: $('composer'), prompt: $('prompt'), attachButton: $('attachButton'),
    attachmentList: $('attachmentList'), sendButton: $('sendButton'), stopButton: $('stopButton'),
    webSearchToggle: $('webSearchToggle'), modelSelect: $('modelSelect'), connectionStatus: $('connectionStatus'),
    settingsDialog: $('settingsDialog'), openSettings: $('openSettings'), backendUrl: $('backendUrl'),
    apiKey: $('apiKey'), temperature: $('temperature'), maxTokens: $('maxTokens'),
    persistHistory: $('persistHistory'), useNotes: $('useNotes'),
    saveSettings: $('saveSettings'), clearHistory: $('clearHistory'), autoSpeak: $('autoSpeak'), ttsVoiceSetting: $('ttsVoiceSetting'), refreshPolicy: $('refreshPolicy'),
    notesDialog: $('notesDialog'), openNotes: $('openNotes'), noteForm: $('noteForm'),
    noteName: $('noteName'), noteKind: $('noteKind'), noteTags: $('noteTags'), noteValue: $('noteValue'),
    noteSearch: $('noteSearch'), refreshNotes: $('refreshNotes'), notesList: $('notesList'),
    githubDialog: $('githubDialog'), openGithub: $('openGithub'), githubRepository: $('githubRepository'),
    githubArgument: $('githubArgument'), githubOutput: $('githubOutput'),
    mediaDialog: $('mediaDialog'), openMedia: $('openMedia'),
    codeDialog: $('codeDialog'), openCode: $('openCode'),
    vaultDialog: $('vaultDialog'), openVault: $('openVault'),
    vaultList: $('vaultList'), vaultRefresh: $('vaultRefresh'), vaultPingAll: $('vaultPingAll'),
    vaultFilter: $('vaultFilter'), vaultStatus: $('vaultStatus'),
    galleryGrid: $('galleryGrid'), galleryRefresh: $('galleryRefresh'), galleryFilter: $('galleryFilter'), galleryStatus: $('galleryStatus'),
    ttsVoice: $('ttsVoice'), ttsText: $('ttsText'), ttsSpeak: $('ttsSpeak'),
    ttsAudio: $('ttsAudio'), ttsStatus: $('ttsStatus'),
    imageModel: $('imageModel'), imageSize: $('imageSize'), imagePrompt: $('imagePrompt'),
    imageGenerate: $('imageGenerate'), imageGallery: $('imageGallery'), imageStatus: $('imageStatus'),
    videoPrompt: $('videoPrompt'), videoSeconds: $('videoSeconds'), videoSize: $('videoSize'),
    videoPoll: $('videoPoll'), videoGenerate: $('videoGenerate'),
    videoOutput: $('videoOutput'), videoStatus: $('videoStatus'),
    toast: $('toast'),
  };

  const state = {
    conversations: [],
    activeId: null,
    pendingAttachments: [],
    controller: null,
    renderFrame: 0,
    settings: {
      apiBase: CONFIGURED_API_BASE,
      temperature: 0.7,
      maxTokens: 1024,
      persistHistory: false,
      useNotes: false,
      autoSpeak: false,
      ttsVoice: 'alloy',
      forgetApiKeyOnClose: false,
    },
    selectedModel: null,
    modelsLoaded: false,
    codeLanguagesLoaded: false,
  };

  function uid(prefix) {
    return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
  }

  function apiKey() {
    try {
      if (localStorage.getItem(API_KEY_FORGET_KEY) === '1') {
        return sessionStorage.getItem(API_KEY_LOCAL) || '';
      }
      return localStorage.getItem(API_KEY_LOCAL) || sessionStorage.getItem(API_KEY_LOCAL) || '';
    } catch { return ''; }
  }

  function normalizeApiBase(value) {
    const parsed = new URL(String(value || ''), window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Backend URL must use HTTP or HTTPS.');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Backend URL must be a bare origin.');
    if (parsed.pathname !== '/' && parsed.pathname !== '') throw new Error('Backend URL must not contain a path.');
    if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error('Non-local backend URLs must use HTTPS.');
    }
    return parsed.origin;
  }

  function apiBaseAllowed(value) {
    try {
      const base = normalizeApiBase(value);
      return Boolean(CONFIG.allowCustomApiBase) || ALLOWED_API_ORIGINS.has(new URL(base).origin);
    } catch { return false; }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (CONFIG.allowCustomApiBase && saved.apiBase && apiBaseAllowed(saved.apiBase)) {
        state.settings.apiBase = normalizeApiBase(saved.apiBase);
      }
      if (Number.isFinite(saved.temperature)) state.settings.temperature = Math.min(2, Math.max(0, saved.temperature));
      if (Number.isInteger(saved.maxTokens)) state.settings.maxTokens = Math.min(4096, Math.max(32, saved.maxTokens));
      state.settings.persistHistory = saved.persistHistory === true;
      state.settings.useNotes = saved.useNotes === true;
      state.settings.autoSpeak = saved.autoSpeak === true;
      state.settings.ttsVoice = typeof saved.ttsVoice === 'string' ? saved.ttsVoice : 'alloy';
      state.settings.forgetApiKeyOnClose = saved.forgetApiKeyOnClose === true;
      const selected = JSON.parse(localStorage.getItem(MODEL_KEY) || 'null');
      if (selected && selected.provider && selected.model) state.selectedModel = selected;
    } catch { /* use secure defaults */ }
  }

  function saveSettings() {
    const saved = {
      temperature: state.settings.temperature,
      maxTokens: state.settings.maxTokens,
      persistHistory: state.settings.persistHistory,
      useNotes: state.settings.useNotes,
    };
    if (CONFIG.allowCustomApiBase) saved.apiBase = state.settings.apiBase;
    saved.autoSpeak = state.settings.autoSpeak;
    saved.ttsVoice = state.settings.ttsVoice;
    saved.forgetApiKeyOnClose = state.settings.forgetApiKeyOnClose;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
    if (state.settings.forgetApiKeyOnClose) localStorage.setItem(API_KEY_FORGET_KEY, '1');
    else localStorage.removeItem(API_KEY_FORGET_KEY);
    if (state.selectedModel) localStorage.setItem(MODEL_KEY, JSON.stringify(state.selectedModel));
    else localStorage.removeItem(MODEL_KEY);
  }

  function loadConversations() {
    if (state.settings.persistHistory) {
      try {
        const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        if (Array.isArray(value)) state.conversations = value;
      } catch { state.conversations = []; }
    }
    if (!state.conversations.length) createConversation();
    state.activeId = state.conversations[0].id;
  }

  function saveConversations() {
    if (!state.settings.persistHistory) return;
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
    const result = tool.result && typeof tool.result === 'object' ? { ...tool.result } : tool.result;
    if (result && typeof result === 'object') delete result.content;
    return {
      type: tool.type,
      tool: tool.tool,
      repository: tool.repository,
      result: limitObject(result),
      message: tool.message,
    };
  }

  function limitObject(value, depth = 0) {
    if (depth > 5) return '[truncated]';
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      return typeof value === 'string' ? value.slice(0, 5000) : value;
    }
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => limitObject(item, depth + 1));
    if (typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [key, limitObject(item, depth + 1)]));
    }
    return String(value).slice(0, 5000);
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
