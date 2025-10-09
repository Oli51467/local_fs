class ModelModule {
  constructor(options = {}) {
    this.catalog = this.buildModelCatalog();
    this.userModels = [];
    this.initialized = false;
    this.addModalLoading = false;

    this.dependencies = {
      getSettingsModule: () => null
    };
    this.dependencies = { ...this.dependencies, ...options };
  }

  buildModelCatalog() {
    return [
      {
        sourceId: 'siliconflow',
        name: '硅基流动',
        icon: './dist/assets/qwen.png',
        models: [
          {
            modelId: 'Qwen/Qwen3-8B',
            name: 'Qwen/Qwen3-8B',
            description: '硅基流动提供的 Qwen3-8B 通用模型，兼顾推理与创作表现。',
            tags: ['硅基流动', 'Qwen3', '8B'],
            apiModel: 'Qwen/Qwen3-8B'
          }
        ]
      }
    ];
  }

  cacheElements() {
    this.modelPageEl = document.getElementById('model-page');
    this.cardContainerEl = document.getElementById('model-card-container');
    this.providerTitleEl = document.getElementById('model-provider-title');
    this.addButtonEl = document.getElementById('model-add-btn');
  }

  init() {
    if (this.initialized) {
      return;
    }

    this.cacheElements();
    this.setupAddModal();
    this.restorePersistedModels();
    this.bindEvents();
    this.renderAllModels();

    this.initialized = true;
  }

  bindEvents() {
    if (this.addButtonEl) {
      this.addButtonEl.addEventListener('click', () => {
        this.showAddModal();
      });
    }
  }

  buildSourceSelectOptions() {
    if (!this.sourceSelectEl) {
      return;
    }
    this.sourceSelectEl.innerHTML = '';
    this.catalog.forEach((source) => {
      const option = document.createElement('option');
      option.value = source.sourceId;
      option.textContent = source.name;
      this.sourceSelectEl.appendChild(option);
    });
  }

  populateModelOptionsForSource(sourceId) {
    if (!this.modelSelectEl) {
      return;
    }

    const source = this.getSourceById(sourceId);
    this.modelSelectEl.innerHTML = '';

    if (!source || !Array.isArray(source.models) || source.models.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '暂无模型';
      this.modelSelectEl.appendChild(option);
      this.modelSelectEl.disabled = true;
      return;
    }

    this.modelSelectEl.disabled = false;
    source.models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.modelId;
      option.textContent = model.name;
      this.modelSelectEl.appendChild(option);
    });
  }

  setupAddModal() {
    if (this.addModalEl) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'model-add-modal';
    overlay.innerHTML = `
      <div class="model-add-modal__content">
        <h3 class="model-add-modal__title">添加模型</h3>
        <div class="model-add-modal__field">
          <label for="model-add-source">来源</label>
          <select id="model-add-source" data-role="source"></select>
        </div>
        <div class="model-add-modal__field">
          <label for="model-add-model">模型名称</label>
          <select id="model-add-model" data-role="model"></select>
        </div>
        <div class="model-add-modal__status" data-role="status"></div>
        <div class="model-add-modal__actions">
          <button type="button" class="model-add-modal__btn ghost" data-action="cancel">取消</button>
          <button type="button" class="model-add-modal__btn primary" data-action="confirm">添加</button>
        </div>
      </div>
    `;

    this.addModalEl = overlay;
    this.sourceSelectEl = overlay.querySelector('[data-role="source"]');
    this.modelSelectEl = overlay.querySelector('[data-role="model"]');
    this.modalStatusEl = overlay.querySelector('[data-role="status"]');
    this.modalConfirmBtn = overlay.querySelector('[data-action="confirm"]');
    this.modalCancelBtn = overlay.querySelector('[data-action="cancel"]');

    this.buildSourceSelectOptions();
    if (this.catalog.length > 0) {
      this.populateModelOptionsForSource(this.catalog[0].sourceId);
    }

    if (this.sourceSelectEl) {
      this.sourceSelectEl.addEventListener('change', () => {
        this.populateModelOptionsForSource(this.sourceSelectEl.value);
        this.clearModalStatus();
      });
    }

    if (this.modalConfirmBtn) {
      this.modalConfirmBtn.addEventListener('click', () => {
        this.handleAddModel();
      });
    }

    if (this.modalCancelBtn) {
      this.modalCancelBtn.addEventListener('click', () => {
        if (!this.addModalLoading) {
          this.hideAddModal();
        }
      });
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && !this.addModalLoading) {
        this.hideAddModal();
      }
    });

    this.handleModalKeydown = (event) => {
      if (event.key === 'Escape' && this.addModalEl?.classList.contains('visible') && !this.addModalLoading) {
        this.hideAddModal();
      }
    };

    document.body.appendChild(overlay);
  }

  showAddModal() {
    if (!this.addModalEl) {
      return;
    }
    this.clearModalStatus();
    this.setModalLoading(false);
    this.addModalEl.classList.add('visible');
    document.addEventListener('keydown', this.handleModalKeydown);
  }

  hideAddModal() {
    if (!this.addModalEl) {
      return;
    }
    this.addModalEl.classList.remove('visible');
    this.setModalLoading(false);
    this.clearModalStatus();
    document.removeEventListener('keydown', this.handleModalKeydown);
  }

  async handleAddModel() {
    if (this.addModalLoading) {
      return;
    }

    const sourceId = this.sourceSelectEl?.value;
    const modelId = this.modelSelectEl?.value;

    const source = this.getSourceById(sourceId);
    const model = this.getModelById(sourceId, modelId);

    if (!source) {
      this.setModalStatus('请选择模型来源。', 'error');
      return;
    }

    if (!model) {
      this.setModalStatus('请选择模型名称。', 'error');
      return;
    }

    if (this.userModels.some((item) => item.sourceId === source.sourceId && item.modelId === model.modelId)) {
      this.setModalStatus('该模型已在列表中，无需重复添加。', 'warning');
      return;
    }

    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    const apiKey = settingsModule && typeof settingsModule.getApiKey === 'function'
      ? settingsModule.getApiKey('siliconflwApiKey')
      : '';

    if (!apiKey) {
      this.setModalStatus('请先在设置页面填写 SiliconFlow API Key。', 'error');
      return;
    }

    this.setModalLoading(true);
    this.setModalStatus('正在测试连接，请稍候...', 'info');

    try {
      await this.testSiliconflowConnection(apiKey, model.apiModel);
      this.setModalStatus('测试通过，模型已添加。', 'success');
      this.appendModelCard({
        sourceId: source.sourceId,
        modelId: model.modelId,
        apiModel: model.apiModel,
        name: model.name,
        providerName: source.name,
        providerIcon: model.icon || source.icon || null,
        description: model.description,
        tags: model.tags || []
      });

      setTimeout(() => {
        this.hideAddModal();
      }, 600);
    } catch (error) {
      const message = error?.message || '测试失败，请稍后重试。';
      this.setModalStatus(`测试失败：${message}`, 'error');
      this.setModalLoading(false);
    }
  }

  async testSiliconflowConnection(apiKey, apiModel) {
    const url = 'https://api.siliconflow.cn/v1/chat/completions';
    const payload = {
      model: apiModel,
      messages: [
        {
          role: 'user',
          content: 'What opportunities and challenges will the Chinese large model industry face in 2025?'
        }
      ],
      stream: false,
      max_tokens: 4096,
      enable_thinking: false,
      thinking_budget: 4096,
      min_p: 0.05,
      stop: null,
      temperature: 0.7,
      top_p: 0.7,
      top_k: 50,
      frequency_penalty: 0.5,
      n: 1,
      response_format: { type: 'text' },
      tools: [
        {
          type: 'function',
          function: {
            description: '<string>',
            name: '<string>',
            parameters: {},
            strict: false
          }
        }
      ]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let data = null;
    try {
      data = await response.json();
      console.log('SiliconFlow test response:', data);
    } catch (parseError) {
      console.warn('解析 SiliconFlow 响应失败:', parseError);
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `调用失败，状态码 ${response.status}`;
      throw new Error(errorMessage);
    }
  }

  appendModelCard(model) {
    const prepared = this.enrichModel(model);
    this.userModels.push(prepared);
    this.renderAllModels();
    this.persistModels();
  }

  setModalLoading(isLoading) {
    this.addModalLoading = Boolean(isLoading);
    if (this.modalConfirmBtn) {
      this.modalConfirmBtn.disabled = this.addModalLoading;
      this.modalConfirmBtn.textContent = this.addModalLoading ? '测试中…' : '添加';
    }
    if (this.modalCancelBtn) {
      this.modalCancelBtn.disabled = this.addModalLoading;
    }
    if (this.sourceSelectEl) {
      this.sourceSelectEl.disabled = this.addModalLoading;
    }
    if (this.modelSelectEl) {
      this.modelSelectEl.disabled = this.addModalLoading || this.modelSelectEl.options.length === 0;
    }
  }

  setModalStatus(message, type = 'info') {
    if (!this.modalStatusEl) {
      return;
    }
    this.modalStatusEl.textContent = message || '';
    this.modalStatusEl.className = `model-add-modal__status ${type}`;
  }

  clearModalStatus() {
    if (this.modalStatusEl) {
      this.modalStatusEl.textContent = '';
      this.modalStatusEl.className = 'model-add-modal__status';
    }
  }

  showModelPage() {
    if (!this.initialized) {
      this.init();
    }

    this.hideOtherAreas();
    this.renderAllModels();

    if (this.modelPageEl) {
      this.modelPageEl.style.display = 'flex';
    }
  }

  hideModelPage() {
    if (this.modelPageEl) {
      this.modelPageEl.style.display = 'none';
    }
  }

  hideOtherAreas() {
    const hideEl = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
      }
    };

    hideEl('file-content');
    hideEl('settings-page');
    hideEl('database-page');
    hideEl('chat-page');

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }

    const fileTree = document.getElementById('file-tree-container');
    if (fileTree) {
      fileTree.style.display = 'none';
    }

    const searchArea = document.getElementById('search-area');
    if (searchArea) {
      searchArea.style.display = 'none';
    }
  }

  renderAllModels() {
    if (!this.cardContainerEl) {
      return;
    }

    this.cardContainerEl.innerHTML = '';

    if (this.providerTitleEl) {
      this.providerTitleEl.textContent = '模型库';
    }

    if (!this.userModels.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'model-placeholder';
      placeholder.textContent = '尚未添加模型。点击右上角的“添加”按钮开始。';
      this.cardContainerEl.appendChild(placeholder);
      this.notifyModelRegistryChanged();
      return;
    }

    const fragment = document.createDocumentFragment();

    this.userModels.forEach((model) => {
      const card = this.buildModelCard(model);
      fragment.appendChild(card);
    });

    this.cardContainerEl.appendChild(fragment);
    this.notifyModelRegistryChanged();
  }

  buildModelCard(model) {
    const card = document.createElement('article');
    card.className = 'model-card';

    const header = document.createElement('div');
    header.className = 'model-card-header';

    const avatar = document.createElement('div');
    avatar.className = 'model-card-avatar';
    if (model.providerIcon) {
      const img = document.createElement('img');
      img.src = model.providerIcon;
      img.alt = `${model.providerName} 图标`;
      avatar.appendChild(img);
    } else {
      avatar.textContent = this.getInitials(model.name);
    }

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'model-card-titles';

    const title = document.createElement('h3');
    title.className = 'model-card-title';
    title.textContent = model.name;

    const providerLabel = document.createElement('span');
    providerLabel.className = 'model-card-provider';
    providerLabel.textContent = model.providerName;

    titleWrapper.appendChild(title);
    titleWrapper.appendChild(providerLabel);

    header.appendChild(avatar);
    header.appendChild(titleWrapper);

    const description = document.createElement('p');
    description.className = 'model-card-description';
    description.textContent = model.description || '暂无简介。';

    const tagsWrapper = document.createElement('div');
    tagsWrapper.className = 'model-card-tags';

    if (Array.isArray(model.tags) && model.tags.length > 0) {
      model.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'model-tag';
        tagEl.textContent = tag;
        tagsWrapper.appendChild(tagEl);
      });
    }

    card.appendChild(header);
    card.appendChild(description);
    if (tagsWrapper.children.length > 0) {
      card.appendChild(tagsWrapper);
    }

    card.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.confirmRemoveModel(model);
    });

    return card;
  }

  confirmRemoveModel(model) {
    const confirmRemoval = () => {
      this.removeModel(model);
    };

    if (typeof window.showModal === 'function') {
      window.showModal({
        type: 'warning',
        title: '删除模型',
        message: `确定要移除 ${model.name} 吗？`,
        confirmText: '删除',
        cancelText: '暂不删除',
        showCancel: true,
        onConfirm: confirmRemoval
      });
      return;
    }

    if (window.confirm(`确定要移除 ${model.name} 吗？`)) {
      confirmRemoval();
    }
  }

  removeModel(model) {
    this.userModels = this.userModels.filter((item) => {
      return !(item.sourceId === model.sourceId && item.modelId === model.modelId);
    });
    this.renderAllModels();
    this.persistModels();
  }

  notifyModelRegistryChanged() {
    const snapshot = this.getModels();
    document.dispatchEvent(new CustomEvent('modelRegistryChanged', {
      detail: { models: snapshot }
    }));
  }

  getModels() {
    return this.userModels.map((model) => this.enrichModel(model));
  }

  restorePersistedModels() {
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    if (!settingsModule || typeof settingsModule.getCustomModels !== 'function') {
      return;
    }
    try {
      const stored = settingsModule.getCustomModels();
      if (Array.isArray(stored) && stored.length) {
        this.userModels = stored.map((model) => this.enrichModel(model));
      }
    } catch (error) {
      console.warn('恢复用户模型失败:', error);
    }
  }

  persistModels() {
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    if (!settingsModule || typeof settingsModule.updateCustomModels !== 'function') {
      return;
    }
    settingsModule.updateCustomModels(this.getModels()).catch((error) => {
      console.error('保存用户模型失败:', error);
    });
  }

  getSourceById(sourceId) {
    return this.catalog.find((source) => source.sourceId === sourceId) || null;
  }

  getModelById(sourceId, modelId) {
    const source = this.getSourceById(sourceId);
    if (!source || !Array.isArray(source.models)) {
      return null;
    }
    return source.models.find((model) => model.modelId === modelId) || null;
  }

  enrichModel(model = {}) {
    const enriched = { ...model };
    const source = enriched.sourceId ? this.getSourceById(enriched.sourceId) : null;
    if (source) {
      enriched.providerName = enriched.providerName || source.name;
      enriched.providerIcon = enriched.providerIcon || source.icon || null;
      if (!enriched.apiModel) {
        const catalogModel = this.getModelById(enriched.sourceId, enriched.modelId);
        if (catalogModel && catalogModel.apiModel) {
          enriched.apiModel = catalogModel.apiModel;
        }
      }
    }
    return enriched;
  }

  getInitials(text) {
    if (!text) {
      return '';
    }
    const sanitized = text.trim();
    if (!sanitized) {
      return '';
    }
    const parts = sanitized.split(/\s+/);
    if (parts.length === 1) {
      return sanitized.substring(0, 2).toUpperCase();
    }
    const initials = parts.slice(0, 2).map((part) => part.charAt(0)).join('');
    return initials.toUpperCase();
  }
}

window.ModelModule = ModelModule;
