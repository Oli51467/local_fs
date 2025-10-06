const pptDynamicScriptCache = new Map();

const loadPptExternalScript = (url) => {
  if (!url) {
    return Promise.reject(new Error('无法加载空白脚本路径'));
  }

  if (pptDynamicScriptCache.get(url) === 'loaded') {
    return Promise.resolve();
  }

  const cached = pptDynamicScriptCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = () => {
      pptDynamicScriptCache.set(url, 'loaded');
      resolve();
    };
    script.onerror = () => {
      pptDynamicScriptCache.delete(url);
      reject(new Error(`无法加载脚本: ${url}`));
    };
    document.head.appendChild(script);
  });

  pptDynamicScriptCache.set(url, promise);
  return promise;
};

/**
 * PPT文件查看器模块
 * 专门处理 .pptx 和 .ppt 文件的查看功能
 */
class PptViewer {
  constructor(contentContainer, tabManager) {
    this.contentContainer = contentContainer;
    this.tabManager = tabManager;
    this.addStyles();
  }

  // 添加PPT查看器样式
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* PPTX文件特殊样式 - 移除padding确保完全占据宽度 */
      .file-content.pptx-content {
        padding: 0;
        overflow: visible;
      }
      
      .file-content.pptx-content.active {
        display: flex;
        flex-direction: column;
      }

      /* PPTX查看器样式 */
      .pptx-viewer {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: transparent;
      }

      .pptx-content {
        flex: 1;
        overflow: hidden;
        padding: 10px;
        background: transparent;
        text-align: center;
        padding-left: 0;
      }

      .pptx-loading,
      .pptx-error {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 200px;
        font-size: 16px;
        color: #666;
        text-align: center;
      }

      .pptx-error {
        color: #d32f2f;
      }

      /* pptx-preview库生成的幻灯片样式优化 */
      .pptx-content .ppt-slide {
        margin: 20px auto;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        border-radius: 8px;
        overflow: hidden;
        background: white;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .pptx-content .ppt-slide:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      }

      /* 确保幻灯片内容正确显示且居中 */
      .pptx-content svg {
        max-width: 100%;
        height: auto;
        display: block;
        margin: 0 auto;
      }

      /* 确保pptx-preview生成的内容正确显示 */
      .pptx-content > div {
        display: inline-block;
        text-align: left;
      }

      /* PPTX容器样式 - 自定义垂直滚动条为1px粗度 */
      .pptx-container {
        overflow-x: hidden;
        overflow-y: auto;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        position: relative;
      }
      
      /* PPTX容器滚动条样式 - 针对所有可能的滚动元素 */
       .pptx-container::-webkit-scrollbar,
       .pptx-container *::-webkit-scrollbar,
       .pptx-container div::-webkit-scrollbar,
       .pptx-container .pptx-slide::-webkit-scrollbar,
       .pptx-container .slide-container::-webkit-scrollbar {
         width: 1px !important;
         height: 1px !important;
       }
       
       .pptx-container::-webkit-scrollbar-track,
       .pptx-container *::-webkit-scrollbar-track,
       .pptx-container div::-webkit-scrollbar-track,
       .pptx-container .pptx-slide::-webkit-scrollbar-track,
       .pptx-container .slide-container::-webkit-scrollbar-track {
         background: var(--tree-bg, #2d2d30) !important;
       }
       
       .pptx-container::-webkit-scrollbar-thumb,
       .pptx-container *::-webkit-scrollbar-thumb,
       .pptx-container div::-webkit-scrollbar-thumb,
       .pptx-container .pptx-slide::-webkit-scrollbar-thumb,
       .pptx-container .slide-container::-webkit-scrollbar-thumb {
         background: var(--tree-border, #464647) !important;
         border-radius: 3px !important;
       }
       
       .pptx-container::-webkit-scrollbar-thumb:hover,
       .pptx-container *::-webkit-scrollbar-thumb:hover,
       .pptx-container div::-webkit-scrollbar-thumb:hover,
       .pptx-container .pptx-slide::-webkit-scrollbar-thumb:hover,
       .pptx-container .slide-container::-webkit-scrollbar-thumb:hover {
          background: var(--accent-color, #007acc) !important;
        }
        
        /* 全局PPTX滚动条样式 - 最高优先级 */
        [class*="pptx"]::-webkit-scrollbar,
        [id*="pptx"]::-webkit-scrollbar {
          width: 2px !important;
          height: 2px !important;
        }
        
        [class*="pptx"]::-webkit-scrollbar-track,
        [id*="pptx"]::-webkit-scrollbar-track {
          background: var(--tree-bg, #2d2d30) !important;
        }
        
        [class*="pptx"]::-webkit-scrollbar-thumb,
        [id*="pptx"]::-webkit-scrollbar-thumb {
          background: var(--tree-border, #464647) !important;
          border-radius: 3px !important;
        }
        
        [class*="pptx"]::-webkit-scrollbar-thumb:hover,
        [id*="pptx"]::-webkit-scrollbar-thumb:hover {
          background: var(--accent-color, #007acc) !important;
        }
    `;
    document.head.appendChild(style);
  }

  // 检查是否支持该文件类型
  isSupportedFile(fileExt) {
    const supportedExts = ['.pptx', '.ppt'];
    return supportedExts.includes(fileExt.toLowerCase());
  }

  // 加载PPTX文件
  async loadPptxFile(filePath) {
    try {
      // 使用预加载脚本中的API读取PPTX文件
      const result = await window.fsAPI.readPptxFile(filePath);
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      return {
        buffer: result.buffer,
        fileName: result.fileName,
        filePath: filePath
      };
    } catch (error) {
      console.error('加载PPTX文件失败:', error);
      throw new Error(`加载PPTX文件失败: ${error.message}`);
    }
  }

  // 创建PPTX查看器
  async createPptxViewer(tabId, content, filePath) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    try {
      // 创建PPTX查看器容器
      const pptxContainer = document.createElement('div');
      pptxContainer.className = 'pptx-viewer pptx-container';
      pptxContainer.innerHTML = `
        <div class="pptx-content" id="pptx-content-${tabId}">
          <div class="pptx-loading">正在解析PPTX文件，请稍候...</div>
        </div>
      `;
      
      contentElement.appendChild(pptxContainer);
      
      // 使用pptx-preview库解析并渲染PPTX内容
      await this.renderPptxWithPreview(tabId, content.buffer, content.fileName);
      
    } catch (error) {
      console.error('创建PPTX查看器失败:', error);
      this.createErrorView(tabId, `创建PPTX查看器失败: ${error.message}`);
    }
  }

  // 使用pptx-preview库渲染PPTX内容
  async renderPptxWithPreview(tabId, buffer, fileName) {
    try {
      if (!window.pptxPreview) {
        let pptxUrl = './static/libs/pptx-preview.umd.js';
        if (window.fsAPI && typeof window.fsAPI.getPptxLibPath === 'function') {
          try {
            const resolved = await window.fsAPI.getPptxLibPath();
            if (resolved) {
              pptxUrl = resolved;
            }
          } catch (error) {
            console.warn('获取pptx-preview路径失败，使用默认路径:', error);
          }
        }
        await loadPptExternalScript(pptxUrl);
      }

      // 检查pptx-preview全局变量
      if (!window.pptxPreview) {
        throw new Error('pptx-preview库未正确加载');
      }
      
      const contentDiv = document.getElementById(`pptx-content-${tabId}`);
      if (!contentDiv) {
        throw new Error('找不到PPTX内容容器');
      }
      
      // 清空加载提示
      contentDiv.innerHTML = '';
      
      // 使用pptx-preview解析并渲染PPTX
      // 获取容器的实际尺寸
      const containerRect = contentDiv.getBoundingClientRect();
      const containerWidth = containerRect.width || contentDiv.offsetWidth || window.innerWidth - 100;
      const containerHeight = containerRect.height || contentDiv.offsetHeight || window.innerHeight - 200;
      
      // 使用init方法创建预览器实例，让内容自适应容器
      const previewer = window.pptxPreview.init(contentDiv, {
        width: containerWidth,  // 使用完整容器宽度
        height: containerHeight,  // 使用完整容器高度
        slidesScale: "fit",  // 自适应缩放确保内容完全适配
        backgroundColor: "#fff"
      });
      
      // 调用preview方法渲染PPTX内容
      await previewer.preview(buffer);
      
      // 返回状态信息
      return {
        fileName: fileName,
        currentZoom: 1.0,
        isLoaded: true,
        previewer: previewer
      };
      
    } catch (error) {
      console.error('渲染PPTX内容失败:', error);
      const contentDiv = document.getElementById(`pptx-content-${tabId}`);
      if (contentDiv) {
        contentDiv.innerHTML = `<div class="pptx-error">渲染PPTX文件失败: ${error.message}<br/>请确保文件格式正确且未损坏。</div>`;
      }
      throw error;
    }
  }

  // 打开PPTX文件
  async openPptxFile(filePath, tabId, fileName) {
    try {
      // 加载PPTX文件
      const content = await this.loadPptxFile(filePath);
      
      // 创建PPTX查看器
      await this.createPptxViewer(tabId, content, filePath);
      
      // 返回状态信息
      return await this.renderPptxWithPreview(tabId, content.buffer, content.fileName);
      
    } catch (error) {
      console.error('打开PPTX文件失败:', error);
      this.createErrorView(tabId, `打开PPTX文件失败: ${error.message}`);
      throw error;
    }
  }

  // 创建错误视图
  createErrorView(tabId, message) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.style.cssText = `
      display: flex;
      justify-content: center;
      align-items: center;
      height: 200px;
      color: #d32f2f;
      font-size: 16px;
      text-align: center;
      padding: 20px;
    `;
    errorDiv.textContent = message;

    contentElement.appendChild(errorDiv);
  }

  // 清理资源
  cleanup(tabId) {
    // 清理PPTX相关的DOM元素
    const contentDiv = document.getElementById(`pptx-content-${tabId}`);
    if (contentDiv) {
      contentDiv.innerHTML = '';
    }
  }
}

// 模块导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PptViewer;
} else {
  window.PptViewer = PptViewer;
}
