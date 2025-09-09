/**
 * 文件查看器模块
 * 支持多tab显示，txt和word文件查看编辑
 */

class FileViewer {
  constructor(container) {
    this.container = container;
    this.contentContainer = null;
    this.tabManager = null;
    // 存储tab状态信息
    this.tabStates = new Map();
    this.init();
  }

  init() {
    // 创建文件查看器容器
    this.container.innerHTML = `
      <div class="file-viewer">
        <div id="tab-container"></div>
        <div class="content-container" id="content-container">
          <div class="welcome-message">
            <p>选择一个文件开始查看...</p>
          </div>
        </div>
      </div>
    `;

    // 初始化TabManager
    const tabContainer = document.getElementById('tab-container');
    this.tabManager = new TabManager(tabContainer);
    this.contentContainer = document.getElementById('content-container');
     
     // 设置TabManager回调
     this.tabManager.setCallbacks({
       onTabSwitch: (tabId, tab) => this.handleTabSwitch(tabId, tab),
       onTabClose: (tabId, tab) => this.handleTabClose(tabId, tab),
       onTabCreate: (tabId, fileName, filePath) => this.handleTabCreate(tabId, fileName, filePath)
     });
 
     // 初始化键盘快捷键
     this.initKeyboardShortcuts();
 
     // 添加样式
     this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .file-viewer {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }

      /* Tab相关样式已移至TabManager模块 */

      .content-container {
        flex: 1;
        overflow: hidden;
        background: var(--bg-color);
        position: relative;
        display: flex;
        flex-direction: column;
      }

      .file-content {
        height: 100%;
        width: 100%;
        display: none;
        padding: 15px;
        box-sizing: border-box;
        overflow-y: auto;
        overflow-x: auto;
        flex: 1;
      }

      .file-content.active {
        display: flex;
        flex-direction: column;
      }
      
      /* Markdown编辑器特殊样式 - 移除padding确保完全占据高度 */
      .file-content.markdown-content {
        padding: 0;
        overflow: hidden;
      }
      
      .file-content.markdown-content.active {
        display: flex;
        flex-direction: column;
      }
      
      /* TXT和JSON文件特殊样式 - 移除padding确保完全占据宽度 */
      .file-content.txt-content {
        padding: 0;
        overflow: hidden;
      }
      
      .file-content.txt-content.active {
        display: flex;
        flex-direction: column;
      }
      
      /* DOCX文件特殊样式 - 移除padding确保完全占据宽度 */
      .file-content.docx-content {
        padding: 0;
        overflow: hidden;
      }
      
      .file-content.docx-content.active {
        display: flex;
        flex-direction: column;
      }

      .file-content-wrapper {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        position: relative;
      }

      .file-content-display {
        height: 100%;
        width: 100%;
        overflow: auto;
        flex: 1;
        display: none;
      }

      .file-content-display.active {
        display: block;
      }

      .welcome-message {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-color);
        opacity: 0.6;
      }

      .txt-editor {
        width: 100%;
        height: 100%;
        border: none;
        outline: none;
        font-family: 'Courier New', monospace;
        font-size: 14px;
        line-height: 1.5;
        background: var(--bg-color);
        color: var(--text-color);
        resize: none;
        padding: 0;
        margin: 0;
        box-sizing: border-box;
      }
      
      /* 文本编辑器滚动条样式 */
      .txt-editor::-webkit-scrollbar {
        width: 3px;
      }
      
      .txt-editor::-webkit-scrollbar-track {
        background: var(--tree-bg);
      }
      
      .txt-editor::-webkit-scrollbar-thumb {
        background: var(--tree-border);
        border-radius: 1.5px;
      }
      
      .txt-editor::-webkit-scrollbar-thumb:hover {
        background: var(--text-color);
      }

      .html-viewer {
        width: 100%;
        height: 100%;
        overflow: hidden;
        padding: 0;
        background: var(--bg-color);
        color: var(--text-color);
      }

      .html-viewer iframe {
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
      }

      .word-viewer {
        width: 100%;
        height: 100%;
        overflow: auto;
        padding: 0;
        margin: 0;
        background: var(--bg-color);
        color: var(--text-color);
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
      }
      
      /* 确保docx内容适配深色模式 */
      .word-viewer * {
        background-color: transparent !important;
        color: var(--text-color) !important;
      }
      
      .word-viewer p, .word-viewer div, .word-viewer span {
        color: var(--text-color) !important;
      }
      
      .word-viewer h1, .word-viewer h2, .word-viewer h3, .word-viewer h4, .word-viewer h5, .word-viewer h6 {
        color: var(--text-color) !important;
      }
      
      .word-viewer table {
        border-collapse: collapse;
        border: 1px solid var(--tree-border) !important;
      }
      
      .word-viewer th, .word-viewer td {
        border: 1px solid var(--tree-border) !important;
        padding: 8px 12px;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
      }
      
      /* Word查看器滚动条样式 */
      .word-viewer::-webkit-scrollbar {
        width: 3px;
      }
      
      .word-viewer::-webkit-scrollbar-track {
        background: var(--tree-bg);
      }
      
      .word-viewer::-webkit-scrollbar-thumb {
        background: var(--tree-border);
        border-radius: 1.5px;
      }
      
      .word-viewer::-webkit-scrollbar-thumb:hover {
        background: var(--text-color);
      }

      .error-message {
        padding: 20px;
        color: #e74c3c;
        text-align: center;
      }

      .loading-message {
        padding: 20px;
        text-align: center;
        color: var(--text-color);
      }
      
      /* Markdown编辑器样式 */
      .markdown-editor-container {
          display: flex;
          height: 100%;
          width: 100%;
          position: relative;
          margin-left: 10px;
          padding: 0;
          box-sizing: border-box;
        }
      
      .markdown-editor-pane,
        .markdown-preview-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
          min-width: 200px;
          position: relative;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
      
      .markdown-editor {
        flex: 1;
        border: none;
        outline: none;
        padding: 16px;
        margin: 0;
        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        font-size: 14px;
        line-height: 1.5;
        background: var(--bg-color);
        color: var(--text-color);
        resize: none;
        tab-size: 2;
        box-sizing: border-box;
        overflow-y: auto;
      }
      
      .markdown-preview {
        flex: 1;
        overflow-y: auto;
        background: var(--bg-color);
        color: var(--text-color);
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }
      
      .markdown-preview .markdown-body {
        padding: 16px;
        margin: 0;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
      }
      
      /* 确保Markdown预览内容适配深色模式 */
      .markdown-preview * {
        background-color: transparent !important;
        color: var(--text-color) !important;
      }
      
      .markdown-preview h1, .markdown-preview h2, .markdown-preview h3,
      .markdown-preview h4, .markdown-preview h5, .markdown-preview h6 {
        color: var(--text-color) !important;
        border-bottom-color: var(--tree-border) !important;
      }
      
      .markdown-preview code {
        background: var(--tree-bg) !important;
        color: var(--text-color) !important;
        padding: 2px 4px;
        border-radius: 3px;
      }
      
      .markdown-preview pre {
        background: var(--tree-bg) !important;
        color: var(--text-color) !important;
        border: 1px solid var(--tree-border) !important;
        border-radius: 5px;
        padding: 10px;
      }
      
      .markdown-preview blockquote {
        border-left: 4px solid var(--tree-border) !important;
        background: var(--tree-bg) !important;
        color: var(--text-color) !important;
        padding: 10px 15px;
        margin: 10px 0;
      }
      
      .markdown-preview a {
        color: #007acc !important;
      }
      
      .markdown-preview table {
        border-collapse: collapse;
        border: 1px solid var(--tree-border) !important;
      }
      
      .markdown-preview th, .markdown-preview td {
        border: 1px solid var(--tree-border) !important;
        padding: 8px 12px;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
      }
      
      .markdown-preview th {
        background: var(--tree-bg) !important;
        font-weight: bold;
      }
      
      /* 自定义滚动条样式 */
      .markdown-editor::-webkit-scrollbar,
      .markdown-preview::-webkit-scrollbar {
        width: 2px;
      }
      
      .markdown-editor::-webkit-scrollbar-track,
      .markdown-preview::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .markdown-editor::-webkit-scrollbar-thumb,
      .markdown-preview::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .markdown-editor::-webkit-scrollbar-thumb:hover,
      .markdown-preview::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }
      
      .resize-handle {
        width: 0px;
        background: var(--tree-border);
        cursor: col-resize;
        position: relative;
        flex-shrink: 0;
      }
      
      .resize-handle:hover {
        background: var(--accent-color, #007acc);
      }
      
      .resize-handle::after {
        content: '';
        position: absolute;
        top: 0;
        left: -2px;
        right: -2px;
        bottom: 0;
      }
      
      /* Docx编辑器样式 */
      .docx-content {
        padding: 0 !important;
        height: 100% !important;
        width: 100% !important;
        overflow: hidden;
        background: white !important;
        margin: 0 !important;
        position: relative;
      }

      .docx-preview-full {
        height: 100% !important;
        width: 100% !important;
        overflow: auto;
        background: white !important;
        margin: 0 !important;
        padding: 0 !important;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }

      .docx-preview {
        height: 100% !important;
        width: 100% !important;
        overflow-y: auto;
        background: white !important;
        color: black;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box;
      }

      /* 强制docx内容占满整个区域 */
      .docx-preview .docx-wrapper,
      .docx-preview-content .docx-wrapper,
      .docx-preview > div,
      .docx-preview-content > div {
        width: 100% !important;
        height: auto !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 20px !important;
        background: white !important;
        box-sizing: border-box !important;
      }

      /* 移除所有可能的灰色背景 */
      .docx-preview *,
      .docx-preview-content *,
      .docx-content * {
        background-color: white !important;
        max-width: 100% !important;
      }

      /* 确保文档页面样式 */
      .docx-preview section,
      .docx-preview-content section {
        width: 100% !important;
        margin: 0 !important;
        padding: 20px !important;
        background: white !important;
        box-shadow: none !important;
      }


    `;
    document.head.appendChild(style);
  }

  // 打开文件
  async openFile(filePath) {
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
    const fileExt = fileName.split('.').pop().toLowerCase();
    const tabId = filePath;

    // 如果文件已经打开，直接切换到该tab
    if (this.tabManager.hasTab(tabId)) {
      this.tabManager.switchTab(tabId);
      return;
    }

    // 创建新tab
    this.tabManager.createTab(tabId, fileName, filePath);
    
    // 根据文件类型加载内容
    try {
      let content;
      let displayMode = 'text'; // 'text' 或 'html'
      let isEditable = true;
      
      switch (fileExt) {
        case 'txt':
        case 'json':
        case 'js':
        case 'css':
          content = await this.loadTextFile(filePath);
          this.createTextEditor(tabId, content, fileExt);
          displayMode = 'text';
          isEditable = true;
          break;
        case 'html':
         case 'htm':
           content = await this.loadHtmlFile(filePath);
           this.createHtmlViewer(tabId, content);
           displayMode = 'html';
           isEditable = false;
           break;
         case 'md':
         case 'markdown':
           content = await window.fsAPI.readFile(filePath);
           this.createMarkdownEditor(tabId, content, filePath);
           displayMode = 'markdown';
           isEditable = true;
           break;
        case 'docx':
          content = await this.loadWordFile(filePath);
          if (content && content.isEditable) {
            this.createDocxEditor(tabId, content, filePath);
            displayMode = 'docx';
            isEditable = true;
          } else {
            this.createWordViewer(tabId, content.content || content);
            displayMode = 'html';
            isEditable = false;
          }
          break;
        case 'doc':
          content = await this.loadWordFile(filePath);
          this.createWordViewer(tabId, content.content || content);
          displayMode = 'html';
          isEditable = false;
          break;
        default:
          this.createErrorView(tabId, `不支持的文件类型: ${fileExt}`);
      }
      
      // 存储显示模式信息到内容元素的数据属性
      const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
      if (contentElement) {
        contentElement.dataset.displayMode = displayMode;
        contentElement.dataset.isEditable = isEditable;
      }
    } catch (error) {
      console.error('加载文件失败:', error);
      this.createErrorView(tabId, `加载文件失败: ${error.message}`);
    }

    this.tabManager.switchTab(tabId);
  }

  // TabManager回调：处理标签页创建
  handleTabCreate(tabId, fileName, filePath) {
    // 创建内容容器
    const contentElement = document.createElement('div');
    contentElement.className = 'file-content';
    contentElement.dataset.tabId = tabId;
    this.contentContainer.appendChild(contentElement);

    // 隐藏欢迎消息
    const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }
  }

  // TabManager回调：处理标签页切换
  handleTabSwitch(tabId, tab) {
    // 取消所有内容的激活状态
    const allContents = this.contentContainer.querySelectorAll('.file-content');
    allContents.forEach(content => {
      content.classList.remove('active');
    });

    // 激活指定内容
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (contentElement) {
      contentElement.classList.add('active');
      
      // 根据显示模式更新内容区域
      const displayMode = contentElement.dataset.displayMode;
      const isEditable = contentElement.dataset.isEditable === 'true';
      const fileContent = contentElement.querySelector('.txt-editor');
      const fileDisplay = contentElement.querySelector('.word-viewer, .error-message');
      
      if (displayMode === 'html') {
        // 显示HTML内容
        if (fileContent) {
          fileContent.style.display = 'none';
        }
        if (fileDisplay) {
          fileDisplay.style.display = 'block';
        }
      } else {
        // 显示文本内容
        if (fileDisplay) {
          fileDisplay.style.display = 'none';
        }
        if (fileContent) {
          fileContent.style.display = 'block';
          fileContent.disabled = !isEditable;
        }
      }
    }
  }

  // TabManager回调：处理标签页关闭
  handleTabClose(tabId, tab) {
    // 查找对应的内容元素
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (contentElement) {
      // 清理Markdown编辑器的自动保存计时器
      const autoSaveTimer = contentElement.dataset.autoSaveTimer;
      if (autoSaveTimer) {
        clearTimeout(parseInt(autoSaveTimer));
      }

      // 移除内容元素
      contentElement.remove();
    }

    // 清理tabStates中的状态信息
    const tabState = this.tabStates.get(tabId);
    if (tabState) {
      // 清除自动保存计时器
      if (tabState.autoSaveTimer) {
        clearTimeout(tabState.autoSaveTimer);
      }
      this.tabStates.delete(tabId);
    }

    // 如果没有剩余标签页，显示欢迎消息
    if (this.tabManager.getTabCount() === 0) {
      const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
      if (welcomeMessage) {
        welcomeMessage.style.display = 'flex';
      }
    }
  }

  // 加载文本文件
  async loadTextFile(filePath) {
    try {
      return await window.fsAPI.readFile(filePath);
    } catch (error) {
      throw new Error(`无法读取文件: ${error.message}`);
    }
  }

  // 加载HTML文件
  async loadHtmlFile(filePath) {
    try {
      const content = await window.fsAPI.readFile(filePath);
      return content;
    } catch (error) {
      console.error('加载HTML文件失败:', error);
      return `<p>加载HTML文件失败: ${error.message}</p>`;
    }
  }
  
  // 加载Markdown文件
  async loadMarkdownFile(filePath) {
    try {
      const content = await window.fsAPI.readFile(filePath);
      return this.parseMarkdown(content);
    } catch (error) {
      console.error('加载Markdown文件失败:', error);
      return `<p>加载Markdown文件失败: ${error.message}</p>`;
    }
  }
  
  // Markdown解析器
  parseMarkdown(content) {
    // 调试信息
    console.log('parseMarkdown called with content length:', content.length);
    console.log('marked available:', typeof marked !== 'undefined');
    console.log('hljs available:', typeof hljs !== 'undefined');
    
    // 使用 marked 库解析 Markdown
    if (typeof marked !== 'undefined') {
      // 配置 marked 解析器
      marked.setOptions({
        gfm: true,       // 启用 GitHub 风格（表格/任务列表等）
        breaks: true,    // 换行符转 <br>
        headerIds: true, // 为标题生成 id
        mangle: false,   // 防止标题 id 被转义乱码
        highlight: function (code, lang) {
          // 如果 highlight.js 可用，进行代码高亮
          if (typeof hljs !== 'undefined') {
            try {
              if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
              }
              return hljs.highlightAuto(code).value;
            } catch (e) {
              console.warn('Highlight.js error:', e);
              return code;
            }
          }
          return code;
        }
      });

      const html = marked.parse(content);
      console.log('Generated HTML length:', html.length);
      console.log('Generated HTML preview:', html.substring(0, 200) + '...');

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
            padding: 20px;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
            font-size: 16px;
            line-height: 1.5;
            word-wrap: break-word;
          }
          
          .markdown-body table {
            border-spacing: 0;
            border-collapse: collapse;
            display: block;
            width: max-content;
            max-width: 100%;
            overflow: auto;
            margin-top: 0;
            margin-bottom: 16px;
          }
          
          .markdown-body table th,
          .markdown-body table td {
            padding: 6px 13px;
            border: 1px solid #d0d7de;
          }
          
          .markdown-body table th {
            font-weight: 600;
            background-color: #f6f8fa;
          }
          
          .markdown-body table tr {
            background-color: #ffffff;
            border-top: 1px solid #c6cbd1;
          }
          
          .markdown-body table tr:nth-child(2n) {
            background-color: #f6f8fa;
          }
          
          .markdown-body pre {
            padding: 16px;
            overflow: auto;
            font-size: 85%;
            line-height: 1.45;
            background-color: #f6f8fa;
            border-radius: 6px;
            margin-top: 0;
            margin-bottom: 16px;
          }
          
          .markdown-body code {
            padding: 0.2em 0.4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(175,184,193,0.2);
            border-radius: 6px;
            font-family: ui-monospace,SFMono-Regular,"SF Mono",Consolas,"Liberation Mono",Menlo,monospace;
          }
          
          .markdown-body pre code {
            display: inline;
            max-width: auto;
            padding: 0;
            margin: 0;
            overflow: visible;
            line-height: inherit;
            word-wrap: normal;
            background-color: transparent;
            border: 0;
          }
          
          .markdown-body hr {
            height: 0.25em;
            padding: 0;
            margin: 24px 0;
            background-color: #d0d7de;
            border: 0;
          }
          
          .markdown-body ol,
          .markdown-body ul {
            padding-left: 2em;
            margin-top: 0;
            margin-bottom: 16px;
          }
          
          .markdown-body blockquote {
            padding: 0 1em;
            color: #656d76;
            border-left: 0.25em solid #d0d7de;
            margin-top: 0;
            margin-bottom: 16px;
          }
          
          .markdown-body h1,
          .markdown-body h2,
          .markdown-body h3,
          .markdown-body h4,
          .markdown-body h5,
          .markdown-body h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
          }
          
          .markdown-body h1 {
            font-size: 2em;
            border-bottom: 1px solid #d0d7de;
            padding-bottom: 0.3em;
          }
          
          .markdown-body h2 {
            font-size: 1.5em;
            border-bottom: 1px solid #d0d7de;
            padding-bottom: 0.3em;
          }
        </style>
        
        <div class="markdown-body">
          ${html}
        </div>
      `;
    } else {
      // 降级到简单解析器
      let html = content
        // 标题
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        // 粗体
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        // 斜体
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        // 代码块
        .replace(/```([\s\S]*?)```/gim, '<pre><code>$1</code></pre>')
        // 行内代码
        .replace(/`(.*?)`/gim, '<code>$1</code>')
        // 链接
        .replace(/\[([^\]]+)\]\(([^\)]+)\)/gim, '<a href="$2" target="_blank">$1</a>')
        // 无序列表
        .replace(/^\* (.*$)/gim, '<li>$1</li>')
        .replace(/^- (.*$)/gim, '<li>$1</li>')
        // 有序列表
        .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
        // 换行
        .replace(/\n/gim, '<br>');
      
      // 包装列表项
      html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
      
      // 添加样式
      return `
        <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: var(--text-color);">
          ${html}
        </div>
      `;
    }
  }

  // 加载Word文件
  async loadWordFile(filePath) {
    try {
      // 读取文件为ArrayBuffer
      const fileBuffer = await window.fsAPI.readFileBuffer(filePath);
      
      // 检查docx-preview是否可用
      console.log('检查docx对象:', typeof window.docx, window.docx);
      if (typeof window.docx !== 'undefined' && window.docx.renderAsync) {
        // 创建一个临时容器来渲染Word文档
        const tempContainer = document.createElement('div');
        tempContainer.style.padding = '20px';
        tempContainer.style.backgroundColor = 'white';
        tempContainer.style.color = 'black';
        tempContainer.style.fontFamily = 'Times New Roman, serif';
        tempContainer.style.lineHeight = '1.6';
        tempContainer.style.maxWidth = '100%';
        tempContainer.style.wordWrap = 'break-word';
        
        try {
          // 确保fileBuffer是Uint8Array格式
          const uint8Array = new Uint8Array(fileBuffer);
          
          // 使用docx-preview渲染
          await window.docx.renderAsync(uint8Array, tempContainer, null, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: false,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            useMathMLPolyfill: false,
            showChanges: false,
            debug: false
          });
          
          return {
            content: tempContainer.outerHTML,
            rawBuffer: uint8Array,
            isEditable: true
          };
        } catch (renderError) {
          console.error('docx渲染失败:', renderError);
          return {
            content: `<div style="padding: 20px; color: #e74c3c;">
              <h3>Word文档渲染失败</h3>
              <p>错误信息: ${renderError.message}</p>
              <p>文件路径: ${filePath}</p>
              <p>请确保这是一个有效的.docx文件</p>
            </div>`,
            rawBuffer: null,
            isEditable: false
          };
        }
      } else {
        return {
          content: `<div style="padding: 20px; color: #f39c12;">
            <h3>Word文件查看功能不可用</h3>
            <p>docx-preview库未正确加载</p>
            <p>文件路径: ${filePath}</p>
            <p>请检查库文件是否正确引入</p>
          </div>`,
          rawBuffer: null,
          isEditable: false
        };
      }
    } catch (error) {
      console.error('加载Word文件失败:', error);
      return {
        content: `<div style="padding: 20px; color: #e74c3c;">
          <h3>加载Word文件失败</h3>
          <p>错误信息: ${error.message}</p>
          <p>文件路径: ${filePath}</p>
        </div>`,
        rawBuffer: null,
        isEditable: false
      };
    }
  }

  // 创建文本编辑器
  createTextEditor(tabId, content, fileType) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 为TXT和JSON文件添加特殊类名
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

    // 键盘快捷键已在全局处理，这里不需要重复添加

    contentElement.appendChild(textarea);
  }

  // 创建HTML查看器
  createHtmlViewer(tabId, content) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 清空容器并移除padding
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    
    // 创建查看器
    const viewer = document.createElement('div');
    viewer.className = 'html-viewer';
    
    // 创建iframe来隔离HTML内容，防止影响主应用布局
    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.background = 'var(--bg-color)';
    
    // 设置iframe内容
    iframe.onload = () => {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      
      // 检查当前是否为深色模式
      const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
      
      // 为HTML内容添加深色模式样式
      const styledContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'} !important;
              color: ${isDarkMode ? '#d4d4d4' : '#000000'} !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              margin: 0;
              padding: 20px;
              line-height: 1.6;
              overflow-y: auto;
              height: 100vh;
              box-sizing: border-box;
            }
            /* 自定义滚动条样式 */
            body::-webkit-scrollbar {
              width: 3px;
            }
            body::-webkit-scrollbar-track {
              background: ${isDarkMode ? '#2d2d2d' : '#f1f1f1'};
            }
            body::-webkit-scrollbar-thumb {
              background: ${isDarkMode ? '#555' : '#888'};
              border-radius: 1.5px;
            }
            body::-webkit-scrollbar-thumb:hover {
              background: ${isDarkMode ? '#777' : '#555'};
            }
            * {
              background-color: transparent !important;
              color: ${isDarkMode ? '#d4d4d4' : '#000000'} !important;
            }
            h1, h2, h3, h4, h5, h6 {
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
            }
            a {
              color: ${isDarkMode ? '#4fc3f7' : '#0066cc'} !important;
            }
            pre, code {
              background-color: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'} !important;
              color: ${isDarkMode ? '#d4d4d4' : '#000000'} !important;
              padding: 4px 8px;
              border-radius: 4px;
            }
            table {
              border-collapse: collapse;
              border: 1px solid ${isDarkMode ? '#404040' : '#cccccc'} !important;
            }
            th, td {
              border: 1px solid ${isDarkMode ? '#404040' : '#cccccc'} !important;
              padding: 8px 12px;
              background-color: ${isDarkMode ? '#1e1e1e' : '#ffffff'} !important;
            }
            th {
              background-color: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'} !important;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
        </html>
      `;
      
      doc.write(styledContent);
      doc.close();
    };
    
    viewer.appendChild(iframe);
    contentElement.appendChild(viewer);
  }

  // 创建Word查看器
  createWordViewer(tabId, content) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 为DOCX文件添加特殊类名
    contentElement.classList.add('docx-content');

    // 清空容器并移除padding和margin
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    contentElement.style.margin = '0';

    const viewer = document.createElement('div');
    viewer.className = 'word-viewer';
    viewer.innerHTML = content;

    contentElement.appendChild(viewer);
  }

  // 创建Docx编辑器
  createDocxEditor(tabId, wordData, filePath) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 为Docx内容添加特殊类名
    contentElement.classList.add('docx-content');

    // 创建简化的预览布局
    contentElement.innerHTML = `
      <div class="docx-preview-full" id="docx-preview-full-${tabId}">
        <div class="docx-preview" id="docx-preview-${tabId}"></div>
      </div>
    `;

    // 获取预览元素
    const preview = document.getElementById(`docx-preview-${tabId}`);

    // 存储数据到tabStates
    this.tabStates.set(tabId, {
      filePath: filePath,
      wordData: wordData,
      isDirty: false,
      isEditMode: false,
      preview: preview,
      originalContent: ''
    });

    // 初始渲染预览
    if (wordData && wordData.content) {
      preview.innerHTML = wordData.content;
    }
  }

  // 从docx预览中提取文本内容
  extractTextFromDocx(previewElement) {
    const textContent = previewElement.textContent || previewElement.innerText || '';
    return textContent.trim();
  }

  // 创建Markdown编辑器
  createMarkdownEditor(tabId, content, filePath) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;
    
    // 为Markdown内容添加特殊类名
    contentElement.classList.add('markdown-content');

    // 创建分屏布局
    contentElement.innerHTML = `
      <div class="markdown-editor-container" id="container-${tabId}">
        <div class="markdown-editor-pane" id="editor-pane-${tabId}">
          <textarea class="markdown-editor" id="editor-${tabId}" spellcheck="false">${content}</textarea>
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

  // 更新Markdown预览
  updateMarkdownPreview(tabId, content) {
    const preview = document.getElementById(`preview-${tabId}`);
    if (!preview) return;

    const html = this.parseMarkdown(content);
    preview.innerHTML = html;
  }

  // 绑定Markdown编辑器事件
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

    // 添加拖拽调整大小功能
    this.initResizeHandle(tabId);
  }

  // 初始化拖拽调整大小功能
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

  // 重置自动保存计时器
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

  // 保存Markdown文件
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
      alert(`保存文件失败: ${error.message}`);
    }
  }

  // 保存Docx文件
  async saveDocxFile(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (!tabState || !tabState.textEditor || !tabState.filePath) return;

    try {
      const textContent = tabState.textEditor.value;
      
      // 注意：这里是简化的保存方式，只保存文本内容
      // 实际的docx文件保存需要更复杂的处理来保持格式
      // 这里我们创建一个简单的文本文件作为备份
      const backupPath = tabState.filePath.replace('.docx', '_backup.txt');
      await window.fsAPI.writeFile(backupPath, textContent);
      
      // 更新状态
      tabState.originalContent = textContent;
      tabState.isDirty = false;
      
      // 更新tab标题
      this.updateTabTitle(tabId);
      
      // 禁用保存按钮
      const saveBtn = document.getElementById(`docx-save-btn-${tabId}`);
      if (saveBtn) {
        saveBtn.disabled = true;
      }
      
      // 显示保存成功提示
      const status = document.getElementById(`docx-status-${tabId}`);
      if (status) {
        const originalText = status.textContent;
        status.textContent = '已保存';
        status.style.color = '#28a745';
        setTimeout(() => {
          status.textContent = originalText;
          status.style.color = '';
        }, 2000);
      }
      
      console.log('Docx文件内容已保存为文本备份:', backupPath);
      alert(`文档内容已保存为文本备份：${backupPath}\n\n注意：由于docx格式的复杂性，当前版本只能保存文本内容。`);
    } catch (error) {
      console.error('保存Docx文件失败:', error);
      alert('保存文件失败: ' + error.message);
    }
  }

  // 更新标签标题
  updateTabTitle(tabId) {
    const tab = this.tabManager.tabs.get(tabId);
    if (!tab) return;

    const fileName = tab.fileName || 'Untitled';
    this.tabManager.updateTabTitle(tabId, fileName);
  }

  // 创建错误视图
  createErrorView(tabId, message) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;

    contentElement.appendChild(errorDiv);
  }



  // 保存当前文件
  async saveCurrentFile() {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) return;

    const activeTabId = this.tabManager.activeTabId;
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (!contentElement) return;

    const displayMode = contentElement.dataset.displayMode;
    const isEditable = contentElement.dataset.isEditable === 'true';
    if (!isEditable) return;

    try {
      if (displayMode === 'markdown') {
        await this.saveMarkdownFile(activeTabId);
      } else if (displayMode === 'docx') {
        await this.saveDocxFile(activeTabId);
      } else if (displayMode === 'text') {
        // 处理普通文本文件
        const textarea = contentElement.querySelector('.txt-editor');
        if (textarea && activeTab.filePath) {
          await window.fsAPI.writeFile(activeTab.filePath, textarea.value);
          // 移除修改标记
          this.tabManager.markTabAsClean(activeTabId);
          console.log('文件已保存');
        }
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      alert('保存文件失败: ' + error.message);
    }
  }

  // 标记标签页为已修改
  markTabAsDirty(tabId) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;
    
    const isEditable = contentElement.dataset.isEditable === 'true';
    if (!isEditable) return;
    
    this.tabManager.markTabAsDirty(tabId);
  }

   // 初始化键盘快捷键（保存文件快捷键）
   initKeyboardShortcuts() {
     document.addEventListener('keydown', (e) => {
       // Ctrl+S 保存文件
       if (e.ctrlKey && e.key === 's') {
         e.preventDefault();
         this.saveCurrentFile();
       }
     });
   }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileViewer;
} else {
  window.FileViewer = FileViewer;
}