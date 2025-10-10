const WINDOWS_1252_REVERSE = new Map([
  [0x20AC, 0x80],
  [0x201A, 0x82],
  [0x0192, 0x83],
  [0x201E, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02C6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8A],
  [0x2039, 0x8B],
  [0x0152, 0x8C],
  [0x017D, 0x8E],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201C, 0x93],
  [0x201D, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02DC, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9A],
  [0x203A, 0x9B],
  [0x0153, 0x9C],
  [0x017E, 0x9E],
  [0x0178, 0x9F]
]);

class ChatModule {
  constructor() {
    this.baseApiUrl = 'http://localhost:8000/api/chat';

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
    this.handleDocumentClick = (event) => this.handleGlobalClick(event);
    this.handleDocumentKeydown = (event) => this.handleGlobalKeydown(event);
    this.streamingState = null;
    this.markdownViewer = null;
    this.markdownStyleRefs = new Set();
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.bindEvents();
    this.updateModelSelect(this.getInitialModelList());
    this.initialized = true;
  }

  bindEvents() {
    if (this.chatSendBtn) {
      this.chatSendBtn.addEventListener('click', () => this.handleSend());
    }

    if (this.chatInputEl) {
      this.chatInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          this.handleSend();
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

    if (this.chatModelButtonEl) {
      this.chatModelButtonEl.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleModelDropdown();
      });
    }

    if (this.chatModelDropdownEl) {
      this.chatModelDropdownEl.addEventListener('click', (event) => {
        event.stopPropagation();
      });
    }

    document.addEventListener('click', this.handleDocumentClick);
    document.addEventListener('keydown', this.handleDocumentKeydown);
    document.addEventListener('modelRegistryChanged', this.modelRegistryHandler);
  }

  getInitialModelList() {
    if (window.modelModule && typeof window.modelModule.getModels === 'function') {
      try {
        const models = window.modelModule.getModels();
        return Array.isArray(models) ? models : [];
      } catch (error) {
        console.warn('获取初始模型列表失败:', error);
      }
    }
    return [];
  }

  handleModelRegistryChanged(event) {
    const models = event?.detail?.models || [];
    this.updateModelSelect(models);
  }

  updateModelSelect(models) {
    if (!this.chatModelButtonEl || !this.chatModelDropdownEl || !this.chatModelButtonTextEl) {
      return;
    }

    this.closeModelDropdown();

    this.availableModels = Array.isArray(models) ? models.map((model) => ({ ...model })) : [];
    const previousKey = this.selectedModel ? this.getModelKey(this.selectedModel) : '';
    let effectiveKey = previousKey;

    if (effectiveKey && !this.availableModels.some((model) => this.getModelKey(model) === effectiveKey)) {
      this.selectedModel = null;
      effectiveKey = '';
    }

    if (!effectiveKey && this.availableModels.length) {
      const firstModel = this.availableModels[0];
      this.selectedModel = { ...firstModel };
      effectiveKey = this.getModelKey(firstModel);
    }

    this.renderModelDropdown(effectiveKey);
    this.updateModelButtonState(effectiveKey);
  }

  renderModelDropdown(activeKey) {
    if (!this.chatModelDropdownEl) {
      return;
    }

    this.chatModelDropdownEl.innerHTML = '';

    if (!this.availableModels.length) {
      const empty = document.createElement('div');
      empty.className = 'chat-model-dropdown-empty';
      empty.textContent = '尚未添加模型';
      this.chatModelDropdownEl.appendChild(empty);
      return;
    }

    this.availableModels.forEach((model) => {
      const key = this.getModelKey(model);
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'chat-model-option';
      option.setAttribute('role', 'option');
      option.dataset.modelKey = key;
      if (key === activeKey) {
        option.classList.add('active');
      }

      const label = document.createElement('div');
      label.className = 'chat-model-option-label';

      const name = document.createElement('span');
      name.className = 'chat-model-option-name';
      name.textContent = model.name || '未命名模型';
      label.appendChild(name);

      const provider = document.createElement('span');
      provider.className = 'chat-model-option-provider';
      const providerName = model.providerName || model.sourceId || '自定义';
      provider.textContent = ` - ${providerName}`;
      label.appendChild(provider);

      const check = document.createElement('span');
      check.className = 'chat-model-option-check';
      check.textContent = '✓';

      option.appendChild(label);
      option.appendChild(check);

      option.addEventListener('click', () => {
        this.selectModel(model);
      });

      this.chatModelDropdownEl.appendChild(option);
    });
  }

  updateModelButtonState(activeKey) {
    if (!this.chatModelButtonEl || !this.chatModelButtonTextEl) {
      return;
    }

    const hasModels = this.availableModels.length > 0;
    this.chatModelButtonEl.disabled = !hasModels;

    if (!hasModels) {
      this.selectedModel = null;
      this.chatModelButtonTextEl.textContent = '暂无可用模型';
      this.chatModelButtonEl.setAttribute('aria-expanded', 'false');
      this.closeModelDropdown();
      return;
    }

    if (!activeKey && this.availableModels.length) {
      const firstModel = this.availableModels[0];
      this.selectedModel = { ...firstModel };
      activeKey = this.getModelKey(firstModel);
      this.renderModelDropdown(activeKey);
    }

    const active = this.selectedModel || this.availableModels.find((model) => this.getModelKey(model) === activeKey);
    if (active) {
      this.selectedModel = { ...active };
      this.chatModelButtonTextEl.textContent = active.name || '未命名模型';
    } else {
      this.selectedModel = null;
      this.chatModelButtonTextEl.textContent = '请选择模型';
    }

    this.chatModelButtonEl.setAttribute('aria-expanded', this.modelDropdownVisible ? 'true' : 'false');
  }

  selectModel(model) {
    this.selectedModel = model ? { ...model } : null;
    const key = this.selectedModel ? this.getModelKey(this.selectedModel) : '';
    this.updateModelButtonState(key);
    this.renderModelDropdown(key);
    this.closeModelDropdown();
  }

  getModelKey(model) {
    if (!model) {
      return '';
    }
    return `${model.sourceId || ''}::${model.modelId || ''}`;
  }

  toggleModelDropdown() {
    if (this.chatModelButtonEl && this.chatModelButtonEl.disabled) {
      return;
    }

    if (this.modelDropdownVisible) {
      this.closeModelDropdown();
    } else {
      this.openModelDropdown();
    }
  }

  openModelDropdown() {
    if (!this.chatModelDropdownEl || !this.availableModels.length) {
      return;
    }
    const activeKey = this.selectedModel ? this.getModelKey(this.selectedModel) : '';
    this.renderModelDropdown(activeKey);
    this.modelDropdownVisible = true;
    this.chatModelDropdownEl.classList.add('visible');
    if (this.chatModelButtonEl) {
      this.chatModelButtonEl.setAttribute('aria-expanded', 'true');
    }
  }

  closeModelDropdown() {
    if (!this.chatModelDropdownEl) {
      return;
    }
    this.modelDropdownVisible = false;
    this.chatModelDropdownEl.classList.remove('visible');
    if (this.chatModelButtonEl) {
      this.chatModelButtonEl.setAttribute('aria-expanded', 'false');
    }
  }

  handleGlobalClick(event) {
    if (!this.modelDropdownVisible) {
      return;
    }
    const target = event.target;
    if (this.chatModelButtonEl && this.chatModelButtonEl.contains(target)) {
      return;
    }
    if (this.chatModelDropdownEl && this.chatModelDropdownEl.contains(target)) {
      return;
    }
    this.closeModelDropdown();
  }

  handleGlobalKeydown(event) {
    if (event.key === 'Escape' && this.modelDropdownVisible) {
      this.closeModelDropdown();
    }
  }



  async enterChatMode() {
    await this.init();
    await this.refreshConversations();
    if (this.conversations.length && this.currentConversationId === null) {
      this.openConversation(this.conversations[0].id);
    } else if (this.currentConversationId === null) {
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

    // 添加固定的"新对话"行
    const newChatItem = document.createElement('div');
    newChatItem.className = 'chat-history-item new-chat-item';
    newChatItem.innerHTML = `
      <div class="new-chat-icon">${window.icons?.edit || ''}</div>
      <div class="chat-history-title">新对话</div>
    `;
    newChatItem.addEventListener('click', () => {
      this.startNewConversation();
    });
    this.historyListEl.appendChild(newChatItem);

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
      this.renderMessages();
      const conversationSummary = data.conversation ? { ...data.conversation } : null;
      if (conversationSummary) {
        if (typeof conversationSummary.title === 'string' && conversationSummary.title) {
          conversationSummary.title = this.normalizeModelText(conversationSummary.title) || conversationSummary.title;
        }
        if (typeof conversationSummary.last_message === 'string' && conversationSummary.last_message) {
          conversationSummary.last_message = this.normalizeModelText(conversationSummary.last_message);
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
        ? `最近更新：${this.formatTimestamp(conversation.updated_time)}`
        : '';
    }
  }

  renderMessages() {
    if (!this.chatMessagesEl) {
      return;
    }

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
      } else {
        avatar.classList.add('is-assistant');
      }
      header.appendChild(avatar);

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';

      const contentEl = document.createElement('div');
      contentEl.className = 'chat-bubble-content';

      if (isWaitingMessage) {
        this.renderWaitingIndicator(contentEl);
      } else {
        const content = rawContent;
        this.setBubbleContent(contentEl, content, message.role);
      }

      bubble.appendChild(contentEl);

      header.appendChild(bubble);
      wrapper.appendChild(header);
      this.chatMessagesEl.appendChild(wrapper);

      this.applyWaitingState(wrapper, avatar, bubble, isWaitingMessage, message.role);
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

  renderWaitingIndicator(target) {
    if (!target) {
      return;
    }
    target.innerHTML = '';
    const indicator = document.createElement('div');
    indicator.className = 'chat-waiting-indicator';

    const spinner = document.createElement('div');
    spinner.className = 'chat-waiting-spinner';

    const text = document.createElement('span');
    text.className = 'chat-waiting-text';
    text.textContent = '正在思考中';

    indicator.appendChild(spinner);
    indicator.appendChild(text);
    target.appendChild(indicator);
  }

  applyWaitingState(wrapper, avatar, bubble, isWaiting, role = 'assistant') {
    if (wrapper) {
      wrapper.classList.toggle('is-waiting', Boolean(isWaiting));
    }
    if (bubble) {
      bubble.classList.toggle('is-waiting', Boolean(isWaiting));
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
      this.renderWaitingIndicator(state.content);
      this.applyWaitingState(state.wrapper, state.avatar, state.bubble, true, role);
      return;
    }
    this.setBubbleContent(state.content, content, role);
    this.applyWaitingState(state.wrapper, state.avatar, state.bubble, false, role);
  }

  normalizeModelText(text) {
    if (typeof text !== 'string') {
      return '';
    }
    if (!text) {
      return '';
    }
    const normalized = text.replace(/\r\n/g, '\n');
    const containsMojibake = /[\u0080-\u00FF]/.test(normalized) && !/[\u4e00-\u9fff]/.test(normalized);
    if (!containsMojibake) {
      return normalized;
    }
    try {
      const byteValues = [];
      for (const char of normalized) {
        const codePoint = char.codePointAt(0);
        if (codePoint === undefined) {
          continue;
        }
        if (codePoint <= 0xff) {
          byteValues.push(codePoint);
          continue;
        }
        const mapped = WINDOWS_1252_REVERSE.get(codePoint);
        if (mapped !== undefined) {
          byteValues.push(mapped);
          continue;
        }
        return normalized;
      }
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(byteValues));
      if (!decoded || /[\uFFFD]/.test(decoded)) {
        return normalized;
      }
      return decoded.replace(/\r\n/g, '\n');
    } catch (error) {
      console.debug('normalizeModelText fallback triggered:', error);
      if (typeof decodeURIComponent === 'function' && typeof escape === 'function') {
        try {
          return decodeURIComponent(escape(normalized));
        } catch (decodeError) {
          console.debug('decodeURIComponent fallback failed:', decodeError);
        }
      }
      return normalized;
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
        normalized.content = this.normalizeModelText(normalized.content);
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
        normalized.title = this.normalizeModelText(normalized.title) || normalized.title;
      }
      if (typeof normalized.last_message === 'string' && normalized.last_message) {
        normalized.last_message = this.normalizeModelText(normalized.last_message);
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
    if (window.hljs && typeof window.hljs.highlightElement === 'function') {
      root.querySelectorAll('pre code').forEach((block) => {
        try {
          window.hljs.highlightElement(block);
        } catch (error) {
          console.debug('代码高亮失败:', error);
        }
      });
    }
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
      const rendered = this.renderAssistantMarkdownElement(text);
      if (rendered) {
        target.innerHTML = '';
        target.appendChild(rendered);
        return;
      }
    }

    target.textContent = text;
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
          const delta = this.normalizeModelText(rawDelta) || rawDelta;
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
      const delta = this.normalizeModelText(rawDelta) || rawDelta;
      this.streamingState.buffer += delta;
      if (this.streamingState.message) {
        this.streamingState.message.content = this.streamingState.buffer;
      }
      this.updateStreamingBubble();
      return null;
    }

    if (event === 'done') {
      if (this.streamingState) {
        const rawContent = typeof data.content === 'string'
          ? data.content
          : this.streamingState.buffer;
        const finalContent = this.normalizeModelText(rawContent || '') || rawContent || '';
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
      const errorMessage = this.normalizeModelText(rawMessage) || rawMessage;
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

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
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
          await reader.cancel();
          return { hadError };
        }
        if (result === 'done') {
          return { hadError };
        }
        // 继续查找剩余缓冲中的完整事件
        idxLF = buffer.indexOf('\n\n');
        idxCRLF = buffer.indexOf('\r\n\r\n');
      }
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
      }
    }

    return { hadError };
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
    const apiKeySetting = this.selectedModel.apiKeySetting || 'siliconflwApiKey';
    const apiKey = settingsModule && typeof settingsModule.getApiKey === 'function'
      ? settingsModule.getApiKey(apiKeySetting)
      : '';

    if (!apiKey) {
      this.setStatus('请先在设置页面填写模型所需的 API Key。', 'warning');
      return;
    }

    if (this.pendingRequest) {
      return;
    }

    this.closeModelDropdown();

    const payload = {
      question,
      conversation_id: this.currentConversationId,
      top_k: 5,
      stream: true,
      model: {
        source_id: this.selectedModel.sourceId,
        model_id: this.selectedModel.modelId,
        api_model: this.selectedModel.apiModel,
        provider_name: this.selectedModel.providerName || '',
        api_key: apiKey
      }
    };

    this.pendingRequest = true;
    this.chatSendBtn.disabled = true;
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

    // 先设置流式状态，再渲染消息，以便等待样式正确显示
    this.streamingState = {
      message: streamingMessage,
      messageId: streamingMessage.id,
      wrapper: null,
      bubble: null,
      content: null,
      avatar: null,
      buffer: '',
      metadata: null
    };

    this.renderMessages();

    // 渲染后再绑定元素引用并刷新等待气泡
    const elements = this.findMessageElements(streamingMessage.id);
    this.streamingState.wrapper = elements.wrapper;
    this.streamingState.bubble = elements.bubble;
    this.streamingState.content = elements.content;
    this.streamingState.avatar = elements.avatar;
    this.updateStreamingBubble();

    this.chatInputEl.value = '';
    this.autoResizeTextarea();

    try {
      const response = await fetch(`${this.baseApiUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `发送失败 (${response.status})`);
      }

      const { hadError } = await this.processStreamResponse(response);

    if (hadError) {
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
      try {
        await this.refreshConversations();
        if (this.currentConversationId !== null && this.currentConversationId !== undefined) {
          await this.openConversation(this.currentConversationId);
        }
      } catch (refreshError) {
        console.warn('刷新会话失败:', refreshError);
      }
    } finally {
      this.chatSendBtn.disabled = false;
      if (this.chatInputEl) {
        this.chatInputEl.disabled = false;
        this.chatInputEl.focus();
      }
      this.pendingRequest = null;
      // 不显示“回答已完成”状态提示，保持底部状态为空
      if (this.chatStatusTextEl) {
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

  formatTimestamp(value) {
    if (!value) {
      return '';
    }
    try {
      const date = new Date(value);
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return '';
    }
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
