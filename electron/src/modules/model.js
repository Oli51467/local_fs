class ModelModule {
  constructor() {
    this.providers = this.buildProviderData();
    this.initialized = false;
  }

  buildProviderData() {
    return [
      {
        id: 'qwen',
        name: '阿里云通义',
        icon: './dist/assets/qwen.png',
        description: '通义系列覆盖开源与闭源模型，提供从轻量推理到企业级多模态的完整矩阵。',
        models: [
          {
            id: 'qwen-plus',
            name: 'Qwen-Plus',
            subtitle: '',
            description: '在中文任务与指令遵循方面表现突出，同时兼顾多语言与多模态。',
            tags: ['推理模型', '多语言', '高可靠性']
          }
        ]
      }
    ];
  }

  cacheElements() {
    this.modelPageEl = document.getElementById('model-page');
    this.cardContainerEl = document.getElementById('model-card-container');
    this.providerTitleEl = document.getElementById('model-provider-title');
  }

  init() {
    if (this.initialized) {
      return;
    }

    this.cacheElements();
    this.renderAllModels();

    this.initialized = true;
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

    const models = this.flattenModels();

    if (this.providerTitleEl) {
      this.providerTitleEl.textContent = '模型库';
    }

    if (!models.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'model-placeholder';
      placeholder.textContent = '暂未收录模型，敬请期待。';
      this.cardContainerEl.appendChild(placeholder);
      return;
    }

    const fragment = document.createDocumentFragment();

    models.forEach((model) => {
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

      if (Array.isArray(model.tags)) {
        model.tags.forEach((tag) => {
          const tagEl = document.createElement('span');
          tagEl.className = 'model-tag';
          tagEl.textContent = tag;
          tagsWrapper.appendChild(tagEl);
        });
      }

      card.appendChild(header);
      card.appendChild(description);
      card.appendChild(tagsWrapper);

      fragment.appendChild(card);
    });

    this.cardContainerEl.appendChild(fragment);
  }

  flattenModels() {
    return this.providers.flatMap((provider) => {
      if (!Array.isArray(provider.models)) {
        return [];
      }

      return provider.models.map((model) => ({
        ...model,
        providerId: provider.id,
        providerName: provider.name,
        providerIcon: provider.icon || null
      }));
    });
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
