/**
 * Markdown查看器和编辑器模块
 * 提供Markdown文件的查看、编辑和预览功能
 */
class MarkdownViewer {
  constructor() {
    this.tabStates = new Map(); // 存储每个标签页的状态
    if (typeof document !== 'undefined') {
      this.addStyles();
    }
    this.markdownIt = null;
  }

  /**
   * 添加Markdown查看器相关的样式
   */
  addStyles() {
    const styleId = 'markdown-viewer-styles';
    if (document.getElementById(styleId)) {
      return; // 样式已存在
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Markdown编辑器容器样式 */
      .markdown-editor-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: row;
        background: var(--bg-color);
        color: var(--text-color);
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 14px;
        overflow: hidden;
      }
      
      .markdown-content {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      
      .markdown-editor-pane {
        flex: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--tree-border);
        overflow: hidden;
      }
      
      .markdown-textarea-wrapper {
        position: relative;
        flex: 1;
        display: flex;
      }
      
      .markdown-preview-pane {
        flex: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      
      .markdown-editor-header {
        padding: 8px 12px;
        background: var(--tree-bg);
        border-bottom: 1px solid var(--tree-border);
        font-size: 12px;
        font-weight: bold;
        color: var(--text-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .markdown-editor-textarea {
        flex: 1;
        width: 100%;
        border: none;
        outline: none;
        resize: none;
        padding: 12px;
        background: var(--bg-color);
        color: var(--text-color);
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 14px;
        line-height: 1.5;
        tab-size: 2;
        overflow-y: auto;
        z-index: 1;
      }
      
      .markdown-preview {
        flex: 1;
        height: 100%;
        overflow-y: auto;
        padding: 20px;
        background: var(--bg-color);
        color: var(--text-color);
        line-height: 1.6;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .markdown-preview h1,
      .markdown-preview h2,
      .markdown-preview h3,
      .markdown-preview h4,
      .markdown-preview h5,
      .markdown-preview h6 {
        color: var(--text-color);
        margin-top: 24px;
        margin-bottom: 16px;
        font-weight: 600;
        line-height: 1.25;
      }
      
      .markdown-preview h1 {
        font-size: 2em;
        border-bottom: 1px solid var(--tree-border);
        padding-bottom: 8px;
      }
      
      .markdown-preview h2 {
        font-size: 1.5em;
        border-bottom: 1px solid var(--tree-border);
        padding-bottom: 8px;
      }
      
      .markdown-preview p {
        margin-bottom: 16px;
        color: var(--text-color);
      }
      
      .markdown-preview code {
        background: var(--tree-bg);
        color: var(--accent-color);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 0.9em;
      }
      
      .markdown-preview pre {
        background: var(--tree-bg);
        color: var(--text-color);
        padding: 16px;
        border-radius: 6px;
        overflow-x: auto;
        margin-bottom: 16px;
        border: 1px solid var(--tree-border);
      }
      
      .markdown-preview pre code {
        background: none;
        color: inherit;
        padding: 0;
        border-radius: 0;
      }
      
      .markdown-preview blockquote {
        border-left: 4px solid var(--accent-color);
        padding-left: 16px;
        margin: 16px 0;
        color: var(--text-color);
        font-style: italic;
      }
      
      .markdown-preview ul,
      .markdown-preview ol {
        padding-left: 24px;
        margin-bottom: 16px;
      }
      
      .markdown-preview li {
        margin-bottom: 4px;
        color: var(--text-color);
      }
      
      .markdown-preview table {
        border-collapse: collapse;
        width: 100%;
        margin-bottom: 16px;
        border: 1px solid var(--tree-border);
      }
      
      .markdown-preview th,
      .markdown-preview td {
        border: 1px solid var(--tree-border);
        padding: 8px 12px;
        text-align: left;
        background: var(--bg-color);
        color: var(--text-color);
      }
      
      .markdown-preview th {
        background: var(--tree-bg);
        font-weight: 600;
      }
      
      .markdown-preview a {
        color: var(--accent-color);
        text-decoration: none;
      }
      
      .markdown-preview a:hover {
        text-decoration: underline;
      }
      
      .markdown-preview img {
        max-width: 100%;
        height: auto;
        border-radius: 6px;
        margin: 16px 0;
      }
      
      /* Markdown编辑器滚动条样式 */
      .markdown-editor-textarea::-webkit-scrollbar,
      .markdown-preview::-webkit-scrollbar {
        width: 2px;
      }
      
      .markdown-editor-textarea::-webkit-scrollbar-track,
      .markdown-preview::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .markdown-editor-textarea::-webkit-scrollbar-thumb,
      .markdown-preview::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .markdown-editor-textarea::-webkit-scrollbar-thumb:hover,
      .markdown-preview::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }
      
      /* 调整大小手柄 */
      .resize-handle {
        width: 4px;
        background: var(--tree-border);
        cursor: col-resize;
        position: relative;
        z-index: 10;
        flex-shrink: 0;
      }
      
      .resize-handle:hover {
        background: var(--accent-color);
      }
      
      /* 保存状态指示器 */
      .markdown-save-indicator {
        font-size: 11px;
        color: var(--text-color-secondary, #888);
      }
      
      .markdown-save-indicator.saving {
        color: var(--accent-color);
      }
      
      .markdown-save-indicator.saved {
        color: #4CAF50;
      }
      
      .markdown-save-indicator.error {
        color: #f44336;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 加载Markdown文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 解析后的HTML内容
   */
  async loadMarkdownFile(filePath) {
    try {
      const content = await window.fsAPI.readFile(filePath);
      return this.parseMarkdown(content, filePath);
    } catch (error) {
      console.error('加载Markdown文件失败:', error);
      return `<p>加载Markdown文件失败: ${error.message}</p>`;
    }
  }

  /**
   * Markdown解析器
   * @param {string} content - Markdown内容
   * @returns {string} 解析后的HTML
   */

  parseMarkdown(content, filePath = null) {
    const source = typeof content === 'string' ? content : String(content || '');
    const md = this.ensureMarkdownIt();
    if (md) {
      try {
        const bodyHtml = this.enhanceMarkdownHtml(md.render(source), filePath);
        return this.composeMarkdownHtml(bodyHtml);
      } catch (error) {
        console.warn('markdown-it 渲染失败，回退到简易解析器:', error);
      }
    }

    const fallbackHtml = this.enhanceMarkdownHtml(this.renderFallbackMarkdown(source), filePath);
    return this.composeMarkdownHtml(fallbackHtml);
  }

  ensureMarkdownIt() {
    if (this.markdownIt) {
      return this.markdownIt;
    }

    let factory = null;
    if (typeof MarkdownIt !== 'undefined') {
      factory = MarkdownIt;
    } else if (typeof window !== 'undefined' && typeof window.markdownit === 'function') {
      factory = window.markdownit;
    } else if (typeof require === 'function') {
      try {
        factory = require('markdown-it');
      } catch (error) {
        factory = null;
      }
    }

    if (!factory) {
      return null;
    }

    try {
      const options = {
        html: true,
        linkify: true,
        typographer: true,
        highlight: (code, lang) => {
          if (typeof hljs !== 'undefined' && hljs) {
            try {
              if (lang && hljs.getLanguage && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
              }
              if (hljs.highlightAuto) {
                return hljs.highlightAuto(code).value;
              }
            } catch (error) {
              console.warn('Highlight.js error:', error);
            }
          }
          return '';
        }
      };

      let instance = null;
      if (factory.prototype && typeof factory.prototype.render === 'function') {
        instance = new factory(options);
      } else if (typeof factory === 'function') {
        instance = factory(options);
      }

      this.markdownIt = instance && typeof instance.render === 'function' ? instance : null;
    } catch (error) {
      console.warn('markdown-it 初始化失败:', error);
      this.markdownIt = null;
    }

    return this.markdownIt;
  }

  composeMarkdownHtml(bodyHtml) {
    return `
      <!-- GitHub Markdown 样式 -->
      <link rel="stylesheet" href="./node_modules/github-markdown-css/github-markdown.css">
      <!-- highlight.js 样式 -->
      <link rel="stylesheet" href="./node_modules/highlight.js/styles/github.min.css">

      <style>
        .markdown-body {
          box-sizing: border-box;
          min-width: 200px;
          max-width: none;
          margin: 0;
          padding: 16px 20px;
          font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
          font-size: 15px;
          line-height: 1.65;
          word-wrap: break-word;
          background-color: var(--bg-color) !important;
          color: var(--text-color) !important;
        }

        .markdown-body h1,
        .markdown-body h2,
        .markdown-body h3,
        .markdown-body h4,
        .markdown-body h5,
        .markdown-body h6 {
          margin-top: 24px;
          margin-bottom: 12px;
          font-weight: 600;
          line-height: 1.3;
          color: var(--text-color) !important;
        }

        .markdown-body p {
          margin: 12px 0;
          color: var(--text-color) !important;
        }

        .markdown-body ul,
        .markdown-body ol {
          padding-left: 1.6em;
          margin: 12px 0;
        }

        .markdown-body table {
          border-spacing: 0;
          border-collapse: collapse;
          display: block;
          max-width: 100%;
          overflow: auto;
          margin: 16px 0;
        }

        .markdown-body table th,
        .markdown-body table td {
          padding: 6px 13px;
          border: 1px solid var(--tree-border) !important;
          background-color: var(--bg-color) !important;
          color: var(--text-color) !important;
        }

        .markdown-body pre {
          padding: 14px;
          overflow: auto;
          font-size: 0.9em;
          line-height: 1.45;
          background-color: var(--tree-bg) !important;
          color: var(--text-color) !important;
          border: 1px solid var(--tree-border) !important;
          border-radius: 6px;
          margin: 16px 0;
        }

        .markdown-body code {
          padding: 0.2em 0.4em;
          margin: 0;
          font-size: 0.9em;
          background-color: var(--tree-bg) !important;
          color: var(--accent-color) !important;
          border-radius: 4px;
          font-family: ui-monospace,SFMono-Regular,"SF Mono",Consolas,"Liberation Mono",Menlo,monospace;
        }

        .markdown-body a {
          color: var(--accent-color) !important;
          text-decoration: none;
        }

        .markdown-body a:hover {
          text-decoration: underline;
        }
      </style>

      <div class="markdown-body">
        ${bodyHtml}
      </div>
    `;
  }


  renderFallbackMarkdown(source) {
    let html = String(source || '').replace(/\r?\n/g, '\n');
    html = html
      .replace(/!\[([^\]]*)\]\(([^\)]+)\)/gim, '<img alt="$1" src="$2" />')
      .replace(/^######\s+(.*)$/gim, '<h6>$1</h6>')
      .replace(/^#####\s+(.*)$/gim, '<h5>$1</h5>')
      .replace(/^####\s+(.*)$/gim, '<h4>$1</h4>')
      .replace(/^###\s+(.*)$/gim, '<h3>$1</h3>')
      .replace(/^##\s+(.*)$/gim, '<h2>$1</h2>')
      .replace(/^#\s+(.*)$/gim, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
      .replace(/`(.*?)`/gim, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^\)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/^\* (.*)$/gim, '<li>$1</li>')
      .replace(/^- (.*)$/gim, '<li>$1</li>')
      .replace(/^\d+\. (.*)$/gim, '<li>$1</li>');
  
    html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
    html = html.replace(/(<ul>)(\s*<ul>)+/gims, '<ul>').replace(/<\/ul>\s*<ul>/gims, '');
  
    const blocks = html
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        if (/^<(h[1-6]|ul|ol|pre|table|blockquote)>/i.test(block)) {
          return block;
        }
        return `<p>${block.replace(/\n+/g, ' ')}</p>`;
      });
  
    return blocks.join('\n');
  }
  enhanceMarkdownHtml(html, filePath) {
    if (!html) {
      return '';
    }

    const baseDir = this.getBaseDirectory(filePath);
    if (!baseDir) {
      return html;
    }

    const container = document.createElement('div');
    container.innerHTML = html;

    container.querySelectorAll('img').forEach((img) => {
      const rawSrc = (img.getAttribute('src') || '').trim();
      if (!rawSrc) {
        return;
      }

      if (/^(https?:|data:|file:|blob:)/i.test(rawSrc)) {
        return;
      }

      const absolutePath = this.resolveRelativePath(baseDir, rawSrc);
      if (!absolutePath) {
        return;
      }

      const fileUrl = this.convertPathToFileUrl(absolutePath);
      if (fileUrl) {
        img.setAttribute('src', fileUrl);
        img.dataset.internalPath = absolutePath;
      }
    });

    return container.innerHTML;
  }

  getBaseDirectory(filePath) {
    if (!filePath) {
      return null;
    }
    const normalized = String(filePath).replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) {
      return normalized;
    }
    return normalized.slice(0, lastSlash);
  }

  resolveRelativePath(baseDir, relativePath) {
    if (!relativePath) {
      return null;
    }

    let normalizedRelative = String(relativePath).trim().replace(/\\/g, '/');
    if (/^(https?:|data:|file:|blob:)/i.test(normalizedRelative)) {
      return normalizedRelative;
    }

    const base = String(baseDir || '').replace(/\\/g, '/');

    if (normalizedRelative.startsWith('/')) {
      if (/^[a-zA-Z]:/.test(base)) {
        const drive = base.split('/')[0];
        return `${drive}${normalizedRelative}`;
      }
      return normalizedRelative;
    }

    const segments = base ? base.split('/') : [];

    normalizedRelative.split('/').forEach((part) => {
      if (!part || part === '.') {
        return;
      }
      if (part === '..') {
        if (segments.length) {
          segments.pop();
        }
      } else {
        segments.push(part);
      }
    });

    return segments.join('/');
  }

  convertPathToFileUrl(absPath) {
    if (!absPath) {
      return null;
    }

    if (/^(https?:|data:|file:|blob:)/i.test(absPath)) {
      return absPath;
    }

    let normalized = String(absPath).replace(/\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    return encodeURI(`file://${normalized}`);
  }

  /**
   * 创建Markdown编辑器
   * @param {string} tabId - 标签页ID
   * @param {string} content - Markdown内容
   * @param {string} filePath - 文件路径
   * @param {Element} contentElement - 内容容器元素
   */
  createMarkdownEditor(tabId, content, filePath, contentElement) {
    if (!contentElement) return;
    
    // 为Markdown内容添加特殊类名
    contentElement.classList.add('markdown-content');

    // 创建分屏布局
    contentElement.innerHTML = `
      <div class="markdown-editor-container" id="container-${tabId}">
        <div class="markdown-editor-pane" id="editor-pane-${tabId}">
          <div class="markdown-textarea-wrapper">
            <div class="txt-highlight-overlay"></div>
            <textarea class="markdown-editor-textarea" id="editor-${tabId}" spellcheck="false" wrap="soft" autocomplete="off">${content}</textarea>
          </div>
        </div>
        <div class="resize-handle" id="resize-handle-${tabId}"></div>
        <div class="markdown-preview-pane" id="preview-pane-${tabId}">
          <div class="markdown-preview" id="preview-${tabId}"></div>
        </div>
      </div>
    `;

    // 获取编辑器和预览区域
    const editor = document.getElementById(`editor-${tabId}`);
    const preview = document.getElementById(`preview-${tabId}`);

    // 存储文件路径和原始内容到tabStates
    this.tabStates.set(tabId, {
      filePath: filePath,
      originalContent: content,
      editor: editor,
      preview: preview,
      isDirty: false,
      autoSaveTimer: null
    });

    // 初始渲染预览
    this.updateMarkdownPreview(tabId, content);

    // 绑定编辑器事件
    this.bindMarkdownEditorEvents(tabId);
  }

  /**
   * 更新Markdown预览
   * @param {string} tabId - 标签页ID
   * @param {string} content - Markdown内容
   */
  updateMarkdownPreview(tabId, content) {
    const preview = document.getElementById(`preview-${tabId}`);
    if (!preview) return;

    const tabState = this.tabStates.get(tabId);
    const filePath = tabState ? tabState.filePath : null;
    const html = this.parseMarkdown(content, filePath);
    preview.innerHTML = html;
  }

  /**
   * 绑定Markdown编辑器事件
   * @param {string} tabId - 标签页ID
   */
  bindMarkdownEditorEvents(tabId) {
    const editor = document.getElementById(`editor-${tabId}`);
    if (!editor) return;

    const tabState = this.tabStates.get(tabId);
    if (!tabState) return;

    // 实时预览更新
    editor.addEventListener('input', () => {
      const content = editor.value;
      this.updateMarkdownPreview(tabId, content);
      
      // 标记为已修改
      if (content !== tabState.originalContent) {
        this.markTabAsDirty(tabId);
        tabState.isDirty = true;
      } else {
        tabState.isDirty = false;
        this.updateTabTitle(tabId);
      }

      // 重置自动保存计时器
      this.resetAutoSaveTimer(tabId);
    });

    // 点击行进入编辑模式（编辑器默认就是编辑模式）
    editor.addEventListener('click', () => {
      editor.focus();
    });

    // 添加键盘事件监听，确保按键重复功能正常
    editor.addEventListener('keydown', (e) => {
      // 特别处理Tab键，插入制表符而不是切换焦点
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;
        editor.value = value.substring(0, start) + '\t' + value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 1;
        
        // 触发input事件以更新预览
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // 不阻止任何默认键盘行为，让所有事件正常传播
    });

    // 添加拖拽调整大小功能
    this.initResizeHandle(tabId);
  }

  /**
   * 初始化拖拽调整大小功能
   * @param {string} tabId - 标签页ID
   */
  initResizeHandle(tabId) {
    const resizeHandle = document.getElementById(`resize-handle-${tabId}`);
    const container = document.getElementById(`container-${tabId}`);
    const editorPane = document.getElementById(`editor-pane-${tabId}`);
    const previewPane = document.getElementById(`preview-pane-${tabId}`);
    
    if (!resizeHandle || !container || !editorPane || !previewPane) return;
    
    let isResizing = false;
    let startX = 0;
    let startEditorWidth = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startEditorWidth = editorPane.offsetWidth;
      
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const deltaX = e.clientX - startX;
      const containerWidth = container.offsetWidth;
      const newEditorWidth = startEditorWidth + deltaX;
      
      // 限制最小和最大宽度
      const minWidth = 200;
      const maxWidth = containerWidth - minWidth - 4; // 4px for resize handle
      
      if (newEditorWidth >= minWidth && newEditorWidth <= maxWidth) {
        const editorPercent = (newEditorWidth / containerWidth) * 100;
        const previewPercent = ((containerWidth - newEditorWidth - 4) / containerWidth) * 100;
        
        editorPane.style.flex = `0 0 ${editorPercent}%`;
        previewPane.style.flex = `0 0 ${previewPercent}%`;
      }
      
      e.preventDefault();
    });
    
    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  /**
   * 重置自动保存计时器
   * @param {string} tabId - 标签页ID
   */
  resetAutoSaveTimer(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (!tabState) return;

    // 清除现有计时器
    if (tabState.autoSaveTimer) {
      clearTimeout(tabState.autoSaveTimer);
    }

    // 设置新的5秒自动保存计时器
    tabState.autoSaveTimer = setTimeout(() => {
      if (tabState.isDirty) {
        this.saveMarkdownFile(tabId);
      }
    }, 5000);
  }

  /**
   * 保存Markdown文件
   * @param {string} tabId - 标签页ID
   */
  async saveMarkdownFile(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (!tabState || !tabState.editor || !tabState.filePath) return;

    try {
      const content = tabState.editor.value;
      await window.fsAPI.writeFile(tabState.filePath, content);
      
      // 更新原始内容和状态
      tabState.originalContent = content;
      tabState.isDirty = false;
      this.updateTabTitle(tabId);
      
      // 清除自动保存计时器
      if (tabState.autoSaveTimer) {
        clearTimeout(tabState.autoSaveTimer);
        tabState.autoSaveTimer = null;
      }

      console.log('Markdown文件保存成功:', tabState.filePath);
    } catch (error) {
      console.error('保存Markdown文件失败:', error);
      showAlert(`保存文件失败: ${error.message}`, 'error');
    }
  }

  /**
   * 标记标签页为已修改
   * @param {string} tabId - 标签页ID
   */
  markTabAsDirty(tabId) {
    // 这个方法需要由外部提供，因为它涉及到TabManager
    if (this.onMarkTabAsDirty) {
      this.onMarkTabAsDirty(tabId);
    }
  }

  /**
   * 更新标签标题
   * @param {string} tabId - 标签页ID
   */
  updateTabTitle(tabId) {
    // 这个方法需要由外部提供，因为它涉及到TabManager
    if (this.onUpdateTabTitle) {
      this.onUpdateTabTitle(tabId);
    }
  }

  /**
   * 设置回调函数
   * @param {Object} callbacks - 回调函数对象
   */
  setCallbacks(callbacks) {
    this.onMarkTabAsDirty = callbacks.onMarkTabAsDirty;
    this.onUpdateTabTitle = callbacks.onUpdateTabTitle;
  }

  /**
   * 获取标签页状态
   * @param {string} tabId - 标签页ID
   * @returns {Object} 标签页状态
   */
  getTabState(tabId) {
    return this.tabStates.get(tabId);
  }

  /**
   * 检查标签页是否已修改
   * @param {string} tabId - 标签页ID
   * @returns {boolean} 是否已修改
   */
  isTabDirty(tabId) {
    const tabState = this.tabStates.get(tabId);
    return tabState ? tabState.isDirty : false;
  }

  /**
   * 清理标签页
   * @param {string} tabId - 标签页ID
   */
  cleanupTab(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (tabState) {
      // 清除自动保存计时器
      if (tabState.autoSaveTimer) {
        clearTimeout(tabState.autoSaveTimer);
      }
      // 删除标签页状态
      this.tabStates.delete(tabId);
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarkdownViewer;
} else {
  window.MarkdownViewer = MarkdownViewer;
}
