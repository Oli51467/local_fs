/**
 * 文件查看器模块
 * 支持多tab显示，txt和word文件查看编辑
 */

class FileViewer {
  constructor(container) {
    this.container = container;
    this.tabs = new Map(); // 存储打开的文件tab
    this.activeTabId = null;
    this.init();
  }

  init() {
    // 创建tab容器和内容容器
    this.container.innerHTML = `
      <div class="file-viewer">
        <div class="tabs-container" id="tabs-container" style="display: none;">
          <div class="tab-list" id="tab-list"></div>
        </div>
        <div class="content-container" id="content-container">
          <div class="welcome-message">
            <p>选择一个文件开始查看...</p>
          </div>
        </div>
      </div>
    `;

    this.tabList = document.getElementById('tab-list');
    this.contentContainer = document.getElementById('content-container');
     
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

      .tabs-container {
        border-bottom: 2px solid var(--tree-border);
        background: var(--tree-bg);
        min-height: 35px;
      }



      .tab-list {
        display: flex;
        overflow-x: auto;
        scrollbar-width: thin;
      }

      .tab-item {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          border-right: 1px solid var(--tree-border);
          cursor: pointer;
          background: var(--bg-color);
          color: var(--text-color);
          font-size: 13px;
          white-space: nowrap;
          min-width: 120px;
          max-width: 200px;
          position: relative;
          border-bottom: 2px solid transparent;
        }

        .tab-item:first-child {
          margin-left: 0;
        }

      .tab-item:hover {
        background: var(--tree-hover);
      }

      .tab-item.active {
        background: var(--bg-color);
        border-bottom: 2px solid #007acc;
      }

      .tab-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 8px;
      }

      .tab-close {
        width: 16px;
        height: 16px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        opacity: 0.7;
        margin-left: 8px;
        padding: 2px 6px;
        font-weight: bold;
        color: var(--text-color);
        cursor: pointer;
        transition: all 0.2s;
      }

      .tab-close:hover {
        background: rgba(128, 128, 128, 0.3);
        opacity: 1;
      }

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
        padding: 10px;
        box-sizing: border-box;
      }

      .html-viewer {
        width: 100%;
        height: 100%;
        overflow: auto;
        background: var(--bg-color);
        color: var(--text-color);
      }

      .word-viewer {
        width: 100%;
        height: 100%;
        overflow: auto;
        padding: 20px;
        background: white;
        color: black;
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
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
    `;
    document.head.appendChild(style);
  }

  // 打开文件
  async openFile(filePath) {
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop();
    const fileExt = fileName.split('.').pop().toLowerCase();
    const tabId = filePath;

    // 如果文件已经打开，直接切换到该tab
    if (this.tabs.has(tabId)) {
      this.switchTab(tabId);
      return;
    }

    // 创建新tab
    this.createTab(tabId, fileName);
    
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
           content = await this.loadMarkdownFile(filePath);
           this.createHtmlViewer(tabId, content);
           displayMode = 'html';
           isEditable = false;
           break;
        case 'docx':
        case 'doc':
          content = await this.loadWordFile(filePath);
          this.createWordViewer(tabId, content);
          displayMode = 'html';
          isEditable = false;
          break;
        default:
          this.createErrorView(tabId, `不支持的文件类型: ${fileExt}`);
      }
      
      // 存储显示模式信息
      const tab = this.tabs.get(tabId);
      if (tab) {
        tab.displayMode = displayMode;
        tab.isEditable = isEditable;
      }
    } catch (error) {
      console.error('加载文件失败:', error);
      this.createErrorView(tabId, `加载文件失败: ${error.message}`);
    }

    this.switchTab(tabId);
  }

  // 创建tab
  createTab(tabId, fileName) {
    // 显示标签页容器
    const tabsContainer = document.getElementById('tabs-container');
    if (tabsContainer) {
      tabsContainer.style.display = 'flex';
    }
    
    const tabElement = document.createElement('div');
    tabElement.className = 'tab-item';
    tabElement.dataset.tabId = tabId;
    
    const tabTitle = document.createElement('span');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = fileName;
    tabTitle.title = fileName;
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });
    
    tabElement.appendChild(tabTitle);
    tabElement.appendChild(closeBtn);

    // 点击tab切换
    tabElement.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTab(tabId);
      }
    });

    this.tabList.appendChild(tabElement);
    
    // 创建内容容器
    const contentElement = document.createElement('div');
    contentElement.className = 'file-content';
    contentElement.dataset.tabId = tabId;
    this.contentContainer.appendChild(contentElement);

    // 存储tab信息
    this.tabs.set(tabId, {
      element: tabElement,
      contentElement: contentElement,
      fileName: fileName,
      filePath: tabId
    });

    // 隐藏欢迎消息
    const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }
  }

  // 切换tab
  switchTab(tabId) {
    // 取消所有tab的激活状态
    this.tabs.forEach((tab, id) => {
      tab.element.classList.remove('active');
      tab.contentElement.classList.remove('active');
    });

    // 激活指定tab
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.element.classList.add('active');
      tab.contentElement.classList.add('active');
      this.activeTabId = tabId;
      
      // 根据显示模式更新内容区域
      const fileContent = tab.contentElement.querySelector('.txt-editor');
      const fileDisplay = tab.contentElement.querySelector('.word-viewer, .error-message');
      
      if (tab.displayMode === 'html') {
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
          fileContent.disabled = !tab.isEditable;
        }
      }
    }
  }

  // 关闭tab
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // 移除DOM元素
    tab.element.remove();
    tab.contentElement.remove();
    
    // 从tabs中删除
    this.tabs.delete(tabId);

    // 如果关闭的是当前激活的tab，切换到其他tab
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        this.activeTabId = null;
        // 隐藏标签页容器
        const tabsContainer = document.getElementById('tabs-container');
        if (tabsContainer) {
          tabsContainer.style.display = 'none';
        }
        // 显示欢迎消息
        const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
          welcomeMessage.style.display = 'flex';
        }
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
      if (typeof docx !== 'undefined') {
        // 创建一个临时容器来渲染Word文档
        const tempContainer = document.createElement('div');
        tempContainer.style.padding = '20px';
        tempContainer.style.backgroundColor = 'white';
        tempContainer.style.color = 'black';
        tempContainer.style.fontFamily = 'Times New Roman, serif';
        tempContainer.style.lineHeight = '1.6';
        
        try {
          // 使用docx-preview渲染
          await docx.renderAsync(fileBuffer, tempContainer, null, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            useMathMLPolyfill: false,
            showChanges: false,
            debug: false
          });
          return tempContainer.outerHTML;
        } catch (renderError) {
          console.error('docx渲染失败:', renderError);
          return `<div style="padding: 20px; color: #e74c3c;">
            <h3>Word文档渲染失败</h3>
            <p>错误信息: ${renderError.message}</p>
            <p>文件路径: ${filePath}</p>
            <p>请确保这是一个有效的.docx文件</p>
          </div>`;
        }
      } else {
        return `<div style="padding: 20px; color: #f39c12;">
          <h3>Word文件查看功能不可用</h3>
          <p>docx-preview库未正确加载</p>
          <p>文件路径: ${filePath}</p>
          <p>请检查库文件是否正确引入</p>
        </div>`;
      }
    } catch (error) {
      console.error('加载Word文件失败:', error);
      return `<div style="padding: 20px; color: #e74c3c;">
        <h3>加载Word文件失败</h3>
        <p>错误信息: ${error.message}</p>
        <p>文件路径: ${filePath}</p>
      </div>`;
    }
  }

  // 创建文本编辑器
  createTextEditor(tabId, content, fileType) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

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

    tab.contentElement.appendChild(textarea);
  }

  // 创建HTML查看器
  createHtmlViewer(tabId, content) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // 清空容器
    tab.contentElement.innerHTML = '';
    
    // 创建查看器
    const viewer = document.createElement('div');
    viewer.className = 'html-viewer';
    viewer.innerHTML = content;

    tab.contentElement.appendChild(viewer);
  }

  // 创建Word查看器
  createWordViewer(tabId, content) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const viewer = document.createElement('div');
    viewer.className = 'word-viewer';
    viewer.innerHTML = content;

    tab.contentElement.appendChild(viewer);
  }

  // 创建错误视图
  createErrorView(tabId, message) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;

    tab.contentElement.appendChild(errorDiv);
  }



  // 保存当前文件
  async saveCurrentFile() {
    const activeTab = this.getActiveTab();
    if (!activeTab || !activeTab.isEditable) return;

    const textarea = activeTab.contentElement.querySelector('.txt-editor');
    if (!textarea) return;

    try {
      await window.fsAPI.writeFile(activeTab.filePath, textarea.value);
      // 移除修改标记
      const tabTitle = activeTab.element.querySelector('.tab-title');
      if (tabTitle.textContent.endsWith(' *')) {
        tabTitle.textContent = activeTab.fileName;
      }
      console.log('文件已保存');
    } catch (error) {
      console.error('保存文件失败:', error);
    }
  }

  // 获取当前激活的tab
  getActiveTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
  }

  // 关闭所有标签页
  closeAllTabs() {
    const tabIds = Array.from(this.tabs.keys());
    tabIds.forEach(tabId => {
      this.closeTab(tabId);
    });
  }

  // 标记标签页为已修改
   markTabAsDirty(tabId) {
     const tab = this.tabs.get(tabId);
     if (!tab || !tab.isEditable) return;
     
     const tabTitle = tab.element.querySelector('.tab-title');
     if (tabTitle && !tabTitle.textContent.endsWith(' *')) {
       tabTitle.textContent += ' *';
     }

   }

   // 初始化键盘快捷键
   initKeyboardShortcuts() {
     document.addEventListener('keydown', (e) => {
       // Ctrl+S 保存文件
       if (e.ctrlKey && e.key === 's') {
         e.preventDefault();
         this.saveCurrentFile();
       }
       
       // Ctrl+W 关闭当前标签
       if (e.ctrlKey && e.key === 'w') {
         e.preventDefault();
         if (this.activeTabId) {
           this.closeTab(this.activeTabId);
         }
       }
       
       // Ctrl+Shift+W 关闭所有标签
       if (e.ctrlKey && e.shiftKey && e.key === 'W') {
         e.preventDefault();
         this.closeAllTabs();
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