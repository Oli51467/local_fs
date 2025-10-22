const ChatUtils = window.ChatUtils;
if (!ChatUtils) {
  throw new Error('ChatUtils 模块未能正确加载');
}

const ChatSearchDialog = window.ChatSearchDialog;
if (!ChatSearchDialog) {
  throw new Error('ChatSearchDialog 模块未能正确加载');
}

const ChatModelSelector = window.ChatModelSelector;
if (!ChatModelSelector) {
  throw new Error('ChatModelSelector 模块未能正确加载');
}

const ChatReferenceManager = window.ChatReferenceManager;
if (!ChatReferenceManager) {
  throw new Error('ChatReferenceManager 模块未能正确加载');
}

class ChatModule {
  constructor() {
    this.cacheDomElements();
    this.initializeState();
    this.initializeManagers();
    this.attachSettingsListener();
    this.tryAttachModelModuleListener();
    this.ensureModelSelector();
    this.updateSendButtonState();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.bindEvents();
    this.tryAttachModelModuleListener();
    this.ensureSearchDialog();
    this.ensureModelSelector();
    await this.refreshAvailableModels();
    this.initialized = true;
  }

  cacheDomElements() {
    this.historyContainer = document.getElementById('chat-history-container');
    this.historyListEl = document.getElementById('chat-history-list');
    this.historyTitleEl = document.getElementById('chat-history-title');
    this.chatPageEl = document.getElementById('chat-page');
    this.chatMessagesContainer = document.getElementById('chat-messages-container');
    this.chatMessagesEl = document.getElementById('chat-messages');
    this.chatInputArea = document.getElementById('chat-input-area');
    this.chatInputEl = document.getElementById('chat-input');
    this.chatSendBtn = document.getElementById('chat-send-btn');
    this.chatStatusTextEl = document.getElementById('chat-status-text');
    this.chatTitleEl = document.getElementById('chat-conversation-title');
    this.chatTimestampEl = document.getElementById('chat-conversation-updated');
    this.chatModelButtonEl = document.getElementById('chat-model-button');
    this.chatModelButtonTextEl = document.getElementById('chat-model-button-text');
    this.chatModelDropdownEl = document.getElementById('chat-model-dropdown');
    this.sendBtnDefaultContent = this.chatSendBtn ? this.chatSendBtn.innerHTML : '';
    this.sendBtnDefaultAriaLabel = this.chatSendBtn
      ? (this.chatSendBtn.getAttribute('aria-label') || '发送消息')
      : '发送消息';
    this.sendBtnStopContent = (
      '<svg class="icon-stop" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"></rect>'
      + '</svg>'
    );
  }

  initializeState() {
    this.baseApiUrl = 'http://localhost:8000/api/chat';
    this.currentConversationId = null;
    this.conversations = [];
    this.messages = [];
    this.initialized = false;
    this.historyVisible = true;
    this.isHistoryCollapsed = false;
    this.pendingRequest = null;
    this.chatInputBaseHeight = null;
    this.chatInputMaxHeight = null;
    this.availableModels = [];
    this.selectedModel = null;
    this.modelDropdownVisible = false;
    this.modelRegistryHandler = (event) => this.handleModelRegistryChanged(event);
    this.handleBackendStatusEvent = (event) => this.handleBackendStatus(event);
    this.streamingState = null;
    this.markdownViewer = null;
    this.markdownStyleRefs = new Set();
    this.unsubscribeModelRegistry = null;
    this.modelModuleListenerRetryScheduled = false;
    this.isStreaming = false;
    this.activeRequestController = null;
    this.abortRequested = false;
    this.searchDialog = null;
    this.modelSelector = null;
  }

  initializeManagers() {
    this.referenceManager = new ChatReferenceManager({
      setStatus: (message, type) => this.setStatus(message, type),
      appendSystemError: (message) => this.appendSystemErrorToChat(message),
      getStatusElement: () => this.chatStatusTextEl
    });
  }

  attachSettingsListener() {
    if (window.fsAPI && typeof window.fsAPI.onSettingsUpdated === 'function') {
      window.fsAPI.onSettingsUpdated((config) => {
        this.handleSettingsUpdated(config);
      });
    }
  }

  bindEvents() {
    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener('click', () => this.handleSendClick());
    }

    if (this.chatInputEl) {
      this.chatInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (this.isStreaming) {
            this.handleAbortStreaming();
          } else {
            this.handleSend();
          }
        }
      });

      this.chatInputEl.addEventListener('input', () => {
        this.autoResizeTextarea();
      });
    }

    // 绑定折叠按钮事件
    const collapseBtn = document.querySelector('#chat-history-collapse-btn');
    if (collapseBtn) {
      collapseBtn.innerHTML = window.icons?.chevronLeft || '';
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleHistoryCollapse();
      });
    }

    // 绑定折叠状态下的展开按钮事件
    const expandBtn = document.querySelector('#collapsed-expand-btn');
    if (expandBtn) {
      expandBtn.innerHTML = window.icons?.chevronRight || '';
      expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleHistoryCollapse();
      });
    }

    document.addEventListener('backendStatus', this.handleBackendStatusEvent);
    document.addEventListener('modelRegistryChanged', this.modelRegistryHandler);
  }

  updateSendButtonState() {
    if (!this.chatSendBtn) {
      return;
    }
    if (this.isStreaming) {
      this.chatSendBtn.innerHTML = this.sendBtnStopContent;
      this.chatSendBtn.setAttribute('aria-label', '终止回答');
      this.chatSendBtn.classList.add('is-stop');
      this.chatSendBtn.disabled = Boolean(this.abortRequested);
    } else {
      this.chatSendBtn.innerHTML = this.sendBtnDefaultContent;
      this.chatSendBtn.setAttribute('aria-label', this.sendBtnDefaultAriaLabel);
      this.chatSendBtn.classList.remove('is-stop');
      this.chatSendBtn.disabled = Boolean(this.pendingRequest);
    }
  }

  ensureSearchDialog() {
    if (this.searchDialog) {
      return this.searchDialog;
    }
    if (typeof ChatSearchDialog !== 'function') {
      console.warn('ChatSearchDialog 模块不可用，跳过聊天搜索弹窗初始化。');
      return null;
    }
    try {
      this.searchDialog = new ChatSearchDialog({
        icons: window.icons,
        onSubmit: (keyword, dialog) => this.handleSearchSubmit(keyword, dialog)
      });
    } catch (error) {
      console.warn('初始化聊天搜索弹窗失败:', error);
      this.searchDialog = null;
    }
    return this.searchDialog;
  }

  showSearchDialog() {
    const dialog = this.ensureSearchDialog();
    if (dialog) {
      dialog.show();
    }
  }

  hideSearchDialog() {
    if (this.searchDialog) {
      this.searchDialog.hide();
    }
  }

  handleSearchSubmit(keyword, dialogInstance) {
    const dialog = dialogInstance || this.searchDialog;
    if (!dialog) {
      return true;
    }
    const trimmed = typeof keyword === 'string' ? keyword.trim() : '';
    if (!trimmed) {
      dialog.resetResults();
      return true;
    }
    dialog.showPlaceholder(trimmed);
    return true;
  }

  ensureModelSelector() {
    if (!this.chatModelButtonEl || !this.chatModelButtonTextEl || !this.chatModelDropdownEl) {
      return null;
    }
    if (this.modelSelector) {
      this.modelSelector.setElements({
        buttonEl: this.chatModelButtonEl,
        buttonTextEl: this.chatModelButtonTextEl,
        dropdownEl: this.chatModelDropdownEl
      });
      this.modelDropdownVisible = Boolean(this.modelSelector.visible);
      return this.modelSelector;
    }
    try {
      this.modelSelector = new ChatModelSelector({
        buttonEl: this.chatModelButtonEl,
        buttonTextEl: this.chatModelButtonTextEl,
        dropdownEl: this.chatModelDropdownEl,
        onChange: (model) => this.handleModelSelectionChange(model),
        onToggle: (visible) => {
          this.modelDropdownVisible = Boolean(visible);
        },
        onClose: () => {
          this.modelDropdownVisible = false;
        }
      });
      this.modelDropdownVisible = false;
    } catch (error) {
      console.warn('初始化聊天模型选择器失败:', error);
      this.modelSelector = null;
    }
    return this.modelSelector;
  }

  handleModelSelectionChange(model) {
    this.selectedModel = model ? { ...model } : null;
  }

  refreshModelButtonFallback() {
    if (!this.chatModelButtonEl || !this.chatModelButtonTextEl) {
      return;
    }
    const hasModels = this.availableModels.length > 0;
    this.chatModelButtonEl.disabled = !hasModels;
    if (!hasModels) {
      this.selectedModel = null;
      this.chatModelButtonTextEl.textContent = '暂无可用模型';
      this.modelDropdownVisible = false;
      if (this.chatModelDropdownEl) {
        this.chatModelDropdownEl.classList.remove('visible');
        this.chatModelDropdownEl.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'chat-model-dropdown-empty';
        empty.textContent = '尚未添加模型';
        this.chatModelDropdownEl.appendChild(empty);
      }
      return;
    }
    const active = this.selectedModel || this.availableModels[0];
    if (active) {
      this.selectedModel = { ...active };
      this.chatModelButtonTextEl.textContent = active.name || '未命名模型';
    } else {
      this.selectedModel = null;
      this.chatModelButtonTextEl.textContent = '请选择模型';
    }
    this.chatModelButtonEl.setAttribute('aria-expanded', 'false');
    this.modelDropdownVisible = false;
  }

  handleSendClick() {
    if (this.isStreaming) {
      this.handleAbortStreaming();
    } else {
      this.handleSend();
    }
  }

  handleAbortStreaming() {
    if (!this.isStreaming || this.abortRequested) {
      return;
    }
    this.abortRequested = true;
    if (this.activeRequestController && typeof this.activeRequestController.abort === 'function') {
      try {
        this.activeRequestController.abort();
      } catch (error) {
        console.debug('终止请求失败:', error);
      }
    }
    this.setStatus('正在终止回答…', 'info');
    this.updateSendButtonState();
  }

  tryAttachModelModuleListener() {
    if (this.unsubscribeModelRegistry || typeof window === 'undefined') {
      return;
    }

    const module = window.modelModule;
    if (module && typeof module.onModelRegistryChanged === 'function') {
      const handler = (models) => {
        this.refreshAvailableModels({ models }).catch((error) => {
          console.warn('通过模型模块刷新聊天模型列表失败:', error);
        });
      };
      try {
        const unsubscribe = module.onModelRegistryChanged(handler);
        this.unsubscribeModelRegistry = typeof unsubscribe === 'function' ? unsubscribe : () => {};
      } catch (error) {
        console.error('注册模型监听器失败:', error);
      }
      return;
    }

    if (!this.modelModuleListenerRetryScheduled) {
      this.modelModuleListenerRetryScheduled = true;
      setTimeout(() => {
        this.modelModuleListenerRetryScheduled = false;
        this.tryAttachModelModuleListener();
      }, 120);
    }
  }

  getInitialModelList() {
    if (typeof window !== 'undefined' && window.modelModule && typeof window.modelModule.getModels === 'function') {
      try {
        return this.normalizeModelList(window.modelModule.getModels());
      } catch (error) {
        console.warn('获取初始模型列表失败:', error);
      }
    }
    return [];
  }

  handleModelRegistryChanged(event) {
    const models = event?.detail?.models;
    this.refreshAvailableModels({ models }).catch((error) => {
      console.warn('刷新聊天模型列表失败:', error);
    });
  }

  handleSettingsUpdated(config) {
    if (!config || !Object.prototype.hasOwnProperty.call(config, 'customModels')) {
      return;
    }
    const models = Array.isArray(config.customModels) ? config.customModels : [];
    this.refreshAvailableModels({ models }).catch((error) => {
      console.warn('设置更新后刷新聊天模型列表失败:', error);
    });
  }

  handleBackendStatus(event) {
    if (!event || !event.detail || typeof event.detail !== 'object') {
      return;
    }
    const payload = event.detail;
    if (payload.event !== 'chat_progress') {
      return;
    }
    this.applyChatProgressUpdate(payload);
  }

  applyChatProgressUpdate(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (!this.streamingState) {
      return;
    }

    const requestId = typeof payload.client_request_id === 'string' ? payload.client_request_id : null;
    const assistantId = payload.assistant_message_id !== undefined && payload.assistant_message_id !== null
      ? String(payload.assistant_message_id)
      : null;
    const conversationId = typeof payload.conversation_id === 'number' ? payload.conversation_id : null;

    const currentRequestId = this.streamingState.clientRequestId || null;
    const currentAssistantId = this.streamingState.messageId
      ? String(this.streamingState.messageId)
      : (this.streamingState.message && this.streamingState.message.id !== undefined && this.streamingState.message.id !== null
        ? String(this.streamingState.message.id)
        : null);

    const matchesRequest = Boolean(requestId && currentRequestId && requestId === currentRequestId);
    const matchesAssistant = Boolean(assistantId && currentAssistantId && assistantId === currentAssistantId);
    const matchesConversation = Boolean(
      conversationId !== null
        && (this.streamingState.conversationId === conversationId
          || this.streamingState.conversationId === undefined
          || this.streamingState.conversationId === null)
    );

    if (!matchesRequest && !matchesAssistant && !matchesConversation) {
      return;
    }

    if (conversationId !== null) {
      this.streamingState.conversationId = conversationId;
      this.streamingState.conversationKey = `id:${conversationId}`;
    }

    if (assistantId && !currentAssistantId) {
      this.streamingState.messageId = payload.assistant_message_id;
      if (this.streamingState.message) {
        this.streamingState.message.id = payload.assistant_message_id;
      }
    }

    if (requestId && !currentRequestId) {
      this.streamingState.clientRequestId = requestId;
    }

    const stageMessage = typeof payload.message === 'string' && payload.message ? payload.message : null;
    if (stageMessage) {
      this.streamingState.stageMessage = stageMessage;
    }

    if (typeof payload.step === 'number') {
      this.streamingState.stageStep = payload.step;
    }

    if (typeof payload.status === 'string' && payload.status) {
      this.streamingState.stageStatus = payload.status;
    }

    this.updateStreamingBubble();
  }

  updateModelSelect(models) {
    this.closeModelDropdown();
    this.availableModels = Array.isArray(models) ? models.map((model) => ({ ...model })) : [];
    const selector = this.ensureModelSelector();
    if (selector) {
      selector.updateModels(this.availableModels);
      const current = selector.getSelectedModel();
      this.selectedModel = current ? { ...current } : null;
      this.modelDropdownVisible = Boolean(selector.visible);
      return;
    }
    if (this.availableModels.length) {
      this.selectedModel = { ...this.availableModels[0] };
    } else {
      this.selectedModel = null;
    }
    this.refreshModelButtonFallback();
  }

  getModelKey(model) {
    if (!model) {
      return '';
    }
    return `${model.sourceId || ''}::${model.modelId || ''}`;
  }

  normalizeModelRecord(model) {
    if (!model || typeof model !== 'object') {
      return null;
    }
    const normalized = { ...model };
    if (normalized.source_id && !normalized.sourceId) {
      normalized.sourceId = normalized.source_id;
    }
    if (normalized.model_id && !normalized.modelId) {
      normalized.modelId = normalized.model_id;
    }
    if (normalized.api_model && !normalized.apiModel) {
      normalized.apiModel = normalized.api_model;
    }
    if (normalized.provider_name && !normalized.providerName) {
      normalized.providerName = normalized.provider_name;
    }
    if (normalized.api_key_setting && !normalized.apiKeySetting) {
      normalized.apiKeySetting = normalized.api_key_setting;
    }
    if (normalized.api_url && !normalized.apiUrl) {
      normalized.apiUrl = normalized.api_url;
    }
    if (typeof normalized.requires_api_key === 'boolean' && typeof normalized.requiresApiKey !== 'boolean') {
      normalized.requiresApiKey = normalized.requires_api_key;
    }
    return normalized;
  }

  shouldUseSummarySearch() {
    const settingsModule = window.settingsModule;
    if (!settingsModule || typeof settingsModule.isSummarySearchEnabled !== 'function') {
      return false;
    }
    try {
      return Boolean(settingsModule.isSummarySearchEnabled());
    } catch (error) {
      console.warn('读取主题检索配置失败:', error);
      return false;
    }
  }

  normalizeModelList(models) {
    if (!Array.isArray(models) || models.length === 0) {
      return [];
    }

    const seen = new Set();
    const result = [];
    models.forEach((item) => {
      const normalized = this.normalizeModelRecord(item);
      if (!normalized) {
        return;
      }

      let prepared = { ...normalized };
      if (typeof window !== 'undefined' && window.modelModule && typeof window.modelModule.enrichModel === 'function') {
        try {
          prepared = window.modelModule.enrichModel({ ...normalized });
        } catch (error) {
          console.warn('补充模型信息失败，使用原始模型数据:', error);
          prepared = { ...normalized };
        }
      }

      prepared.sourceId = prepared.sourceId || '';
      prepared.modelId = prepared.modelId || prepared.apiModel || prepared.name || '';
      prepared.apiModel = prepared.apiModel || prepared.modelId || '';
      prepared.name = prepared.name || prepared.apiModel || prepared.modelId || '未命名模型';
      prepared.providerName = prepared.providerName || prepared.sourceId || '自定义';
      if (typeof prepared.requiresApiKey !== 'boolean') {
        prepared.requiresApiKey = true;
      }
      prepared.requiresApiKey = prepared.requiresApiKey !== false;
      if (prepared.requiresApiKey) {
        prepared.apiKeySetting = prepared.apiKeySetting || 'siliconflwApiKey';
      } else {
        prepared.apiKeySetting = prepared.apiKeySetting || null;
      }
      if (typeof prepared.apiUrl === 'string') {
        prepared.apiUrl = prepared.apiUrl.trim();
      } else {
        prepared.apiUrl = '';
      }

      const key = this.getModelKey(prepared);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(prepared);
    });

    return result;
  }

  async refreshAvailableModels(options = {}) {
    const hasDirectModels = Object.prototype.hasOwnProperty.call(options || {}, 'models');
    let list = [];

    if (hasDirectModels) {
      list = this.normalizeModelList(Array.isArray(options.models) ? options.models : []);
    }

    if (!list.length && typeof window !== 'undefined' && window.modelModule && typeof window.modelModule.getModels === 'function') {
      try {
        list = this.normalizeModelList(window.modelModule.getModels());
      } catch (error) {
        console.warn('读取模型模块列表失败:', error);
      }
    }

    if (!list.length && typeof window !== 'undefined' && window.__fsModelRegistry && Array.isArray(window.__fsModelRegistry.models)) {
      list = this.normalizeModelList(window.__fsModelRegistry.models);
    }

    if (!list.length && typeof window !== 'undefined') {
      const settingsModule = window.settingsModule;
      if (settingsModule && typeof settingsModule.getCustomModels === 'function') {
        try {
          list = this.normalizeModelList(settingsModule.getCustomModels());
        } catch (error) {
          console.warn('从设置模块获取模型失败:', error);
        }
      }
    }

    if (!list.length && typeof window !== 'undefined' && window.fsAPI && typeof window.fsAPI.getSettings === 'function') {
      try {
        const settings = await window.fsAPI.getSettings();
        if (Array.isArray(settings?.customModels)) {
          list = this.normalizeModelList(settings.customModels);
        }
      } catch (error) {
        console.warn('直接读取设置失败:', error);
      }
    }

    this.updateModelSelect(list);
    return list;
  }

  toggleModelDropdown() {
    const selector = this.ensureModelSelector();
    if (!selector || !this.availableModels.length) {
      return;
    }
    if (selector.visible) {
      selector.hideDropdown();
      this.modelDropdownVisible = false;
    } else {
      selector.showDropdown();
      this.modelDropdownVisible = true;
    }
  }

  openModelDropdown() {
    const selector = this.ensureModelSelector();
    if (!selector || !this.availableModels.length) {
      return;
    }
    selector.showDropdown();
    this.modelDropdownVisible = true;
  }

  closeModelDropdown() {
    const selector = this.modelSelector || this.ensureModelSelector();
    if (selector) {
      selector.hideDropdown();
      this.modelDropdownVisible = false;
      return;
    }
    if (this.chatModelDropdownEl) {
      this.chatModelDropdownEl.classList.remove('visible');
    }
    if (this.chatModelButtonEl) {
      this.chatModelButtonEl.setAttribute('aria-expanded', 'false');
    }
    this.modelDropdownVisible = false;
  }



  async enterChatMode() {
    await this.init();
    await this.refreshAvailableModels();
    await this.refreshConversations();

    const hasStreaming = Boolean(this.streamingState && Array.isArray(this.messages) && this.messages.length);
    if (hasStreaming) {
      this.renderMessages();
      this.updateStreamingBubble();
    } else if (this.currentConversationId !== null
        && this.currentConversationId !== undefined
        && (!Array.isArray(this.messages) || !this.messages.length)) {
      await this.openConversation(this.currentConversationId);
    } else if (this.conversations.length && (this.currentConversationId === null || this.currentConversationId === undefined)) {
      await this.openConversation(this.conversations[0].id);
    } else if (!Array.isArray(this.messages) || !this.messages.length) {
      this.startNewConversation();
    }

    this.autoResizeTextarea();
    this.showChatPage();
  }

  leaveChatMode() {
    if (this.chatInputEl) {
      this.chatInputEl.value = '';
      this.autoResizeTextarea();
    }
    if (this.chatStatusTextEl) {
      this.chatStatusTextEl.textContent = '';
      delete this.chatStatusTextEl.dataset.statusType;
    }
    this.closeModelDropdown();
  }

  showChatPage() {
    if (this.chatPageEl) {
      this.chatPageEl.style.display = 'flex';
    }
    if (this.historyContainer) {
      this.historyContainer.style.display = 'flex';
      this.historyVisible = true;
    }
    if (this.chatInputEl) {
      setTimeout(() => this.chatInputEl.focus(), 50);
    }
    if (this.chatStatusTextEl) {
      this.chatStatusTextEl.textContent = '';
      delete this.chatStatusTextEl.dataset.statusType;
    }
  }

  hideChatPage() {
    if (this.chatPageEl) {
      this.chatPageEl.style.display = 'none';
    }
    if (this.historyContainer) {
      this.historyContainer.style.display = 'none';
      this.historyVisible = false;
    }
  }

  startNewConversation() {
    if (this.streamingState) {
      this.streamingState = null;
    }
    this.currentConversationId = null;
    this.messages = [];
    this.renderMessages();
    if (this.chatTitleEl) {
      this.chatTitleEl.textContent = '新对话';
    }
    if (this.chatTimestampEl) {
      this.chatTimestampEl.textContent = '';
    }
    if (this.chatInputEl) {
      this.chatInputEl.value = '';
      this.autoResizeTextarea();
      this.chatInputEl.focus();
    }
    this.highlightActiveConversation();
  }

  setStatus(message, type = 'info') {
    if (type === 'error') {
      if (this.chatStatusTextEl) {
        this.chatStatusTextEl.textContent = '';
        delete this.chatStatusTextEl.dataset.statusType;
      }
      this.appendSystemErrorToChat(message);
      return;
    }

    if (!this.chatStatusTextEl) {
      return;
    }

    // 仅在非 info 情况下显示（例如 warning），普通信息不显示
    const text = typeof message === 'string' ? message : '';
    if (type === 'info') {
      this.chatStatusTextEl.textContent = '';
      delete this.chatStatusTextEl.dataset.statusType;
      return;
    }
    this.chatStatusTextEl.textContent = text || '';
    if (text) {
      this.chatStatusTextEl.dataset.statusType = type;
    } else {
      delete this.chatStatusTextEl.dataset.statusType;
    }
  }

  appendSystemErrorToChat(message) {
    const content = typeof message === 'string' ? message.trim() : '';
    if (!content) {
      return;
    }

    if (!Array.isArray(this.messages)) {
      this.messages = [];
    }

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      const lastContent = typeof lastMessage.content === 'string' ? lastMessage.content.trim() : '';
      if (lastContent === content) {
        return;
      }
    }

    const errorMessage = {
      id: `system-error-${Date.now()}`,
      role: 'assistant',
      content,
      created_time: new Date().toISOString(),
      metadata: {
        error: true,
        system: true
      }
    };

    this.messages.push(errorMessage);
    this.renderMessages();
    if (this.chatMessagesContainer) {
      this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
    }
  }

  async refreshConversations() {
    if (!this.initialized) {
      await this.init();
    }

    try {
      const response = await fetch(`${this.baseApiUrl}/conversations`);
      if (!response.ok) {
        throw new Error(`获取对话历史失败 (${response.status})`);
      }
      const data = await response.json();
      this.conversations = this.normalizeConversationList(data);
      this.renderConversationHistory();
    } catch (error) {
      console.error('加载对话历史失败:', error);
      this.setStatus('加载对话历史失败，请稍后重试。', 'error');
    }
  }

  renderConversationHistory() {
    if (!this.historyListEl) {
      return;
    }

    this.historyListEl.innerHTML = '';

    // 添加 Logo
    const logoRow = document.createElement('div');
    logoRow.className = 'chat-history-logo-row';
    const logoImg = document.createElement('img');
    logoImg.className = 'chat-history-logo';
    logoImg.src = ChatUtils.getAssetUrl('dist/assets/logo.png');
    logoImg.alt = '应用 Logo';
    logoRow.appendChild(logoImg);
    this.historyListEl.appendChild(logoRow);

    // 新对话和搜索聊天入口
    const quickActionsRow = document.createElement('div');
    quickActionsRow.className = 'chat-history-quick-actions';

    const newChatButton = document.createElement('button');
    newChatButton.type = 'button';
    newChatButton.className = 'chat-history-action-btn new-chat-action';
    newChatButton.innerHTML = `
      <span class="chat-history-action-icon">${window.icons?.edit || ''}</span>
      <span class="chat-history-action-text">新对话</span>
    `;
    newChatButton.addEventListener('click', () => {
      this.startNewConversation();
    });
    quickActionsRow.appendChild(newChatButton);

    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'chat-history-action-btn search-chat-action';
    searchButton.innerHTML = `
      <span class="chat-history-action-icon">${window.icons?.search || ''}</span>
      <span class="chat-history-action-text">搜索聊天</span>
    `;
    searchButton.addEventListener('click', () => {
      this.showSearchDialog();
    });
    quickActionsRow.appendChild(searchButton);

    this.historyListEl.appendChild(quickActionsRow);

    if (!this.conversations.length) {
      return;
    }

    // 添加"聊天"小标题（在历史对话列表之前）
    const chatSectionTitle = document.createElement('div');
    chatSectionTitle.className = 'chat-section-title';
    chatSectionTitle.textContent = '聊天';
    this.historyListEl.appendChild(chatSectionTitle);

    this.conversations.forEach((conversation) => {
      const item = document.createElement('div');
      item.className = 'chat-history-item';
      item.dataset.conversationId = conversation.id;

      if (conversation.id === this.currentConversationId) {
        item.classList.add('active');
      }

      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'chat-history-item-content';

      const titleEl = document.createElement('div');
      titleEl.className = 'chat-history-title';
      titleEl.textContent = conversation.title || '未命名对话';
      contentWrapper.appendChild(titleEl);

      const actions = document.createElement('div');
      actions.className = 'chat-history-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'chat-history-delete-btn';
      deleteBtn.title = '删除对话';
      deleteBtn.innerHTML = window.icons?.trash || '×';
      deleteBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        this.confirmDeleteConversation(conversation);
      });
      actions.appendChild(deleteBtn);

      item.appendChild(contentWrapper);
      item.appendChild(actions);
      item.addEventListener('click', () => {
        this.openConversation(conversation.id);
      });

      this.historyListEl.appendChild(item);
    });
  }

  confirmDeleteConversation(conversation) {
    if (!conversation || typeof conversation.id !== 'number') {
      return;
    }
    const title = conversation.title || '未命名对话';
    const executeDeletion = () => {
      this.deleteConversation(conversation.id);
    };

    if (typeof window.showModal === 'function') {
      window.showModal({
        type: 'warning',
        title: '删除对话',
        message: `确定要删除“${title}”及其全部历史记录吗？`,
        confirmText: '删除',
        cancelText: '保留',
        showCancel: true,
        onConfirm: executeDeletion
      });
      return;
    }

    if (window.confirm(`确定要删除“${title}”及其全部历史记录吗？`)) {
      executeDeletion();
    }
  }

  async deleteConversation(conversationId) {
    if (typeof conversationId !== 'number') {
      return;
    }
    try {
      const response = await fetch(`${this.baseApiUrl}/conversations/${conversationId}`, {
        method: 'DELETE'
      });
      if (response.status === 404) {
        this.setStatus('该对话不存在或已被删除。', 'warning');
        await this.refreshConversations();
        return;
      }
      if (!response.ok) {
        throw new Error(`删除失败 (${response.status})`);
      }

      if (this.currentConversationId === conversationId) {
        this.currentConversationId = null;
        this.messages = [];
      }

      await this.refreshConversations();

      if (this.currentConversationId === null) {
        if (this.conversations.length > 0) {
          await this.openConversation(this.conversations[0].id);
        } else {
          this.startNewConversation();
        }
      } else {
        this.renderMessages();
      }
      this.setStatus('对话已删除。', 'success');
    } catch (error) {
      console.error('删除对话失败:', error);
      this.setStatus('删除对话失败，请稍后重试。', 'error');
    }
  }

  highlightActiveConversation() {
    if (!this.historyListEl) {
      return;
    }

    const items = this.historyListEl.querySelectorAll('.chat-history-item');
    items.forEach((item) => {
      const id = Number.parseInt(item.dataset.conversationId, 10);
      if (!Number.isNaN(id) && id === this.currentConversationId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  async openConversation(conversationId) {
    if (typeof conversationId !== 'number') {
      return;
    }

    try {
      const response = await fetch(`${this.baseApiUrl}/conversations/${conversationId}`);
      if (!response.ok) {
        throw new Error(`获取对话详情失败 (${response.status})`);
      }
      const data = await response.json();
      this.currentConversationId = data.conversation.id;
      this.messages = this.normalizeMessageList(data.messages);
      this.ensureStreamingMessageRetained(conversationId);
      this.renderMessages();
      const conversationSummary = data.conversation ? { ...data.conversation } : null;
      if (conversationSummary) {
        if (typeof conversationSummary.title === 'string' && conversationSummary.title) {
          conversationSummary.title = ChatUtils.normalizeModelText(conversationSummary.title) || conversationSummary.title;
        }
        if (typeof conversationSummary.last_message === 'string' && conversationSummary.last_message) {
          conversationSummary.last_message = ChatUtils.normalizeModelText(conversationSummary.last_message);
        }
      }
      this.updateConversationHeader(conversationSummary || data.conversation);
      this.highlightActiveConversation();
      if (this.chatMessagesContainer) {
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
      }
    } catch (error) {
      console.error('打开对话失败:', error);
      this.setStatus('加载对话失败，请稍后重试。', 'error');
    }
  }

  updateConversationHeader(conversation) {
    if (!conversation) {
      return;
    }
    if (this.chatTitleEl) {
      this.chatTitleEl.textContent = conversation.title || '未命名对话';
    }
    if (this.chatTimestampEl) {
      this.chatTimestampEl.textContent = conversation.updated_time
        ? `最近更新：${ChatUtils.formatTimestamp(conversation.updated_time)}`
        : '';
    }
  }

  ensureStreamingMessageRetained(targetConversationId = this.currentConversationId) {
    if (!this.streamingState || !this.streamingState.message) {
      return;
    }

    if (!Array.isArray(this.messages)) {
      this.messages = [];
    }

    const streamingId = this.streamingState.messageId || this.streamingState.message.id;
    if (!streamingId) {
      return;
    }

    const stateKey = Object.prototype.hasOwnProperty.call(this.streamingState, 'conversationKey')
      ? this.streamingState.conversationKey
      : undefined;

    const resolvedTarget = targetConversationId !== undefined
      ? targetConversationId
      : this.currentConversationId;
    const targetKey = resolvedTarget === null || resolvedTarget === undefined
      ? 'pending'
      : `id:${resolvedTarget}`;

    if (stateKey && stateKey !== targetKey) {
      return;
    }

    const exists = this.messages.some((message) => String(message?.id) === String(streamingId));
    if (!exists) {
      this.messages.push(this.streamingState.message);
    }
  }

  renderMessages() {
    if (!this.chatMessagesEl) {
      return;
    }

    this.ensureStreamingMessageRetained();

    this.chatMessagesEl.innerHTML = '';

    if (!this.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-empty-placeholder';
      empty.textContent = '在时刻准备着。';
      this.chatMessagesEl.appendChild(empty);
      return;
    }

    const streamingId = this.streamingState ? String(this.streamingState.messageId) : null;

    this.messages.forEach((message) => {
      const wrapper = document.createElement('div');
      wrapper.className = `chat-message ${message.role}`;
      if (message.id !== undefined && message.id !== null) {
        wrapper.dataset.messageId = String(message.id);
      }

      const rawContent = typeof message.content === 'string' ? message.content : '';
      const trimmedContent = rawContent.trim();
      const isStreamingMessage = streamingId && String(message.id) === streamingId;
      const isWaitingMessage = isStreamingMessage && !trimmedContent;
      if (message.role === 'assistant' && !trimmedContent && !isStreamingMessage) {
        return;
      }

      const header = document.createElement('div');
      header.className = 'chat-message-header';

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      if (message.role === 'user') {
        avatar.classList.add('is-user');
        // 显式设置用户头像的背景图，兼容打包后的资源路径
        try {
          avatar.style.backgroundImage = `url('${ChatUtils.getAssetUrl('dist/assets/user.png')}')`;
        } catch (_) {}
      } else {
        avatar.classList.add('is-assistant');
        // 根据当前是否为深色模式选择助手头像，兼容打包后的资源路径
        try {
          const isDark = document.body && document.body.classList && document.body.classList.contains('dark-mode');
          const assistantAsset = isDark ? 'dist/assets/gpt-dark.png' : 'dist/assets/gpt.png';
          avatar.style.backgroundImage = `url('${ChatUtils.getAssetUrl(assistantAsset)}')`;
        } catch (_) {}
      }
      header.appendChild(avatar);

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';

      const contentEl = document.createElement('div');
      contentEl.className = 'chat-bubble-content';
      bubble.appendChild(contentEl);

      header.appendChild(bubble);

      if (isWaitingMessage) {
        const waitingStage = (this.streamingState && String(this.streamingState.messageId) === String(message.id))
          ? (this.streamingState.stageMessage || '')
          : '';
        this.renderWaitingIndicator(contentEl, waitingStage);
      } else {
        const content = rawContent;
        this.setBubbleContent(contentEl, content, message.role);
      }

      if (isWaitingMessage) {
        this.removeCopyButton(bubble);
      } else {
        this.attachCopyButton(bubble, contentEl);
      }

      wrapper.appendChild(header);
      this.chatMessagesEl.appendChild(wrapper);

      this.applyWaitingState(wrapper, avatar, bubble, isWaitingMessage, message.role);

      if (message.role === 'assistant') {
        if (this.referenceManager) {
          this.referenceManager.updateReferenceSection(wrapper, message.metadata);
        }
      }
    });

    if (this.streamingState) {
      const elements = this.findMessageElements(this.streamingState.messageId);
      this.streamingState.wrapper = elements.wrapper;
      this.streamingState.bubble = elements.bubble;
      this.streamingState.content = elements.content;
      this.streamingState.avatar = elements.avatar;
      this.updateStreamingBubble();
    }
  }

  renderWaitingIndicator(target, message = '') {
    if (!target) {
      return;
    }
    target.innerHTML = '';
    const bubble = target.closest('.chat-bubble');
    const header = bubble ? bubble.parentElement : target.closest('.chat-message-header');
    if (!header) {
      return;
    }
    const wrapper = header.closest('.chat-message');
    let indicator = header.querySelector('.chat-waiting-indicator-inline');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'chat-waiting-indicator chat-waiting-indicator-inline';
      const spinner = document.createElement('div');
      spinner.className = 'chat-waiting-spinner';
      const text = document.createElement('span');
      text.className = 'chat-waiting-text';
      indicator.appendChild(spinner);
      indicator.appendChild(text);
      if (bubble) {
        header.insertBefore(indicator, bubble);
      } else {
        header.appendChild(indicator);
      }
    }
    const textNode = indicator.querySelector('.chat-waiting-text');
    if (textNode) {
      textNode.textContent = message || '';
      textNode.style.display = message ? '' : 'none';
    }
    if (bubble) {
      bubble.style.display = 'none';
      bubble.classList.add('is-waiting-hidden');
    }
    indicator.hidden = false;
    if (wrapper) {
      wrapper.classList.add('is-waiting');
    }
  }

  removeWaitingIndicator(wrapper) {
    if (!wrapper) {
      return;
    }
    const header = wrapper.querySelector('.chat-message-header');
    if (!header) {
      return;
    }
    const indicator = header.querySelector('.chat-waiting-indicator-inline');
    if (indicator && indicator.parentElement) {
      indicator.parentElement.removeChild(indicator);
    }
    const bubble = header.querySelector('.chat-bubble');
    if (bubble) {
      bubble.style.display = '';
      bubble.classList.remove('is-waiting-hidden');
    }
  }

  applyWaitingState(wrapper, avatar, bubble, isWaiting, role = 'assistant') {
    if (wrapper) {
      wrapper.classList.toggle('is-waiting', Boolean(isWaiting));
    }
    if (bubble) {
      bubble.classList.toggle('is-waiting', Boolean(isWaiting));
    }
    if (!isWaiting && wrapper) {
      this.removeWaitingIndicator(wrapper);
    }
    if (!avatar) {
      return;
    }

    // 始终根据角色设置头像类型
    if (role === 'user') {
      avatar.classList.add('is-user');
      avatar.classList.remove('is-assistant');
    } else {
      avatar.classList.add('is-assistant');
      avatar.classList.remove('is-user');
    }

    // 等待状态下，弱化头像阴影并显示头像后的加载圆圈
    if (isWaiting) {
      avatar.classList.add('chat-avatar-waiting');
    } else {
      avatar.classList.remove('chat-avatar-waiting');
    }

    const spinnerEl = wrapper ? wrapper.querySelector('.chat-avatar-spinner') : null;
    if (spinnerEl) {
      spinnerEl.style.display = isWaiting && role !== 'user' ? 'inline-block' : 'none';
    }
  }

  findMessageElements(messageId) {
    if (!this.chatMessagesEl) {
      return { wrapper: null, bubble: null, content: null, avatar: null };
    }
    const selectorId = messageId !== undefined && messageId !== null ? String(messageId) : '';
    if (!selectorId) {
      return { wrapper: null, bubble: null, content: null, avatar: null };
    }
    const wrapper = this.chatMessagesEl.querySelector(`[data-message-id="${selectorId}"]`);
    const bubble = wrapper ? wrapper.querySelector('.chat-bubble') : null;
    const content = bubble ? bubble.querySelector('.chat-bubble-content') : null;
    const avatar = wrapper ? wrapper.querySelector('.chat-avatar') : null;
    return { wrapper, bubble, content, avatar };
  }

  updateStreamingBubble() {
    if (!this.streamingState) {
      return;
    }
    const state = this.streamingState;
    if (!state.wrapper || !state.content || !state.avatar) {
      const elements = this.findMessageElements(state.messageId);
      state.wrapper = elements.wrapper;
      state.bubble = elements.bubble;
      state.content = elements.content;
      state.avatar = elements.avatar;
    }
    if (!state.content) {
      return;
    }
    const content = state.buffer || state.message?.content || '';
    const trimmed = content.trim();
    const role = state.message?.role || 'assistant';
    if (!trimmed) {
      const waitingStage = state.stageMessage || '';
      this.renderWaitingIndicator(state.content, waitingStage);
      this.removeCopyButton(state.bubble);
      this.applyWaitingState(state.wrapper, state.avatar, state.bubble, true, role);
      return;
    }
    this.removeWaitingIndicator(state.wrapper);
    this.setBubbleContent(state.content, content, role);
    this.attachCopyButton(state.bubble, state.content);
    this.applyWaitingState(state.wrapper, state.avatar, state.bubble, false, role);

    if (role === 'assistant' && state.wrapper) {
      const metadata = state.message?.metadata || state.metadata;
      if (this.referenceManager) {
        this.referenceManager.updateReferenceSection(state.wrapper, metadata);
      }
    }
  }

  normalizeMessageList(messages) {
    if (!Array.isArray(messages)) {
      return [];
    }
    return messages.map((message) => {
      if (!message || typeof message !== 'object') {
        return message;
      }
      const normalized = { ...message };
      if (typeof normalized.content === 'string') {
        normalized.content = ChatUtils.normalizeModelText(normalized.content);
      }
      return normalized;
    });
  }

  normalizeConversationList(conversations) {
    if (!Array.isArray(conversations)) {
      return [];
    }
    return conversations.map((item) => {
      if (!item || typeof item !== 'object') {
        return item;
      }
      const normalized = { ...item };
      if (typeof normalized.title === 'string' && normalized.title) {
        normalized.title = ChatUtils.normalizeModelText(normalized.title) || normalized.title;
      }
      if (typeof normalized.last_message === 'string' && normalized.last_message) {
        normalized.last_message = ChatUtils.normalizeModelText(normalized.last_message);
      }
      return normalized;
    });
  }

  ensureMarkdownRenderer() {
    if (!this.markdownViewer && typeof window !== 'undefined') {
      if (window.chatMarkdownViewer && typeof window.chatMarkdownViewer.parseMarkdown === 'function') {
        this.markdownViewer = window.chatMarkdownViewer;
      } else if (typeof window.MarkdownViewer === 'function') {
        try {
          this.markdownViewer = new window.MarkdownViewer();
          window.chatMarkdownViewer = this.markdownViewer;
        } catch (error) {
          console.warn('MarkdownViewer 初始化失败:', error);
          this.markdownViewer = null;
        }
      }
    }

    if (this.markdownViewer && typeof this.markdownViewer.ensureMarkdownIt === 'function') {
      this.markdownViewer.ensureMarkdownIt();
    }
  }

  injectMarkdownAsset(node) {
    if (!node) {
      return;
    }
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) {
      return;
    }
    if (node.tagName === 'LINK') {
      const href = node.getAttribute('href') || '';
      const key = `link:${href}`;
      if (!href || this.markdownStyleRefs.has(key)) {
        return;
      }
      this.markdownStyleRefs.add(key);
      head.appendChild(node.cloneNode(true));
    } else if (node.tagName === 'STYLE') {
      const content = node.textContent || '';
      const key = `style:${content.length}:${content.slice(0, 32)}`;
      if (this.markdownStyleRefs.has(key)) {
        return;
      }
      this.markdownStyleRefs.add(key);
      head.appendChild(node.cloneNode(true));
    }
  }

  renderAssistantMarkdownElement(text) {
    this.ensureMarkdownRenderer();
    const viewer = this.markdownViewer;
    let html = '';

    if (viewer && typeof viewer.parseMarkdown === 'function') {
      try {
        html = viewer.parseMarkdown(text);
      } catch (error) {
        console.warn('MarkdownViewer 解析失败:', error);
        html = '';
      }
    }

    if (!html) {
      html = this.renderBasicMarkdown(text);
    }

    if (!html || typeof html !== 'string') {
      return null;
    }

    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const assets = template.content.querySelectorAll('style,link[rel="stylesheet"]');
    assets.forEach((asset) => this.injectMarkdownAsset(asset));
    assets.forEach((asset) => asset.remove());

    let body = template.content.querySelector('.markdown-body');
    if (body) {
      const clone = body.cloneNode(true);
      clone.classList.remove('markdown-body');
      clone.classList.add('chat-markdown-body');
      this.decorateMarkdownElement(clone);
      this.trimMarkdownWhitespace(clone);
      return clone;
    }

    const fragment = template.content.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-markdown-body';
    wrapper.appendChild(fragment);
    wrapper.normalize();
    this.decorateMarkdownElement(wrapper);
    this.trimMarkdownWhitespace(wrapper);
    return wrapper;
  }

  decorateMarkdownElement(root) {
    if (!root) {
      return;
    }
    root.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
    const codeBlocks = root.querySelectorAll('pre code');
    codeBlocks.forEach((block) => {
      if (window.hljs && typeof window.hljs.highlightElement === 'function') {
        try {
          window.hljs.highlightElement(block);
        } catch (error) {
          console.debug('代码高亮失败:', error);
        }
      }
      if (!block.classList.contains('hljs')) {
        block.classList.add('hljs');
      }
    });
  }

  trimMarkdownWhitespace(root) {
    if (!root || !root.childNodes) {
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const toRemove = [];
    while (true) {
      const node = walker.nextNode();
      if (!node) {
        break;
      }
      const parent = node.parentElement;
      if (!parent || parent.closest('pre')) {
        continue;
      }
      if (!node.textContent.trim()) {
        toRemove.push(node);
      } else {
        node.textContent = node.textContent.replace(/\s+/g, ' ');
      }
    }
    toRemove.forEach((node) => {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    root.normalize();
  }

  renderBasicMarkdown(text) {
    const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const source = String(text || '').replace(/\r\n?/g, '\n');

    const lines = source.split('\n');
    const blocks = [];
    let buffer = [];
    let listBuffer = [];
    let listType = null;

    const flushParagraph = () => {
      if (buffer.length) {
        const paragraph = buffer.join(' ');
        blocks.push(`<p>${paragraph}</p>`);
        buffer = [];
      }
    };

    const flushList = () => {
      if (!listBuffer.length) {
        return;
      }
      const items = listBuffer.map((item) => `<li>${item}</li>`).join('');
      blocks.push(listType === 'ol' ? `<ol>${items}</ol>` : `<ul>${items}</ul>`);
      listBuffer = [];
      listType = null;
    };

    lines.forEach((line) => {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        flushParagraph();
        flushList();
        return;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        const textContent = escapeHtml(headingMatch[2].trim());
        blocks.push(`<h${level}>${textContent}</h${level}>`);
        return;
      }

      const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (orderedMatch) {
        flushParagraph();
        const itemText = this.renderBasicInline(orderedMatch[1].trim());
        if (listType && listType !== 'ol') {
          flushList();
        }
        listType = 'ol';
        listBuffer.push(itemText);
        return;
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
      if (unorderedMatch) {
        flushParagraph();
        const itemText = this.renderBasicInline(unorderedMatch[1].trim());
        if (listType && listType !== 'ul') {
          flushList();
        }
        listType = 'ul';
        listBuffer.push(itemText);
        return;
      }

      flushList();
      buffer.push(this.renderBasicInline(trimmed));
    });

    flushParagraph();
    flushList();

    if (!blocks.length) {
      return '';
    }

    return `<div class="chat-markdown-body">${blocks.join('')}</div>`;
  }

  renderBasicInline(text) {
    if (!text) {
      return '';
    }
    let result = text;
    result = result.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    result = result
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return result;
  }

  setBubbleContent(target, content, role = 'assistant') {
    if (!target) {
      return;
    }
    const rawText = typeof content === 'string' ? content : '';
    const normalized = rawText
      .replace(/\r\n?/g, '\n')
      .replace(/\u00A0/g, ' ')
      .replace(/\u3000/g, ' ')
      .replace(/\uFEFF/g, '');
    const lines = normalized.split('\n');
    const cleanedLines = [];
    let inCodeFence = false;
    lines.forEach((line) => {
      let current = line.replace(/\uFEFF/g, '');
      const fenceMatch = current.match(/^\s*```/);
      if (fenceMatch) {
        current = current.replace(/[ \t]+$/g, '');
        cleanedLines.push(current);
        inCodeFence = !inCodeFence;
        return;
      }
      if (inCodeFence) {
        cleanedLines.push(current);
        return;
      }
      let trimmedRight = current.replace(/[ \t]+$/g, '');
      trimmedRight = trimmedRight.replace(/^[ ]{0,3}(#+)/, (_, hashes) => hashes);
      cleanedLines.push(trimmedRight);
    });
    const text = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (role === 'assistant') {
      const { answerText, thinkingSegments } = this.extractThinkingSegments(text);
      const rendered = this.renderAssistantMarkdownElement(answerText);
      if (rendered || thinkingSegments.length) {
        target.innerHTML = '';
        if (thinkingSegments.length) {
          const thinkingPanel = this.renderThinkingPanel(thinkingSegments);
          if (thinkingPanel) {
            target.appendChild(thinkingPanel);
          }
        }
        if (rendered) {
          target.appendChild(rendered);
        } else if (answerText) {
          const fallback = document.createElement('div');
          fallback.className = 'chat-plaintext';
          fallback.textContent = answerText;
          target.appendChild(fallback);
        }
        return;
      }
    }

    target.textContent = text;
  }

  extractThinkingSegments(text) {
    if (!text || typeof text !== 'string') {
      return { answerText: '', thinkingSegments: [] };
    }
    const segments = [];
    const parts = [];
    let lastIndex = 0;
    const startTagRegex = /<think\b[^>]*>/gi;
    let match;
    while ((match = startTagRegex.exec(text)) !== null) {
      const tagStart = match.index;
      const tagEnd = startTagRegex.lastIndex;
      parts.push(text.slice(lastIndex, tagStart));
      const closeIndex = text.indexOf('</think>', tagEnd);
      if (closeIndex === -1) {
        const fragment = text.slice(tagEnd);
        if (fragment && fragment.trim()) {
          segments.push({
            content: fragment.trim(),
            completed: false
          });
        }
        lastIndex = text.length;
        break;
      }
      const fragment = text.slice(tagEnd, closeIndex);
      if (fragment && fragment.trim()) {
        segments.push({
          content: fragment.trim(),
          completed: true
        });
      }
      lastIndex = closeIndex + '</think>'.length;
      startTagRegex.lastIndex = lastIndex;
    }
    parts.push(text.slice(lastIndex));
    const answerText = parts.join('').trim();
    return { answerText, thinkingSegments: segments };
  }

  renderThinkingPanel(segments) {
    if (!Array.isArray(segments) || segments.length === 0) {
      return null;
    }
    const details = document.createElement('details');
    details.className = 'chat-thinking-panel';
    const hasIncomplete = segments.some((segment) => !segment.completed);
    details.open = hasIncomplete;

    const summary = document.createElement('summary');
    summary.className = 'chat-thinking-summary';
    const segmentCount = segments.length;
    if (hasIncomplete) {
      summary.textContent = segmentCount > 1 ? `思考过程（进行中，${segmentCount} 段）` : '思考过程（进行中）';
    } else {
      summary.textContent = segmentCount > 1 ? `思考过程（${segmentCount} 段）` : '思考过程';
    }
    details.appendChild(summary);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'chat-thinking-content';

    segments.forEach((segment, index) => {
      if (!segment || typeof segment.content !== 'string') {
        return;
      }
      const block = document.createElement('div');
      block.className = 'chat-thinking-block';
      if (!segment.completed) {
        block.classList.add('is-partial');
      }
      const pre = document.createElement('pre');
      pre.className = 'chat-thinking-pre';
      pre.textContent = segment.content;
      block.appendChild(pre);
      contentWrapper.appendChild(block);
      if (index < segments.length - 1) {
        block.classList.add('has-divider');
      }
    });

    if (contentWrapper.children.length === 0) {
      return null;
    }

    details.appendChild(contentWrapper);
    return details;
  }

  attachCopyButton(bubble, contentEl) {
    if (!bubble || !contentEl) {
      return;
    }
    bubble.classList.add('has-copy');
    let button = bubble.querySelector('.chat-copy-button');
    if (!button) {
      button = this.createCopyButton(contentEl);
      bubble.appendChild(button);
    }
    button._copyTarget = contentEl;
    button.classList.remove('is-copied');
  }

  removeCopyButton(bubble) {
    if (!bubble) {
      return;
    }
    bubble.classList.remove('has-copy');
    const button = bubble.querySelector('.chat-copy-button');
    if (!button) {
      return;
    }
    if (button._copyTimer) {
      clearTimeout(button._copyTimer);
    }
    button.remove();
  }

  createCopyButton(contentEl) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-copy-button';
    button.innerHTML = window.icons?.copy || '复制';
    button.setAttribute('aria-label', '复制内容');
    button.setAttribute('title', '复制内容');
    button._copyTarget = contentEl;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = button._copyTarget || contentEl;
      this.copyBubbleContent(button, target);
    });
    return button;
  }

  async copyBubbleContent(button, contentEl) {
    if (!contentEl) {
      this.setStatus('暂无可复制内容', 'warning');
      return;
    }
    const text = this.extractBubbleText(contentEl);
    if (!text) {
      this.setStatus('暂无可复制内容', 'warning');
      return;
    }

    let success = false;
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch (error) {
        success = false;
      }
    }

    if (!success) {
      success = this.fallbackCopyToClipboard(text);
    }

    if (!success) {
      this.setStatus('复制失败，请手动复制。', 'error');
      return;
    }

    button.classList.add('is-copied');
    button.blur();
    if (button._copyTimer) {
      clearTimeout(button._copyTimer);
    }
    button._copyTimer = setTimeout(() => {
      button.classList.remove('is-copied');
    }, 1500);
  }

  extractBubbleText(contentEl) {
    if (!contentEl) {
      return '';
    }
    const text = typeof contentEl.innerText === 'string' ? contentEl.innerText : contentEl.textContent;
    return (text || '').replace(/\r\n/g, '\n').trim();
  }

  fallbackCopyToClipboard(text) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const succeeded = document.execCommand('copy');
      document.body.removeChild(textarea);
      return succeeded;
    } catch (error) {
      return false;
    }
  }

  parseSSEEvent(rawEvent) {
    if (!rawEvent) {
      return null;
    }
    // 统一换行到 \n，避免 Windows CRLF 影响解析
    const normalized = rawEvent.replace(/\r\n/g, '\n');
    const dataParts = [];
    normalized.split('\n').forEach((line) => {
      if (line.startsWith('data:')) {
        dataParts.push(line.slice(5).trim());
      }
    });
    if (!dataParts.length) {
      return null;
    }
    const payload = dataParts.join('\n');
    if (!payload) {
      return null;
    }
    // 兼容上游以 [DONE] 结束的流
    if (payload === '[DONE]') {
      return { event: 'done', data: {} };
    }
    try {
      return JSON.parse(payload);
    } catch (error) {
      console.warn('无法解析流数据:', payload, error);
      return null;
    }
  }

  handleStreamEvent(eventPayload) {
    if (!eventPayload) {
      return null;
    }

    // 支持直接转发的上游 SSE 事件（无 event 字段）
    if (!eventPayload.event) {
      const choices = Array.isArray(eventPayload.choices) ? eventPayload.choices : [];
      if (choices.length) {
        const choice = choices[0] || {};
        const deltaObj = choice.delta || choice.message || {};
        const rawDelta = typeof deltaObj.content === 'string' ? deltaObj.content : '';
        if (rawDelta) {
          if (!this.streamingState) {
            return null;
          }
          const delta = ChatUtils.normalizeModelText(rawDelta) || rawDelta;
          this.streamingState.buffer += delta;
          if (this.streamingState.message) {
            this.streamingState.message.content = this.streamingState.buffer;
          }
          this.updateStreamingBubble();
          return null;
        }
      }
    }
    const { event, data = {} } = eventPayload;

    if (event === 'meta') {
      if (typeof data.conversation_id === 'number') {
        this.currentConversationId = data.conversation_id;
      }
      if (this.streamingState) {
        if (typeof data.conversation_id === 'number') {
          this.streamingState.conversationId = data.conversation_id;
          this.streamingState.conversationKey = `id:${data.conversation_id}`;
        }
        if (data.assistant_message_id) {
          this.streamingState.messageId = data.assistant_message_id;
          if (this.streamingState.message) {
            this.streamingState.message.id = data.assistant_message_id;
          }
          if (this.streamingState.wrapper) {
            this.streamingState.wrapper.dataset.messageId = String(data.assistant_message_id);
          }
        }
        if (data.metadata) {
          this.streamingState.message.metadata = data.metadata;
          this.streamingState.metadata = data.metadata;
        }
        if (typeof data.client_request_id === 'string') {
          this.streamingState.clientRequestId = data.client_request_id;
        }
      }
      return null;
    }

    if (event === 'chunk') {
      if (!this.streamingState) {
        return null;
      }
      const rawDelta = typeof data.delta === 'string' ? data.delta : '';
      if (!rawDelta) {
        return null;
      }
      const delta = ChatUtils.normalizeModelText(rawDelta) || rawDelta;
      this.streamingState.buffer += delta;
      if (this.streamingState.message) {
        this.streamingState.message.content = this.streamingState.buffer;
      }
      this.updateStreamingBubble();
      return null;
    }

    if (event === 'done') {
      if (typeof data.conversation_id === 'number') {
        if (this.streamingState) {
          this.streamingState.conversationId = data.conversation_id;
          this.streamingState.conversationKey = `id:${data.conversation_id}`;
        }
        if (this.currentConversationId === null || this.currentConversationId === undefined) {
          this.currentConversationId = data.conversation_id;
        }
      }
      if (this.streamingState) {
        const rawContent = typeof data.content === 'string'
          ? data.content
          : this.streamingState.buffer;
        const finalContent = ChatUtils.normalizeModelText(rawContent || '') || rawContent || '';
        this.streamingState.buffer = finalContent;
        const trimmedFinal = finalContent.trim();
        if (!trimmedFinal) {
          const emptyMessageId = this.streamingState.message ? this.streamingState.message.id : null;
          if (emptyMessageId) {
            const messageIdStr = String(emptyMessageId);
            this.messages = this.messages.filter((message) => String(message.id) !== messageIdStr);
            const existing = this.findMessageElements(messageIdStr);
            if (existing.wrapper && existing.wrapper.parentElement) {
              existing.wrapper.parentElement.removeChild(existing.wrapper);
            }
          }
          this.streamingState = null;
          this.renderMessages();
          // 保留必要的警告，但不显示“回答已完成”
          this.setStatus('模型未返回内容。', 'warning');
          return 'done';
        }
        if (this.streamingState.message) {
          this.streamingState.message.content = this.streamingState.buffer;
          if (data.assistant_message_id) {
            this.streamingState.message.id = data.assistant_message_id;
          }
          if (data.metadata) {
            this.streamingState.message.metadata = data.metadata;
          }
        }
        if (data.assistant_message_id) {
          this.streamingState.messageId = data.assistant_message_id;
        }
        if (this.streamingState.wrapper) {
          this.streamingState.wrapper.dataset.messageId = String(this.streamingState.messageId);
        }
        if (data.metadata) {
          this.streamingState.metadata = data.metadata;
        }
        this.updateStreamingBubble();
      }
      return 'done';
    }

    if (event === 'error') {
      const rawMessage = typeof data.message === 'string' && data.message
        ? data.message
        : '生成失败，请稍后重试。';
      const errorMessage = ChatUtils.normalizeModelText(rawMessage) || rawMessage;
      this.setStatus(errorMessage, 'error');
      if (this.streamingState) {
        this.streamingState.buffer = errorMessage;
        if (this.streamingState.message) {
          this.streamingState.message.content = errorMessage;
          this.streamingState.message.metadata = {
            ...(this.streamingState.message.metadata || {}),
            error: true
          };
        }
        this.updateStreamingBubble();
      }
      return 'error';
    }

    return null;
  }

  async processStreamResponse(response) {
    if (!response.body || !response.body.getReader) {
      throw new Error('当前环境不支持流式响应。');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let buffer = '';
    let hadError = false;
    let aborted = false;
    const cancelReader = async () => {
      try {
        await reader.cancel();
      } catch (error) {
        console.debug('取消流式读取失败:', error);
      }
    };

    while (true) {
      let readResult;
      try {
        readResult = await reader.read();
      } catch (error) {
        if (this.abortRequested || (error && error.name === 'AbortError')) {
          aborted = true;
          break;
        }
        throw error;
      }
      const { value, done } = readResult;
      if (done) {
        break;
      }
      if (this.abortRequested) {
        aborted = true;
        await cancelReader();
        break;
      }
      // 增量解码，确保中文等多字节字符不被截断
      buffer += decoder.decode(value, { stream: true });

      // 兼容不同换行符，优先处理已完整事件
      let idxLF = buffer.indexOf('\n\n');
      let idxCRLF = buffer.indexOf('\r\n\r\n');
      while (idxLF !== -1 || idxCRLF !== -1) {
        let sepIdx;
        let sepLen;
        if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF < idxLF)) {
          sepIdx = idxCRLF;
          sepLen = 4;
        } else {
          sepIdx = idxLF;
          sepLen = 2;
        }
        const rawEvent = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + sepLen);
        if (!rawEvent.trim()) {
          continue;
        }
        const eventPayload = this.parseSSEEvent(rawEvent);
        if (!eventPayload) {
          continue;
        }
        const result = this.handleStreamEvent(eventPayload);
        if (result === 'error') {
          hadError = true;
          await cancelReader();
          return { hadError, aborted };
        }
        if (result === 'done') {
          return { hadError, aborted };
        }
        if (this.abortRequested) {
          aborted = true;
          await cancelReader();
          return { hadError, aborted };
        }
        // 继续查找剩余缓冲中的完整事件
        idxLF = buffer.indexOf('\n\n');
        idxCRLF = buffer.indexOf('\r\n\r\n');
      }
    }

    if (this.abortRequested && !aborted) {
      aborted = true;
    }

    if (aborted) {
      return { hadError, aborted };
    }

    // 读取结束后执行最终flush，确保最后一个多字节字符不丢失
    buffer += decoder.decode();

    // 处理任何剩余的完整事件
    let idxLF = buffer.indexOf('\n\n');
    let idxCRLF = buffer.indexOf('\r\n\r\n');
    while (idxLF !== -1 || idxCRLF !== -1) {
      let sepIdx;
      let sepLen;
      if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF < idxLF)) {
        sepIdx = idxCRLF;
        sepLen = 4;
      } else {
        sepIdx = idxLF;
        sepLen = 2;
      }
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + sepLen);
      if (rawEvent.trim()) {
        const eventPayload = this.parseSSEEvent(rawEvent);
        if (eventPayload) {
          const result = this.handleStreamEvent(eventPayload);
          if (result === 'error') {
            hadError = true;
          }
          if (result === 'done' || this.abortRequested) {
            if (this.abortRequested) {
              aborted = true;
            }
            return { hadError, aborted };
          }
        }
      }
      idxLF = buffer.indexOf('\n\n');
      idxCRLF = buffer.indexOf('\r\n\r\n');
    }

    // 处理最后残留的单一事件（可能没有以空行结尾）
    if (buffer.trim()) {
      const eventPayload = this.parseSSEEvent(buffer);
      if (eventPayload) {
        const result = this.handleStreamEvent(eventPayload);
        if (result === 'error') {
          hadError = true;
        }
        if (result === 'done') {
          return { hadError, aborted };
        }
      }
    }

    return { hadError, aborted };
  }

  async handleSend() {
    if (!this.chatInputEl || !this.chatSendBtn) {
      return;
    }

    const question = this.chatInputEl.value.trim();
    if (!question) {
      this.setStatus('请输入问题', 'warning');
      return;
    }

    if (!this.selectedModel) {
      this.setStatus('请选择模型', 'warning');
      return;
    }

    if (!this.selectedModel.apiModel) {
      this.setStatus('当前模型缺少调用信息，请重新选择。', 'warning');
      return;
    }

    const settingsModule = window.settingsModule;
    const requiresApiKey = this.selectedModel.requiresApiKey !== false;
    let apiKeySetting = this.selectedModel.apiKeySetting || null;
    let apiKey = '';

    if (requiresApiKey) {
      const keyId = apiKeySetting || 'siliconflwApiKey';
      apiKeySetting = keyId;
      apiKey = settingsModule && typeof settingsModule.getApiKey === 'function'
        ? settingsModule.getApiKey(keyId)
        : '';
      if (!apiKey) {
        this.setStatus('请先在设置页面填写模型所需的 API Key。', 'warning');
        return;
      }
    }

    const apiUrl = typeof this.selectedModel.apiUrl === 'string'
      ? this.selectedModel.apiUrl.trim()
      : '';

    if (!requiresApiKey && (!apiUrl || !apiUrl.length) && this.selectedModel.sourceId === 'ollama') {
      this.setStatus('当前模型缺少接口 URL，请重新添加。', 'warning');
      return;
    }

    if (this.isStreaming || this.pendingRequest) {
      return;
    }

    this.pendingRequest = true;
    this.updateSendButtonState();

    this.closeModelDropdown();

    if (this.chatInputEl) {
      this.chatInputEl.disabled = true;
    }

    const userMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: question,
      created_time: new Date().toISOString(),
      metadata: null
    };
    this.messages.push(userMessage);

    const streamingMessage = {
      id: `pending-${Date.now()}`,
      role: 'assistant',
      content: '',
      created_time: new Date().toISOString(),
      metadata: null
    };
    this.messages.push(streamingMessage);

    this.streamingState = {
      message: streamingMessage,
      messageId: streamingMessage.id,
      clientRequestId: streamingMessage.id,
      wrapper: null,
      bubble: null,
      content: null,
      avatar: null,
      buffer: '',
      metadata: null,
      stageMessage: '正在理解问题',
      stageStatus: 'running',
      stageStep: 1,
      conversationId: this.currentConversationId,
      conversationKey: (this.currentConversationId === null || this.currentConversationId === undefined)
        ? 'pending'
        : `id:${this.currentConversationId}`
    };

    this.renderMessages();

    const elements = this.findMessageElements(streamingMessage.id);
    this.streamingState.wrapper = elements.wrapper;
    this.streamingState.bubble = elements.bubble;
    this.streamingState.content = elements.content;
    this.streamingState.avatar = elements.avatar;
    this.updateStreamingBubble();

    const payload = {
      question,
      conversation_id: this.currentConversationId,
      top_k: 5,
      stream: true,
      client_request_id: streamingMessage.id,
      use_summary_search: this.shouldUseSummarySearch(),
      model: {
        source_id: this.selectedModel.sourceId,
        model_id: this.selectedModel.modelId,
        api_model: this.selectedModel.apiModel,
        provider_name: this.selectedModel.providerName || '',
        api_key: requiresApiKey ? apiKey : '',
        api_key_setting: apiKeySetting || undefined,
        api_url: apiUrl || undefined,
        requires_api_key: requiresApiKey
      }
    };

    this.chatInputEl.value = '';
    this.autoResizeTextarea();

    const controller = new AbortController();
    this.activeRequestController = controller;
    this.abortRequested = false;

    this.isStreaming = true;
    this.pendingRequest = null;
    this.updateSendButtonState();

    let hadError = false;
    let aborted = false;

    try {
      const response = await fetch(`${this.baseApiUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `发送失败 (${response.status})`);
      }

      const { hadError: streamError, aborted: streamAborted } = await this.processStreamResponse(response);
      hadError = streamError;
      aborted = streamAborted || this.abortRequested;

      if (aborted) {
        if (this.streamingState && this.streamingState.message) {
          streamingMessage.content = this.streamingState.buffer || streamingMessage.content;
          streamingMessage.metadata = {
            ...(streamingMessage.metadata || {}),
            aborted: true
          };
        }
        this.streamingState = null;
        this.renderMessages();
        this.setStatus('回答已终止。', 'info');
      } else if (hadError) {
        if (this.streamingState && this.streamingState.message) {
          streamingMessage.content = this.streamingState.buffer || streamingMessage.content;
          streamingMessage.metadata = {
            ...(streamingMessage.metadata || {}),
            error: true
          };
        }
        this.streamingState = null;
        this.renderMessages();
      } else {
        if (this.streamingState && this.streamingState.message) {
          streamingMessage.content = this.streamingState.buffer || streamingMessage.content;
          if (this.streamingState.metadata) {
            streamingMessage.metadata = this.streamingState.metadata;
          }
        }
        this.streamingState = null;
        await this.refreshConversations();
        if (this.currentConversationId !== null && this.currentConversationId !== undefined) {
          await this.openConversation(this.currentConversationId);
        } else {
          this.renderMessages();
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError' || this.abortRequested) {
        aborted = true;
        if (this.streamingState && this.streamingState.message) {
          streamingMessage.content = this.streamingState.buffer || streamingMessage.content;
          streamingMessage.metadata = {
            ...(streamingMessage.metadata || {}),
            aborted: true
          };
        }
        this.streamingState = null;
        this.renderMessages();
        this.setStatus('回答已终止。', 'info');
      } else {
        console.error('发送消息失败:', error);
        const message = error?.message || '发送失败，请稍后重试。';
        this.setStatus(message, 'error');
        streamingMessage.content = message;
        streamingMessage.metadata = {
          ...(streamingMessage.metadata || {}),
          error: true
        };
        this.streamingState = null;
        this.renderMessages();
        hadError = true;
        try {
          await this.refreshConversations();
          if (this.currentConversationId !== null && this.currentConversationId !== undefined) {
            await this.openConversation(this.currentConversationId);
          }
        } catch (refreshError) {
          console.warn('刷新会话失败:', refreshError);
        }
      }
    } finally {
      this.isStreaming = false;
      this.activeRequestController = null;
      this.abortRequested = false;
      this.pendingRequest = null;
      if (this.chatInputEl) {
        this.chatInputEl.disabled = false;
        this.chatInputEl.focus();
      }
      this.updateSendButtonState();
      if (!hadError && !aborted && this.chatStatusTextEl) {
        this.chatStatusTextEl.textContent = '';
        delete this.chatStatusTextEl.dataset.statusType;
      }
    }
  }

  autoResizeTextarea() {
    if (!this.chatInputEl) {
      return;
    }
    const computed = window.getComputedStyle(this.chatInputEl);
    if (this.chatInputBaseHeight === null) {
      const minHeight = parseFloat(computed.minHeight) || parseFloat(computed.lineHeight) || 24;
      this.chatInputBaseHeight = minHeight;
    }
    if (this.chatInputMaxHeight === null) {
      const maxHeight = parseFloat(computed.maxHeight);
      this.chatInputMaxHeight = Number.isNaN(maxHeight) ? 320 : maxHeight;
    }
    const base = this.chatInputBaseHeight;
    const limit = this.chatInputMaxHeight;
    this.chatInputEl.style.height = 'auto';
    const next = Math.min(Math.max(base, this.chatInputEl.scrollHeight), limit);
    this.chatInputEl.style.height = `${next}px`;
  }

  toggleHistoryCollapse() {
    this.isHistoryCollapsed = !this.isHistoryCollapsed;
    const historyContainer = document.querySelector('#chat-history-container');
    const chatPageEl = document.querySelector('#chat-page');
    const collapseBtn = document.querySelector('#chat-history-collapse-btn');
    const expandBtn = document.querySelector('#collapsed-expand-btn');
    
    if (this.isHistoryCollapsed) {
      historyContainer?.classList.add('collapsed');
      chatPageEl?.classList.add('expanded');
      if (collapseBtn) {
        collapseBtn.innerHTML = window.icons?.chevronRight || '';
      }
      if (expandBtn) {
        expandBtn.style.display = 'flex';
        expandBtn.innerHTML = window.icons?.chevronRight || '';
      }
    } else {
      historyContainer?.classList.remove('collapsed');
      chatPageEl?.classList.remove('expanded');
      if (collapseBtn) {
        collapseBtn.innerHTML = window.icons?.chevronLeft || '';
      }
      if (expandBtn) {
        expandBtn.style.display = 'none';
      }
    }
  }


}

window.ChatModule = ChatModule;
