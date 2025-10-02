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
    const truncatedPath = documentPath ? this.truncateMiddleText(documentPath, 60) : '';
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
            ${documentPath ? `<div class="image-card-path" title="${this.escapeHtml(documentPath)}">${this.escapeHtml(truncatedPath)}</div>` : ''}
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

    // SQLite数据库事件
    document.getElementById('test-db-connection').addEventListener('click', () => {
      this.testConnection();
    });

    document.getElementById('get-all-tables').addEventListener('click', () => {
      this.getAllTables();
    });

    document.getElementById('query-table').addEventListener('click', () => {
      this.queryTableData();
    });

    document.getElementById('table-select').addEventListener('change', (e) => {
      this.selectedTable = e.target.value;
    });

    // 删除所有数据按钮事件
    document.getElementById('delete-all-data').addEventListener('click', () => {
      this.deleteAllTableData();
    });

    // 清空SQLite数据按钮事件
    document.getElementById('cleanup-sqlite-data').addEventListener('click', () => {
      this.cleanupSQLiteData();
    });

    // 清空Faiss向量按钮事件
    document.getElementById('cleanup-faiss-vectors').addEventListener('click', () => {
      this.cleanupFaissVectors();
    });

    // Faiss数据库事件
    document.getElementById('test-faiss-connection').addEventListener('click', () => {
      this.testFaissConnection();
    });

    document.getElementById('get-faiss-statistics').addEventListener('click', () => {
      this.getFaissStatistics();
    });

    document.getElementById('query-vectors').addEventListener('click', () => {
      this.queryVectorData();
    });

    document.getElementById('vector-type-select').addEventListener('change', (e) => {
      this.selectedVectorType = e.target.value;
    });

    // 图片向量事件
    const imageSearchInput = document.getElementById('image-vector-search');
    const imageSearchButton = document.getElementById('search-image-vectors');
    const imageResetButton = document.getElementById('reset-image-vector-search');
    const pageSizeSelect = document.getElementById('image-vector-page-size');
    const prevButton = document.getElementById('image-vector-prev');
    const nextButton = document.getElementById('image-vector-next');

    if (imageSearchButton) {
      imageSearchButton.addEventListener('click', () => {
        this.imageVectorState.search = (imageSearchInput?.value || '').trim();
        this.imageVectorState.offset = 0;
        this.loadImageVectors();
      });
    }

    if (imageSearchInput) {
      imageSearchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.imageVectorState.search = (imageSearchInput.value || '').trim();
          this.imageVectorState.offset = 0;
          this.loadImageVectors();
        }
      });
    }

    if (imageResetButton) {
      imageResetButton.addEventListener('click', () => {
        if (imageSearchInput) {
          imageSearchInput.value = '';
        }
        this.imageVectorState.search = '';
        this.imageVectorState.offset = 0;
        this.loadImageVectors();
      });
    }

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
    document.getElementById('test-page').style.display = 'none';
    document.getElementById('file-tree-container').style.display = 'none';
    
    // 显示数据库页面
    document.getElementById('database-page').style.display = 'block';
    
    // 根据当前tab自动测试连接
    if (this.currentTab === 'sqlite') {
      this.testConnection();
    } else if (this.currentTab === 'faiss') {
      this.testFaissConnection();
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

    // 自动测试连接
    if (tabName === 'sqlite') {
      this.testConnection();
    } else if (tabName === 'faiss') {
      this.testFaissConnection();
    } else if (tabName === 'image-vectors') {
      this.loadImageVectors();
    }
  }

  async testConnection() {
    const statusEl = document.getElementById('db-status');
    statusEl.textContent = '正在测试数据库连接...';
    statusEl.className = 'status-indicator status-info';

    try {
      const response = await fetch(`${this.baseUrl}/api/database/test-connection`);
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        statusEl.textContent = '连接成功！';
        statusEl.className = 'status-indicator status-success';
        
        // 连接成功后自动获取表列表
        setTimeout(() => this.getAllTables(), 500);
      } else {
        throw new Error(data.detail || '连接失败');
      }
    } catch (error) {
      console.error('数据库连接测试失败:', error);
      statusEl.textContent = `连接失败: ${error.message}`;
      statusEl.className = 'status-indicator status-error';
    }
  }

  async getAllTables() {
    const tablesContent = document.getElementById('tables-content');
    const tableSelect = document.getElementById('table-select');
    
    tablesContent.innerHTML = '<div class="loading">正在获取表列表...</div>';
    
    // 清空表选择器
    tableSelect.innerHTML = '<option value="">选择表...</option>';

    try {
      const response = await fetch(`${this.baseUrl}/api/database/tables`);
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        this.currentTables = data.tables;
        this.renderTables(data.tables);
        this.populateTableSelect(data.tables);
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
        document.getElementById('table-select').value = tableName;
        
        // 显示删除按钮
        document.getElementById('delete-all-data').style.display = 'inline-block';
        
        // 自动查询表数据
        this.queryTableData();
      });
    });
  }

  populateTableSelect(tables) {
    const tableSelect = document.getElementById('table-select');
    
    tables.forEach(table => {
      const option = document.createElement('option');
      option.value = table;
      option.textContent = table;
      tableSelect.appendChild(option);
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

  async deleteAllTableData() {
    if (!confirm('确定要删除所有数据吗？此操作将清空SQLite数据库和Faiss向量数据库中的所有数据，且不可恢复。')) {
      return;
    }

    const tableDataContent = document.getElementById('table-data-content');
    tableDataContent.innerHTML = '<div class="loading">正在删除所有数据...</div>';

    try {
      const response = await fetch(`${this.baseUrl}/api/cleanup/all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok && data.status === 'completed') {
        tableDataContent.innerHTML = `<div class="success-message">${data.message}</div>`;
        // 重新获取表列表和统计信息
        setTimeout(() => {
          this.getAllTables();
          this.testConnection();
          this.testFaissConnection();
        }, 1500);
        
        // 触发全局事件，通知其他模块数据已更新
        this.notifyDataUpdate('all');
        
      } else {
        throw new Error(data.detail || '删除失败');
      }
    } catch (error) {
      console.error('删除所有数据失败:', error);
      tableDataContent.innerHTML = `<div class="error-message">删除失败: ${error.message}</div>`;
    }
  }

  async cleanupSQLiteData() {
    if (!confirm('确定要清空SQLite数据库中的所有数据吗？此操作将删除所有文档和分块数据，但保留表结构。')) {
      return;
    }

    const tableDataContent = document.getElementById('table-data-content');
    tableDataContent.innerHTML = '<div class="loading">正在清空SQLite数据...</div>';

    try {
      const response = await fetch(`${this.baseUrl}/api/cleanup/sqlite-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        tableDataContent.innerHTML = `<div class="success-message">${data.message}</div>`;
        // 重新获取表列表和数据
        setTimeout(() => {
          this.getAllTables();
          this.queryTableData();
        }, 1500);
        
        // 触发全局事件，通知其他模块数据已更新
        this.notifyDataUpdate('sqlite');
        
      } else {
        throw new Error(data.detail || '清空失败');
      }
    } catch (error) {
      console.error('清空SQLite数据失败:', error);
      tableDataContent.innerHTML = `<div class="error-message">清空失败: ${error.message}</div>`;
    }
  }

  async cleanupFaissVectors() {
    if (!confirm('确定要清空Faiss向量数据库中的所有向量吗？此操作将删除所有向量数据，但保留索引结构。')) {
      return;
    }

    const vectorsDataContent = document.getElementById('vectors-data-content');
    vectorsDataContent.innerHTML = '<div class="loading">正在清空Faiss向量...</div>';

    try {
      const response = await fetch(`${this.baseUrl}/api/cleanup/faiss-vectors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        vectorsDataContent.innerHTML = `<div class="success-message">${data.message}</div>`;
        // 重新获取统计信息
        setTimeout(() => this.getFaissStatistics(), 1500);
        // 清空当前显示的向量数据，避免用户看到旧数据
        const vectorsTableContent = document.getElementById('vectors-data-content');
        if (vectorsTableContent && vectorsTableContent.innerHTML.includes('vectors-table')) {
          vectorsTableContent.innerHTML = '<p>Faiss向量已清空，请重新查询</p>';
        }
        
        // 触发全局事件，通知其他模块数据已更新
        this.notifyDataUpdate('faiss');
        
      } else {
        throw new Error(data.detail || '清空失败');
      }
    } catch (error) {
      console.error('清空Faiss向量失败:', error);
      vectorsDataContent.innerHTML = `<div class="error-message">清空失败: ${error.message}</div>`;
    }
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

    normalized = normalized.replace(/\\/g, '/').replace(/^\.\//, '');

    if (/^[a-zA-Z]:\//.test(normalized)) {
      return `file:///${normalized}`;
    }

    if (normalized.startsWith('/')) {
      return `file://${normalized}`;
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

    const statusEl = document.getElementById('image-vectors-status');
    const tableEl = document.getElementById('image-vector-table');
    const statsEl = document.getElementById('image-vector-stats-content');
    const pageInfoEl = document.getElementById('image-vector-page-info');
    const pageSizeSelect = document.getElementById('image-vector-page-size');
    const searchInput = document.getElementById('image-vector-search');

    if (!statusEl || !tableEl) {
      return;
    }

    if (pageSizeSelect && parseInt(pageSizeSelect.value, 10) !== this.imageVectorState.limit) {
      pageSizeSelect.value = String(this.imageVectorState.limit);
    }

    if (searchInput && searchInput !== document.activeElement) {
      searchInput.value = this.imageVectorState.search;
    }

    this.imageVectorState.loading = true;

    statusEl.textContent = '正在加载图片向量信息...';
    statusEl.className = 'status-indicator status-info';
    tableEl.innerHTML = '<div class="loading">正在查询图片向量数据...</div>';
    if (statsEl) {
      statsEl.innerHTML = '';
    }
    if (pageInfoEl) {
      pageInfoEl.textContent = '';
    }

    try {
      const params = new URLSearchParams();
      params.append('limit', String(this.imageVectorState.limit));
      params.append('offset', String(this.imageVectorState.offset));
      if (this.imageVectorState.search) {
        params.append('search', this.imageVectorState.search);
      }

      const response = await fetch(`${this.baseUrl}/api/database/image-vectors?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        throw new Error(data.detail || '获取图片向量信息失败');
      }

      this.imageVectorState.total = data.total || 0;
      this.renderImageVectorTable(data.records || []);
      this.renderImageVectorStats(data.stats || null);
      this.updateImagePagination();

      const recordCount = Array.isArray(data.records) ? data.records.length : 0;
      statusEl.textContent = `已加载 ${recordCount} 条图片向量记录`;
      statusEl.className = 'status-indicator status-success';
      this.imageVectorsInitialized = true;
    } catch (error) {
      console.error('获取图片向量信息失败:', error);
      statusEl.textContent = `获取图片向量信息失败: ${error.message}`;
      statusEl.className = 'status-indicator status-error';
      tableEl.innerHTML = `<div class="error-message">${this.escapeHtml(error.message || '加载失败')}</div>`;
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

  renderImageVectorTable(records) {
    const container = document.getElementById('image-vector-table');
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
  async testFaissConnection() {
    const statusEl = document.getElementById('faiss-status');
    statusEl.innerHTML = '<span class="status-loading">正在测试Faiss连接...</span>';

    try {
      const response = await fetch(`${this.baseUrl}/api/faiss/test-connection`);
      const data = await response.json();

      if (response.ok) {
        statusEl.innerHTML = `
          <span class="status-success">✓ Faiss连接成功</span>
          <div class="connection-info">
            <p>向量总数: ${data.total_vectors}</p>
            <p>向量维度: ${data.dimension}</p>
            <p>索引类型: ${data.index_type}</p>
          </div>
        `;
      } else {
        statusEl.innerHTML = `<span class="status-error">✗ 连接失败: ${data.detail}</span>`;
      }
    } catch (error) {
      statusEl.innerHTML = `<span class="status-error">✗ 连接错误: ${error.message}</span>`;
    }
  }

  async getFaissStatistics() {
    const statusEl = document.getElementById('faiss-status');
    const contentEl = document.getElementById('statistics-content');
    
    statusEl.innerHTML = '<span class="status-loading">正在获取统计信息...</span>';

    try {
      const response = await fetch(`${this.baseUrl}/api/faiss/statistics`);
      const data = await response.json();

      if (response.ok) {
        statusEl.innerHTML = '<span class="status-success">✓ 统计信息获取成功</span>';
        this.renderFaissStatistics(data);
        this.populateVectorTypeSelect(data.type_statistics);
      } else {
        statusEl.innerHTML = `<span class="status-error">✗ 获取失败: ${data.detail}</span>`;
        contentEl.innerHTML = '<p>获取统计信息失败</p>';
      }
    } catch (error) {
      statusEl.innerHTML = `<span class="status-error">✗ 请求错误: ${error.message}</span>`;
      contentEl.innerHTML = '<p>请求统计信息时发生错误</p>';
    }
  }

  renderFaissStatistics(data) {
    const contentEl = document.getElementById('statistics-content');
    
    let html = `
      <div class="statistics-grid">
        <div class="stat-item">
          <strong>向量总数:</strong> ${data.total_vectors}
        </div>
        <div class="stat-item">
          <strong>元数据数量:</strong> ${data.metadata_count}
        </div>
        <div class="stat-item">
          <strong>向量维度:</strong> ${data.dimension}
        </div>
        <div class="stat-item">
          <strong>索引路径:</strong> ${data.index_path}
        </div>
        <div class="stat-item">
          <strong>元数据路径:</strong> ${data.metadata_path}
        </div>
      </div>
    `;

    if (data.type_statistics && Object.keys(data.type_statistics).length > 0) {
      html += '<h4>按类型统计:</h4><div class="type-stats">';
      for (const [type, count] of Object.entries(data.type_statistics)) {
        html += `<div class="type-stat-item"><strong>${type}:</strong> ${count}</div>`;
      }
      html += '</div>';
    }

    contentEl.innerHTML = html;
  }

  populateVectorTypeSelect(typeStats) {
    const selectEl = document.getElementById('vector-type-select');
    selectEl.innerHTML = '<option value="">选择向量类型...</option>';
    
    if (typeStats && Object.keys(typeStats).length > 0) {
      for (const type of Object.keys(typeStats)) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = `${type} (${typeStats[type]})`;
        selectEl.appendChild(option);
      }
    }
  }

  async queryVectorData() {
    if (!this.selectedVectorType) {
      showAlert('请先选择向量类型', 'warning');
      return;
    }

    const statusEl = document.getElementById('faiss-status');
    const contentEl = document.getElementById('vectors-data-content');
    
    statusEl.innerHTML = '<span class="status-loading">正在查询向量数据...</span>';

    try {
      const response = await fetch(`${this.baseUrl}/api/faiss/vectors/by-type/${this.selectedVectorType}?limit=50`);
      const data = await response.json();

      if (response.ok) {
        statusEl.innerHTML = `<span class="status-success">✓ 查询成功，共 ${data.total_count} 条记录</span>`;
        this.renderVectorData(data.vectors);
      } else {
        statusEl.innerHTML = `<span class="status-error">✗ 查询失败: ${data.detail}</span>`;
        contentEl.innerHTML = '<p>查询向量数据失败</p>';
      }
    } catch (error) {
      statusEl.innerHTML = `<span class="status-error">✗ 请求错误: ${error.message}</span>`;
      contentEl.innerHTML = '<p>请求向量数据时发生错误</p>';
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
    html += '<th>向量ID</th><th>类型</th><th>文件名</th><th>内容</th><th>其他信息</th>';
    html += '</tr></thead><tbody>';

    vectors.forEach(vector => {
      // 确定文件类型（优先使用file_type字段）
      const fileType = vector.file_type || 'unknown';
      
      // 确定文件名（优先使用filename字段）
      const filename = vector.filename || 'N/A';
      
      // 确定内容（优先使用chunk_text，其次使用text字段）
      const content = vector.chunk_text || vector.text || 'N/A';
      
      html += '<tr>';
      html += `<td>${vector.vector_id ?? 'N/A'}</td>`;
      html += `<td>${this.escapeHtml(fileType)}</td>`;
      html += `<td>${this.escapeHtml(filename)}</td>`;
      html += `<td>${this.escapeHtml(this.truncateText(content, 100))}</td>`;
      
      // 显示其他元数据（只显示核心字段，排除已显示的内容）
      const otherInfo = [];
      for (const [key, value] of Object.entries(vector)) {
        if (!['vector_id', 'file_type', 'filename', 'chunk_text', 'text'].includes(key)) {
          otherInfo.push(`${key}: ${value}`);
        }
      }
      html += `<td>${this.escapeHtml(otherInfo.join(', ') || 'N/A')}</td>`;
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
