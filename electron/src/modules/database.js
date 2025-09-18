class DatabaseModule {
  constructor() {
    this.baseUrl = 'http://localhost:8000';
    this.currentTables = [];
    this.selectedTable = null;
    this.currentVectorTypes = [];
    this.selectedVectorType = null;
    this.currentTab = 'sqlite';
    this.init();
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
      alert('请先选择一个表');
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
    if (!this.selectedTable) {
      alert('请先选择一个表');
      return;
    }

    // 确认删除
    const confirmed = confirm(`确定要删除表 "${this.selectedTable}" 中的所有数据吗？此操作不可撤销！`);
    if (!confirmed) {
      return;
    }

    const statusEl = document.getElementById('db-status');
    statusEl.textContent = '正在删除数据...';
    statusEl.className = 'status-indicator status-info';

    try {
      const response = await fetch(`${this.baseUrl}/api/database/table/${this.selectedTable}/data`, {
        method: 'DELETE'
      });
      const data = await response.json();

      if (response.ok && data.status === 'success') {
        statusEl.textContent = `删除成功！已删除 ${data.deleted_rows} 行数据`;
        statusEl.className = 'status-indicator status-success';
        
        // 重新查询表数据以显示空表
        setTimeout(() => this.queryTableData(), 500);
      } else {
        throw new Error(data.detail || '删除失败');
      }
    } catch (error) {
      console.error('删除表数据失败:', error);
      statusEl.textContent = `删除失败: ${error.message}`;
      statusEl.className = 'status-indicator status-error';
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

  // 工具方法：截断长文本
  truncateText(text, maxLength = 100) {
    if (typeof text !== 'string') {
      text = String(text);
    }
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
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
      alert('请先选择向量类型');
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