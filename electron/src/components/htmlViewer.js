/**
 * HTML查看器模块
 * 负责HTML文件的显示和渲染
 */

class HtmlViewer {
  constructor() {
    this.tabStates = new Map(); // 存储每个tab的状态
  }

  /**
   * 打开HTML文件
   * @param {string} filePath - 文件路径
   * @param {string} tabId - 标签页ID
   * @param {string} fileName - 文件名
   * @param {HTMLElement} contentElement - 内容容器元素
   * @returns {Object} 返回显示模式和可编辑状态
   */
  async openHtmlFile(filePath, tabId, fileName, contentElement) {
    try {
      // 加载HTML文件内容
      const content = await this.loadHtmlFile(filePath);
      
      // 创建HTML查看器
      this.createHtmlViewer(tabId, content, contentElement);
      
      // 存储tab状态
      this.tabStates.set(tabId, {
        filePath: filePath,
        fileName: fileName,
        content: content,
        isDirty: false
      });
      
      return {
        displayMode: 'html',
        isEditable: false
      };
    } catch (error) {
      console.error('打开HTML文件失败:', error);
      this.createErrorView(tabId, contentElement, `打开HTML文件失败: ${error.message}`);
      return {
        displayMode: 'html',
        isEditable: false
      };
    }
  }

  /**
   * 加载HTML文件内容
   * @param {string} filePath - 文件路径
   * @returns {string} HTML内容
   */
  async loadHtmlFile(filePath) {
    try {
      const content = await window.fsAPI.readFile(filePath);
      return content;
    } catch (error) {
      console.error('加载HTML文件失败:', error);
      return `<p>加载HTML文件失败: ${error.message}</p>`;
    }
  }

  /**
   * 创建HTML查看器
   * @param {string} tabId - 标签页ID
   * @param {string} content - HTML内容
   * @param {HTMLElement} contentElement - 内容容器元素
   */
  createHtmlViewer(tabId, content, contentElement) {
    if (!contentElement) return;

    // 为HTML文件添加特殊类名
    contentElement.classList.add('html-content');

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
      const isDarkMode = document.body.classList.contains('dark-mode');
      
      // 为HTML内容添加深色模式样式
      const styledContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              background-color: ${isDarkMode ? 'var(--tree-bg)' : '#ffffff'} !important;
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
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
              background: ${isDarkMode ? 'var(--tree-bg)' : '#f1f1f1'};
            }
            body::-webkit-scrollbar-thumb {
              background: ${isDarkMode ? '#404040' : '#888'};
              border-radius: 1.5px;
            }
            body::-webkit-scrollbar-thumb:hover {
              background: ${isDarkMode ? '#606060' : '#555'};
            }
            * {
              background-color: transparent !important;
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
            }
            h1, h2, h3, h4, h5, h6 {
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
            }
            a {
              color: ${isDarkMode ? '#4fc3f7' : '#0066cc'} !important;
            }
            pre, code {
              background-color: ${isDarkMode ? '#1a1a1a' : '#f8f8f8'} !important;
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
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
              background-color: ${isDarkMode ? '#000000' : '#ffffff'} !important;
              color: ${isDarkMode ? '#ffffff' : '#000000'} !important;
            }
            th {
              background-color: ${isDarkMode ? '#1a1a1a' : '#f8f8f8'} !important;
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

  /**
   * 创建错误视图
   * @param {string} tabId - 标签页ID
   * @param {HTMLElement} contentElement - 内容容器元素
   * @param {string} message - 错误消息
   */
  createErrorView(tabId, contentElement, message) {
    if (!contentElement) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-color);
        text-align: center;
        padding: 20px;
      ">
        <h3 style="margin-bottom: 10px; color: #ff6b6b;">HTML文件加载失败</h3>
        <p style="margin: 0; opacity: 0.8;">${message}</p>
      </div>
    `;

    contentElement.appendChild(errorDiv);
  }

  /**
   * 获取tab状态
   * @param {string} tabId - 标签页ID
   * @returns {Object|null} tab状态对象
   */
  getTabState(tabId) {
    return this.tabStates.get(tabId) || null;
  }

  /**
   * 检查tab是否已修改
   * @param {string} tabId - 标签页ID
   * @returns {boolean} 是否已修改
   */
  isTabDirty(tabId) {
    const tabState = this.tabStates.get(tabId);
    return tabState ? tabState.isDirty : false;
  }

  /**
   * 清理tab资源
   * @param {string} tabId - 标签页ID
   */
  cleanupTab(tabId) {
    // 清理tab状态
    this.tabStates.delete(tabId);
  }

  /**
   * 添加HTML查看器样式
   */
  static addStyles() {
    const styleId = 'html-viewer-styles';
    if (document.getElementById(styleId)) {
      return; // 样式已存在
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
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

      .html-content {
        height: 100%;
        overflow: hidden;
      }

      .error-message {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-color);
        background: var(--bg-color);
      }
    `;
    
    document.head.appendChild(style);
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = HtmlViewer;
} else {
  window.HtmlViewer = HtmlViewer;
}