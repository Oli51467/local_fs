class DatabaseModule {
  constructor() {
    this.baseUrl = 'http://localhost:8000';
    this.currentTables = [];
    this.selectedTable = null;
    this.currentVectorTypes = [];
    this.selectedVectorType = null;
    this.currentTab = 'sqlite';
    this.imageVectorState = {
      search: '',
      limit: 100,
      offset: 0,
      total: 0,
      loading: false
    };
    this.imageVectorsInitialized = false;
    this.pendingImageVectorReload = false;
    this.init();
  }

  buildImageVectorCard(record, index = 0) {
    const rank = this.imageVectorState ? this.imageVectorState.offset + index + 1 : index + 1;
    const documentName = record?.filename || '未命名文档';
    const documentPath = record?.file_path || '';
    const displayPath = documentPath ? this.getDisplayPathAfterData(documentPath) : '';
    const truncatedPath = displayPath ? this.truncateMiddleText(displayPath, 60) : '';
    const formatLabel = record?.image_format ? String(record.image_format).toUpperCase() : 'IMG';
    const hasResolution = Number.isFinite(record?.width) && Number.isFinite(record?.height);
    const resolutionLabel = hasResolution
      ? `${record.width} × ${record.height}`
      : '未记录';
    const hasSize = Number.isFinite(record?.image_size);
    const sizeLabel = hasSize ? this.formatBytes(record.image_size) : '未知';
    const uploadLabel = record?.image_upload_time ? this.formatDateTime(record.image_upload_time) : '-';
    const vectorLabel = record?.vector_id != null ? String(record.vector_id) : '未绑定';
    let locationLabel = '未知';
    if (record?.line_number != null) {
      locationLabel = `索引 ${record.line_number}`;
    } else if (record?.source_path) {
      locationLabel = this.truncateMiddleText(record.source_path, 48);
    }
    const previewSrc = this.buildImagePreviewSrc(record?.storage_path);

    const preview = previewSrc
      ? `
        <button type="button" class="image-card-preview" data-src="${this.escapeHtml(previewSrc)}" data-title="${this.escapeHtml(documentName)}">
          <img src="${this.escapeHtml(previewSrc)}" alt="${this.escapeHtml(documentName)}" loading="lazy" />
          <span class="image-card-format">${this.escapeHtml(formatLabel)}</span>
        </button>
      `
      : `
        <div class="image-card-preview no-preview">
          <div class="image-card-preview-fallback">${this.escapeHtml(formatLabel)}</div>
          <span class="image-card-format">${this.escapeHtml(formatLabel)}</span>
        </div>
      `;

    return `
      <article class="image-card" data-vector-id="${this.escapeHtml(vectorLabel)}">
        ${preview}
        <div class="image-card-body">
          <div class="image-card-header">
            <div class="image-card-title" title="${this.escapeHtml(documentName)}">${this.escapeHtml(documentName)}</div>
            ${displayPath ? `<div class="image-card-path" title="${this.escapeHtml(displayPath)}">${this.escapeHtml(truncatedPath)}</div>` : ''}
          </div>
          <div class="image-card-meta">
            ${this.buildImageMetaItem('序号', `#${rank}`)}
            ${this.buildImageMetaItem('向量ID', vectorLabel)}
            ${this.buildImageMetaItem('分辨率', resolutionLabel)}
            ${this.buildImageMetaItem('文件大小', sizeLabel)}
            ${this.buildImageMetaItem('位置', locationLabel)}
            ${this.buildImageMetaItem('上传时间', uploadLabel)}
          </div>
        </div>
      </article>
    `;
  }

  buildImageMetaItem(label, value) {
    return `
      <div class="image-card-meta-item">
        <span class="meta-label">${this.escapeHtml(label)}</span>
        <span class="meta-value">${this.escapeHtml(value == null || value === '' ? '-' : String(value))}</span>
      </div>
    `;
  }

  attachImageCardEvents(container) {
    const previewButtons = container.querySelectorAll('.image-card-preview[data-src]');
    previewButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const src = button.getAttribute('data-src');
        const title = button.getAttribute('data-title') || '';
        if (src) {
          this.openImagePreview(src, title);
        }
      });
    });
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    // Tab切换事件
    document.querySelectorAll('.db-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // SQLite 页面：自动模式，无需手动按钮

    // Faiss 手动事件已移除，改为自动加载类型与点击展示数据

    // 图片向量事件（移除搜索，保留分页与每页数量）
    const pageSizeSelect = document.getElementById('image-vector-page-size');
    const prevButton = document.getElementById('image-vector-prev');
    const nextButton = document.getElementById('image-vector-next');

    if (pageSizeSelect) {
      pageSizeSelect.addEventListener('change', (event) => {
        const newLimit = parseInt(event.target.value, 10) || 100;
        this.imageVectorState.limit = newLimit;
        this.imageVectorState.offset = 0;
        this.loadImageVectors();
      });
    }

    if (prevButton) {
      prevButton.addEventListener('click', () => {
        if (this.imageVectorState.offset <= 0 || this.imageVectorState.loading) {
          return;
        }
        this.imageVectorState.offset = Math.max(0, this.imageVectorState.offset - this.imageVectorState.limit);
        this.loadImageVectors();
      });
    }

    if (nextButton) {
      nextButton.addEventListener('click', () => {
        if (this.imageVectorState.loading) {
          return;
        }
        const nextOffset = this.imageVectorState.offset + this.imageVectorState.limit;
        if (nextOffset >= this.imageVectorState.total) {
          return;
        }
        this.imageVectorState.offset = nextOffset;
        this.loadImageVectors();
      });
    }
  }

  showDatabasePage() {
    // 隐藏其他页面
    document.getElementById('file-content').style.display = 'none';
    document.getElementById('settings-page').style.display = 'none';
    document.getElementById('file-tree-container').style.display = 'none';
    const resourceTitle = document.getElementById('resource-title');
    if (resourceTitle) {
      resourceTitle.textContent = '数据库';
    }
    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }
    const chatPage = document.getElementById('chat-page');
    if (chatPage) {
      chatPage.style.display = 'none';
    }
    
    const chatModule = window.chatModule;
    if (chatModule && typeof chatModule.leaveChatMode === 'function') {
      chatModule.leaveChatMode();
    }
    
    const modelPage = document.getElementById('model-page');
    if (modelPage) {
      modelPage.style.display = 'none';
    }
    
    // 显示数据库页面
    document.getElementById('database-page').style.display = 'block';
    
    // 根据当前tab自动加载
    if (this.currentTab === 'sqlite') {
      this.testConnection();
    } else if (this.currentTab === 'faiss') {
      this.loadFaissTypes();
    } else if (this.currentTab === 'image-vectors') {
      this.loadImageVectors();
    }
  }

  switchTab(tabName) {
    // 更新tab按钮状态
    document.querySelectorAll('.db-tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // 切换面板显示
    document.querySelectorAll('.db-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(`${tabName}-panel`).classList.add('active');

    this.currentTab = tabName;

    // 自动加载
    if (tabName === 'sqlite') {
      this.testConnection();
    } else if (tabName === 'faiss') {
      this.loadFaissTypes();
    } else if (tabName === 'image-vectors') {
      this.loadImageVectors();
    }
  }

  async testConnection() {
    const tablesContent = document.getElementById('tables-content');
    if (tablesContent) {
      tablesContent.innerHTML = '<div class="loading">正在连接数据库...</div>';
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/database/test-connection`);
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        // 连接成功后自动获取表列表
        setTimeout(() => this.getAllTables(), 300);
      } else {
        throw new Error(data.detail || '连接失败');
      }
    } catch (error) {
      console.error('数据库连接测试失败:', error);
      if (tablesContent) {
        tablesContent.innerHTML = `<div class="error-message">连接失败: ${error.message}</div>`;
      }
    }
  }

  async getAllTables() {
    const tablesContent = document.getElementById('tables-content');
    
    tablesContent.innerHTML = '<div class="loading">正在获取表列表...</div>';

    try {
      const response = await fetch(`${this.baseUrl}/api/database/tables`);
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        this.currentTables = data.tables;
        this.renderTables(data.tables);
      } else {
        throw new Error(data.detail || '获取表列表失败');
      }
    } catch (error) {
      console.error('获取表列表失败:', error);
      tablesContent.innerHTML = `<div class="error-message">获取表列表失败: ${error.message}</div>`;
    }
  }

  renderTables(tables) {
    const tablesContent = document.getElementById('tables-content');
    
    if (tables.length === 0) {
      tablesContent.innerHTML = '<div class="loading">数据库中没有表</div>';
      return;
    }

    const tableItems = tables.map(table => {
      return `<div class="table-item" data-table="${table}">${table}</div>`;
    }).join('');

    tablesContent.innerHTML = tableItems;

    // 绑定表项点击事件
    tablesContent.querySelectorAll('.table-item').forEach(item => {
      item.addEventListener('click', () => {
        // 移除其他选中状态
        tablesContent.querySelectorAll('.table-item').forEach(i => i.classList.remove('selected'));
        // 添加选中状态
        item.classList.add('selected');
        
        const tableName = item.dataset.table;
        this.selectedTable = tableName;
        
        // 自动查询表数据
        this.queryTableData();
      });
    });
  }

  async queryTableData() {
    if (!this.selectedTable) {
      showAlert('请先选择一个表', 'warning');
      return;
    }

    const tableDataContent = document.getElementById('table-data-content');
    tableDataContent.innerHTML = '<div class="loading">正在查询表数据...</div>';

    try {
      const response = await fetch(`${this.baseUrl}/api/database/table/${this.selectedTable}?limit=100`);
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        this.renderTableData(data);
      } else {
        throw new Error(data.detail || '查询表数据失败');
      }
    } catch (error) {
      console.error('查询表数据失败:', error);
      tableDataContent.innerHTML = `<div class="error-message">查询表数据失败: ${error.message}</div>`;
    }
  }

  renderTableData(data) {
    const tableDataContent = document.getElementById('table-data-content');
    
    if (!data.data || data.data.length === 0) {
      tableDataContent.innerHTML = '<div class="loading">表中没有数据</div>';
      return;
    }

    // 创建表格信息
    const tableInfo = `
      <div class="table-info">
        表名: ${data.table_name} | 
        总行数: ${data.total_count} | 
        显示行数: ${data.returned_count}
      </div>
    `;

    // 创建表格
    const columns = data.columns;
    const rows = data.data;

    let tableHtml = '<table class="data-table">';
    
    // 表头
    tableHtml += '<thead><tr>';
    columns.forEach(column => {
      tableHtml += `<th>${this.escapeHtml(column)}</th>`;
    });
    tableHtml += '</tr></thead>';
    
    // 表体
    tableHtml += '<tbody>';
    rows.forEach(row => {
      tableHtml += '<tr>';
      columns.forEach(column => {
        const value = row[column];
        const displayValue = value === null ? '<em>NULL</em>' : this.escapeHtml(String(value));
        tableHtml += `<td>${displayValue}</td>`;
      });
      tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';

    tableDataContent.innerHTML = tableInfo + tableHtml;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }


  // 工具方法：格式化JSON
  formatJson(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return String(obj);
    }
  }

  formatBytes(size) {
    let bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes < 0) {
      bytes = 0;
    }
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
  }

  formatDateTime(value) {
    if (!value) {
      return '-';
    }
    let normalized = value;
    if (typeof value === 'string' && value.includes(' ') && !value.includes('T')) {
      normalized = value.replace(' ', 'T');
    }
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  }

  buildImagePreviewSrc(storagePath) {
    const resolved = this.resolveProjectRelativeUrl(storagePath);
    return resolved;
  }

  toFileUrl(absolutePath) {
    if (!absolutePath) {
      return null;
    }

    const raw = String(absolutePath).trim();
    if (!raw) {
      return null;
    }

    if (raw.startsWith('file://')) {
      return raw;
    }

    const normalized = raw.replace(/\\/g, '/');
    if (/^[a-zA-Z]:[\\/]/.test(raw) || /^[a-zA-Z]:[\\/]/.test(normalized)) {
      return `file:///${normalized}`;
    }

    if (normalized.startsWith('/')) {
      return `file://${normalized}`;
    }

    return null;
  }

  resolveProjectRelativeUrl(targetPath) {
    if (!targetPath) {
      return null;
    }

    let normalized = String(targetPath).trim();
    if (!normalized) {
      return null;
    }

    if (normalized.startsWith('file://')) {
      return normalized;
    }

    if (typeof window.fsAPI?.resolveProjectPathSync === 'function') {
      try {
        const absolute = window.fsAPI.resolveProjectPathSync(normalized);
        const asFileUrl = this.toFileUrl(absolute);
        if (asFileUrl) {
          return asFileUrl;
        }
      } catch (error) {
        console.warn('解析项目路径失败:', normalized, error);
      }
    }

    const absoluteFallback = this.toFileUrl(normalized);
    if (absoluteFallback) {
      return absoluteFallback;
    }

    try {
      const runtimePaths = typeof window.fsAPI?.getRuntimePathsSync === 'function'
        ? window.fsAPI.getRuntimePathsSync()
        : null;
      if (runtimePaths?.externalRoot) {
        const joined = `${runtimePaths.externalRoot.replace(/\\/g, '/')}/${normalized.replace(/^\/+/, '')}`;
        const fallbackUrl = this.toFileUrl(joined);
        if (fallbackUrl) {
          return fallbackUrl;
        }
      }
    } catch (error) {
      console.warn('无法解析运行时路径:', error);
    }

    try {
      const url = new URL(`../${normalized}`, window.location.href);
      return url.href;
    } catch (error) {
      console.warn('无法解析文件路径:', normalized, error);
      return null;
    }
  }

  truncateMiddleText(text, maxLength = 60) {
    if (!text) {
      return '';
    }

    const str = String(text);
    if (str.length <= maxLength) {
      return str;
    }

    const keep = Math.max(4, Math.floor((maxLength - 3) / 2));
    return `${str.slice(0, keep)}...${str.slice(-keep)}`;
  }

  openImagePreview(src, title = '') {
    if (!src) {
      return;
    }

    try {
      window.open(src, '_blank', 'noopener');
    } catch (error) {
      console.warn('无法打开图片预览:', title || src, error);
    }
  }

  // 工具方法：截断长文本
  truncateText(text, maxLength = 100) {
    if (typeof text !== 'string') {
      text = String(text);
    }
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  // 数据更新通知机制
  notifyDataUpdate(dataType) {
    // 触发自定义事件，通知其他模块数据已更新
    const event = new CustomEvent('dataUpdated', {
      detail: { type: dataType, timestamp: Date.now() }
    });
    document.dispatchEvent(event);
    
    console.log(`数据更新通知已发送: ${dataType}`);
    
    // 同时刷新文件树中的上传状态标记
    this.refreshUploadStatus();

    if (this.currentTab === 'image-vectors') {
      this.loadImageVectors(true);
    } else {
      this.imageVectorsInitialized = false;
    }
  }

  // 刷新文件上传状态标记
  async refreshUploadStatus() {
    if (window.refreshVisibleFolderUploadStatus) {
      await window.refreshVisibleFolderUploadStatus();
    }
  }

  // 添加上传状态标记
  addUploadIndicator(fileElement, filePath) {
    // 检查是否已存在标记
    const existingIndicator = fileElement.querySelector('.upload-indicator');
    if (existingIndicator) {
      return;
    }
    
    // 创建上传标记
    const indicator = document.createElement('span');
    indicator.className = 'upload-indicator';
    indicator.innerHTML = '✓';
    indicator.title = '已上传到向量数据库';
    indicator.style.cssText = `
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: #28a745;
      font-weight: bold;
      font-size: 12px;
      background: rgba(40, 167, 69, 0.1);
      padding: 2px 4px;
      border-radius: 3px;
      border: 1px solid rgba(40, 167, 69, 0.3);
    `;
    
    // 设置父元素为相对定位
    fileElement.style.position = 'relative';
    fileElement.appendChild(indicator);
  }

  // 移除上传状态标记
  removeUploadIndicator(fileElement) {
    const indicator = fileElement.querySelector('.upload-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  async loadImageVectors(force = false) {
    if (this.imageVectorState.loading) {
      if (force) {
        this.pendingImageVectorReload = true;
      }
      return;
    }

    this.pendingImageVectorReload = false;

    const filesEl = document.getElementById('image-files-content');
    const imagesEl = document.getElementById('image-images-content');
    const statsEl = document.getElementById('image-vector-stats-content');
    const pageInfoEl = document.getElementById('image-vector-page-info');
    const pageSizeSelect = document.getElementById('image-vector-page-size');

    if (!filesEl || !imagesEl) {
      return;
    }

    if (pageSizeSelect && parseInt(pageSizeSelect.value, 10) !== this.imageVectorState.limit) {
      pageSizeSelect.value = String(this.imageVectorState.limit);
    }

    this.imageVectorState.loading = true;

    if (filesEl) {
      filesEl.innerHTML = '<div class="loading">正在加载文件列表...</div>';
    }
    if (imagesEl) {
      imagesEl.innerHTML = '<div class="loading">正在查询图片向量数据...</div>';
    }
    if (statsEl) {
      statsEl.innerHTML = '';
    }
    if (pageInfoEl) {
      pageInfoEl.textContent = '';
    }

    try {
      // 默认显示全部：服务端最大500/页，循环拉取直至结束
      const allRecords = [];
      const limit = 500; // 与服务端限制保持一致
      let offset = 0;
      let total = 0;
      let statsFromFirstResponse = null;

      while (true) {
        const params = new URLSearchParams();
        params.append('limit', String(limit));
        params.append('offset', String(offset));

        const response = await fetch(`${this.baseUrl}/api/database/image-vectors?${params.toString()}`);
        const data = await response.json();

        if (!response.ok || data.status !== 'success') {
          throw new Error(data.detail || '获取图片向量信息失败');
        }

        const pageRecords = Array.isArray(data.records) ? data.records : [];
        allRecords.push(...pageRecords);
        total = typeof data.total === 'number' ? data.total : Math.max(total, offset + pageRecords.length);
        if (!statsFromFirstResponse && data.stats) {
          statsFromFirstResponse = data.stats;
        }

        if (pageRecords.length < limit) {
          break;
        }
        offset += limit;
        if (total && offset >= total) {
          break;
        }
      }

      this.imageVectorState.total = total || allRecords.length;
      this.imageVectorState.limit = limit;
      this.imageVectorState.offset = 0;
      this.imageVectorRecords = allRecords;

      this.renderImageFileList(allRecords);
      const firstFileKey = this.getFirstFileKey(allRecords);
      if (firstFileKey) {
        this.renderImagesForFile(firstFileKey);
      } else {
        imagesEl.innerHTML = '<div class="image-card-empty">暂无图片向量数据</div>';
      }

      this.renderImageVectorStats(statsFromFirstResponse || null);
      // 已取消分页控件，默认显示全部
      this.imageVectorsInitialized = true;
    } catch (error) {
      console.error('获取图片向量信息失败:', error);
      imagesEl.innerHTML = `<div class="error-message">${this.escapeHtml(error.message || '加载失败')}</div>`;
      if (filesEl) {
        filesEl.innerHTML = '';
      }
      if (statsEl) {
        statsEl.innerHTML = '';
      }
    } finally {
      this.imageVectorState.loading = false;
      if (this.pendingImageVectorReload) {
        this.pendingImageVectorReload = false;
        this.loadImageVectors();
      }
    }
  }

  renderImageVectorStats(stats) {
    const statsEl = document.getElementById('image-vector-stats-content');
    if (!statsEl) {
      return;
    }

    if (!stats || !stats.total_count) {
      statsEl.innerHTML = '<div class="loading">暂无图片向量数据</div>';
      return;
    }

    const items = [];
    items.push(`<div class="stat-item"><span>图片总数</span><span>${this.escapeHtml(String(stats.total_count))}</span></div>`);
    items.push(`<div class="stat-item"><span>关联文档数</span><span>${this.escapeHtml(String(stats.document_count || 0))}</span></div>`);
    if (typeof stats.total_size === 'number') {
      items.push(`<div class="stat-item"><span>图片总大小</span><span>${this.escapeHtml(this.formatBytes(stats.total_size))}</span></div>`);
    }

    const formatEntries = Object.entries(stats.format_breakdown || {});
    if (formatEntries.length) {
      const chips = formatEntries
        .map(([format, count]) => `<span class="format-chip">${this.escapeHtml(String(format).toUpperCase())}: ${this.escapeHtml(String(count))}</span>`)
        .join('');
      items.push(`<div class="stat-item format-stat"><span>格式分布</span><span class="format-chip-group">${chips}</span></div>`);
    }

    statsEl.innerHTML = items.join('');
  }

  // 根据记录渲染左侧文件列表
  renderImageFileList(records) {
    const filesEl = document.getElementById('image-files-content');
    if (!filesEl) {
      return;
    }
    if (!Array.isArray(records) || records.length === 0) {
      filesEl.innerHTML = '<div class="image-card-empty">暂无文件</div>';
      return;
    }

    const fileMap = new Map();
    records.forEach((rec) => {
      const key = this.getFileKey(rec);
      const displayLabel = this.getDisplayPathAfterData(key);
      const entry = fileMap.get(key) || { label: displayLabel, count: 0 };
      entry.count += 1;
      fileMap.set(key, entry);
    });

    const itemsHtml = Array.from(fileMap.entries()).map(([key, meta]) => {
      const truncated = this.truncateMiddleText(meta.label, 64);
      return `<div class="table-item" data-file="${this.escapeHtml(key)}" style="display:flex;align-items:center;justify-content:space-between;">
        <span class="table-item-name">${this.escapeHtml(truncated)}</span>
        <span class="table-item-count" style="color:var(--text-muted)">${this.escapeHtml(String(meta.count))}</span>
      </div>`;
    }).join('');

    filesEl.innerHTML = itemsHtml;

    Array.from(filesEl.querySelectorAll('.table-item')).forEach((el) => {
      el.addEventListener('click', () => {
        const selectedKey = el.getAttribute('data-file');
        if (selectedKey) {
          this.renderImagesForFile(selectedKey);
        }
      });
    });
  }

  // 获取记录的文件键
  getFileKey(record) {
    if (!record) return '未知文件';
    const path = record.file_path || record.storage_path || '';
    const name = record.filename || '';
    return path || name || '未知文件';
  }

  // 仅用于显示：提取 data 目录后的相对路径
  getDisplayPathAfterData(text) {
    if (!text) return '未知文件';
    const str = String(text);
    const lower = str.toLowerCase();

    // 支持多种情况：'/data/', '\\data\\', 'data/', 'data\\'
    const tokens = ['/data/', '\\data\\', 'data/', 'data\\'];
    let startIdx = -1;

    for (const token of tokens) {
      const pos = lower.indexOf(token);
      if (pos >= 0) {
        // 确保是路径边界：前一位为空或为分隔符
        const isBoundary = pos === 0 || lower[pos - 1] === '/' || lower[pos - 1] === '\\';
        if (isBoundary) {
          startIdx = pos + token.length;
          break;
        }
      }
    }

    return startIdx >= 0 ? str.substring(startIdx) : str;
  }

  // 获取第一个文件键
  getFirstFileKey(records) {
    if (!Array.isArray(records) || records.length === 0) return null;
    for (const rec of records) {
      const key = this.getFileKey(rec);
      if (key) return key;
    }
    return null;
  }

  // 点击文件后渲染右侧图片列表
  renderImagesForFile(fileKey) {
    const imagesEl = document.getElementById('image-images-content');
    if (!imagesEl) {
      return;
    }
    const records = Array.isArray(this.imageVectorRecords)
      ? this.imageVectorRecords.filter(r => this.getFileKey(r) === fileKey)
      : [];
    this.renderImageVectorTable(records);

    // 简单高亮选中项
    const filesEl = document.getElementById('image-files-content');
    if (filesEl) {
      Array.from(filesEl.querySelectorAll('.table-item')).forEach((el) => {
        if (el.getAttribute('data-file') === fileKey) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
    }
  }

  // 渲染图片卡片到右侧容器
  renderImageVectorTable(records) {
    const container = document.getElementById('image-images-content');
    if (!container) {
      return;
    }

    container.classList.add('image-card-grid');

    if (!records || records.length === 0) {
      container.innerHTML = '<div class="image-card-empty">暂无图片向量数据</div>';
      return;
    }

    const cardsHtml = records.map((record, index) => this.buildImageVectorCard(record, index)).join('');
    container.innerHTML = cardsHtml;
    this.attachImageCardEvents(container);
  }

  updateImagePagination() {
    const pageInfoEl = document.getElementById('image-vector-page-info');
    const prevButton = document.getElementById('image-vector-prev');
    const nextButton = document.getElementById('image-vector-next');

    if (!pageInfoEl || !prevButton || !nextButton) {
      return;
    }

    const { limit, offset, total } = this.imageVectorState;
    const currentPage = total === 0 ? 0 : Math.floor(offset / limit) + 1;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    if (total === 0) {
      pageInfoEl.textContent = '暂无数据';
    } else {
      pageInfoEl.textContent = `第 ${currentPage} / ${totalPages} 页 · 共 ${total} 条`;
    }

    prevButton.disabled = offset <= 0;
    nextButton.disabled = offset + limit >= total;
    prevButton.classList.toggle('disabled', prevButton.disabled);
    nextButton.classList.toggle('disabled', nextButton.disabled);
  }

  // Faiss数据库相关方法

  async loadFaissTypes() {
    const typesContent = document.getElementById('faiss-types-content');
    const vectorsContent = document.getElementById('vectors-data-content');
    if (typesContent) {
      typesContent.innerHTML = '<div class="loading">正在加载向量类型...</div>';
    }
    if (vectorsContent) {
      vectorsContent.innerHTML = '';
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/faiss/statistics`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || '获取向量类型失败');
      }

      const typeStats = data.type_statistics || {};
      const types = Object.keys(typeStats);
      this.renderFaissTypes(types, typeStats);
    } catch (error) {
      console.error('加载向量类型失败:', error);
      if (typesContent) {
        typesContent.innerHTML = `<div class=\"error-message\">${this.escapeHtml(error.message || '加载失败')}</div>`;
      }
    }
  }

  renderFaissTypes(types, typeStats = {}) {
    const typesContent = document.getElementById('faiss-types-content');
    if (!typesContent) return;

    if (!types || types.length === 0) {
      typesContent.innerHTML = '<div class="loading">暂无向量类型</div>';
      return;
    }

    const items = types.map(t => {
      const count = typeof typeStats[t] === 'number' ? ` <span class="table-subtext">(${typeStats[t]})</span>` : '';
      return `<div class="table-item" data-type="${this.escapeHtml(t)}">${this.escapeHtml(t)}${count}</div>`;
    }).join('');

    typesContent.innerHTML = items;

    typesContent.querySelectorAll('.table-item').forEach(item => {
      item.addEventListener('click', () => {
        typesContent.querySelectorAll('.table-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        const type = item.getAttribute('data-type');
        this.selectedVectorType = type;
        this.loadFaissVectorsByType(type);
      });
    });
  }

  async loadFaissVectorsByType(type) {
    const contentEl = document.getElementById('vectors-data-content');
    if (contentEl) {
      contentEl.innerHTML = '<div class="loading">正在加载向量数据...</div>';
    }
    try {
      const response = await fetch(`${this.baseUrl}/api/faiss/vectors/by-type/${encodeURIComponent(type)}?limit=50`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || '查询失败');
      }
      this.renderVectorData(data.vectors || []);
    } catch (error) {
      console.error('查询向量失败:', error);
      if (contentEl) {
        contentEl.innerHTML = `<div class=\"error-message\">${this.escapeHtml(error.message || '请求失败')}</div>`;
      }
    }
  }


  renderVectorData(vectors) {
    const contentEl = document.getElementById('vectors-data-content');
    
    if (!vectors || vectors.length === 0) {
      contentEl.innerHTML = '<p>没有找到向量数据</p>';
      return;
    }

    let html = '<div class="vectors-table">';
    html += '<table><thead><tr>';
    html += '<th>向量ID</th><th>类型</th><th>文件名</th><th>内容</th>';
    html += '</tr></thead><tbody>';

    vectors.forEach(vector => {
      const fileType = vector.file_type || 'unknown';
      const filename = vector.filename || 'N/A';
      const content = vector.chunk_text || vector.text || 'N/A';
      
      html += '<tr>';
      html += `<td>${vector.vector_id ?? 'N/A'}</td>`;
      html += `<td>${this.escapeHtml(fileType)}</td>`;
      html += `<td>${this.escapeHtml(filename)}</td>`;
      html += `<td>${this.escapeHtml(this.truncateText(content, 100))}</td>`;
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    contentEl.innerHTML = html;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatabaseModule;
} else {
  window.DatabaseModule = DatabaseModule;
}
