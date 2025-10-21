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

    this.apiStatusEl = document.getElementById('api-settings-status');
    this.apiSaveBtn = document.getElementById('api-settings-save');
    this.apiInputs = {
      openaiApiKey: document.getElementById('api-key-openai'),
      modelscopeApiKey: document.getElementById('api-key-modelscope'),
      qwenApiKey: document.getElementById('api-key-qwen'),
      kimiApiKey: document.getElementById('api-key-kimi'),
      claudeApiKey: document.getElementById('api-key-claude'),
      siliconflwApiKey: document.getElementById('api-key-siliconflw')
    };
    this.apiVisibilityControllers = [];
    this.apiSettings = {
      openaiApiKey: '',
      modelscopeApiKey: '',
      qwenApiKey: '',
      kimiApiKey: '',
      claudeApiKey: '',
      siliconflwApiKey: ''
    };
    this.apiSettingsOriginal = { ...this.apiSettings };
    this.apiSettingsKeys = Object.keys(this.apiSettings);
    this.apiSettingsDirty = false;
    this.apiSettingsLoading = false;
    this.apiStatusTimer = null;

    this.currentSettings = {};
    this.customModels = [];
    this.enableModelSummary = false;
    this.modelSummarySelection = null;
    this.availableSummaryModels = [];
    this.enableSummarySearch = false;
    this.modelSummaryRegistryDisposer = null;
    this.modelSummaryToggleEl = null;
    this.modelSummarySelectEl = null;
    this.modelSummaryHintEl = null;
    this.modelSummaryStatusEl = null;
    this.modelSummarySelectorEl = null;
    this.modelSummarySectionEl = null;
    this.modelSummarySaveTimer = null;
    this.summarySearchToggleEl = null;

    this.init();
  }

  /**
   * 初始化设置模块
   */
  async init() {
    await this.loadSettings();
    this.setupModelSummaryControls();
    this.setupSummarySearchControl();
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
        this.currentSettings = { ...this.currentSettings, ...newConfig };
        if (!this.apiSettingsDirty) {
          this.updateApiSettingsFromConfig(newConfig, { replaceOriginal: true, silent: true, resetVisibility: true });
        }
        this.customModels = this.normalizeCustomModels(newConfig?.customModels);
        this.enableModelSummary = Boolean(newConfig?.enableModelSummary);
        this.modelSummarySelection = this.sanitizeModelSelection(newConfig?.modelSummarySelection);
        this.enableSummarySearch = Boolean(newConfig?.enableSummarySearch);
        this.refreshSummaryModelOptions();
        this.syncSummaryControls();
        this.syncSummarySearchControl();
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

    this.bindApiSettingsEvents();
    this.bindRetrievalEvents();
  }

  /**
   * 应用主题
   */
  applyTheme() {
    if (this.isDarkMode) {
      document.body.classList.add('dark-mode');
      this.darkModeToggle.checked = true;
      // 同步标题栏主题
      window.fsAPI.setTitleBarTheme(true);
    } else {
      document.body.classList.remove('dark-mode');
      this.darkModeToggle.checked = false;
      // 同步标题栏主题
      window.fsAPI.setTitleBarTheme(false);
    }
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const settings = await window.fsAPI.getSettings();
      this.currentSettings = settings || {};
      this.isDarkMode = Boolean(settings?.darkMode);
      this.applyTheme();
      this.updateApiSettingsFromConfig(settings, { replaceOriginal: true, silent: true, resetVisibility: true });
      this.updateApiSaveButtonState();
      this.customModels = this.normalizeCustomModels(settings?.customModels);
      this.enableModelSummary = Boolean(settings?.enableModelSummary);
      this.modelSummarySelection = this.sanitizeModelSelection(settings?.modelSummarySelection);
      this.enableSummarySearch = Boolean(settings?.enableSummarySearch);
      // 确保标题栏主题在应用启动时正确应用
      await window.fsAPI.setTitleBarTheme(this.isDarkMode);
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  /**
   * 保存设置
   */
  async saveSettings(overrides = {}) {
    const payload = {
      darkMode: this.isDarkMode,
      customModels: this.customModels,
      enableModelSummary: this.enableModelSummary,
      enableSummarySearch: this.enableSummarySearch,
      modelSummarySelection: this.sanitizeModelSelection(this.modelSummarySelection),
      ...overrides
    };
    const cleanedPayload = {};
    Object.keys(payload).forEach((key) => {
      if (payload[key] !== undefined) {
        cleanedPayload[key] = payload[key];
      }
    });

    try {
      const result = await window.fsAPI.saveSettings(cleanedPayload);
      if (!result || result.success !== false) {
        this.currentSettings = { ...this.currentSettings, ...cleanedPayload };
      }
      return result;
    } catch (error) {
      console.error('保存设置失败:', error);
      return { success: false, error: error?.message || error };
    }
  }

  bindApiSettingsEvents() {
    const handleInput = (event) => {
      const target = event?.target;
      const settingsKey = target?.dataset?.settingsKey;
      if (!settingsKey) {
        return;
      }
      this.handleApiInputChange(settingsKey, target.value);
    };

    const handleBlur = (event) => {
      const target = event?.target;
      const settingsKey = target?.dataset?.settingsKey;
      if (!settingsKey) {
        return;
      }
      const trimmed = target.value.trim();
      if (trimmed !== target.value) {
        target.value = trimmed;
        this.handleApiInputChange(settingsKey, trimmed);
      }
    };

    Object.entries(this.apiInputs).forEach(([key, inputEl]) => {
      if (!inputEl) {
        return;
      }
      inputEl.addEventListener('input', handleInput);
      inputEl.addEventListener('blur', handleBlur);
    });

    this.setupApiVisibilityControllers();

    if (this.apiSaveBtn) {
      this.apiSaveBtn.addEventListener('click', () => {
        this.saveApiSettings();
      });
    }

    this.hideAllApiKeys();
    this.updateApiInputValues();
    this.updateApiSaveButtonState();
  }

  setupApiVisibilityControllers() {
    this.apiVisibilityControllers = [];
    const toggles = document.querySelectorAll('.settings-input-visibility-toggle');
    toggles.forEach((button) => {
      const inputId = button?.dataset?.targetInput;
      const inputEl = inputId ? document.getElementById(inputId) : null;
      if (!inputEl) {
        button.disabled = true;
        return;
      }
      const controller = { button, input: inputEl, visible: false };
      this.apiVisibilityControllers.push(controller);
      this.updateApiVisibility(controller, false);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (button.disabled) {
          return;
        }
        controller.visible = !controller.visible;
        this.updateApiVisibility(controller, controller.visible);
        if (controller.visible && !this.apiSettingsLoading) {
          controller.input.focus({ preventScroll: true });
          const valueLength = controller.input.value?.length ?? 0;
          try {
            controller.input.setSelectionRange(valueLength, valueLength);
          } catch (error) {
            // 某些输入类型不支持 setSelectionRange，忽略即可
          }
        }
      });
    });
  }

  updateApiVisibility(controller, shouldShow) {
    if (!controller || !controller.input || !controller.button) {
      return;
    }
    const nextType = shouldShow ? 'text' : 'password';
    try {
      controller.input.type = nextType;
    } catch (error) {
      controller.input.setAttribute('type', nextType);
    }
    controller.visible = shouldShow;
    controller.button.classList.toggle('is-visible', shouldShow);
    controller.button.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
    const platform = controller.button.dataset?.platformName || '';
    const prefix = shouldShow ? '隐藏' : '显示';
    const suffix = platform ? ` ${platform} API Key` : ' API Key';
    controller.button.setAttribute('aria-label', `${prefix}${suffix}`);
  }

  hideAllApiKeys() {
    if (!this.apiVisibilityControllers || !this.apiVisibilityControllers.length) {
      return;
    }
    this.apiVisibilityControllers.forEach((controller) => {
      this.updateApiVisibility(controller, false);
    });
  }

  handleApiInputChange(settingsKey, rawValue) {
    if (!this.apiSettingsKeys.includes(settingsKey)) {
      return;
    }
    this.apiSettings[settingsKey] = rawValue;
    const wasDirty = this.apiSettingsDirty;
    this.apiSettingsDirty = this.checkApiSettingsDirty();
    this.updateApiSaveButtonState();
    if (this.apiSettingsDirty) {
      this.setApiStatus('有未更新的更改', 'info');
    } else if (wasDirty) {
      this.clearApiStatus();
    }
  }

  checkApiSettingsDirty() {
    return this.apiSettingsKeys.some((key) => {
      const current = this.apiSettings[key] ?? '';
      const original = this.apiSettingsOriginal[key] ?? '';
      return current !== original;
    });
  }

  updateApiSaveButtonState() {
    const disableActions = this.apiSettingsLoading || !this.apiSettingsDirty;
    if (this.apiSaveBtn) {
      this.apiSaveBtn.disabled = disableActions;
    }
  }

  setApiSettingsLoading(isLoading) {
    this.apiSettingsLoading = Boolean(isLoading);
    Object.values(this.apiInputs).forEach((inputEl) => {
      if (inputEl) {
        inputEl.disabled = this.apiSettingsLoading;
      }
    });
    if (this.apiVisibilityControllers && this.apiVisibilityControllers.length) {
      this.apiVisibilityControllers.forEach((controller) => {
        if (controller?.button) {
          controller.button.disabled = this.apiSettingsLoading;
        }
      });
    }
    this.updateApiSaveButtonState();
  }

  setApiStatus(message, status = 'info', options = {}) {
    if (!this.apiStatusEl) {
      return;
    }
    if (this.apiStatusTimer) {
      clearTimeout(this.apiStatusTimer);
      this.apiStatusTimer = null;
    }
    if (message) {
      this.apiStatusEl.textContent = message;
      this.apiStatusEl.dataset.status = status;
    } else {
      this.apiStatusEl.textContent = '';
      this.apiStatusEl.removeAttribute('data-status');
    }

    const autoClear = options.autoClear;
    if (autoClear) {
      const delay = typeof autoClear === 'number' ? autoClear : 3200;
      this.apiStatusTimer = window.setTimeout(() => {
        this.clearApiStatus();
      }, delay);
    }
  }

  clearApiStatus() {
    if (!this.apiStatusEl) {
      return;
    }
    if (this.apiStatusTimer) {
      clearTimeout(this.apiStatusTimer);
      this.apiStatusTimer = null;
    }
    this.apiStatusEl.textContent = '';
    this.apiStatusEl.removeAttribute('data-status');
  }

  updateApiInputValues() {
    Object.entries(this.apiInputs).forEach(([key, inputEl]) => {
      if (!inputEl) {
        return;
      }
      inputEl.value = this.apiSettings[key] ?? '';
    });
  }

  updateApiSettingsFromConfig(source = {}, options = {}) {
    let changed = false;
    const configSource = source || {};
    this.apiSettingsKeys.forEach((key) => {
      const incoming = configSource[key] !== undefined && configSource[key] !== null ? String(configSource[key]) : '';
      if (this.apiSettings[key] !== incoming) {
        this.apiSettings[key] = incoming;
        changed = true;
      }
    });
    if (changed || options.forceUpdateInputs) {
      this.updateApiInputValues();
    }
    if (options.resetVisibility || options.replaceOriginal) {
      this.hideAllApiKeys();
    }
    if (options.replaceOriginal) {
      this.apiSettingsOriginal = { ...this.apiSettings };
      this.apiSettingsDirty = false;
      this.updateApiSaveButtonState();
      if (!options.silent) {
        this.clearApiStatus();
      }
    }
  }

  async saveApiSettings() {
    if (!this.apiSettingsDirty || this.apiSettingsLoading) {
      return;
    }

    const payload = {};
    this.apiSettingsKeys.forEach((key) => {
      const trimmed = (this.apiSettings[key] ?? '').trim();
      this.apiSettings[key] = trimmed;
      payload[key] = trimmed;
    });

    this.setApiSettingsLoading(true);
    this.setApiStatus('正在更新...', 'info');

    try {
      const result = await this.saveSettings(payload);
      if (result && result.success === false) {
        this.setApiStatus('更新失败，请稍后重试。', 'error');
        return;
      }
      this.apiSettingsOriginal = { ...this.apiSettings };
      this.apiSettingsDirty = false;
      this.updateApiSaveButtonState();
      this.hideAllApiKeys();
      this.setApiStatus('更新成功', 'success', { autoClear: 3200 });
    } catch (error) {
      console.error('更新 API Key 失败:', error);
      this.setApiStatus('更新失败，请稍后重试。', 'error');
    } finally {
      this.setApiSettingsLoading(false);
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

    // 实现BM25S和向量检索权重的联动逻辑
    if (configKey === 'BM25S_WEIGHT' || configKey === 'EMBEDDING_WEIGHT') {
      const otherKey = configKey === 'BM25S_WEIGHT' ? 'EMBEDDING_WEIGHT' : 'BM25S_WEIGHT';
      const otherValue = Math.max(0, Math.min(1, 1 - parsedValue)); // 确保另一个值在0-1范围内

      // 更新另一个滑块的值
      this.retrievalConfig[otherKey] = otherValue;

      // 更新另一个滑块的UI
      const otherInputEl = this.retrievalInputs[otherKey];
      if (otherInputEl) {
        otherInputEl.value = otherValue.toFixed(2);
      }
      this.updateRetrievalValueDisplay(otherKey, otherValue);
    }

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

    // 确保权重值之和为1，如果不是则进行调整
    if (config.BM25S_WEIGHT !== undefined && config.EMBEDDING_WEIGHT !== undefined) {
      const sum = config.BM25S_WEIGHT + config.EMBEDDING_WEIGHT;
      if (Math.abs(sum - 1) > 0.01 && sum > 0) {
        // 按比例调整权重，使其和为1
        config.BM25S_WEIGHT = config.BM25S_WEIGHT / sum;
        config.EMBEDDING_WEIGHT = config.EMBEDDING_WEIGHT / sum;
      } else if (sum <= 0) {
        // 如果两个权重都为0或负数，设置默认值
        config.BM25S_WEIGHT = 0.7;
        config.EMBEDDING_WEIGHT = 0.3;
      }
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
    } else if (Math.abs((payload.bm25s_weight + payload.embedding_weight) - 1) > 0.01) {
      errorMessage = 'BM25S 与向量检索权重之和必须等于 1.00。';
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
    // 隐藏数据库页面
    const databasePage = document.getElementById('database-page');
    if (databasePage) {
      databasePage.style.display = 'none';
    }

    const chatPage = document.getElementById('chat-page');
    if (chatPage) {
      chatPage.style.display = 'none';
    }

    const modelPage = document.getElementById('model-page');
    if (modelPage) {
      modelPage.style.display = 'none';
    }

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }

    // 新增：隐藏 Github 页面，避免与文件页面同时显示
    const githubPage = document.getElementById('github-page');
    if (githubPage) {
      githubPage.style.display = 'none';
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
    // 隐藏数据库页面
    const databasePage = document.getElementById('database-page');
    if (databasePage) {
      databasePage.style.display = 'none';
    }

    const chatPage = document.getElementById('chat-page');
    if (chatPage) {
      chatPage.style.display = 'none';
    }

    const modelPage = document.getElementById('model-page');
    if (modelPage) {
      modelPage.style.display = 'none';
    }

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }

    // 新增：隐藏 Github 页面，避免与设置页面同时显示
    const githubPage = document.getElementById('github-page');
    if (githubPage) {
      githubPage.style.display = 'none';
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
    // 同步标题栏主题
    await window.fsAPI.setTitleBarTheme(darkMode);
  }

  getApiKey(key) {
    if (!key) {
      return '';
    }
    const normalizedKey = String(key);
    if (this.apiSettings && Object.prototype.hasOwnProperty.call(this.apiSettings, normalizedKey)) {
      const stored = this.apiSettings[normalizedKey];
      if (stored && stored.trim) {
        const trimmed = stored.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }

    const inputEl = this.apiInputs ? this.apiInputs[normalizedKey] : null;
    if (inputEl && typeof inputEl.value === 'string') {
      return inputEl.value.trim();
    }

    return '';
  }

  setupModelSummaryControls() {
    this.modelSummarySectionEl = document.getElementById('model-summary-settings');
    this.modelSummaryStatusEl = document.getElementById('model-summary-status');
    this.modelSummaryToggleEl = document.getElementById('enable-model-summary-toggle');
    this.modelSummarySelectorEl = document.getElementById('model-summary-selector');
    this.modelSummarySelectEl = document.getElementById('model-summary-select');
    this.modelSummaryHintEl = document.getElementById('model-summary-hint');

    if (this.modelSummaryToggleEl) {
      this.modelSummaryToggleEl.addEventListener('change', (event) => {
        this.handleSummaryToggleChange(event);
      });
    }

    if (this.modelSummarySelectEl) {
      this.modelSummarySelectEl.addEventListener('change', (event) => {
        this.handleSummaryModelChange(event);
      });
    }

    this.refreshSummaryModelOptions();
    this.syncSummaryControls();
    this.registerModelSummaryRegistryListener();
  }

  setupSummarySearchControl() {
    this.summarySearchToggleEl = document.getElementById('enable-summary-search-toggle');
    if (this.summarySearchToggleEl) {
      this.summarySearchToggleEl.addEventListener('change', () => {
        this.handleSummarySearchToggleChange();
      });
    }
    this.syncSummarySearchControl();
  }

  registerModelSummaryRegistryListener() {
    if (this.modelSummaryRegistryDisposer) {
      try {
        this.modelSummaryRegistryDisposer();
      } catch (error) {
        console.warn('移除模型监听器失败:', error);
      }
      this.modelSummaryRegistryDisposer = null;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const { modelModule } = window;
    if (modelModule && typeof modelModule.onModelRegistryChanged === 'function') {
      try {
        this.modelSummaryRegistryDisposer = modelModule.onModelRegistryChanged((models) => {
          this.refreshSummaryModelOptions({ models });
          this.syncSummaryControls();
        });
      } catch (error) {
        console.warn('注册模型监听器失败:', error);
      }
    } else {
      document.addEventListener('modelRegistryChanged', (event) => {
        if (event?.detail && Array.isArray(event.detail.models)) {
          this.refreshSummaryModelOptions({ models: event.detail.models });
          this.syncSummaryControls();
        }
      });
    }
  }

  refreshSummaryModelOptions(options = {}) {
    const rawList = Array.isArray(options.models) ? options.models : this.getAvailableSummaryModels();
    const prepared = [];
    const seen = new Set();
    rawList.forEach((item) => {
      const record = this.prepareSummaryModelRecord(item);
      if (!record) {
        return;
      }
      if (seen.has(record.key)) {
        return;
      }
      seen.add(record.key);
      prepared.push(record);
    });

    this.availableSummaryModels = prepared;

    if (!this.modelSummarySelectEl) {
      return;
    }

    const previousValue = this.modelSummarySelectEl.value;
    this.modelSummarySelectEl.innerHTML = '';

    prepared.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.key;
      option.textContent = model.displayLabel;
      this.modelSummarySelectEl.appendChild(option);
    });

    let selectedRecord = null;
    if (this.modelSummarySelection) {
      const currentKey = this.getSummaryModelKey(this.modelSummarySelection);
      selectedRecord = prepared.find((model) => model.key === currentKey) || null;
    }
    if (!selectedRecord && prepared.length) {
      selectedRecord = prepared[0];
    }

    if (selectedRecord) {
      this.modelSummarySelectEl.value = selectedRecord.key;
      this.modelSummarySelection = { ...selectedRecord };
    } else {
      this.modelSummarySelection = null;
      this.modelSummarySelectEl.value = '';
    }
  }

  getAvailableSummaryModels() {
    let list = [];
    if (typeof window !== 'undefined' && window.modelModule && typeof window.modelModule.getModels === 'function') {
      try {
        list = window.modelModule.getModels();
      } catch (error) {
        console.warn('获取模型模块列表失败:', error);
      }
    }
    if (!Array.isArray(list) || !list.length) {
      list = this.customModels.map((model) => ({ ...model }));
    }
    return list;
  }

  prepareSummaryModelRecord(model) {
    const sanitized = this.sanitizeModelSelection(model);
    if (!sanitized) {
      return null;
    }
    const key = this.getSummaryModelKey(sanitized);
    const displayProvider = sanitized.providerName || sanitized.sourceId || '自定义';
    const displayName = sanitized.name || sanitized.apiModel || sanitized.modelId || '未命名模型';
    return {
      ...sanitized,
      key,
      displayLabel: displayProvider ? `${displayName}（${displayProvider}）` : displayName
    };
  }

  sanitizeModelSelection(model) {
    if (!model || typeof model !== 'object') {
      return null;
    }
    const sourceId = (model.sourceId || model.source_id || '').trim();
    const rawModelId = model.modelId || model.model_id || model.apiModel || model.api_model || model.name || '';
    const modelId = rawModelId ? String(rawModelId).trim() : '';
    const rawApiModel = model.apiModel || model.api_model || modelId;
    const apiModel = rawApiModel ? String(rawApiModel).trim() : '';
    const rawName = model.name || model.displayName || apiModel || modelId;
    const name = rawName ? String(rawName).trim() : '';
    if (!sourceId && !modelId && !apiModel && !name) {
      return null;
    }
    const providerName = (model.providerName || model.provider_name || sourceId || '自定义').trim();
    const apiKeySetting = model.apiKeySetting || model.api_key_setting || null;
    const apiUrl = model.apiUrl || model.api_url || null;
    const requiresApiKey = model.requiresApiKey !== undefined
      ? model.requiresApiKey !== false
      : model.requires_api_key !== undefined
        ? model.requires_api_key !== false
        : true;
    return {
      sourceId,
      modelId: modelId || apiModel || name,
      apiModel: apiModel || modelId || name,
      name: name || modelId || apiModel || '未命名模型',
      providerName,
      apiKeySetting: apiKeySetting || null,
      requiresApiKey,
      apiUrl: apiUrl || null
    };
  }

  getSummaryModelKey(model) {
    if (!model) {
      return '';
    }
    if (model.key) {
      return model.key;
    }
    const sourceId = model.sourceId || '';
    const identifier = model.modelId || model.apiModel || model.name || '';
    return `${sourceId}::${identifier}`;
  }

  syncSummaryControls() {
    if (!this.modelSummaryToggleEl) {
      return;
    }
    const hasModels = Array.isArray(this.availableSummaryModels) && this.availableSummaryModels.length > 0;
    const selection = this.modelSummarySelection;
    let missingApiKey = false;
    if (hasModels && selection && selection.requiresApiKey !== false) {
      const keySetting = selection.apiKeySetting || 'siliconflwApiKey';
      const apiKey = this.getApiKey(keySetting);
      if (!apiKey) {
        missingApiKey = true;
        this.enableModelSummary = false;
      }
    }

    let summarySearchChanged = false;
    if (!hasModels) {
      this.enableModelSummary = false;
      this.modelSummarySelection = null;
      if (this.enableSummarySearch) {
        this.enableSummarySearch = false;
        summarySearchChanged = true;
      }
    }
    this.modelSummaryToggleEl.disabled = !hasModels;
    this.modelSummaryToggleEl.checked = hasModels && this.enableModelSummary;

    if (this.modelSummarySelectorEl) {
      this.modelSummarySelectorEl.style.display = (this.enableModelSummary && hasModels) ? 'flex' : 'none';
    }

    if (this.modelSummarySelectEl) {
      this.modelSummarySelectEl.disabled = !hasModels || !this.enableModelSummary;
      if (this.enableModelSummary && hasModels && this.modelSummarySelection) {
        this.modelSummarySelectEl.value = this.getSummaryModelKey(this.modelSummarySelection);
      }
    }

    this.syncSummarySearchControl();

    if (summarySearchChanged) {
      this.persistModelSummarySettings({ silent: true });
    }

    if (hasModels) {
      if (missingApiKey) {
        this.setModelSummaryHint('所选模型需要 API Key，请先在“API-Key”部分填写后再启用。', 'warning');
        return;
      }

      const selection = this.modelSummarySelection || (this.availableSummaryModels.length ? this.availableSummaryModels[0] : null);
      if (this.enableModelSummary && selection) {
        const displayName = selection.name || selection.apiModel || selection.modelId || '当前模型';
        const provider = selection.providerName || selection.sourceId || '';
        const label = provider ? `${displayName}（${provider}）` : displayName;
        this.setModelSummaryHint(`当前使用模型 ${label} 进行主题检索。`, 'success');
      } else {
        this.setModelSummaryHint('已检测到可用模型，开启主题检索后即可使用。', 'info');
      }
      return;
    }

    this.setModelSummaryHint('暂无可用模型，请在“模型库”页面添加模型。', 'warning');
  }

  handleSummaryToggleChange(event) {
    const shouldEnable = Boolean(event?.target?.checked);
    if (shouldEnable && (!this.availableSummaryModels || !this.availableSummaryModels.length)) {
      if (event?.target) {
        event.target.checked = false;
      }
      this.enableModelSummary = false;
      this.setModelSummaryHint('暂无可用模型，请先在“模型库”页面添加模型。', 'warning');
      this.syncSummaryControls();
      return;
    }
    this.enableModelSummary = shouldEnable;
    if (this.enableModelSummary) {
      if ((!this.modelSummarySelection) && this.availableSummaryModels.length) {
        this.modelSummarySelection = { ...this.availableSummaryModels[0] };
        if (this.modelSummarySelectEl) {
          this.modelSummarySelectEl.value = this.getSummaryModelKey(this.modelSummarySelection);
        }
      }
      const selection = this.modelSummarySelection;
      if (selection && selection.requiresApiKey !== false) {
        const keySetting = selection.apiKeySetting || 'siliconflwApiKey';
        const apiKey = this.getApiKey(keySetting);
        if (!apiKey) {
          if (event?.target) {
            event.target.checked = false;
          }
          this.enableModelSummary = false;
          this.setModelSummaryHint('所选模型需要 API Key，请先在“API-Key”部分填写后再启用。', 'warning');
          this.syncSummaryControls();
          return;
        }
      }
    }
    this.syncSummaryControls();
    this.persistModelSummarySettings();
  }

  handleSummarySearchToggleChange() {
    if (!this.summarySearchToggleEl) {
      return;
    }
    const hasModels = Array.isArray(this.availableSummaryModels) && this.availableSummaryModels.length > 0;
    if (!hasModels) {
      this.summarySearchToggleEl.checked = false;
      this.enableSummarySearch = false;
      this.setModelSummaryHint('暂无可用模型，请先在“模型库”页面添加模型。', 'warning');
      return;
    }
    const shouldEnable = Boolean(this.summarySearchToggleEl.checked);
    this.enableSummarySearch = shouldEnable;
    this.persistModelSummarySettings({ silent: true });
    this.syncSummarySearchControl();
  }

  handleSummaryModelChange(event) {
    const selectedKey = event?.target?.value;
    if (!selectedKey) {
      return;
    }
    const matched = this.availableSummaryModels.find((model) => model.key === selectedKey);
    if (!matched) {
      return;
    }
    this.modelSummarySelection = { ...matched };
    let missingApiKey = false;
    if (this.enableModelSummary && matched.requiresApiKey !== false) {
      const keySetting = matched.apiKeySetting || 'siliconflwApiKey';
      const apiKey = this.getApiKey(keySetting);
      if (!apiKey) {
        missingApiKey = true;
        if (this.modelSummaryToggleEl) {
          this.modelSummaryToggleEl.checked = false;
        }
        this.enableModelSummary = false;
        this.setModelSummaryHint('所选模型需要 API Key，请先在“API-Key”部分填写后再启用。', 'warning');
      }
    }
    this.syncSummaryControls();
    this.persistModelSummarySettings({ silent: !this.enableModelSummary || missingApiKey });
  }

  syncSummarySearchControl() {
    if (!this.summarySearchToggleEl) {
      return;
    }
    const hasModels = Array.isArray(this.availableSummaryModels) && this.availableSummaryModels.length > 0;
    this.summarySearchToggleEl.disabled = !hasModels;
    const shouldBeChecked = hasModels && this.enableSummarySearch;
    if (!shouldBeChecked && this.summarySearchToggleEl.checked) {
      this.summarySearchToggleEl.checked = false;
    } else if (shouldBeChecked && !this.summarySearchToggleEl.checked) {
      this.summarySearchToggleEl.checked = true;
    }
  }

  async persistModelSummarySettings(options = {}) {
    const silent = Boolean(options?.silent);
    if (this.modelSummarySaveTimer) {
      clearTimeout(this.modelSummarySaveTimer);
      this.modelSummarySaveTimer = null;
    }
    if (!silent) {
      this.setModelSummaryStatus('保存中…', 'info');
    }
    const result = await this.saveSettings({
      enableModelSummary: this.enableModelSummary,
      modelSummarySelection: this.sanitizeModelSelection(this.modelSummarySelection),
      enableSummarySearch: this.enableSummarySearch
    });
    if (silent) {
      return;
    }
    if (result && result.success === false) {
      this.setModelSummaryStatus(result.error || '保存失败，请稍后重试。', 'error');
      return;
    }
    this.setModelSummaryStatus('设置已保存。', 'success');
    this.modelSummarySaveTimer = setTimeout(() => {
      this.clearModelSummaryStatus();
    }, 2000);
  }

  setModelSummaryHint(message, variant = 'info') {
    if (!this.modelSummaryHintEl) {
      return;
    }
    this.modelSummaryHintEl.textContent = message || '';
    if (variant) {
      this.modelSummaryHintEl.dataset.variant = variant;
    } else {
      delete this.modelSummaryHintEl.dataset.variant;
    }
  }

  setModelSummaryStatus(message, variant = 'info') {
    if (!this.modelSummaryStatusEl) {
      return;
    }
    this.modelSummaryStatusEl.textContent = message || '';
    if (variant) {
      this.modelSummaryStatusEl.dataset.status = variant;
    } else {
      this.modelSummaryStatusEl.removeAttribute('data-status');
    }
  }

  clearModelSummaryStatus() {
    if (!this.modelSummaryStatusEl) {
      return;
    }
    this.modelSummaryStatusEl.textContent = '';
    this.modelSummaryStatusEl.removeAttribute('data-status');
    if (this.modelSummarySaveTimer) {
      clearTimeout(this.modelSummarySaveTimer);
      this.modelSummarySaveTimer = null;
    }
  }

  getModelSummaryConfig() {
    const selection = this.sanitizeModelSelection(this.modelSummarySelection);
    const hasModels = Array.isArray(this.availableSummaryModels) && this.availableSummaryModels.length > 0;
    const enabled = Boolean(this.enableModelSummary && hasModels && selection);
    if (!enabled || !selection) {
      return {
        enabled: false,
        model: null
      };
    }
    let apiKey = '';
    if (selection.requiresApiKey !== false) {
      const keySetting = selection.apiKeySetting || 'siliconflwApiKey';
      apiKey = this.getApiKey(keySetting);
      if (!apiKey) {
        return {
          enabled: false,
          model: null,
          missingApiKey: true
        };
      }
    }
    return {
      enabled: true,
      model: {
        source_id: selection.sourceId,
        model_id: selection.modelId,
        api_model: selection.apiModel,
        name: selection.name,
        provider_name: selection.providerName,
        api_key_setting: selection.apiKeySetting,
        requires_api_key: selection.requiresApiKey !== false,
        api_url: selection.apiUrl,
        api_key: apiKey || undefined
      }
    };
  }

  isSummarySearchEnabled() {
    return Boolean(this.enableSummarySearch);
  }

  normalizeCustomModels(models) {
    if (!Array.isArray(models)) {
      return [];
    }
    return models.map((model) => ({ ...model })).filter((model) => model && model.modelId);
  }

  getCustomModels() {
    return this.customModels.map((model) => ({ ...model }));
  }

  async updateCustomModels(models) {
    const sanitized = this.normalizeCustomModels(models);
    if (JSON.stringify(sanitized) === JSON.stringify(this.customModels)) {
      return;
    }
    this.customModels = sanitized;
    this.refreshSummaryModelOptions();
    this.syncSummaryControls();
    const result = await this.saveSettings({ customModels: this.customModels });
    if (result && result.success === false) {
      console.error('保存模型列表失败:', result.error || '未知错误');
    }
  }
}

// 导出设置模块
window.SettingsModule = SettingsModule;
