/**
 * PDF文件查看器模块
 * 专门处理 .pdf 文件的查看功能
 */
class PdfViewer {
  constructor(contentContainer, tabManager) {
    this.contentContainer = contentContainer;
    this.tabManager = tabManager;
    this.addStyles();
  }

  // 添加PDF查看器样式
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* PDF文件特殊样式 - 移除padding确保完全占据宽度 */
      .file-content.pdf-content {
        padding: 0;
        overflow: hidden;
      }
      
      .file-content.pdf-content.active {
        display: flex;
        flex-direction: column;
      }
      
      /* PDF查看器样式 */
      .pdf-viewer-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: var(--bg-color);
      }
      
      .pdf-scroll-viewer {
        flex: 1;
        overflow-y: auto;
        overflow-x: auto;
        background: transparent;
        padding: 0;
        display: flex;
        justify-content: center;
      }
      
      .pdf-pages-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        max-width: 100%;
      }
      
      .pdf-page-container {
        position: relative;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        border-radius: 4px;
        background: white;
        margin-bottom: 20px;
        width: fit-content;
      }
      
      .pdf-page-container canvas {
        display: block;
        width: 100%;
        height: auto;
      }
      
      .pdf-text-layer {
        position: absolute;
        left: 0;
        top: 0;
        right: 0;
        bottom: 0;
        overflow: hidden;
        opacity: 0.2;
        line-height: 1.0;
        pointer-events: auto;
      }
      
      .pdf-text-layer > span {
        color: transparent;
        position: absolute;
        white-space: pre;
        cursor: text;
        transform-origin: 0% 0%;
      }
      
      .pdf-text-layer .highlight {
        margin: -1px;
        padding: 1px;
        background-color: rgba(180, 0, 170, 0.2);
        border-radius: 4px;
      }
      
      .pdf-text-layer .highlight.begin {
        border-radius: 4px 0px 0px 4px;
      }
      
      .pdf-text-layer .highlight.end {
        border-radius: 0px 4px 4px 0px;
      }
      
      .pdf-text-layer .highlight.middle {
        border-radius: 0px;
      }
      
      .pdf-text-layer .highlight.selected {
        background-color: rgba(0, 100, 0, 0.2);
      }
      
      /* PDF滚动查看器滚动条样式 */
      .pdf-scroll-viewer::-webkit-scrollbar {
        width: 2px;
        height: 2px;
      }
      
      .pdf-scroll-viewer::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .pdf-scroll-viewer::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .pdf-scroll-viewer::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }
    `;
    document.head.appendChild(style);
  }

  // 检查是否为支持的PDF文件类型
  isSupportedFile(fileExt) {
    return fileExt === 'pdf';
  }

  // 加载PDF文件
  async loadPdfFile(filePath) {
    try {
      // 读取文件为ArrayBuffer
      const fileBuffer = await window.fsAPI.readFileBuffer(filePath);
      
      // 返回ArrayBuffer供PDF.js使用
      return {
        buffer: fileBuffer,
        filePath: filePath
      };
    } catch (error) {
      console.error('加载PDF文件失败:', error);
      throw new Error(`加载PDF文件失败: ${error.message}`);
    }
  }

  // 动态加载PDF.js库
  async loadPdfJsLibrary() {
    return new Promise((resolve, reject) => {
      if (typeof window.pdfjsLib !== 'undefined') {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = './static/libs/pdf.js';
      script.onload = () => {
        // PDF.js加载完成后，pdfjsLib会被添加到window对象
        if (typeof window.pdfjsLib !== 'undefined') {
          resolve();
        } else {
          reject(new Error('PDF.js库加载失败'));
        }
      };
      script.onerror = () => {
        reject(new Error('无法加载PDF.js库'));
      };
      document.head.appendChild(script);
    });
  }

  // 创建PDF查看器
  async createPdfViewer(tabId, pdfData, filePath) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return null;

    // 为PDF文件添加特殊类名
    contentElement.classList.add('pdf-content');

    // 清空容器并移除padding和margin
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    contentElement.style.margin = '0';

    // 创建PDF查看器容器
    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'pdf-viewer-container';
    pdfContainer.innerHTML = `
      <div class="pdf-scroll-viewer" id="pdf-scroll-viewer-${tabId}">
        <div class="pdf-pages-container" id="pdf-pages-${tabId}"></div>
      </div>
    `;

    contentElement.appendChild(pdfContainer);

    // 初始化PDF.js并渲染PDF，返回pdfState
    return await this.initializePdfViewer(tabId, pdfData);
  }

  // 初始化PDF查看器
  async initializePdfViewer(tabId, pdfData) {
    try {
      // 确保PDF.js库已加载
      if (typeof window.pdfjsLib === 'undefined') {
        await this.loadPdfJsLibrary();
      }
      
      const pdfjsLib = window.pdfjsLib;
      
      // 设置worker路径
      const workerPath = await window.fsAPI.getPdfWorkerPath();
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

      // 加载PDF文档
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfData.buffer) }).promise;
      
      const pagesContainerEl = document.getElementById(`pdf-pages-${tabId}`);
      const scrollViewerEl = document.getElementById(`pdf-scroll-viewer-${tabId}`);

      let initialScale = 1.0;
      let baseViewportWidth = 0;

      try {
        const firstPage = await pdfDoc.getPage(1);
        const defaultViewport = firstPage.getViewport({ scale: 1 });
        baseViewportWidth = defaultViewport.width;
        const containerWidth = this.getPdfAvailableWidth(scrollViewerEl, pagesContainerEl);
        if (containerWidth > 0 && baseViewportWidth > 0) {
          const fittedScale = containerWidth / baseViewportWidth;
          initialScale = Math.max(0.85, Math.min(fittedScale, 1.2));
        }
      } catch (fitError) {
        console.warn('PDF自动适配宽度失败，使用默认缩放', fitError);
      }

      // 存储PDF文档和状态
      const pdfState = {
        pdfDoc: pdfDoc,
        scale: initialScale,
        baseViewportWidth,
        pagesContainer: pagesContainerEl,
        scrollViewer: scrollViewerEl,
        canvases: new Map(), // 存储所有canvas以便内存管理
        textLayers: new Map() // 存储所有文本层
      };

      // 渲染所有页面
      await this.renderAllPdfPages(tabId, pdfState);

      // 绑定缩放和滚动事件
      this.bindPdfScrollEvents(tabId, pdfState);

      // 返回PDF状态供外部存储
      return pdfState;

    } catch (error) {
      console.error('初始化PDF查看器失败:', error);
      const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
      if (contentElement) {
        contentElement.innerHTML = `
          <div class="error-message">
            <h3>PDF文件加载失败</h3>
            <p>错误信息: ${error.message}</p>
            <p>请确保这是一个有效的PDF文件</p>
          </div>
        `;
      }
      throw error;
    }
  }

  // 渲染所有PDF页面
  async renderAllPdfPages(tabId, pdfState) {
    try {
      const { pdfDoc, pagesContainer } = pdfState;
      
      // 清空容器
      pagesContainer.innerHTML = '';
      
      // 清理之前的canvas和文本层
      this.cleanupPdfCanvases(pdfState);
      
      // 渲染每一页
      for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        await this.renderSinglePdfPage(tabId, pdfState, pageNum);
      }
      
    } catch (error) {
      console.error('渲染PDF页面失败:', error);
    }
  }

  // 渲染单个PDF页面
  async renderSinglePdfPage(tabId, pdfState, pageNum) {
    try {
      const page = await pdfState.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: pdfState.scale });
      
      // 创建页面容器
      const pageContainer = document.createElement('div');
      pageContainer.className = 'pdf-page-container';
      pageContainer.style.marginBottom = '20px';
      
      // 创建canvas
      const canvas = document.createElement('canvas');
      canvas.id = `pdf-canvas-${tabId}-${pageNum}`;
      
      // 提高分辨率 - 使用设备像素比
      const devicePixelRatio = window.devicePixelRatio || 1;
      const scaledViewport = page.getViewport({ scale: pdfState.scale * devicePixelRatio });
      
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      
      // 创建文本层
      const textLayer = document.createElement('div');
      textLayer.className = 'pdf-text-layer';
      textLayer.id = `pdf-text-layer-${tabId}-${pageNum}`;
      textLayer.style.width = viewport.width + 'px';
      textLayer.style.height = viewport.height + 'px';
      textLayer.style.position = 'absolute';
      textLayer.style.left = '0';
      textLayer.style.top = '0';
      
      // 设置页面容器样式
      pageContainer.style.position = 'relative';
      pageContainer.style.width = 'fit-content';
      pageContainer.style.marginBottom = '20px';
      
      pageContainer.appendChild(canvas);
      pageContainer.appendChild(textLayer);
      pdfState.pagesContainer.appendChild(pageContainer);
      
      // 渲染PDF页面到canvas
      const ctx = canvas.getContext('2d');
      ctx.scale(devicePixelRatio, devicePixelRatio);
      
      await page.render({ 
        canvasContext: ctx, 
        viewport: viewport
      }).promise;
      
      // 渲染文本层
      const textContent = await page.getTextContent();
      const pdfjsLib = window.pdfjsLib;
      if (pdfjsLib.renderTextLayer) {
        pdfjsLib.renderTextLayer({
          textContent,
          container: textLayer,
          viewport,
          textDivs: []
        });
      }
      
      // 存储canvas和文本层引用
      pdfState.canvases.set(pageNum, canvas);
      pdfState.textLayers.set(pageNum, textLayer);
      
    } catch (error) {
      console.error(`渲染PDF第${pageNum}页失败:`, error);
    }
  }

  // 清理PDF canvas以防止内存泄露
  cleanupPdfCanvases(pdfState) {
    // 清理canvas
    pdfState.canvases.forEach((canvas) => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
    });
    pdfState.canvases.clear();
    
    // 清理文本层
    pdfState.textLayers.forEach((textLayer) => {
      textLayer.innerHTML = '';
    });
    pdfState.textLayers.clear();
  }

  // 绑定PDF滚动和缩放事件
  bindPdfScrollEvents(tabId, pdfState) {
    const scrollViewer = pdfState.scrollViewer;
    
    // 防抖函数
    const debounce = (func, wait) => {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    };
    
    // Command+滚轮缩放事件
    const handleZoom = debounce(async (event) => {
      if (event.metaKey || event.ctrlKey) { // Command键(Mac)或Ctrl键(Windows)
        event.preventDefault();
        
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.max(0.5, Math.min(pdfState.scale * zoomFactor, 5.0));
        
        if (newScale !== pdfState.scale) {
          pdfState.scale = newScale;
          await this.renderAllPdfPages(tabId, pdfState);
        }
      }
    }, 30);
    
    // 绑定滚轮事件
    scrollViewer.addEventListener('wheel', handleZoom, { passive: false });
    
    // 存储事件处理器以便后续清理
    if (!pdfState.eventHandlers) {
      pdfState.eventHandlers = [];
    }
    pdfState.eventHandlers.push({
      element: scrollViewer,
      event: 'wheel',
      handler: handleZoom
    });
  }

  getPdfAvailableWidth(scrollViewer, pagesContainer) {
    const target = scrollViewer || pagesContainer || this.contentContainer;
    if (!target) {
      return 0;
    }
    const width = target.clientWidth || target.offsetWidth || 0;
    if (width <= 0 && target.parentElement) {
      return target.parentElement.clientWidth || 0;
    }
    const marginAllowance = 32;
    return Math.max(0, width - marginAllowance);
  }
  
  // 清理PDF事件监听器
  cleanupPdfEvents(pdfState) {
    if (pdfState.eventHandlers) {
      pdfState.eventHandlers.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
      });
      pdfState.eventHandlers = [];
    }
  }

  // 打开PDF文件的主入口方法
  async openPdfFile(filePath, tabId, fileName) {
    try {
      // 显示加载状态
      const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
      if (contentElement) {
        contentElement.innerHTML = `
          <div class="loading-message">
            <p>正在加载PDF文件...</p>
          </div>
        `;
      }

      // 加载PDF文件数据
      const pdfData = await this.loadPdfFile(filePath);
      
      // 创建PDF查看器
      const pdfState = await this.createPdfViewer(tabId, pdfData, filePath);
      
      return pdfState;
    } catch (error) {
      console.error('打开PDF文件失败:', error);
      const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
      if (contentElement) {
        contentElement.innerHTML = `
          <div class="error-message">
            <h3>PDF文件打开失败</h3>
            <p>错误信息: ${error.message}</p>
            <p>请确保这是一个有效的PDF文件</p>
          </div>
        `;
      }
      throw error;
    }
  }

  // 清理PDF相关资源
  cleanup(tabId, pdfState) {
    if (pdfState) {
      // 清理事件监听器
      this.cleanupPdfEvents(pdfState);
      
      // 清理canvas和文本层
      this.cleanupPdfCanvases(pdfState);
      
      // 清理PDF文档
      if (pdfState.pdfDoc) {
        pdfState.pdfDoc.destroy();
      }
    }
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PdfViewer;
} else {
  window.PdfViewer = PdfViewer;
}
