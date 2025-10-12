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
        apiKeySetting: 'siliconflwApiKey',
        models: [
          {
            modelId: 'Qwen/Qwen3-8B',
            name: 'Qwen/Qwen3-8B',
            description: '硅基流动提供的 Qwen3-8B 通用模型，兼顾推理与创作表现。',
            tags: ['硅基流动', 'Qwen3', '8B'],
            apiModel: 'Qwen/Qwen3-8B',
            apiKeySetting: 'siliconflwApiKey'
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
    if (!this.modelInputEl) {
      return;
    }
    const source = this.getSourceById(sourceId);

    this.modelInputEl.value = '';
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
          <input id="model-add-model" data-role="model" type="text" />
        </div>
        <div class="model-add-modal__field">
          <label for="model-add-description">模型描述</label>
          <textarea id="model-add-description" data-role="model-description" rows="3"></textarea>
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
    this.modelInputEl = overlay.querySelector('[data-role="model"]');
    this.modelDescriptionEl = overlay.querySelector('[data-role="model-description"]');
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
    if (this.modelInputEl) {
      this.modelInputEl.value = '';
    }
    if (this.modelDescriptionEl) {
      this.modelDescriptionEl.value = '';
    }
    this.setModalLoading(false);
    this.addModalEl.classList.add('visible');
    if (this.modelInputEl) {
      this.modelInputEl.focus();
    }
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
    const modelName = this.modelInputEl?.value?.trim();
    const modelDescription = this.modelDescriptionEl?.value?.trim() || '';

    const source = this.getSourceById(sourceId);

    if (!source) {
      this.setModalStatus('请选择模型来源。', 'error');
      return;
    }

    if (!modelName) {
      this.setModalStatus('请输入模型名称。', 'error');
      return;
    }

    if (this.userModels.some((item) => item.sourceId === source.sourceId && item.modelId === modelName)) {
      this.setModalStatus('该模型已在列表中，无需重复添加。', 'warning');
      return;
    }

    const apiKeySetting = source.apiKeySetting || 'siliconflwApiKey';
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    const apiKey = settingsModule && typeof settingsModule.getApiKey === 'function'
      ? settingsModule.getApiKey(apiKeySetting)
      : '';

    if (!apiKey) {
      this.setModalStatus('请先在设置页面填写对应的 API Key。', 'error');
      return;
    }

    this.setModalLoading(true);
    this.setModalStatus('正在测试连接，请稍候...', 'info');

    try {
      await this.testSiliconflowConnection(apiKey, modelName);
      this.setModalStatus('测试通过，模型已添加。', 'success');
      this.appendModelCard({
        sourceId: source.sourceId,
        modelId: modelName,
        apiModel: modelName,
        apiKeySetting,
        name: modelName,
        providerName: source.name,
        providerIcon: source.icon || null,
        description: modelDescription,
        parameterSize: this.extractParameterSize(modelName)
      });

      if (this.modelInputEl) {
        this.modelInputEl.value = '';
      }
      if (this.modelDescriptionEl) {
        this.modelDescriptionEl.value = '';
      }

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
      if (data && data.id) {
        console.debug('SiliconFlow 测试响应已接收', {
          status: response.status,
          id: data.id,
          usage: data.usage || null
        });
      } else {
        console.debug('SiliconFlow 测试响应已接收');
      }
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
    if (this.modelInputEl) {
      this.modelInputEl.disabled = this.addModalLoading;
    }
    if (this.modelDescriptionEl) {
      this.modelDescriptionEl.disabled = this.addModalLoading;
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
    // 取消悬浮显示所有描述的功能，不设置 title 提示

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
      enriched.apiKeySetting = enriched.apiKeySetting || source.apiKeySetting || 'siliconflwApiKey';
      if (!enriched.apiModel) {
        const catalogModel = this.getModelById(enriched.sourceId, enriched.modelId);
        if (catalogModel && catalogModel.apiModel) {
          enriched.apiModel = catalogModel.apiModel;
        }
      }
    }
    enriched.apiKeySetting = enriched.apiKeySetting || 'siliconflwApiKey';
    enriched.description = typeof enriched.description === 'string' ? enriched.description : '';
    enriched.parameterSize = enriched.parameterSize || this.extractParameterSize(enriched.apiModel || enriched.name || enriched.modelId);
    enriched.tags = this.buildModelTags(enriched, source);
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

  buildModelTags(model, source) {
    const providerName = model.providerName || source?.name || '未知来源';
    const parameterSize = model.parameterSize || '未知';
    const displayName = model.name || model.apiModel || model.modelId || '未命名模型';
    return [providerName, parameterSize, displayName].filter((item) => typeof item === 'string' && item.trim().length > 0);
  }

  extractParameterSize(identifier) {
    if (!identifier || typeof identifier !== 'string') {
      return '未知';
    }
    const match = identifier.match(/(\d+(?:\.\d+)?)(?:\s*)([kKmMgGtTpP]?)[bB](?![a-zA-Z])/);
    if (match) {
      const value = match[1];
      const unit = match[2] ? match[2].toUpperCase() : '';
      return `${value}${unit}B`;
    }
    return '未知';
  }
}

window.ModelModule = ModelModule;
