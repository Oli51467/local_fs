/**
 * 设置模块
 * 负责应用设置的管理，包括深色模式切换、设置保存和加载等功能
 */

class SettingsModule {
  constructor() {
    this.isDarkMode = false;
    this.settingsPageEl = document.getElementById('settings-page');
    this.fileContentEl = document.getElementById('file-content');
    this.settingsBtn = document.getElementById('settings-btn');
    this.darkModeToggle = document.getElementById('dark-mode-toggle');
    this.toggleTreeBtn = document.getElementById('toggle-tree');

    this.baseApiUrl = 'http://localhost:8000';
    this.retrievalCardEl = document.getElementById('retrieval-settings-card');
    this.retrievalSaveBtn = document.getElementById('retrieval-settings-save');
    this.retrievalReloadBtn = document.getElementById('retrieval-settings-reload');
    this.retrievalStatusEl = document.getElementById('retrieval-settings-status');
    this.retrievalInputs = {
      RECURSIVE_CHUNK_SIZE: document.getElementById('retrieval-chunk-size'),
      RECURSIVE_CHUNK_OVERLAP: document.getElementById('retrieval-chunk-overlap'),
      BM25S_WEIGHT: document.getElementById('retrieval-bm25s-weight'),
      EMBEDDING_WEIGHT: document.getElementById('retrieval-embedding-weight')
    };
    this.retrievalValueEls = {
      RECURSIVE_CHUNK_SIZE: document.getElementById('retrieval-chunk-size-value'),
      RECURSIVE_CHUNK_OVERLAP: document.getElementById('retrieval-chunk-overlap-value'),
      BM25S_WEIGHT: document.getElementById('retrieval-bm25s-weight-value'),
      EMBEDDING_WEIGHT: document.getElementById('retrieval-embedding-weight-value')
    };
    this.retrievalConfig = null;
    this.retrievalConfigDirty = false;
    this.retrievalLoading = false;
    this.retrievalStatusTimer = null;
    this.retrievalValidationError = null;
    this.retrievalStatusContext = null;
    
    this.init();
  }

  /**
   * 初始化设置模块
   */
  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.setupConfigListener();
    await this.loadRetrievalSettings();
  }

  /**
   * 设置配置更新监听器
   */
  setupConfigListener() {
    // 监听来自主进程的配置更新事件
    if (window.fsAPI && window.fsAPI.onSettingsUpdated) {
      window.fsAPI.onSettingsUpdated((newConfig) => {
        console.log('收到配置更新:', newConfig);
        this.isDarkMode = newConfig.darkMode || false;
        this.applyTheme();
        // 不需要保存，因为配置已经在主进程中更新了
      });
    }
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 设置按钮点击事件
    this.settingsBtn.addEventListener('click', () => {
      this.showSettingsPage();
    });

    // 深色模式切换事件
    this.darkModeToggle.addEventListener('change', async (e) => {
      this.isDarkMode = e.target.checked;
      this.applyTheme();
      await this.saveSettings();
    });

    // 文件按钮点击事件
    this.toggleTreeBtn.addEventListener('click', () => {
      this.showFilePage();
    });
    
    // 搜索按钮点击事件已在renderer.js中处理，这里不需要重复绑定

    this.bindRetrievalEvents();
  }

  /**
   * 应用主题
   */
  applyTheme() {
    if (this.isDarkMode) {
      document.body.classList.add('dark-mode');
      this.darkModeToggle.checked = true;
    } else {
      document.body.classList.remove('dark-mode');
      this.darkModeToggle.checked = false;
    }
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const settings = await window.fsAPI.getSettings();
      this.isDarkMode = settings.darkMode || false;
      this.applyTheme();
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    try {
      await window.fsAPI.saveSettings({ darkMode: this.isDarkMode });
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  }

  bindRetrievalEvents() {
    if (!this.retrievalCardEl) {
      return;
    }

    const sliderHandler = (event) => {
      this.handleRetrievalSliderInput(event);
    };

    Object.values(this.retrievalInputs).forEach((inputEl) => {
      if (!inputEl) {
        return;
      }
      inputEl.addEventListener('input', sliderHandler);
      inputEl.addEventListener('change', sliderHandler);
    });

    if (this.retrievalSaveBtn) {
      this.retrievalSaveBtn.addEventListener('click', () => {
        this.saveRetrievalSettings();
      });
    }

    if (this.retrievalReloadBtn) {
      this.retrievalReloadBtn.addEventListener('click', () => {
        this.resetRetrievalSettings();
      });
    }
  }

  async loadRetrievalSettings(options = {}) {
    if (!this.retrievalCardEl || this.retrievalLoading) {
      return;
    }

    const { force = false } = options;
    if (this.retrievalConfig && !force) {
      this.applyRetrievalConfig(this.retrievalConfig);
      return;
    }

    this.setRetrievalLoading(true);
    this.setRetrievalStatus('正在加载检索配置...', 'info', { context: 'operation' });

    try {
      const response = await fetch(`${this.baseApiUrl}/api/config/retrieval`);
      if (!response.ok) {
        throw new Error(`加载失败: ${response.status}`);
      }
      const data = await response.json();
      this.retrievalConfig = {
        RECURSIVE_CHUNK_SIZE: Number(data.recursive_chunk_size),
        RECURSIVE_CHUNK_OVERLAP: Number(data.recursive_chunk_overlap),
        BM25S_WEIGHT: Number(data.bm25s_weight),
        EMBEDDING_WEIGHT: Number(data.embedding_weight)
      };
      this.applyRetrievalConfig(this.retrievalConfig);
      this.retrievalConfigDirty = false;
      this.validateRetrievalConfig({ showFeedback: false });
      this.setRetrievalStatus('已加载当前配置', 'success', { autoClear: true, context: 'operation' });
    } catch (error) {
      console.error('获取检索配置失败:', error);
      this.setRetrievalStatus('加载检索配置失败，请检查后端服务。', 'error', { context: 'operation' });
    } finally {
      this.setRetrievalLoading(false);
      this.updateRetrievalSaveButtonState();
    }
  }

  setRetrievalLoading(isLoading) {
    this.retrievalLoading = isLoading;

    Object.values(this.retrievalInputs).forEach((inputEl) => {
      if (inputEl) {
        inputEl.disabled = isLoading;
      }
    });

    if (this.retrievalReloadBtn) {
      this.retrievalReloadBtn.disabled = isLoading;
    }

    this.updateRetrievalSaveButtonState();

    if (this.retrievalCardEl) {
      this.retrievalCardEl.classList.toggle('is-loading', isLoading);
    }
  }

  updateRetrievalSaveButtonState() {
    if (!this.retrievalSaveBtn) {
      return;
    }
    const shouldEnable = this.retrievalConfigDirty && !this.retrievalLoading && !this.retrievalValidationError;
    this.retrievalSaveBtn.disabled = !shouldEnable;
  }

  handleRetrievalSliderInput(event) {
    const target = event?.target;
    if (!target || !target.dataset || !target.dataset.configKey) {
      return;
    }

    const configKey = target.dataset.configKey;
    const parsedValue = this.parseSliderValue(configKey, target.value);

    if (!this.retrievalConfig) {
      this.retrievalConfig = {};
    }

    this.retrievalConfig[configKey] = parsedValue;
    this.updateRetrievalValueDisplay(configKey, parsedValue);
    this.retrievalConfigDirty = true;
    this.updateRetrievalSaveButtonState();
    this.validateRetrievalConfig({ showFeedback: true });
  }

  parseSliderValue(key, rawValue) {
    if (key === 'BM25S_WEIGHT' || key === 'EMBEDDING_WEIGHT') {
      const numeric = Number.parseFloat(rawValue);
      return Number.isNaN(numeric) ? 0 : Number(numeric.toFixed(2));
    }
    const numeric = Number.parseInt(rawValue, 10);
    return Number.isNaN(numeric) ? 0 : numeric;
  }

  updateRetrievalValueDisplay(key, value) {
    const targetEl = this.retrievalValueEls[key];
    if (!targetEl) {
      return;
    }

    if (key === 'BM25S_WEIGHT' || key === 'EMBEDDING_WEIGHT') {
      targetEl.textContent = value.toFixed(2);
    } else {
      targetEl.textContent = String(Math.round(value));
    }
  }

  applyRetrievalConfig(config) {
    if (!config) {
      return;
    }

    Object.entries(this.retrievalInputs).forEach(([key, inputEl]) => {
      if (!inputEl || config[key] === undefined) {
        return;
      }
      const value = config[key];
      inputEl.value = key === 'BM25S_WEIGHT' || key === 'EMBEDDING_WEIGHT'
        ? Number(value).toFixed(2)
        : String(Math.round(value));
      this.updateRetrievalValueDisplay(key, Number(value));
    });
    this.validateRetrievalConfig({ showFeedback: false });
  }

  clearRetrievalStatus() {
    if (this.retrievalStatusEl) {
      this.retrievalStatusEl.textContent = '';
      delete this.retrievalStatusEl.dataset.status;
      delete this.retrievalStatusEl.dataset.context;
    }
    this.retrievalStatusContext = null;
  }

  setRetrievalStatus(message, status, options = {}) {
    if (!this.retrievalStatusEl) {
      return;
    }

    const { autoClear = false, timeout = 2800, context = null } = options;

    this.retrievalStatusEl.textContent = message || '';
    if (status) {
      this.retrievalStatusEl.dataset.status = status;
    } else {
      delete this.retrievalStatusEl.dataset.status;
    }
    if (context) {
      this.retrievalStatusEl.dataset.context = context;
    } else {
      delete this.retrievalStatusEl.dataset.context;
    }
    this.retrievalStatusContext = context;

    if (this.retrievalStatusTimer) {
      clearTimeout(this.retrievalStatusTimer);
      this.retrievalStatusTimer = null;
    }

    if (message && autoClear && status !== 'error') {
      this.retrievalStatusTimer = window.setTimeout(() => {
        this.clearRetrievalStatus();
      }, timeout);
    }
  }

  buildRetrievalPayload() {
    const source = this.retrievalConfig || {};
    return {
      recursive_chunk_size: Number(source.RECURSIVE_CHUNK_SIZE ?? this.retrievalInputs.RECURSIVE_CHUNK_SIZE?.value ?? 0),
      recursive_chunk_overlap: Number(source.RECURSIVE_CHUNK_OVERLAP ?? this.retrievalInputs.RECURSIVE_CHUNK_OVERLAP?.value ?? 0),
      bm25s_weight: Number(source.BM25S_WEIGHT ?? this.retrievalInputs.BM25S_WEIGHT?.value ?? 0),
      embedding_weight: Number(source.EMBEDDING_WEIGHT ?? this.retrievalInputs.EMBEDDING_WEIGHT?.value ?? 0)
    };
  }

  async saveRetrievalSettings() {
    if (!this.retrievalCardEl || !this.retrievalConfigDirty || this.retrievalLoading) {
      return;
    }

    if (!this.validateRetrievalConfig({ showFeedback: true })) {
      return;
    }

    const payload = this.buildRetrievalPayload();

    this.setRetrievalLoading(true);
    this.setRetrievalStatus('正在保存...', 'info', { context: 'operation' });

    try {
      const response = await fetch(`${this.baseApiUrl}/api/config/retrieval`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const detail = errorPayload?.detail || `保存失败: ${response.status}`;
        throw new Error(detail);
      }

      const data = await response.json();
      this.retrievalConfig = {
        RECURSIVE_CHUNK_SIZE: Number(data.recursive_chunk_size),
        RECURSIVE_CHUNK_OVERLAP: Number(data.recursive_chunk_overlap),
        BM25S_WEIGHT: Number(data.bm25s_weight),
        EMBEDDING_WEIGHT: Number(data.embedding_weight)
      };
      this.applyRetrievalConfig(this.retrievalConfig);
      this.retrievalConfigDirty = false;
      this.setRetrievalStatus('设置已保存', 'success', { autoClear: true, context: 'operation' });
    } catch (error) {
      console.error('保存检索配置失败:', error);
      this.setRetrievalStatus(error?.message || '保存失败，请稍后重试。', 'error', { context: 'operation' });
    } finally {
      this.setRetrievalLoading(false);
      this.updateRetrievalSaveButtonState();
    }
  }

  async resetRetrievalSettings() {
    if (!this.retrievalCardEl || this.retrievalLoading) {
      return;
    }

    this.setRetrievalLoading(true);
    this.setRetrievalStatus('正在恢复默认配置...', 'info', { context: 'operation' });

    try {
      const response = await fetch(`${this.baseApiUrl}/api/config/retrieval/reset`, {
        method: 'POST'
      });
      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        const detail = errorPayload?.detail || `恢复失败: ${response.status}`;
        throw new Error(detail);
      }

      const data = await response.json();
      this.retrievalConfig = {
        RECURSIVE_CHUNK_SIZE: Number(data.recursive_chunk_size),
        RECURSIVE_CHUNK_OVERLAP: Number(data.recursive_chunk_overlap),
        BM25S_WEIGHT: Number(data.bm25s_weight),
        EMBEDDING_WEIGHT: Number(data.embedding_weight)
      };
      this.applyRetrievalConfig(this.retrievalConfig);
      this.retrievalConfigDirty = false;
      this.validateRetrievalConfig({ showFeedback: false });
      this.setRetrievalStatus('已恢复默认配置', 'success', { autoClear: true, context: 'operation' });
    } catch (error) {
      console.error('恢复默认检索配置失败:', error);
      this.setRetrievalStatus(error?.message || '恢复默认失败，请稍后重试。', 'error', { context: 'operation' });
    } finally {
      this.setRetrievalLoading(false);
      this.updateRetrievalSaveButtonState();
    }
  }

  validateRetrievalConfig(options = {}) {
    if (!this.retrievalCardEl) {
      return true;
    }

    const { showFeedback = false } = options;
    const payload = this.buildRetrievalPayload();

    let errorMessage = null;
    if (payload.recursive_chunk_overlap > payload.recursive_chunk_size) {
      errorMessage = '分块重叠不能大于分块大小，请调整后再保存。';
    } else if ((payload.bm25s_weight + payload.embedding_weight) <= 0) {
      errorMessage = 'BM25S 与向量检索权重至少需要一个大于 0。';
    }

    this.retrievalValidationError = errorMessage;

    if (errorMessage) {
      if (showFeedback) {
        this.setRetrievalStatus(errorMessage, 'error', { context: 'validation' });
      }
      this.updateRetrievalSaveButtonState();
      return false;
    }

    if (showFeedback && this.retrievalStatusContext === 'validation') {
      this.clearRetrievalStatus();
    }
    this.updateRetrievalSaveButtonState();
    return true;
  }

  /**
   * 显示文件页面
   */
  showFilePage() {
    this.fileContentEl.style.display = 'block';
    this.settingsPageEl.style.display = 'none';
    
    // 隐藏测试页面
    const testPage = document.getElementById('test-page');
    if (testPage) {
      testPage.style.display = 'none';
    }
    
    // 隐藏数据库页面
    const databasePage = document.getElementById('database-page');
    if (databasePage) {
      databasePage.style.display = 'none';
    }

    const chatPage = document.getElementById('chat-page');
    if (chatPage) {
      chatPage.style.display = 'none';
    }

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }
    
    // 显示文件树容器
    const fileTreeContainer = document.getElementById('file-tree-container');
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'block';
    }
  }

  /**
   * 显示设置页面
   */
  showSettingsPage() {
    this.fileContentEl.style.display = 'none';
    this.settingsPageEl.style.display = 'block';
    
    // 隐藏测试页面
    const testPage = document.getElementById('test-page');
    if (testPage) {
      testPage.style.display = 'none';
    }
    
    // 隐藏数据库页面
    const databasePage = document.getElementById('database-page');
    if (databasePage) {
      databasePage.style.display = 'none';
    }

    const chatPage = document.getElementById('chat-page');
    if (chatPage) {
      chatPage.style.display = 'none';
    }

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }
    
    // 折叠操作栏，隐藏左侧的文件树容器
    const fileTreeContainer = document.getElementById('file-tree-container');
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }
  }

  /**
   * 获取当前主题模式
   */
  getDarkMode() {
    return this.isDarkMode;
  }

  /**
   * 设置主题模式
   */
  async setDarkMode(darkMode) {
    this.isDarkMode = darkMode;
    this.applyTheme();
    await this.saveSettings();
  }
}

// 导出设置模块
window.SettingsModule = SettingsModule;
