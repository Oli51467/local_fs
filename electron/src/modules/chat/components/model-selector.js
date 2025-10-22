/**
 * ChatModelSelector
 * 聊天模型下拉选择组件，负责模型列表渲染、交互与选择状态同步。
 */
(function initChatModelSelector(global) {

  class ChatModelSelector {
    constructor(options = {}) {
      this.buttonEl = options.buttonEl || null;
      this.buttonTextEl = options.buttonTextEl || null;
      this.dropdownEl = options.dropdownEl || null;
      this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
      this.onToggle = typeof options.onToggle === 'function' ? options.onToggle : null;
      this.onClose = typeof options.onClose === 'function' ? options.onClose : null;

      this.models = [];
      this.selected = null;
      this.visible = false;
      this.bound = false;

      this.handleDocumentClick = (event) => {
        if (!this.visible) {
          return;
        }
        const target = event.target;
        if (this.buttonEl && this.buttonEl.contains(target)) {
          return;
        }
        if (this.dropdownEl && this.dropdownEl.contains(target)) {
          return;
        }
        this.hideDropdown();
      };

      this.handleDocumentKeydown = (event) => {
        if (event.key === 'Escape') {
          this.hideDropdown();
        }
      };

      this.bind();
    }

    bind() {
      if (this.bound) {
        return;
      }

      if (this.buttonEl) {
        this.buttonEl.addEventListener('click', (event) => {
          event.stopPropagation();
          if (this.buttonEl.disabled) {
            return;
          }
          if (this.visible) {
            this.hideDropdown();
          } else {
            this.showDropdown();
          }
          if (typeof this.onToggle === 'function') {
            try {
              this.onToggle(this.visible);
            } catch (error) {
              console.warn('ChatModelSelector onToggle 回调失败:', error);
            }
          }
        });
      }

      if (global.document) {
        global.document.addEventListener('click', this.handleDocumentClick);
        global.document.addEventListener('keydown', this.handleDocumentKeydown);
      }

      this.bound = true;
    }

    setElements({ buttonEl, buttonTextEl, dropdownEl }) {
      this.buttonEl = buttonEl || this.buttonEl;
      this.buttonTextEl = buttonTextEl || this.buttonTextEl;
      this.dropdownEl = dropdownEl || this.dropdownEl;
      this.bind();
      this.render();
    }

    updateModels(models = []) {
      this.models = Array.isArray(models) ? models.map((model) => ({ ...model })) : [];

      const previousKey = this.selected ? this.getModelKey(this.selected) : '';
      const currentExists = previousKey
        && this.models.some((model) => this.getModelKey(model) === previousKey);

      if (!currentExists) {
        this.selected = null;
      }

      if (!this.selected && this.models.length > 0) {
        this.selected = { ...this.models[0] };
      }

      this.render();
      this.refreshButtonState();
      this.emitChange();
    }

    getSelectedModel() {
      return this.selected ? { ...this.selected } : null;
    }

    setSelectedModel(model) {
      this.selected = model ? { ...model } : null;
      this.render();
      this.refreshButtonState();
      this.emitChange();
      this.hideDropdown();
    }

    render() {
      if (!this.dropdownEl) {
        return;
      }

      this.dropdownEl.innerHTML = '';

      if (!this.models.length) {
        const empty = global.document.createElement('div');
        empty.className = 'chat-model-dropdown-empty';
        empty.textContent = '尚未添加模型';
        this.dropdownEl.appendChild(empty);
        return;
      }

      const activeKey = this.selected ? this.getModelKey(this.selected) : '';

      this.models.forEach((model) => {
        const key = this.getModelKey(model);
        const option = global.document.createElement('button');
        option.type = 'button';
        option.className = 'chat-model-option';
        option.setAttribute('role', 'option');
        option.dataset.modelKey = key;
        if (key === activeKey) {
          option.classList.add('active');
        }

        const label = global.document.createElement('div');
        label.className = 'chat-model-option-label';

        const name = global.document.createElement('span');
        name.className = 'chat-model-option-name';
        name.textContent = model.name || '未命名模型';
        label.appendChild(name);

        const provider = global.document.createElement('span');
        provider.className = 'chat-model-option-provider';
        provider.textContent = ` - ${model.providerName || model.sourceId || '自定义'}`;
        label.appendChild(provider);

        const check = global.document.createElement('span');
        check.className = 'chat-model-option-check';
        check.textContent = '✓';

        option.appendChild(label);
        option.appendChild(check);

        option.addEventListener('click', () => {
          this.setSelectedModel(model);
        });

        this.dropdownEl.appendChild(option);
      });
    }

    refreshButtonState() {
      if (!this.buttonEl || !this.buttonTextEl) {
        return;
      }

      const hasModels = this.models.length > 0;
      this.buttonEl.disabled = !hasModels;

      if (!hasModels) {
        this.buttonEl.setAttribute('aria-expanded', 'false');
        this.buttonTextEl.textContent = '暂无可用模型';
        return;
      }

      const active = this.selected || this.models[0];
      if (active) {
        this.selected = { ...active };
        this.buttonTextEl.textContent = active.name || '未命名模型';
      } else {
        this.buttonTextEl.textContent = '请选择模型';
      }

      this.buttonEl.setAttribute('aria-expanded', this.visible ? 'true' : 'false');
    }

    showDropdown() {
      if (!this.dropdownEl || !this.models.length) {
        return;
      }
      this.render();
      this.dropdownEl.classList.add('visible');
      this.visible = true;
      if (this.buttonEl) {
        this.buttonEl.setAttribute('aria-expanded', 'true');
      }
    }

    hideDropdown() {
      if (!this.dropdownEl) {
        this.visible = false;
        return;
      }
      this.dropdownEl.classList.remove('visible');
      this.visible = false;
      if (this.buttonEl) {
        this.buttonEl.setAttribute('aria-expanded', 'false');
      }
      if (typeof this.onClose === 'function') {
        try {
          this.onClose();
        } catch (error) {
          console.warn('ChatModelSelector onClose 回调失败:', error);
        }
      }
    }

    getModelKey(model) {
      if (!model) {
        return '';
      }
      return `${model.sourceId || ''}::${model.modelId || ''}`;
    }

    emitChange() {
      if (typeof this.onChange !== 'function') {
        return;
      }
      try {
        this.onChange(this.getSelectedModel());
      } catch (error) {
        console.warn('ChatModelSelector onChange 回调失败:', error);
      }
    }

    destroy() {
      if (global.document) {
        global.document.removeEventListener('click', this.handleDocumentClick);
        global.document.removeEventListener('keydown', this.handleDocumentKeydown);
      }
      this.visible = false;
      this.bound = false;
    }
  }

  global.ChatModelSelector = ChatModelSelector;
})(typeof window !== 'undefined' ? window : globalThis);
