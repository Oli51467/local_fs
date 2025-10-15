/**
 * 文件查看器模块
 * 支持多tab显示，txt和word文件查看编辑
 */

// 在浏览器环境中，这些类通过script标签加载，直接使用全局变量
// const TextViewer = require('./textViewer');
// const WordViewer = require('./wordViewer');
// const MarkdownViewer = require('./markdownViewer');
// const HtmlViewer = require('./htmlViewer');
// const PdfViewer = require('./pdfViewer');

class FileViewer {
  constructor(container) {
    this.container = container;
    this.contentContainer = null;
    this.tabManager = null;
    this.textViewer = null; // 文本查看器实例
    this.wordViewer = null; // Word查看器实例
    this.markdownViewer = null; // Markdown查看器实例
    this.htmlViewer = null; // HTML查看器实例
    this.pdfViewer = null; // PDF查看器实例
    this.pptViewer = null; // PPT查看器实例
    this.excelViewer = null; // Excel查看器实例
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
            <p>请选择一个文件打开</p>
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
 
     // 初始化文本查看器
     this.textViewer = new TextViewer(this.contentContainer, this.tabManager);
 
     // 初始化Word查看器
     this.wordViewer = new WordViewer();
 
     // 初始化Markdown查看器
     this.markdownViewer = new MarkdownViewer();
     this.markdownViewer.setCallbacks({
       onMarkTabAsDirty: (tabId) => this.markTabAsDirty(tabId),
       onUpdateTabTitle: (tabId) => this.updateTabTitle(tabId)
     });
 
     // 初始化HTML查看器
     this.htmlViewer = new HtmlViewer();
     HtmlViewer.addStyles();
 
     // 初始化PDF查看器
     this.pdfViewer = new PdfViewer(this.contentContainer, this.tabManager);

     // 初始化Excel查看器
     this.excelViewer = new ExcelViewer(this.contentContainer, this.tabManager);
 
     // 初始化键盘快捷键
    this.initKeyboardShortcuts();

    // 添加点击事件监听器，当点击内容区域时清除文件树选中状态
    this.addContentClickHandler();

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
        padding: 0;
        box-sizing: border-box;
        overflow-y: hidden;
        overflow-x: hidden;
        flex: 1;
      }

      .file-content.active {
        display: flex;
        flex-direction: column;
      }
      
      /* 文件类型特殊样式已移至各自的viewer模块 */
      
      /* PDF文件特殊样式已移至PdfViewer模块 */
      
      /* HTML文件特殊样式已移至HtmlViewer模块 */
      
      /* PPTX文件特殊样式已移至PptViewer模块 */

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
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
        display: none;
        scrollbar-width: thin;
        scrollbar-color: rgba(71, 85, 105, 0.85) transparent;
      }

      .file-content-display.active {
        display: block;
      }

      .file-content-display::-webkit-scrollbar {
        width: 6px;
      }

      .file-content-display::-webkit-scrollbar-track {
        background: transparent;
      }

      .file-content-display::-webkit-scrollbar-thumb {
        background-color: rgba(71, 85, 105, 0.85);
        border-radius: 999px;
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

      .image-file-viewer {
        flex: 1;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color);
        overflow-y: auto;
        overflow-x: hidden;
        cursor: zoom-in;
        scrollbar-width: thin;
        scrollbar-color: rgba(71, 85, 105, 0.85) transparent;
      }

      .image-file-viewer::-webkit-scrollbar {
        width: 6px;
      }

      .image-file-viewer::-webkit-scrollbar-track {
        background: transparent;
      }

      .image-file-viewer::-webkit-scrollbar-thumb {
        background-color: rgba(71, 85, 105, 0.85);
        border-radius: 999px;
      }

      .image-file-viewer img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        border-radius: 12px;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.25);
        background: #0f172a;
      }

      /* 文本编辑器样式已移至TextViewer模块 */



      /* Word查看器样式已移至WordViewer模块 */

      .error-message {
        padding: 0;
        color: inherit;
        text-align: center;
      }

      .loading-message {
        padding: 20px;
        text-align: center;
        color: var(--text-color);
      }
      
      /* Markdown编辑器样式已移至MarkdownViewer模块 */
      
      /* DOCX编辑器样式已移至WordViewer模块 */

      /* PPTX查看器样式已移至PptViewer模块 */
 
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
      let handled = false;

      const hasIsImageFile = window.fsAPI && typeof window.fsAPI.isImageFile === 'function';
      const isImageFile = hasIsImageFile
        ? await window.fsAPI.isImageFile(filePath)
        : this.isImageExtension(fileExt);

      if (isImageFile) {
        this.createImageView(tabId, filePath, fileName);
        displayMode = 'image';
        isEditable = false;
        handled = true;
      }

      if (!handled) {
        switch (fileExt) {
        case 'txt':
          // 使用TextViewer处理txt文件
          const result = await this.textViewer.openTextFile(filePath, tabId, fileName);
          displayMode = result.displayMode;
          isEditable = result.isEditable;
          break;
        case 'json':
        case 'js':
        case 'css':
          // 使用TextViewer处理这些文本文件
          const textResult = await this.textViewer.openTextFile(filePath, tabId, fileName);
          displayMode = textResult.displayMode;
          isEditable = textResult.isEditable;
          break;
        case 'html':
        case 'htm':
          // 使用HtmlViewer处理HTML文件
          const htmlContentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
          const htmlResult = await this.htmlViewer.openHtmlFile(filePath, tabId, fileName, htmlContentElement);
          displayMode = htmlResult.displayMode;
          isEditable = htmlResult.isEditable;
          break;
         case 'md':
         case 'markdown':
           // 使用MarkdownViewer处理Markdown文件
           content = await window.fsAPI.readFile(filePath);
           const markdownContentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
           this.markdownViewer.createMarkdownEditor(tabId, content, filePath, markdownContentElement);
           displayMode = 'markdown';
           isEditable = true;
           break;
        case 'docx':
          content = await this.wordViewer.loadWordFile(filePath);
          const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
          if (content && content.isEditable) {
            this.wordViewer.createDocxEditor(tabId, content, filePath, contentElement);
            displayMode = 'docx';
            isEditable = true;
          } else {
            this.wordViewer.createWordViewer(tabId, content.content || content, contentElement);
            displayMode = 'html';
            isEditable = false;
          }
          break;
        case 'doc':
          content = await this.wordViewer.loadWordFile(filePath);
          const docContentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
          this.wordViewer.createWordViewer(tabId, content.content || content, docContentElement);
          displayMode = 'html';
          isEditable = false;
          break;
        case 'pdf':
          // 使用PdfViewer处理PDF文件
          const pdfState = await this.pdfViewer.openPdfFile(filePath, tabId, fileName);
          // 存储PDF状态到tabStates
          this.tabStates.set(tabId, {
            ...this.tabStates.get(tabId),
            pdfState: pdfState
          });
          displayMode = 'pdf';
          isEditable = false;
          break;
        case 'pptx':
        case 'ppt':
          // 使用PptViewer处理PPT文件
          if (!this.pptViewer) {
            this.pptViewer = new window.PptViewer(this.contentContainer, this.tabStates);
          }
          const pptContentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
          await this.pptViewer.openPptxFile(filePath, tabId, fileName, pptContentElement);
          displayMode = 'pptx';
          isEditable = false;
          break;
        case 'xlsx':
        case 'xls':
          // 使用ExcelViewer处理Excel文件
          await this.excelViewer.openExcelFile(filePath, tabId, fileName);
          displayMode = 'excel';
          isEditable = true;
          break;
        default:
          this.createErrorView(tabId, '不支持的文件类型');
          displayMode = 'error';
          isEditable = false;
          handled = true;
      }
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
    // 隐藏欢迎消息
    const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }

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
      const textEditors = contentElement.querySelectorAll('.txt-editor');
      const viewerSelectors = '.word-viewer, .error-message, .html-viewer, .pdf-viewer-container, .pptx-viewer, .pptx-content, .docx-preview, .docx-preview-full, .docx-content, .image-file-viewer';
      const viewerElements = contentElement.querySelectorAll(viewerSelectors);

      const showText = displayMode === 'text' || displayMode === 'markdown';

      textEditors.forEach((editor) => {
        editor.style.display = showText ? 'block' : 'none';
        editor.disabled = !showText || !isEditable;
      });

      viewerElements.forEach((viewer) => {
        viewer.style.display = showText ? 'none' : '';
      });
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

      // 如果是txt文件，清理TextViewer资源
      if (contentElement.classList.contains('txt-content')) {
        this.textViewer.cleanup(tabId);
      }

      // 如果是Word文件，清理WordViewer资源
      if (contentElement.classList.contains('docx-content')) {
        this.wordViewer.cleanupTab(tabId);
      }

      // 如果是Markdown文件，清理MarkdownViewer资源
      if (contentElement.classList.contains('markdown-content')) {
        this.markdownViewer.cleanupTab(tabId);
      }

      // 如果是HTML文件，清理HtmlViewer资源
      if (contentElement.classList.contains('html-content')) {
        this.htmlViewer.cleanupTab(tabId);
      }

      // 如果是PDF文件，清理PdfViewer资源
      if (contentElement.classList.contains('pdf-content')) {
        const tabState = this.tabStates.get(tabId);
        if (tabState && tabState.pdfState) {
          this.pdfViewer.cleanup(tabId, tabState.pdfState);
        }
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
      
      // PDF相关资源已在上面清理
      
      this.tabStates.delete(tabId);
    }

    // 如果没有剩余标签页，显示欢迎消息
    // 注意：此时标签页还未从TabManager中删除，所以需要检查是否只剩1个标签页
    if (this.tabManager.getTabCount() === 1) {
      const welcomeMessage = this.contentContainer.querySelector('.welcome-message');
      if (welcomeMessage) {
        welcomeMessage.style.display = 'flex';
      }
    }
  }

  isImageExtension(fileExt) {
    const supported = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'svg'];
    return supported.includes((fileExt || '').toLowerCase());
  }

  toFileUrl(filePath) {
    if (!filePath) {
      return '';
    }
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.startsWith('file://')) {
      return encodeURI(normalized);
    }
    if (normalized.startsWith('/')) {
      return encodeURI(`file://${normalized}`);
    }
    return encodeURI(`file:///${normalized}`);
  }

  ensureImageViewer() {
    if (window.__globalImageViewer) {
      return window.__globalImageViewer;
    }
    if (!this.imageViewerInstance && window.ImageViewer) {
      try {
        this.imageViewerInstance = new window.ImageViewer();
        window.__globalImageViewer = this.imageViewerInstance;
      } catch (error) {
        console.error('初始化图片查看器失败:', error);
      }
    }
    return this.imageViewerInstance;
  }

  createImageView(tabId, filePath, fileName) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) {
      return;
    }

    contentElement.classList.add('image-content');
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    contentElement.style.margin = '0';

    const viewer = document.createElement('div');
    viewer.className = 'image-file-viewer';

    const img = document.createElement('img');
    const fileUrl = this.toFileUrl(filePath);
    const altText = fileName || '图片预览';
    if (fileUrl) {
      img.src = fileUrl;
    }
    img.alt = altText;

    viewer.appendChild(img);
    viewer.addEventListener('click', (event) => {
      event.stopPropagation();
      const viewerInstance = this.ensureImageViewer();
      if (viewerInstance && typeof viewerInstance.show === 'function') {
        viewerInstance.show(fileUrl, altText);
      }
    });

    contentElement.appendChild(viewer);
    contentElement.dataset.displayMode = 'image';
    contentElement.dataset.isEditable = 'false';
  }

  // loadTextFile方法已移至TextViewer模块

  // 加载HTML文件

  
  // loadMarkdownFile方法已移至MarkdownViewer模块


  // 加载Word文件
  // loadWordFile方法已移至WordViewer模块

  // 加载PDF文件
  // loadPdfFile方法已移至PdfViewer模块

  // loadPptxFile方法已移至PptViewer模块

  // loadPdfJsLibrary方法已移至PdfViewer模块

  // createTextEditor方法已移至TextViewer模块



  // createWordViewer方法已移至WordViewer模块

  // createPdfViewer方法已移至PdfViewer模块

  // initializePdfViewer方法已移至PdfViewer模块

  // renderAllPdfPages方法已移至PdfViewer模块

  // renderSinglePdfPage方法已移至PdfViewer模块

  // cleanupPdfCanvases方法已移至PdfViewer模块

  // bindPdfScrollEvents方法已移至PdfViewer模块
  
  // cleanupPdfEvents方法已移至PdfViewer模块

  // createDocxEditor方法已移至WordViewer模块

  // extractTextFromDocx方法已移至WordViewer模块

  // createMarkdownEditor方法已移至MarkdownViewer模块



  // 保存Docx文件
  // saveDocxFile方法已移至WordViewer模块

  // 更新标签标题
  updateTabTitle(tabId) {
    const tab = this.tabManager.tabs.get(tabId);
    if (!tab) return;

    const fileName = tab.fileName || 'Untitled';
    // 对于Markdown文件，检查是否已保存并更新标签状态
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (contentElement && contentElement.classList.contains('markdown-content')) {
      const tabState = this.markdownViewer.getTabState(tabId);
      if (tabState && !tabState.isDirty) {
        this.tabManager.markTabAsClean(tabId);
      }
    }
    this.tabManager.updateTabTitle(tabId, fileName);
  }

  // createPptxViewer方法已移至PptViewer模块

  // renderPptxWithPreview方法已移至PptViewer模块



  // 初始化PPTX缩放控制


  // HTML转义
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 创建错误视图
  createErrorView(tabId, message) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'center';
    wrapper.style.boxSizing = 'border-box';

    const inner = document.createElement('div');
    inner.style.maxWidth = '360px';
    inner.style.textAlign = 'center';
    inner.style.padding = '18px 24px';
    inner.style.color = '#1f2937';
    inner.style.background = '#ffffff';
    inner.style.borderRadius = '12px';
    inner.style.boxShadow = '0 18px 36px rgba(15, 23, 42, 0.12)';

    const title = document.createElement('div');
    title.textContent = message || '不支持的文件类型';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.marginBottom = '8px';

    const hint = document.createElement('div');
    hint.textContent = '该文件暂不支持在线预览，请在其他应用中打开或转换为受支持的格式。';
    hint.style.fontSize = '13px';
    hint.style.lineHeight = '1.6';
    hint.style.color = '#6b7280';

    inner.appendChild(title);
    inner.appendChild(hint);
    wrapper.appendChild(inner);
    contentElement.appendChild(wrapper);
  }



  // 保存当前文件
  async saveCurrentFile() {
    const activeTab = this.tabManager.getActiveTab();
    if (!activeTab) {
      return;
    }

    const activeTabId = this.tabManager.activeTabId;
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (!contentElement) {
      return;
    }

    const displayMode = contentElement.dataset.displayMode;
    const isEditable = contentElement.dataset.isEditable === 'true';
    if (!isEditable) return;

    try {
      if (displayMode === 'markdown') {
        await this.markdownViewer.saveMarkdownFile(activeTabId);
      } else if (displayMode === 'docx') {
        await this.wordViewer.saveDocxFile(activeTabId);
      } else if (displayMode === 'text') {
        // 检查是否为txt文件，使用TextViewer处理
        if (contentElement.classList.contains('txt-content')) {
          const content = this.textViewer.getTextContent(activeTabId);
          if (content !== null && activeTab.filePath) {
            await window.fsAPI.writeFile(activeTab.filePath, content);
            // 移除修改标记
            this.tabManager.markTabAsClean(activeTabId);

          }
        } else {
          // 处理其他文本文件（json, js, css等）
          const textarea = contentElement.querySelector('.txt-editor');
          if (textarea && activeTab.filePath) {
            await window.fsAPI.writeFile(activeTab.filePath, textarea.value);
            // 移除修改标记
            this.tabManager.markTabAsClean(activeTabId);

          }
        }
      } else if (displayMode === 'excel') {
        await this.excelViewer.saveExcel(activeTabId);
        // ExcelViewer内部会清理脏标记
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      showAlert('保存文件失败: ' + error.message, 'error');
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

  // 根据文件路径关闭标签页（用于文件删除时同步关闭tab）
  closeTabByFilePath(filePath) {
    return this.tabManager.closeTabByFilePath(filePath);
  }

  // 添加点击事件监听器，当点击内容区域时清除文件树选中状态
  addContentClickHandler() {
    // 监听内容容器的点击事件
    this.contentContainer.addEventListener('click', (e) => {
      // 清除文件树的选中状态
      if (window.explorerModule) {
        window.explorerModule.setSelectedItemPath(null);
      }
      // 清除全局选中路径变量
      if (typeof window.selectedItemPath !== 'undefined') {
        window.selectedItemPath = null;
      }
      // 移除所有文件项的选中样式
      document.querySelectorAll('.file-item.selected').forEach(el => {
        el.classList.remove('selected');
      });
    });
  }

  // 初始化键盘快捷键（保存文件快捷键）
   initKeyboardShortcuts() {
     document.addEventListener('keydown', (e) => {
       // Ctrl+S (Windows/Linux) 或 Command+S (Mac) 保存文件
       if ((e.ctrlKey || e.metaKey) && e.key === 's') {
         e.preventDefault();
         e.stopPropagation();
         this.saveCurrentFile();
         return false;
       }
     }, true); // 使用捕获阶段，确保优先处理
   }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileViewer;
} else {
  window.FileViewer = FileViewer;
}
