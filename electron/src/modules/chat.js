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

    this.currentConversationId = null;
    this.conversations = [];
    this.messages = [];
    this.initialized = false;
    this.historyVisible = true;
    this.isHistoryCollapsed = false;
    this.pendingRequest = null;
    this.chatInputBaseHeight = null;
    this.chatInputMaxHeight = null;
  }

  async init() {
    if (this.initialized) {
      return;
    }

    this.bindEvents();
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
    }
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
    if (!this.chatStatusTextEl) {
      return;
    }
    this.chatStatusTextEl.textContent = message || '';
    this.chatStatusTextEl.dataset.statusType = type;
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
      this.conversations = await response.json();
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

      const titleEl = document.createElement('div');
      titleEl.className = 'chat-history-title';
      titleEl.textContent = conversation.title || '未命名对话';

      const metaEl = document.createElement('div');
      metaEl.className = 'chat-history-meta';
      const count = typeof conversation.message_count === 'number' ? conversation.message_count : 0;
      metaEl.innerHTML = `<span>${count} 条</span>`;

      item.appendChild(titleEl);
      item.appendChild(metaEl);
      item.addEventListener('click', () => {
        this.openConversation(conversation.id);
      });

      this.historyListEl.appendChild(item);
    });
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
      this.messages = data.messages || [];
      this.renderMessages();
      this.updateConversationHeader(data.conversation);
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

    this.messages.forEach((message) => {
      const wrapper = document.createElement('div');
      wrapper.className = `chat-message ${message.role}`;

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

      // 直接显示AI回复内容，不使用内嵌卡片
      bubble.textContent = message.content || '';

      header.appendChild(bubble);
      wrapper.appendChild(header);
      this.chatMessagesEl.appendChild(wrapper);
    });
  }

  async handleSend() {
    if (!this.chatInputEl || !this.chatSendBtn) {
      return;
    }

    const text = this.chatInputEl.value.trim();
    if (!text) {
      this.setStatus('请输入问题', 'warning');
      return;
    }

    if (this.pendingRequest) {
      return;
    }

    this.setStatus('正在发送...', 'info');
    this.chatSendBtn.disabled = true;

    const payload = {
      question: text,
      conversation_id: this.currentConversationId,
      top_k: 5
    };

    try {
      this.pendingRequest = fetch(this.baseApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const response = await this.pendingRequest;
      if (!response.ok) {
        throw new Error(`发送失败 (${response.status})`);
      }

      const data = await response.json();
      this.currentConversationId = data.conversation_id;
      this.messages = data.messages || [];
      this.renderMessages();
      this.setStatus('消息已发送', 'success');
      await this.refreshConversations();
      this.highlightActiveConversation();
      if (this.chatInputEl) {
        this.chatInputEl.value = '';
        this.autoResizeTextarea();
      }
      if (this.chatMessagesContainer) {
        this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;
      }
      const summary = this.conversations.find((item) => item.id === this.currentConversationId);
      if (summary) {
        this.updateConversationHeader(summary);
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      this.setStatus('发送失败，请稍后重试。', 'error');
    } finally {
      this.chatSendBtn.disabled = false;
      this.pendingRequest = null;
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
