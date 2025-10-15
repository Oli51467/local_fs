/**
 * Excel文件查看器模块
 * 使用 Luckysheet 展示与编辑 .xlsx / .xls
 */
class ExcelViewer {
  constructor(contentContainer, tabManager) {
    this.contentContainer = contentContainer;
    this.tabManager = tabManager;
    this.addStyles();
    this.loadedAssets = false;
    this.instances = new Map(); // tabId -> { filePath, sheetName, luckysheetContainerId }
    this.loadingObserver = null;
  }

  // 生成安全的DOM元素ID（去除路径中的特殊字符）
  sanitizeId(input) {
    return String(input || '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .replace(/^_+/, '')
      .slice(0, 128);
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Excel/Luckysheet 区域样式 */
      .file-content.excel-content {
        padding: 0;
        overflow: hidden;
        margin: 0; /* 消除左侧margin */
      }
      .excel-viewer-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: var(--bg-color);
        margin: 0; /* 消除左侧margin */
      }
      .excel-sheet-container {
        position: relative;
        flex: 1;
        width: 100%;
        height: 100%;
        margin: 0; /* 消除左侧margin */
      }
      
      /* 隐藏Luckysheet标题栏 */
      .luckysheet-info-detail-title {
        display: none !important;
      }
      
      /* 优化空白区域显示 - 显示完整表格网格 */
      .luckysheet-cell-main {
        background: #fff !important;
      }
      .luckysheet-scrollbar-x, .luckysheet-scrollbar-y {
        background: #f5f5f5 !important;
      }
      /* 确保表格网格线在空白区域也显示 */
      .luckysheet-grid-container {
        background: #fff !important;
      }
      .luckysheet-cell {
        border-right: 1px solid #d0d4da !important;
        border-bottom: 1px solid #d0d4da !important;
      }
      
      /* 确保单元格内容完整显示 */
      .luckysheet-cell-main .luckysheet-cell {
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
      }
      
      /* 单元格文本完整显示 */
      .luckysheet-cell-main .luckysheet-cell-text {
        white-space: nowrap !important;
        overflow: visible !important;
        text-overflow: clip !important;
        width: auto !important;
        max-width: none !important;
      }
      
      /* 确保输入框也能完整显示内容 */
      .luckysheet-cell-input {
        white-space: nowrap !important;
        overflow: visible !important;
      }
      
      /* 隐藏底部的添加行按钮和回到顶部按钮 */
      .luckysheet-bottom-add-row,
      .luckysheet-bottom-controll-row,
      .luckysheet-bottom-add-row-btn,
      .luckysheet-go-top,
      .luckysheet-go-top-btn,
      .luckysheet-bottom-add-row-area {
        display: none !important;
      }
      
      /* 自定义统计栏，只显示缩放功能，隐藏其他统计信息 */
      .luckysheet-stat-area .luckysheet-stat-count,
      .luckysheet-stat-area .luckysheet-stat-sum,
      .luckysheet-stat-area .luckysheet-stat-average,
      .luckysheet-stat-area .luckysheet-stat-max,
      .luckysheet-stat-area .luckysheet-stat-min {
        display: none !important;
      }
      
      /* 确保底部区域显示为空白单元格而不是灰色 */
      .luckysheet-grid-container,
      .luckysheet-cell-main {
        background-color: #ffffff !important;
      }
      
      /* 确保空白区域也显示网格线 */
      .luckysheet-grid-container canvas {
        background-color: #ffffff !important;
      }
      
      /* 修复底部空白区域显示 */
      .luckysheet-grid-container .luckysheet-canvas-main,
      .luckysheet-grid-container .luckysheet-canvas-main canvas {
        background-color: #ffffff !important;
      }
      
      .luckysheet-scrollbar-x,
      .luckysheet-scrollbar-y {
        background-color: #f8f9fa !important;
      }
    `;
    document.head.appendChild(style);
  }

  ensureLoadingObserver() {
    if (this.loadingObserver || typeof MutationObserver === 'undefined' || !document || !document.body) {
      return;
    }
    try {
      this.loadingObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement || (typeof DocumentFragment !== 'undefined' && node instanceof DocumentFragment)) {
              this.removeLuckysheetLoading(node);
            }
          });
        }
      });
      this.loadingObserver.observe(document.body, { childList: true, subtree: true });
      this.scheduleLoadingCleanup();
    } catch (error) {
      console.warn('无法监听Luckysheet加载遮罩:', error);
      this.loadingObserver = null;
    }
  }

  scheduleLoadingCleanup() {
    const delays = [0, 50, 150, 300, 600];
    delays.forEach((delay) => setTimeout(() => this.removeLuckysheetLoading(), delay));
  }

  removeLuckysheetLoading(target = (document && document.body ? document.body : null)) {
    if (!target) {
      return;
    }
    const selectors = [
      '.luckysheet-modal-dialog-mask',
      '.luckysheet-modal-loading',
      '.luckysheet-sheettable-loading',
      '#luckysheet-sheettable-loading',
      '.luckysheet-loading-img',
      '.luckysheet-loading-text'
    ];

    const shouldCull = (el) => {
      if (!(el instanceof HTMLElement)) {
        return false;
      }
      if (selectors.some((selector) => el.matches(selector))) {
        return true;
      }
      const classString = `${el.className || ''}`.toLowerCase();
      if (classString.includes('luckysheet') && classString.includes('loading')) {
        return true;
      }
      const text = (el.textContent || '').trim();
      if (text && text.includes('渲染中') && classString.includes('luckysheet')) {
        return true;
      }
      return false;
    };

    const purge = (root) => {
      if (!root) {
        return;
      }
      if (shouldCull(root)) {
        root.remove();
        return;
      }
      if (typeof DocumentFragment !== 'undefined' && root instanceof DocumentFragment) {
        Array.from(root.childNodes).forEach((child) => purge(child));
        return;
      }
      if (root instanceof HTMLElement) {
        selectors.forEach((selector) => root.querySelectorAll(selector).forEach((match) => match.remove()));
        root.querySelectorAll('[class*="luckysheet"][class*="loading"]').forEach((match) => match.remove());
        root.querySelectorAll('div').forEach((div) => {
          if (shouldCull(div)) {
            div.remove();
          }
        });
      }
    };

    if (typeof DocumentFragment !== 'undefined' && target instanceof DocumentFragment) {
      purge(target);
    } else if (target instanceof HTMLElement) {
      purge(target);
    } else if (document && document.body) {
      purge(document.body);
    }
  }

  normalizeCellStyle(style) {
    if (!style || typeof style !== 'object') {
      return null;
    }
    const normalized = { ...style };
    if (normalized.ul != null && normalized.un == null) {
      normalized.un = normalized.ul;
    }
    delete normalized.ul;
    if (typeof normalized.fc === 'string') {
      normalized.fc = normalized.fc.toLowerCase();
    }
    if (typeof normalized.bg === 'string') {
      normalized.bg = normalized.bg.toLowerCase();
    }
    return normalized;
  }

  applyCellStyle(cell, style) {
    if (!cell || !style) {
      return;
    }
    const styleKeys = ['fc', 'bg', 'bl', 'it', 'fs', 'ff', 'cl', 'un', 'ht', 'vt', 'tb', 'tr', 'rt', 'qp'];
    styleKeys.forEach((key) => {
      if (style[key] !== undefined) {
        cell[key] = style[key];
      }
    });
    cell.s = { ...style };
  }

  createCellFromBackend(cell) {
    if (!cell || typeof cell !== 'object') {
      return null;
    }
    const luckyCell = {};
    if (cell.v !== undefined) {
      luckyCell.v = cell.v;
    }
    const type = typeof cell.t === 'string' ? cell.t.toLowerCase() : null;
    let ctType = 'g';
    if (type === 's') {
      ctType = 's';
    } else if (type === 'n') {
      ctType = 'n';
    } else if (type === 'b') {
      ctType = 'b';
    } else if (type === 'd') {
      ctType = 'd';
    }
    luckyCell.ct = { fa: 'General', t: ctType };
    if (ctType === 's' && cell.v != null) {
      luckyCell.m = String(cell.v);
    }
    let normalizedStyle = this.normalizeCellStyle(cell.s);
    if (!normalizedStyle) {
      const inlineStyle = {};
      ['fc', 'bg', 'bl', 'it', 'fs', 'ff', 'cl', 'un', 'ul', 'ht', 'vt', 'tb', 'tr', 'rt', 'qp'].forEach((key) => {
        if (cell[key] !== undefined) {
          inlineStyle[key] = cell[key];
        }
      });
      normalizedStyle = this.normalizeCellStyle(inlineStyle);
    }
    this.applyCellStyle(luckyCell, normalizedStyle);
    return luckyCell;
  }

  createCellFromValue(value) {
    if (value == null) {
      return null;
    }
    const luckyCell = { v: value };
    let ctType = 'g';
    if (typeof value === 'number') {
      ctType = 'n';
    } else if (typeof value === 'boolean') {
      ctType = 'b';
    } else {
      ctType = 's';
      luckyCell.m = String(value);
    }
    luckyCell.ct = { fa: 'General', t: ctType };
    return luckyCell;
  }

  buildCellMatrix(sheet) {
    const matrix = [];
    let maxCols = 0;
    if (sheet && Array.isArray(sheet.cellData) && sheet.cellData.length > 0) {
      sheet.cellData.forEach((row, rowIndex) => {
        if (!row) {
          return;
        }
        const rowArr = matrix[rowIndex] || [];
        Object.keys(row).forEach((colIndexStr) => {
          const colIndex = Number(colIndexStr);
          if (Number.isNaN(colIndex)) {
            return;
          }
          const cell = row[colIndex];
          if (!cell) {
            return;
          }
          rowArr[colIndex] = this.createCellFromBackend(cell);
          if (colIndex + 1 > maxCols) {
            maxCols = colIndex + 1;
          }
        });
        matrix[rowIndex] = rowArr;
      });
    }
    if (matrix.length === 0 && Array.isArray(sheet?.aoa)) {
      sheet.aoa.forEach((row, rowIndex) => {
        if (!row) {
          return;
        }
        const rowArr = matrix[rowIndex] || [];
        row.forEach((cellValue, colIndex) => {
          if (cellValue == null) {
            rowArr[colIndex] = null;
            return;
          }
          rowArr[colIndex] = this.createCellFromValue(cellValue);
          if (colIndex + 1 > maxCols) {
            maxCols = colIndex + 1;
          }
        });
        matrix[rowIndex] = rowArr;
      });
    }
    return { matrix, rowCount: matrix.length, colCount: maxCols };
  }

  padMatrix(matrix, targetRows, targetCols) {
    const rows = Math.max(targetRows, 0);
    const cols = Math.max(targetCols, 0);
    for (let r = 0; r < rows; r += 1) {
      if (!Array.isArray(matrix[r])) {
        matrix[r] = [];
      }
      for (let c = 0; c < cols; c += 1) {
        if (typeof matrix[r][c] === 'undefined') {
          matrix[r][c] = null;
        }
      }
    }
    return matrix;
  }

  computeMergeDimensions(merges) {
    if (!Array.isArray(merges)) {
      return { maxRow: 0, maxCol: 0 };
    }
    let maxRow = 0;
    let maxCol = 0;
    merges.forEach((merge) => {
      if (!merge || !merge.e) {
        return;
      }
      const endRow = Number(merge.e.r);
      const endCol = Number(merge.e.c);
      if (!Number.isNaN(endRow) && endRow + 1 > maxRow) {
        maxRow = endRow + 1;
      }
      if (!Number.isNaN(endCol) && endCol + 1 > maxCol) {
        maxCol = endCol + 1;
      }
    });
    return { maxRow, maxCol };
  }


  isSupportedFile(fileExt) {
    const supportedExts = ['.xlsx', '.xls'];
    return supportedExts.includes(fileExt.toLowerCase());
  }

  async loadLuckysheetAssets() {
    if (this.loadedAssets) return;
    const resolveAsset = async (rel) => {
      try {
        if (location.protocol === 'file:' && window.fsAPI && typeof window.fsAPI.getAssetPath === 'function') {
          return await window.fsAPI.getAssetPath(rel);
        }
      } catch (e) {
        // fall back
      }
      return rel; // 使用相对路径用于HTTP预览
    };

    // 加载 CSS 资源（使用 dist 路径）
    const cssPaths = [
      'node_modules/luckysheet/dist/plugins/css/pluginsCss.css',
      'node_modules/luckysheet/dist/plugins/plugins.css',
      'node_modules/luckysheet/dist/css/luckysheet.css',
      'node_modules/luckysheet/dist/assets/iconfont/iconfont.css'
    ];
    for (const rel of cssPaths) {
      try {
        const href = await resolveAsset(rel);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
      } catch (e) {
        console.warn('加载Luckysheet样式失败:', rel, e);
      }
    }

    // 加载 JS 资源（先插件后主库；使用 dist 路径）
    const jsPaths = [
      'node_modules/luckysheet/dist/plugins/js/plugin.js',
      'node_modules/luckysheet/dist/luckysheet.umd.js'
    ];
    for (const rel of jsPaths) {
      await new Promise(async (resolve, reject) => {
        const src = await resolveAsset(rel);
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('无法加载脚本: ' + rel));
        document.head.appendChild(script);
      });
    }

    this.loadedAssets = true;
  }

  async loadExcelFile(filePath) {
    const result = await window.fsAPI.readXlsxFile(filePath);
    if (!result || !result.success) {
      throw new Error(result?.error || '读取Excel失败');
    }
    return result; // { success, sheets: [{name, aoa}], fileName }
  }

  async createExcelViewer(tabId, excelData, filePath) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;

    // 为Excel文件添加特殊类名
    contentElement.classList.add('excel-content');
    contentElement.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'excel-viewer-container';
    const sheetContainerId = `luckysheet-${this.sanitizeId(tabId)}`;
    
    container.innerHTML = `
      <div class="excel-sheet-container">
        <div id="${sheetContainerId}" style="width:100%;height:100%;"></div>
      </div>
    `;
    contentElement.appendChild(container);

    try {
      const firstSheet = excelData.sheets[0] || { name: 'Sheet1', aoa: [], cellData: [] };
      const { matrix: rawMatrix, rowCount: rawRowCount, colCount: rawColCount } = this.buildCellMatrix(firstSheet);
      let matrix = rawMatrix;
      let rowCount = rawRowCount;
      let colCount = rawColCount;

      const measureText = (text) => {
        const str = String(text);
        return str.split('').reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 16 : 8), 0) + 20;
      };

      const colWidths = {};
      const minColWidth = 80;
      const maxColWidth = 300;
      matrix.forEach((row) => {
        if (!Array.isArray(row)) {
          return;
        }
        row.forEach((cell, colIndex) => {
          if (!cell || cell.v == null) {
            return;
          }
          const displayValue = cell.m != null ? String(cell.m) : String(cell.v);
          if (!displayValue) {
            return;
          }
          const width = measureText(displayValue);
          const currentWidth = colWidths[colIndex] || minColWidth;
          colWidths[colIndex] = Math.min(Math.max(width, currentWidth), maxColWidth);
        });
      });
      if (Object.keys(colWidths).length === 0 && Array.isArray(firstSheet.aoa)) {
        firstSheet.aoa.forEach((row) => {
          if (!Array.isArray(row)) {
            return;
          }
          row.forEach((value, colIndex) => {
            if (value == null) {
              return;
            }
            const width = measureText(value);
            const currentWidth = colWidths[colIndex] || minColWidth;
            colWidths[colIndex] = Math.min(Math.max(width, currentWidth), maxColWidth);
          });
        });
      }

      const luckysheetMerges = {};
      if (Array.isArray(firstSheet.merges) && firstSheet.merges.length > 0) {
        firstSheet.merges.forEach((merge) => {
          if (!merge || !merge.s || !merge.e) {
            return;
          }
          const startRow = merge.s.r;
          const startCol = merge.s.c;
          const endRow = merge.e.r;
          const endCol = merge.e.c;
          const mergeKey = `${startRow}_${startCol}`;
          luckysheetMerges[mergeKey] = {
            r: startRow,
            c: startCol,
            rs: endRow - startRow + 1,
            cs: endCol - startCol + 1
          };
        });
      }

      const mergeDimensions = this.computeMergeDimensions(firstSheet.merges || []);
      const widthColumns = Object.keys(colWidths).reduce((max, key) => {
        const index = Number(key);
        if (Number.isNaN(index)) {
          return max;
        }
        return Math.max(max, index + 1);
      }, 0);

      const targetRowCount = Math.max(rowCount, mergeDimensions.maxRow);
      const targetColCount = Math.max(colCount, mergeDimensions.maxCol, widthColumns);
      matrix = this.padMatrix(matrix, targetRowCount, targetColCount);
      rowCount = targetRowCount;
      colCount = targetColCount;

      await this.loadLuckysheetAssets();
      if (typeof window.luckysheet === 'undefined') {
        throw new Error('Luckysheet未正确加载');
      }

      this.ensureLoadingObserver();
      this.removeLuckysheetLoading(document.body);

      const sheetIndexId = `sheet_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const sheetOrder = 0;
      const baseRowCount = Math.max(rowCount, 20);
      const baseColCount = Math.max(colCount, 26);

      window.luckysheet.create({
        container: sheetContainerId,
        data: [{
          name: firstSheet.name || 'Sheet1',
          index: sheetIndexId,
          order: sheetOrder,
          status: 1,
          row: baseRowCount,
          column: baseColCount,
          data: matrix,
          config: {
            columnlen: colWidths,
            merge: luckysheetMerges
          }
        }],
        showinfobar: false, // 隐藏信息栏
        showsheetbar: true, // 显示sheet标签栏
        showstatisticBar: true, // 显示统计栏（包含缩放功能）
        lang: 'zh',
        allowCopy: true,
        title: '', // 清空标题
        userInfo: false, // 隐藏用户信息
        cellRightClickConfig: {
          copy: true, // 允许复制
          copyAs: true, // 允许复制为
          paste: true, // 允许粘贴
        },
        enableAddRow: false, // 禁用添加行功能
        enableAddCol: true, // 允许添加列
        rowHeaderWidth: 46, // 行标题宽度
        columnHeaderHeight: 20, // 列标题高度
        defaultColWidth: 73, // 默认列宽
        defaultRowHeight: 19 // 默认行高
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      this.scheduleLoadingCleanup();

      this.instances.set(tabId, {
        filePath,
        sheetName: firstSheet.name || 'Sheet1',
        luckysheetContainerId: sheetContainerId,
        sheetOrder,
        sheetIndex: sheetIndexId
      });
    } catch (error) {
      this.scheduleLoadingCleanup();
      throw error;
    }
  }

  async openExcelFile(filePath, tabId, fileName) {
    try {
      const excelData = await this.loadExcelFile(filePath);
      await this.createExcelViewer(tabId, excelData, filePath);
      return true;
    } catch (error) {
      console.error('打开Excel失败:', error);
      this.createErrorView(tabId, `打开Excel失败: ${error.message}`);
      return false;
    }
  }

  async saveExcel(tabId) {
    const inst = this.instances.get(tabId);
    if (!inst) return false;

    try {
      // 仅保存当前活动sheet（轻量实现）
      const sheetData = window.luckysheet.getSheetData();
      const aoa = (sheetData || []).map(row => row.map(cell => (cell && cell.v != null ? cell.v : '')));
      const payload = {
        filePath: inst.filePath,
        sheets: [{ name: inst.sheetName || 'Sheet1', aoa }]
      };
      const res = await window.fsAPI.saveXlsxFile(payload);
      if (!res || !res.success) throw new Error(res?.error || '保存失败');
      // 清除脏标记
      if (this.tabManager && typeof this.tabManager.markTabAsClean === 'function') {
        this.tabManager.markTabAsClean(tabId);
      } else {
        const tabState = this.tabManager.getTabState ? this.tabManager.getTabState(tabId) : null;
        if (tabState) {
          tabState.isDirty = false;
          this.tabManager.updateTabTitle && this.tabManager.updateTabTitle(tabId);
        }
      }
      return true;
    } catch (e) {
      console.error('保存Excel失败:', e);
      alert('保存失败: ' + e.message);
      return false;
    }
  }

  createErrorView(tabId, message) {
    const contentElement = this.contentContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!contentElement) return;
    const errorDiv = document.createElement('div');
    errorDiv.style.padding = '20px';
    errorDiv.style.color = '#d32f2f';
    errorDiv.textContent = message;
    contentElement.appendChild(errorDiv);
  }

  cleanup(tabId) {
    this.instances.delete(tabId);
    if (this.instances.size === 0 && this.loadingObserver) {
      try {
        this.loadingObserver.disconnect();
      } catch (error) {
        // ignore disconnect errors
      }
      this.loadingObserver = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExcelViewer;
} else {
  window.ExcelViewer = ExcelViewer;
}
