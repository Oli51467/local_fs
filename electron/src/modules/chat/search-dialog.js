/**
 * ChatSearchDialog
 * 负责管理聊天中的搜索弹窗，封装 DOM 创建、事件绑定与结果渲染。
 */
(function initChatSearchDialog(global) {
  class ChatSearchDialog {
    constructor(options = {}) {
      this.icons = options.icons || global.icons || {};
      this.dialogId = options.dialogId || 'chat-search-dialog';
      this.placeholderTemplate = options.placeholderTemplate
        || ((keyword) => `搜索功能尚未实现，关键词：“${keyword}”`);
      this.emptyMessage = options.emptyMessage || '暂无搜索结果';
      this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
      this.onClose = typeof options.onClose === 'function' ? options.onClose : null;

      this.dialogEl = null;
      this.inputEl = null;
      this.closeBtnEl = null;
      this.resultsEl = null;
      this.bound = false;
    }

    ensureDialog() {
      if (this.dialogEl) {
        return;
      }
      if (!global.document || !global.document.body) {
        console.warn('文档未就绪，无法初始化聊天搜索弹窗。');
        return;
      }

      const existing = global.document.getElementById(this.dialogId);
      if (existing) {
        this.attachDialog(existing);
        return;
      }

      const dialog = global.document.createElement('div');
      dialog.id = this.dialogId;
      dialog.className = 'chat-search-dialog';
      dialog.innerHTML = `
        <div class="chat-search-dialog-backdrop"></div>
        <div class="chat-search-dialog-content" role="dialog" aria-modal="true">
          <header class="chat-search-dialog-header">
            <div class="chat-search-input-wrapper">
              <input type="text" class="chat-search-input" placeholder="搜索聊天" />
            </div>
            <button type="button" class="chat-search-close" aria-label="关闭搜索">
              ${this.icons.close || '&times;'}
            </button>
          </header>
          <div class="chat-search-dialog-body">
            <div class="chat-search-results" data-state="empty">
              <div class="chat-search-result-empty">${this.emptyMessage}</div>
            </div>
          </div>
        </div>
      `;

      global.document.body.appendChild(dialog);
      this.attachDialog(dialog);
    }

    attachDialog(element) {
      this.dialogEl = element;
      this.inputEl = element.querySelector('.chat-search-input');
      this.closeBtnEl = element.querySelector('.chat-search-close');
      this.resultsEl = element.querySelector('.chat-search-results');

      if (this.inputEl && !this.inputEl.placeholder) {
        this.inputEl.placeholder = '搜索聊天';
      }

      this.bindEvents();
      this.resetResults();
    }

    bindEvents() {
      if (!this.dialogEl || this.bound) {
        return;
      }

      const handleBackdropClick = (event) => {
        if (
          event.target === this.dialogEl
          || event.target.classList.contains('chat-search-dialog-backdrop')
        ) {
          this.hide();
        }
      };

      this.dialogEl.addEventListener('click', handleBackdropClick);

      if (this.closeBtnEl) {
        this.closeBtnEl.addEventListener('click', () => this.hide());
      }

      if (this.inputEl) {
        this.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            this.submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            this.hide();
          }
        });
      }

      this.bound = true;
    }

    show() {
      this.ensureDialog();
      if (!this.dialogEl) {
        return;
      }
      this.dialogEl.classList.add('visible');
      if (this.inputEl) {
        this.inputEl.value = '';
        this.inputEl.focus();
      }
      this.resetResults();
    }

    hide() {
      if (!this.dialogEl) {
        return;
      }
      this.dialogEl.classList.remove('visible');
      if (typeof this.onClose === 'function') {
        try {
          this.onClose();
        } catch (error) {
          console.warn('聊天搜索弹窗 onClose 回调执行失败:', error);
        }
      }
    }

    submit() {
      const keyword = this.inputEl ? this.inputEl.value.trim() : '';
      if (!keyword) {
        this.resetResults();
        return;
      }

      if (typeof this.onSubmit === 'function') {
        try {
          const result = this.onSubmit(keyword, this);
          if (result === true) {
            return;
          }
          if (result && typeof result.then === 'function') {
            return;
          }
        } catch (error) {
          console.warn('聊天搜索弹窗 onSubmit 回调执行失败:', error);
        }
      }

      this.showPlaceholder(keyword);
    }

    resetResults() {
      if (!this.resultsEl) {
        return;
      }
      this.resultsEl.dataset.state = 'empty';
      this.resultsEl.innerHTML = '';
      const empty = global.document.createElement('div');
      empty.className = 'chat-search-result-empty';
      empty.textContent = this.emptyMessage;
      this.resultsEl.appendChild(empty);
    }

    showPlaceholder(keyword) {
      if (!this.resultsEl) {
        return;
      }
      this.resultsEl.dataset.state = 'placeholder';
      this.resultsEl.innerHTML = '';
      const item = global.document.createElement('div');
      item.className = 'chat-search-result-placeholder';
      item.textContent = this.placeholderTemplate(keyword);
      this.resultsEl.appendChild(item);
    }
  }

  global.ChatSearchDialog = ChatSearchDialog;
})(typeof window !== 'undefined' ? window : globalThis);

