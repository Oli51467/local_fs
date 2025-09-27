/**
 * 文本文件查看器模块
 * 专门处理 .txt 文件的查看和编辑功能
 */
class TextViewer {
  constructor(contentContainer, tabManager) {
    this.contentContainer = contentContainer;
    this.tabManager = tabManager;
    this.addStyles();
  }

  // 添加文本查看器样式
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* 文本编辑器样式 */
      .txt-content {
        height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .txt-editor-wrapper {
        position: relative;
        height: 100%;
        width: 100%;
        display: flex;
      }
      
      .txt-editor {
        width: 100%;
        height: 100%;
        border: none;
        outline: none;
        resize: none;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 14px;
        line-height: 1.5;
        padding: 20px;
        background-color: var(--bg-color);
        color: var(--text-color);
        box-sizing: border-box;
        white-space: pre-wrap;
        word-wrap: break-word;
        overflow-y: auto;
        background-color: var(--bg-color);
        color: var(--text-color);
      }
      
      .txt-editor:focus {
        background-color: var(--bg-color);
        color: var(--text-color);
      }
      
      .txt-editor::placeholder {
        color: var(--text-muted);
        opacity: 0.7;
      }
      
      /* 自定义滚动条样式 */
      .txt-editor::-webkit-scrollbar {
        width: 2px;
      }
      
      .txt-editor::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .txt-editor::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .txt-editor::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }

      .txt-editor.search-highlight-flash {
        animation: txt-highlight-pulse 0.8s ease;
      }

      @keyframes txt-highlight-pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.35);
          background-color: rgba(191, 219, 254, 0.35);
        }
        100% {
          box-shadow: none;
          background-color: inherit;
        }
      }

      .txt-highlight-overlay {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 0;
        pointer-events: none;
        border-left: 3px solid rgba(37, 99, 235, 0.85);
        background: rgba(37, 99, 235, 0.24);
        opacity: 0;
        transition: opacity 0.2s ease, top 0.1s ease;
        z-index: 5;
      }
    `;
    document.head.appendChild(style);
  }

  // 检查是否为支持的文本文件类型
  isSupportedFile(fileExt) {
    const supportedTypes = ['txt', 'json', 'js', 'css'];
    return supportedTypes.includes(fileExt);
  }

  // 加载文本文件
  async loadTextFile(filePath) {
    try {
      const content = await window.fsAPI.readFile(filePath);
      return content;
    } catch (error) {
      console.error('加载文本文件失败:', error);
      throw new Error(`加载文本文件失败: ${error.message}`);
    }
  }

  // 创建文本编辑器
  createTextEditor(tabId, content, fileType) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 为TXT文件添加特殊类名
    contentElement.classList.add('txt-content');

    // 清空容器并移除padding和margin
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    contentElement.style.margin = '0';

    const textarea = document.createElement('textarea');
    textarea.className = 'txt-editor';
    textarea.value = content;
    textarea.placeholder = '开始编辑...';
    textarea.spellcheck = false;

    // 添加内容变化监听
    textarea.addEventListener('input', () => {
      this.markTabAsDirty(tabId);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'txt-editor-wrapper';

    const overlay = document.createElement('div');
    overlay.className = 'txt-highlight-overlay';

    wrapper.appendChild(overlay);
    wrapper.appendChild(textarea);
    contentElement.appendChild(wrapper);
  }

  // 标记标签页为已修改
  markTabAsDirty(tabId) {
    if (this.tabManager && this.tabManager.markTabAsDirty) {
      this.tabManager.markTabAsDirty(tabId);
    }
  }

  // 获取文本内容（用于保存）
  getTextContent(tabId) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return null;

    const textarea = contentElement.querySelector('.txt-editor');
    return textarea ? textarea.value : null;
  }

  // 设置文本内容
  setTextContent(tabId, content) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    const textarea = contentElement.querySelector('.txt-editor');
    if (textarea) {
      textarea.value = content;
    }
  }

  // 处理文本文件的打开
  async openTextFile(filePath, tabId, fileName) {
    try {
      const fileExt = fileName.split('.').pop().toLowerCase();
      const content = await this.loadTextFile(filePath);
      this.createTextEditor(tabId, content, fileExt);
      
      // 设置显示模式信息
      const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
      if (contentElement) {
        contentElement.dataset.displayMode = 'text';
        contentElement.dataset.isEditable = 'true';
      }
      
      return {
        success: true,
        displayMode: 'text',
        isEditable: true
      };
    } catch (error) {
      console.error('打开文本文件失败:', error);
      throw error;
    }
  }

  // 清理资源
  cleanup(tabId) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (contentElement) {
      // 移除事件监听器
      const textarea = contentElement.querySelector('.txt-editor');
      if (textarea) {
        textarea.removeEventListener('input', this.markTabAsDirty);
      }
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextViewer;
} else {
  window.TextViewer = TextViewer;
}
