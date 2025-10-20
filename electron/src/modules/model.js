// 资源路径解析（与 chat.js 保持一致）
const MODEL_ASSET_URL_CACHE = new Map();
function getAssetUrl(relativePath) {
  if (!relativePath) {
    return '';
  }
  if (MODEL_ASSET_URL_CACHE.has(relativePath)) {
    return MODEL_ASSET_URL_CACHE.get(relativePath);
  }
  const raw = String(relativePath).trim();
  if (!raw) {
    MODEL_ASSET_URL_CACHE.set(relativePath, '');
    return '';
  }
  if (/^(?:file|https?|data):/i.test(raw)) {
    MODEL_ASSET_URL_CACHE.set(relativePath, raw);
    return raw;
  }
  let resolved = `./${raw.replace(/^([./\\])+/, '')}`;
  try {
    if (window.fsAPI && typeof window.fsAPI.getAssetPathSync === 'function') {
      const candidate = window.fsAPI.getAssetPathSync(raw);
      if (candidate) {
        resolved = candidate;
      }
    } else if (typeof window !== 'undefined' && window.location) {
      resolved = new URL(resolved.replace(/^\.\//, ''), window.location.href).href;
    }
  } catch (error) {
    console.warn('解析资源路径失败，使用默认相对路径:', error);
  }
  if (!/^(?:file|https?):/i.test(resolved) && typeof window !== 'undefined' && window.location) {
    try {
      resolved = new URL(resolved, window.location.href).href;
    } catch (error) {
      // ignore
    }
  }
  MODEL_ASSET_URL_CACHE.set(relativePath, resolved);
  return resolved;
}

class ModelModule {
  constructor(options = {}) {
    this.catalog = this.buildModelCatalog();
    this.userModels = [];
    this.initialized = false;
    this.addModalLoading = false;
    this.baseApiUrl = 'http://localhost:8000';
    this.systemModels = this.buildDefaultSystemModels();
    this.systemFetchInFlight = false;
    this.systemFetchPending = false;
    this.systemPollingHandle = null;
    this.systemPollingInterval = null;
    this.systemPollingDelayMs = 10000;
    this.systemDownloadRequests = new Set();
    this.systemUninstallRequests = new Set();
    this.registryListeners = new Set();

    this.ollamaModels = [];
    this.ollamaFetchPromise = null;
    this.ollamaFetchInFlight = false;
    this.ollamaFetchError = null;
    this.modalConfirmGuardDisabled = false;

    this.dependencies = {
      getSettingsModule: () => null
    };
    this.dependencies = { ...this.dependencies, ...options };
  }

  buildModelCatalog() {
    return [
      {
        sourceId: 'siliconflow',
        name: '硅基流动',
        icon: '../dist/assets/qwen.png',
        apiKeySetting: 'siliconflwApiKey',
        requiresApiKey: true,
        models: [
          {
            modelId: 'Qwen/Qwen3-8B',
            name: 'Qwen/Qwen3-8B',
            description: '硅基流动提供的 Qwen3-8B 通用模型，兼顾推理与创作表现。',
            tags: ['硅基流动', 'Qwen3系列', '参数量-8B'],
            apiModel: 'Qwen/Qwen3-8B',
            apiKeySetting: 'siliconflwApiKey'
          }
        ]
      },
      {
        sourceId: 'ollama',
        name: 'Ollama',
        icon: null,
        apiKeySetting: null,
        requiresApiKey: false,
        defaultApiUrl: 'http://localhost:11434/v1/chat/completions',
        models: []
      },
      {
        sourceId: 'openai',
        name: 'Open AI',
        icon: './dist/assets/openai.png',
        apiKeySetting: 'openaiApiKey',
        requiresApiKey: true,
        models: []
      }
    ];
  }

  buildDefaultSystemModels() {
    const now = Date.now();
    return [
      {
        key: 'bge_m3',
        name: 'BGE-M3 向量模型',
        description: '用于文本向量化与相似度检索的通用嵌入模型。',
        tags: ['文本嵌入', '检索'],
        status: 'not_downloaded',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        message: '点击卡片开始下载模型。',
        error: null,
        endpoint: null,
        updatedAt: now
      },
      {
        key: 'bge_reranker_v2_m3',
        name: 'BGE-Reranker V3 M3 模型',
        description: '用于提升检索结果相关性的重排序模型。',
        tags: ['重排序', '检索'],
        status: 'not_downloaded',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        message: '点击卡片开始下载模型。',
        error: null,
        endpoint: null,
        updatedAt: now
      },
      {
        key: 'clip_vit_b_32',
        name: 'CLIP ViT-B 32',
        description: '英文优化的标准 CLIP 模型，适用于通用图文检索。',
        tags: ['图像嵌入', '多模态'],
        status: 'not_downloaded',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        message: '点击卡片开始下载模型。',
        error: null,
        endpoint: null,
        updatedAt: now
      },
      {
        key: 'clip_vit_b_32_multilingual',
        name: 'CLIP ViT-B Multilingual',
        description: '支持中文等多语言查询的 CLIP 模型，提升图文检索效果。',
        tags: ['图像嵌入', '多模态', '多语言'],
        status: 'not_downloaded',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        message: '',
        error: null,
        endpoint: null,
        updatedAt: now
      },
      {
        key: 'pdf_extract_kit',
        name: 'PDF Extract Kit 套件',
        description: '用于PDF解析的离线模型资源。',
        tags: ['PDF解析', 'OCR识别'],
        status: 'not_downloaded',
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        message: '点击卡片开始下载模型。',
        error: null,
        endpoint: null,
        updatedAt: now
      }
    ];
  }

  cacheElements() {
    this.modelPageEl = document.getElementById('model-page');
    this.cardContainerEl = document.getElementById('model-card-container');
    this.providerTitleEl = document.getElementById('model-provider-title');
    this.addButtonEl = document.getElementById('model-add-btn');
  }

  init() {
    if (this.initialized) {
      return;
    }

    this.cacheElements();
    this.setupAddModal();
    this.restorePersistedModels();
    this.bindEvents();
    this.renderAllModels();

    this.initialized = true;

    this.fetchSystemModels({ initial: true }).catch((error) => {
      console.error('获取系统模型状态失败:', error);
    });
  }

  bindEvents() {
    if (this.addButtonEl) {
      this.addButtonEl.addEventListener('click', () => {
        this.showAddModal();
      });
    }
  }

  buildSourceSelectOptions() {
    if (!this.sourceSelectEl) {
      return;
    }
    this.sourceSelectEl.innerHTML = '';
    this.catalog.forEach((source) => {
      const option = document.createElement('option');
      option.value = source.sourceId;
      option.textContent = source.name;
      this.sourceSelectEl.appendChild(option);
    });
  }

  populateModelOptionsForSource(sourceId) {
    const source = this.getSourceById(sourceId);
    const isOllama = sourceId === 'ollama';

    if (this.modelInputEl) {
      this.modelInputEl.value = '';
      this.modelInputEl.style.display = isOllama ? 'none' : '';
    }
    if (this.modelSelectEl) {
      this.modelSelectEl.innerHTML = '';
      this.modelSelectEl.value = '';
      this.modelSelectEl.style.display = isOllama ? '' : 'none';
    }

    this.updateModalControlsState();

    if (this.modelUrlFieldEl && this.modelUrlEl) {
      if (isOllama) {
        this.modelUrlFieldEl.style.display = '';
        const defaultUrl = source?.defaultApiUrl || 'http://localhost:11434/v1/chat/completions';
        this.modelUrlEl.value = defaultUrl;
      } else {
        this.modelUrlFieldEl.style.display = 'none';
        this.modelUrlEl.value = '';
      }
    }

    if (isOllama) {
      this.prepareOllamaModelSelect();
    } else {
      this.modalConfirmGuardDisabled = false;
      this.ollamaFetchInFlight = false;
      this.updateModalControlsState();
      if (this.modelInputEl) {
        this.modelInputEl.focus();
      }
      if (source && Array.isArray(source.models) && source.models.length && this.modelInputEl) {
        const firstModel = source.models[0];
        this.modelInputEl.placeholder = firstModel?.name || firstModel?.modelId || '';
      } else if (this.modelInputEl) {
        this.modelInputEl.placeholder = '';
      }
    }
  }

  async prepareOllamaModelSelect() {
    if (!this.modelSelectEl) {
      return;
    }
    this.modalConfirmGuardDisabled = true;
    this.ollamaFetchInFlight = true;
    this.updateModalControlsState();
    this.setModalStatus('正在获取 Ollama 模型列表…', 'info');

    try {
      const models = await this.loadOllamaModels({ revalidate: false });
      this.ollamaModels = models.slice();
      this.ollamaFetchError = null;
      this.modelSelectEl.innerHTML = '';

      if (!models.length) {
        this.setModalStatus('未在本地找到 Ollama 模型，请先使用 ollama pull 下载模型。', 'warning');
        this.modalConfirmGuardDisabled = true;
        return;
      }

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '请选择模型';
      placeholder.disabled = true;
      placeholder.selected = true;
      this.modelSelectEl.appendChild(placeholder);

      models.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        this.modelSelectEl.appendChild(option);
      });

      this.modalConfirmGuardDisabled = false;
      this.clearModalStatus();
      this.modelSelectEl.focus();
    } catch (error) {
      this.ollamaFetchError = error;
      console.error('加载 Ollama 模型失败:', error);
      let message = '无法获取 Ollama 模型列表。';
      if (error && typeof error.message === 'string' && error.message.trim()) {
        message = error.message.trim();
      }
      this.setModalStatus(`获取 Ollama 模型失败：${message}`, 'error');
      this.modalConfirmGuardDisabled = true;
    } finally {
      this.ollamaFetchInFlight = false;
      this.updateModalControlsState();
    }
  }

  async loadOllamaModels(options = {}) {
    const { revalidate = false } = options || {};
    if (!revalidate && Array.isArray(this.ollamaModels) && this.ollamaModels.length) {
      return this.ollamaModels.slice();
    }
    if (this.ollamaFetchPromise) {
      return this.ollamaFetchPromise;
    }

    const request = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('http://localhost:11434/api/tags', {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new Error(text || `HTTP ${response.status}`);
        }
        const data = await response.json();
        const rawModels = Array.isArray(data?.models) ? data.models : [];
        const names = rawModels
          .map((item) => {
            if (!item) {
              return null;
            }
            if (typeof item === 'string') {
              return item.trim();
            }
            if (item.name) {
              return String(item.name).trim();
            }
            if (item.model) {
              return String(item.model).trim();
            }
            return null;
          })
          .filter((name) => typeof name === 'string' && name.length > 0);
        this.ollamaModels = names;
        return names.slice();
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error('连接 Ollama 超时，请确认本地服务已启动并监听 11434 端口。');
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    this.ollamaFetchPromise = request();
    try {
      return await this.ollamaFetchPromise;
    } finally {
      this.ollamaFetchPromise = null;
    }
  }

  async fetchSystemModels(options = {}) {
    const { silent = false } = options || {};
    if (this.systemFetchInFlight) {
      this.systemFetchPending = true;
      return;
    }
    this.systemFetchInFlight = true;
    try {
      const response = await fetch(`${this.baseApiUrl}/api/models`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.mergeSystemModelList(data);
      this.renderAllModels();
      this.updateSystemPollingState();
    } catch (error) {
      if (!silent) {
        console.error('获取系统模型状态失败:', error);
      }
    } finally {
      this.systemFetchInFlight = false;
      if (this.systemFetchPending) {
        this.systemFetchPending = false;
        this.fetchSystemModels({ silent: true });
      }
    }
  }

  normalizeSystemModel(raw = {}) {
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!key) {
      return null;
    }
    const progressValue = typeof raw.progress === 'number' ? raw.progress : 0;
    const progress = Math.max(0, Math.min(1, progressValue));
    const downloadedBytes = typeof raw.downloaded_bytes === 'number'
      ? raw.downloaded_bytes
      : (typeof raw.downloadedBytes === 'number' ? raw.downloadedBytes : 0);
    const totalBytes = typeof raw.total_bytes === 'number'
      ? raw.total_bytes
      : (typeof raw.totalBytes === 'number' ? raw.totalBytes : null);
    const tags = Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [];

    return {
      key,
      name: raw.name || key,
      description: raw.description || '',
      tags,
      status: raw.status || 'not_downloaded',
      progress,
      downloadedBytes,
      totalBytes,
      message: raw.message || '',
      error: raw.error || null,
      endpoint: raw.endpoint || null,
      updatedAt: typeof raw.updated_at === 'number' ? raw.updated_at : Date.now()
    };
  }

  mergeSystemModelStatus(rawModel) {
    const normalized = this.normalizeSystemModel(rawModel);
    if (!normalized) {
      return;
    }
    const index = this.systemModels.findIndex((item) => item.key === normalized.key);
    if (index === -1) {
      this.systemModels.push(normalized);
    } else {
      const current = this.systemModels[index];
      this.systemModels[index] = {
        ...current,
        ...normalized
      };
    }
  }

  mergeSystemModelList(items) {
    if (!Array.isArray(items)) {
      return;
    }
    const order = new Map();
    items.forEach((item, idx) => {
      const normalized = this.normalizeSystemModel(item);
      if (!normalized) {
        return;
      }
      order.set(normalized.key, idx);
      this.mergeSystemModelStatus(normalized);
    });
    if (order.size) {
      this.systemModels.sort((a, b) => {
        const aOrder = order.has(a.key) ? order.get(a.key) : Number.MAX_SAFE_INTEGER;
        const bOrder = order.has(b.key) ? order.get(b.key) : Number.MAX_SAFE_INTEGER;
        return aOrder - bOrder;
      });
    }
  }

  updateSystemModelPartial(key, updates = {}) {
    if (!key) {
      return;
    }
    const index = this.systemModels.findIndex((item) => item.key === key);
    if (index === -1) {
      const normalized = this.normalizeSystemModel({ key, ...updates });
      if (normalized) {
        this.systemModels.push(normalized);
      }
      return;
    }
    const current = this.systemModels[index];
    const merged = {
      ...current,
      ...updates
    };
    if (typeof merged.progress === 'number') {
      merged.progress = Math.max(0, Math.min(1, merged.progress));
    }
    merged.updatedAt = Date.now();
    this.systemModels[index] = merged;
  }

  areAllSystemModelsReady() {
    if (!Array.isArray(this.systemModels) || this.systemModels.length === 0) {
      return false;
    }
    return this.systemModels.every((model) => model.status === 'downloaded');
  }

  updateSystemPollingState(options = {}) {
    const forceFast = Boolean(options.forceFast);
    const hasActiveModel =
      this.systemModels.some((model) => model.status === 'downloading' || model.status === 'pending');

    // 仅在模型页面可见时才允许轮询
    const isVisible = this.isModelPageVisible();
    if (!isVisible) {
      this.stopSystemPolling();
      return;
    }

    if (hasActiveModel || !this.areAllSystemModelsReady() || forceFast) {
      this.startSystemPolling(this.systemPollingDelayMs);
      return;
    }

    this.stopSystemPolling();
  }

  startSystemPolling(interval) {
    if (!interval) {
      return;
    }
    // 页面不可见时不启动轮询
    if (!this.isModelPageVisible()) {
      return;
    }
    if (this.systemPollingHandle && this.systemPollingInterval === interval) {
      return;
    }
    this.stopSystemPolling();
    this.systemPollingInterval = interval;
    this.systemPollingHandle = setInterval(() => {
      // 再次确认页面可见，否则停止
      if (!this.isModelPageVisible()) {
        this.stopSystemPolling();
        return;
      }
      this.fetchSystemModels({ silent: true }).catch((error) => {
        console.error('轮询系统模型状态失败:', error);
      });
    }, interval);
  }

  stopSystemPolling() {
    if (this.systemPollingHandle) {
      clearInterval(this.systemPollingHandle);
    }
    this.systemPollingHandle = null;
    this.systemPollingInterval = null;
  }

  isModelPageVisible() {
    const el = this.modelPageEl || document.getElementById('model-page');
    if (!el) return false;
    const style = (el.style && el.style.display) || '';
    return style && style !== 'none';
  }

  handleSystemModelClick(model) {
    if (!model || !model.key) {
      return;
    }
    if (model.status === 'downloaded') {
      this.confirmUninstallSystemModel(model);
      return;
    }
    if (this.systemDownloadRequests.has(model.key) || model.status === 'downloading') {
      return;
    }
    this.triggerSystemModelDownload(model.key);
  }

  async triggerSystemModelDownload(key) {
    if (!key || this.systemDownloadRequests.has(key)) {
      return;
    }
    this.systemDownloadRequests.add(key);
    this.updateSystemModelPartial(key, {
      status: 'downloading',
      progress: 0,
      message: '正在请求下载...',
      error: null
    });
    this.renderAllModels();
    this.updateSystemPollingState({ forceFast: true });

    try {
      const response = await fetch(`${this.baseApiUrl}/api/models/${encodeURIComponent(key)}/download`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.mergeSystemModelStatus(data);
      this.renderAllModels();
      this.updateSystemPollingState({ forceFast: true });
    } catch (error) {
      console.error('启动模型下载失败:', error);
      this.updateSystemModelPartial(key, {
        status: 'failed',
        message: '下载请求失败，请稍后重试。',
        error: error?.message || '下载请求失败'
      });
      this.renderAllModels();
      this.updateSystemPollingState();
    } finally {
      this.systemDownloadRequests.delete(key);
      this.updateSystemPollingState();
    }
  }

  async triggerSystemModelUninstall(key) {
    if (!key || this.systemUninstallRequests.has(key)) {
      return;
    }
    this.systemUninstallRequests.add(key);
    this.updateSystemModelPartial(key, {
      status: 'pending',
      message: '正在卸载...',
      error: null
    });
    this.renderAllModels();
    this.updateSystemPollingState({ forceFast: true });

    try {
      const response = await fetch(`${this.baseApiUrl}/api/models/${encodeURIComponent(key)}/uninstall`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.mergeSystemModelStatus(data);
      this.renderAllModels();
      this.updateSystemPollingState();
    } catch (error) {
      console.error('卸载模型失败:', error);
      this.updateSystemModelPartial(key, {
        status: 'failed',
        message: '卸载失败，请稍后重试。',
        error: error?.message || '卸载失败'
      });
      this.renderAllModels();
      this.updateSystemPollingState();
    } finally {
      this.systemUninstallRequests.delete(key);
      this.updateSystemPollingState();
    }
  }

  confirmUninstallSystemModel(model) {
    const doUninstall = () => {
      this.triggerSystemModelUninstall(model.key);
    };

    if (typeof window.showModal === 'function') {
      window.showModal({
        type: 'warning',
        title: '卸载系统模型',
        message: `确定要卸载 ${model.name} 吗？这将删除本地模型数据。`,
        confirmText: '卸载',
        cancelText: '取消',
        showCancel: true,
        onConfirm: doUninstall
      });
      return;
    }

    if (window.confirm(`确定要卸载 ${model.name} 吗？这将删除本地模型数据。`)) {
      doUninstall();
    }
  }

  buildSystemModelCard(model) {
    const card = document.createElement('article');
    card.className = 'model-card system-model-card';
    card.classList.add(`system-model-card--${model.status || 'not_downloaded'}`);
    card.dataset.key = model.key;
    const progressPercent = Math.max(0, Math.min(100, Math.round((model.progress || 0) * 100)));
    card.style.setProperty('--download-progress', `${progressPercent}%`);

    const title = document.createElement('h3');
    title.className = 'model-card-title';
    title.textContent = model.name;

    const providerLabel = document.createElement('span');
    providerLabel.className = 'model-card-provider';
    providerLabel.textContent = this.getVendorLabel(model);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'system-model-card__status-badge';
    statusBadge.textContent = this.describeSystemModelStatus(model);

    const header = document.createElement('div');
    header.className = 'system-model-card__header';
    header.appendChild(title);
    // 将开发商标签从标题区域移除，移动到标签列表末尾
    // header.appendChild(providerLabel);
    header.appendChild(statusBadge);

    const description = document.createElement('p');
    description.className = 'model-card-description';
    description.textContent = model.description || '暂无简介。';

    const tagsWrapper = document.createElement('div');
    tagsWrapper.className = 'model-card-tags';
    if (Array.isArray(model.tags) && model.tags.length > 0) {
      model.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'model-tag';
        tagEl.textContent = tag;
        tagsWrapper.appendChild(tagEl);
      });
    }
    // 将开发商标签追加到描述标签之后
    tagsWrapper.appendChild(providerLabel);

    card.appendChild(header);

    const messageText = this.buildSystemModelMessage(model);
    let inlineMessageAttached = false;
    const shouldAttachToTags =
      messageText && model.key === 'clip_vit_b_32_multilingual' && tagsWrapper.children.length > 0;
    if (shouldAttachToTags) {
      const inlineMessage = this.createSystemModelInlineMessage(messageText);
      inlineMessage.classList.add('system-model-card__inline-message--after-tags');
      tagsWrapper.appendChild(inlineMessage);
      inlineMessageAttached = true;
    }

    card.appendChild(description);

    if (messageText && !inlineMessageAttached) {
      const inlineMessage = this.createSystemModelInlineMessage(messageText);
      inlineMessage.classList.add('system-model-card__inline-message--after-description');
      description.appendChild(inlineMessage);
    }

    if (tagsWrapper.children.length > 0) {
      card.appendChild(tagsWrapper);
    }

    card.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handleSystemModelClick(model);
    });

    return card;
  }

  createSystemModelInlineMessage(text) {
    const inlineMessage = document.createElement('span');
    inlineMessage.className = 'system-model-card__inline-message';
    inlineMessage.textContent = text;
    return inlineMessage;
  }

  describeSystemModelStatus(model) {
    if (!model) {
      return '未知状态';
    }
    if (model.status === 'downloaded') {
      return '已下载';
    }
    if (model.status === 'downloading') {
      const percent = Math.max(0, Math.min(100, Math.round((model.progress || 0) * 100)));
      return `下载中 ${percent}%`;
    }
    if (model.status === 'pending') {
      return '卸载中';
    }
    if (model.status === 'failed') {
      return '下载失败';
    }
    return '未下载';
  }

  buildSystemModelMessage(model) {
    if (!model) {
      return '';
    }
    if (model.status === 'downloaded') {
      return '';
    }
    if (model.status === 'downloading') {
      const percent = Math.max(0, Math.min(100, Math.round((model.progress || 0) * 100)));
      const base = model.message || '正在下载...';
      return `${base} (${percent}%)`;
    }
    if (model.status === 'failed') {
      const reason = model.error || model.message || '请稍后重试。';
      return `下载失败：${this.truncateText(reason, 60)}`;
    }
    if ((model.key || '') === 'clip_vit_b_32_multilingual') {
      return '';
    }
    return model.message || '';
  }

  truncateText(text, limit = 80) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit - 1)}…`;
  }

  getVendorLabel(model) {
    if (!model) {
      return '';
    }
    const key = model.key || '';
    switch (key) {
      case 'bge_m3':
      case 'bge_reranker_v2_m3':
        return 'AAAI';
      case 'clip_vit_b_32':
      case 'clip_vit_b_32_multilingual':
        return 'SentenceTransformer';
      case 'pdf_extract_kit':
        return 'opendatalab';
      default:
        if (Array.isArray(model.tags)) {
          const vendorTag = model.tags.find((tag) => typeof tag === 'string' && tag.trim());
          if (vendorTag) {
            return vendorTag.trim();
          }
        }
        return model.providerName || '系统模型';
    }
  }

  setupAddModal() {
    if (this.addModalEl) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'model-add-modal';
    overlay.innerHTML = `
      <div class="model-add-modal__content">
        <h3 class="model-add-modal__title">添加模型</h3>
        <div class="model-add-modal__field">
          <label for="model-add-source">来源</label>
          <select id="model-add-source" data-role="source"></select>
        </div>
        <div class="model-add-modal__field" data-role="model-field">
          <label for="model-add-model">模型名称</label>
          <input id="model-add-model" data-role="model-input" type="text" autocomplete="off" />
          <select id="model-add-model-select" data-role="model-select" style="display: none;"></select>
        </div>
        <div class="model-add-modal__field" data-role="model-url-field" style="display: none;">
          <label for="model-add-url">接口 URL</label>
          <input id="model-add-url" data-role="model-url" type="text" placeholder="http://localhost:11434/v1/chat/completions" />
        </div>
        <div class="model-add-modal__field">
          <label for="model-add-description">模型描述</label>
          <textarea id="model-add-description" data-role="model-description" rows="3"></textarea>
        </div>
        <div class="model-add-modal__status" data-role="status"></div>
        <div class="model-add-modal__actions">
          <button type="button" class="model-add-modal__btn ghost" data-action="cancel">取消</button>
          <button type="button" class="model-add-modal__btn primary" data-action="confirm">添加</button>
        </div>
      </div>
    `;

    this.addModalEl = overlay;
    this.sourceSelectEl = overlay.querySelector('[data-role="source"]');
    this.modelFieldEl = overlay.querySelector('[data-role="model-field"]');
    this.modelInputEl = overlay.querySelector('[data-role="model-input"]');
    this.modelSelectEl = overlay.querySelector('[data-role="model-select"]');
    this.modelUrlFieldEl = overlay.querySelector('[data-role="model-url-field"]');
    this.modelUrlEl = overlay.querySelector('[data-role="model-url"]');
    this.modelDescriptionEl = overlay.querySelector('[data-role="model-description"]');
    this.modalStatusEl = overlay.querySelector('[data-role="status"]');
    this.modalConfirmBtn = overlay.querySelector('[data-action="confirm"]');
    this.modalCancelBtn = overlay.querySelector('[data-action="cancel"]');

    this.buildSourceSelectOptions();
    if (this.catalog.length > 0) {
      this.populateModelOptionsForSource(this.catalog[0].sourceId);
    }

    if (this.sourceSelectEl) {
      this.sourceSelectEl.addEventListener('change', () => {
        this.populateModelOptionsForSource(this.sourceSelectEl.value);
        this.clearModalStatus();
      });
    }

    if (this.modelSelectEl) {
      this.modelSelectEl.addEventListener('change', () => {
        this.clearModalStatus();
      });
    }

    if (this.modalConfirmBtn) {
      this.modalConfirmBtn.addEventListener('click', () => {
        this.handleAddModel();
      });
    }

    if (this.modalCancelBtn) {
      this.modalCancelBtn.addEventListener('click', () => {
        if (!this.addModalLoading) {
          this.hideAddModal();
        }
      });
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && !this.addModalLoading) {
        this.hideAddModal();
      }
    });

    this.handleModalKeydown = (event) => {
      if (event.key === 'Escape' && this.addModalEl?.classList.contains('visible') && !this.addModalLoading) {
        this.hideAddModal();
      }
    };

    document.body.appendChild(overlay);
  }

  showAddModal() {
    if (!this.addModalEl) {
      return;
    }
    this.clearModalStatus();
    this.modalConfirmGuardDisabled = false;
    this.ollamaFetchError = null;
    this.ollamaFetchInFlight = false;
    if (this.modelInputEl) {
      this.modelInputEl.value = '';
    }
    if (this.modelSelectEl) {
      this.modelSelectEl.innerHTML = '';
      this.modelSelectEl.value = '';
    }
    if (this.modelUrlEl) {
      this.modelUrlEl.value = '';
    }
    if (this.modelDescriptionEl) {
      this.modelDescriptionEl.value = '';
    }
    this.setModalLoading(false);
    if (this.sourceSelectEl) {
      this.populateModelOptionsForSource(this.sourceSelectEl.value);
    }
    this.addModalEl.classList.add('visible');
    if (this.modelInputEl) {
      this.modelInputEl.focus();
    }
    document.addEventListener('keydown', this.handleModalKeydown);
  }

  hideAddModal() {
    if (!this.addModalEl) {
      return;
    }
    this.addModalEl.classList.remove('visible');
    this.modalConfirmGuardDisabled = false;
    this.ollamaFetchInFlight = false;
    this.setModalLoading(false);
    this.clearModalStatus();
    document.removeEventListener('keydown', this.handleModalKeydown);
  }

  async handleAddModel() {
    if (this.addModalLoading) {
      return;
    }

    const sourceId = this.sourceSelectEl?.value;
    const isOllama = sourceId === 'ollama';
    const modelName = isOllama
      ? this.modelSelectEl?.value?.trim()
      : this.modelInputEl?.value?.trim();
    const modelUrl = isOllama ? this.modelUrlEl?.value?.trim() : '';
    const modelDescription = this.modelDescriptionEl?.value?.trim() || '';

    const source = this.getSourceById(sourceId);

    if (!source) {
      this.setModalStatus('请选择模型来源。', 'error');
      return;
    }

    if (!modelName) {
      this.setModalStatus('请输入模型名称。', 'error');
      return;
    }

    if (isOllama && !modelName) {
      this.setModalStatus('请选择要接入的 Ollama 模型。', 'error');
      return;
    }

    if (isOllama && !modelUrl) {
      this.setModalStatus('请输入 Ollama 接口的 URL。', 'error');
      return;
    }

    if (isOllama && modelUrl) {
      try {
        const parsedUrl = new URL(modelUrl);
        if (!/^https?:$/i.test(parsedUrl.protocol)) {
          this.setModalStatus('接口 URL 仅支持 http 或 https 协议。', 'error');
          return;
        }
      } catch (error) {
        this.setModalStatus('接口 URL 无效，请检查格式。', 'error');
        return;
      }
    }

    if (this.userModels.some((item) => item.sourceId === source.sourceId && item.modelId === modelName)) {
      this.setModalStatus('该模型已在列表中，无需重复添加。', 'warning');
      return;
    }

    const requiresApiKey = source.requiresApiKey !== false;
    const apiKeySetting = source.apiKeySetting || (requiresApiKey ? 'siliconflwApiKey' : null);
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    const apiKey = requiresApiKey && settingsModule && typeof settingsModule.getApiKey === 'function'
      ? settingsModule.getApiKey(apiKeySetting)
      : '';

    if (requiresApiKey && !apiKey) {
      this.setModalStatus('请先在设置页面填写对应的 API Key。', 'error');
      return;
    }

    this.setModalLoading(true);
    this.setModalStatus('正在测试连接，请稍候...', 'info');

    try {
      // 根据来源选择不同的验证方法
      if (sourceId === 'openai') {
        await this.testOpenAIConnection(apiKey, modelName);
      } else if (isOllama) {
        await this.testOllamaConnection(modelUrl, modelName);
      } else {
        await this.testSiliconflowConnection(apiKey, modelName);
      }

      this.setModalStatus('测试通过，模型已添加。', 'success');
      this.appendModelCard({
        sourceId: source.sourceId,
        modelId: modelName,
        apiModel: modelName,
        apiKeySetting,
        name: modelName,
        apiUrl: isOllama ? modelUrl : null,
        requiresApiKey,
        providerName: source.name,
        providerIcon: source.icon || null,
        description: modelDescription,
        parameterSize: this.extractParameterSize(modelName)
      });

      if (this.modelInputEl) {
        this.modelInputEl.value = '';
      }
      if (this.modelDescriptionEl) {
        this.modelDescriptionEl.value = '';
      }
      if (this.modelSelectEl) {
        this.modelSelectEl.value = '';
      }

      setTimeout(() => {
        this.hideAddModal();
      }, 600);
    } catch (error) {
      const message = error?.message || '测试失败，请稍后重试。';
      this.setModalStatus(`测试失败：${message}`, 'error');
      this.setModalLoading(false);
    }
  }

  async testOllamaConnection(url, apiModel) {
    const payload = {
      model: apiModel,
      messages: [
        {
          role: 'user',
          content: '你好，如果你能够正常工作，请回复我“你好”，不需要输出其他内容。'
        }
      ],
      stream: false
    };

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw new Error(error?.message || '无法连接到 Ollama 服务，请检查本地服务是否已启动。');
    }

    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      console.warn('解析 Ollama 响应失败:', parseError);
    }

    if (!response.ok) {
      const errorMessage =
        data?.error ||
        data?.message ||
        `调用失败，状态码 ${response.status}`;
      throw new Error(errorMessage);
    }

    if (data && data.choices) {
      console.debug('Ollama 测试响应已接收', {
        status: response.status,
        model: apiModel
      });
    }
  }

  async testSiliconflowConnection(apiKey, apiModel) {
    const url = 'https://api.siliconflow.cn/v1/chat/completions';
    const payload = {
      model: apiModel,
      messages: [
        {
          role: 'user',
          content: '你好，如果你能够正常工作，请回复我“你好”，不需要输出其他内容。'
        }
      ]
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    let data = null;
    try {
      data = await response.json();
      if (data && data.id) {
        console.debug('SiliconFlow 测试响应已接收', {
          status: response.status,
          id: data.id,
          usage: data.usage || null
        });
      } else {
        console.debug('SiliconFlow 测试响应已接收');
      }
    } catch (parseError) {
      console.warn('解析 SiliconFlow 响应失败:', parseError);
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `调用失败，状态码 ${response.status}`;
      throw new Error(errorMessage);
    }
  }

  async testOpenAIConnection(apiKey, model = "gpt-4o-mini") {
    const url = 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "user", content: '你好，如果你能够正常工作，请回复我“你好”，不需要输出其他内容。' }
        ],
        max_tokens: 20  // 限制返回字数，减少开销
      })
    });

    let data = null;
    try {
      data = await response.json();
      if (data && data.choices && data.choices[0]) {
        console.debug('OpenAI 测试响应已接收', {
          status: response.status,
          model: model,
          content: data.choices[0].message?.content
        });
      } else {
        console.debug('OpenAI 测试响应已接收');
      }
    } catch (parseError) {
      console.warn('解析 OpenAI 响应失败:', parseError);
    }

    if (!response.ok) {
      const errorMessage =
        data?.error?.message ||
        data?.message ||
        `模型 "${model}" 调用失败，状态码 ${response.status}`;
      throw new Error(errorMessage);
    }
  }

  appendModelCard(model) {
    const prepared = this.enrichModel(model);
    this.userModels.push(prepared);
    this.renderAllModels();
    this.persistModels();
  }

  updateModalControlsState() {
    const confirmDisabled = this.addModalLoading || this.modalConfirmGuardDisabled;
    if (this.modalConfirmBtn) {
      this.modalConfirmBtn.disabled = confirmDisabled;
      this.modalConfirmBtn.textContent = this.addModalLoading ? '测试中…' : '添加';
    }
    if (this.modalCancelBtn) {
      this.modalCancelBtn.disabled = this.addModalLoading;
    }
    if (this.sourceSelectEl) {
      this.sourceSelectEl.disabled = this.addModalLoading;
    }
    if (this.modelInputEl) {
      const hidden = this.modelInputEl.style.display === 'none';
      this.modelInputEl.disabled = this.addModalLoading || hidden;
    }
    if (this.modelSelectEl) {
      const hidden = this.modelSelectEl.style.display === 'none';
      this.modelSelectEl.disabled = this.addModalLoading || hidden || this.ollamaFetchInFlight;
    }
    if (this.modelUrlEl) {
      const hidden = this.modelUrlFieldEl && this.modelUrlFieldEl.style.display === 'none';
      this.modelUrlEl.disabled = this.addModalLoading || Boolean(hidden);
    }
    if (this.modelDescriptionEl) {
      this.modelDescriptionEl.disabled = this.addModalLoading;
    }
  }

  setModalLoading(isLoading) {
    this.addModalLoading = Boolean(isLoading);
    this.updateModalControlsState();
  }

  setModalStatus(message, type = 'info') {
    if (!this.modalStatusEl) {
      return;
    }
    this.modalStatusEl.textContent = message || '';
    this.modalStatusEl.className = `model-add-modal__status ${type}`;
  }

  clearModalStatus() {
    if (this.modalStatusEl) {
      this.modalStatusEl.textContent = '';
      this.modalStatusEl.className = 'model-add-modal__status';
    }
  }

  showModelPage() {
    if (!this.initialized) {
      this.init();
    }

    this.hideOtherAreas();
    this.renderAllModels();

    if (this.modelPageEl) {
      this.modelPageEl.style.display = 'flex';
    }
    // 进入模型页面后更新轮询状态
    this.updateSystemPollingState();
  }

  hideModelPage() {
    if (this.modelPageEl) {
      this.modelPageEl.style.display = 'none';
    }
    // 离开模型页面时停止轮询
    this.stopSystemPolling();
  }

  hideOtherAreas() {
    const hideEl = (id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
      }
    };

    hideEl('file-content');
    hideEl('settings-page');
    hideEl('database-page');
    hideEl('chat-page');

    const chatHistory = document.getElementById('chat-history-container');
    if (chatHistory) {
      chatHistory.style.display = 'none';
    }

    const fileTree = document.getElementById('file-tree-container');
    if (fileTree) {
      fileTree.style.display = 'none';
    }

    const searchArea = document.getElementById('search-area');
    if (searchArea) {
      searchArea.style.display = 'none';
    }
  }

  renderAllModels() {
    if (!this.cardContainerEl) {
      this.notifyModelRegistryChanged();
      return;
    }

    this.cardContainerEl.innerHTML = '';

    if (this.providerTitleEl) {
      this.providerTitleEl.textContent = '模型库';
    }
    const fragment = document.createDocumentFragment();

    if (Array.isArray(this.systemModels) && this.systemModels.length > 0) {
      const systemWrapper = document.createElement('div');
      systemWrapper.className = 'model-section system-model-section';
      const title = document.createElement('h4');
      title.className = 'model-section__title';
      title.textContent = '系统模型';
      systemWrapper.appendChild(title);
      const systemGrid = document.createElement('div');
      systemGrid.className = 'model-card-grid';
      this.systemModels.forEach((systemModel) => {
        const card = this.buildSystemModelCard(systemModel);
        systemGrid.appendChild(card);
      });
      systemWrapper.appendChild(systemGrid);
      fragment.appendChild(systemWrapper);
    }

    if (this.userModels.length > 0) {
      const userWrapper = document.createElement('div');
      userWrapper.className = 'model-section user-model-section';
      const title = document.createElement('h4');
      title.className = 'model-section__title';
      title.textContent = '我的模型';
      userWrapper.appendChild(title);
      const userGrid = document.createElement('div');
      userGrid.className = 'model-card-grid';
      this.userModels.forEach((model) => {
        const card = this.buildModelCard(model);
        userGrid.appendChild(card);
      });
      userWrapper.appendChild(userGrid);
      fragment.appendChild(userWrapper);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'model-placeholder';
      placeholder.textContent = '尚未添加自定义模型。点击右上角的“添加”按钮开始。';
      fragment.appendChild(placeholder);
    }

    this.cardContainerEl.appendChild(fragment);
    this.notifyModelRegistryChanged();
  }

  buildModelCard(model) {
    const card = document.createElement('article');
    card.className = 'model-card';

    const header = document.createElement('div');
    header.className = 'model-card-header';

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'model-card-titles';

    const title = document.createElement('h3');
    title.className = 'model-card-title';
    title.textContent = model.name;

    const providerLabel = document.createElement('span');
    providerLabel.className = 'model-card-provider';
    providerLabel.textContent = model.providerName;

    const statusLabel = document.createElement('span');
    statusLabel.className = 'model-card-status model-card-status--connected';
    statusLabel.textContent = '已连接';

    titleWrapper.appendChild(title);
    titleWrapper.appendChild(providerLabel);
    titleWrapper.appendChild(statusLabel);

    header.appendChild(titleWrapper);

    const description = document.createElement('p');
    description.className = 'model-card-description';
    description.textContent = model.description || '暂无简介。';
    // 取消悬浮显示所有描述的功能，不设置 title 提示

    const tagsWrapper = document.createElement('div');
    tagsWrapper.className = 'model-card-tags';

    if (Array.isArray(model.tags) && model.tags.length > 0) {
      model.tags.forEach((tag) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'model-tag';
        tagEl.textContent = tag;
        tagsWrapper.appendChild(tagEl);
      });
    }

    card.appendChild(header);
    card.appendChild(description);
    if (tagsWrapper.children.length > 0) {
      card.appendChild(tagsWrapper);
    }

    card.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.confirmRemoveModel(model);
    });

    return card;
  }

  confirmRemoveModel(model) {
    const confirmRemoval = () => {
      this.removeModel(model);
    };

    if (typeof window.showModal === 'function') {
      window.showModal({
        type: 'warning',
        title: '删除模型',
        message: `确定要移除 ${model.name} 吗？`,
        confirmText: '删除',
        cancelText: '暂不删除',
        showCancel: true,
        onConfirm: confirmRemoval
      });
      return;
    }

    if (window.confirm(`确定要移除 ${model.name} 吗？`)) {
      confirmRemoval();
    }
  }

  removeModel(model) {
    this.userModels = this.userModels.filter((item) => {
      return !(item.sourceId === model.sourceId && item.modelId === model.modelId);
    });
    this.renderAllModels();
    this.persistModels();
  }

  notifyModelRegistryChanged() {
    const snapshot = this.getModels();
    const safeSnapshot = Array.isArray(snapshot) ? snapshot.map((model) => ({ ...model })) : [];

    if (typeof window !== 'undefined') {
      window.__fsModelRegistry = {
        models: safeSnapshot.map((model) => ({ ...model })),
        updatedAt: Date.now()
      };
    }

    this.registryListeners.forEach((listener) => {
      if (typeof listener !== 'function') {
        return;
      }
      try {
        listener(safeSnapshot.map((model) => ({ ...model })));
      } catch (error) {
        console.error('通知模型监听器失败:', error);
      }
    });

    document.dispatchEvent(new CustomEvent('modelRegistryChanged', {
      detail: { models: safeSnapshot }
    }));
  }

  onModelRegistryChanged(listener) {
    if (typeof listener !== 'function') {
      return () => { };
    }

    this.registryListeners.add(listener);

    try {
      const snapshot = this.getModels();
      listener(snapshot.map((model) => ({ ...model })));
    } catch (error) {
      console.error('初始化模型监听器回调失败:', error);
    }

    return () => {
      this.registryListeners.delete(listener);
    };
  }

  getModels() {
    return this.userModels.map((model) => this.enrichModel(model));
  }

  restorePersistedModels() {
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    if (!settingsModule || typeof settingsModule.getCustomModels !== 'function') {
      return;
    }
    try {
      const stored = settingsModule.getCustomModels();
      if (Array.isArray(stored) && stored.length) {
        this.userModels = stored.map((model) => this.enrichModel(model));
      }
    } catch (error) {
      console.warn('恢复用户模型失败:', error);
    }
  }

  persistModels() {
    const settingsModule = this.dependencies.getSettingsModule ? this.dependencies.getSettingsModule() : null;
    if (!settingsModule || typeof settingsModule.updateCustomModels !== 'function') {
      return;
    }
    settingsModule.updateCustomModels(this.getModels()).catch((error) => {
      console.error('保存用户模型失败:', error);
    });
  }

  getSourceById(sourceId) {
    return this.catalog.find((source) => source.sourceId === sourceId) || null;
  }

  getModelById(sourceId, modelId) {
    const source = this.getSourceById(sourceId);
    if (!source || !Array.isArray(source.models)) {
      return null;
    }
    return source.models.find((model) => model.modelId === modelId) || null;
  }

  enrichModel(model = {}) {
    const enriched = { ...model };
    const source = enriched.sourceId ? this.getSourceById(enriched.sourceId) : null;
    if (source) {
      enriched.providerName = enriched.providerName || source.name;
      enriched.providerIcon = enriched.providerIcon || source.icon || null;
      if (typeof enriched.requiresApiKey !== 'boolean') {
        enriched.requiresApiKey = source.requiresApiKey !== false;
      }
      if (!enriched.apiUrl && typeof source.defaultApiUrl === 'string' && source.defaultApiUrl) {
        enriched.apiUrl = source.defaultApiUrl;
      }
      if (enriched.requiresApiKey !== false) {
        enriched.apiKeySetting = enriched.apiKeySetting || source.apiKeySetting || 'siliconflwApiKey';
      } else if (!enriched.apiKeySetting) {
        enriched.apiKeySetting = null;
      }
      if (!enriched.apiModel) {
        const catalogModel = this.getModelById(enriched.sourceId, enriched.modelId);
        if (catalogModel && catalogModel.apiModel) {
          enriched.apiModel = catalogModel.apiModel;
        }
      }
    }
    // 解析图标资源路径，确保打包后能正确加载
    if (enriched.providerIcon) {
      enriched.providerIcon = getAssetUrl(enriched.providerIcon);
    }
    if (typeof enriched.requiresApiKey !== 'boolean') {
      enriched.requiresApiKey = true;
    }
    if (typeof enriched.apiUrl === 'string') {
      enriched.apiUrl = enriched.apiUrl.trim();
      if (!enriched.apiUrl) {
        enriched.apiUrl = null;
      }
    } else {
      enriched.apiUrl = null;
    }
    if (enriched.requiresApiKey !== false) {
      enriched.apiKeySetting = enriched.apiKeySetting || 'siliconflwApiKey';
    } else {
      enriched.apiKeySetting = enriched.apiKeySetting || null;
    }
    enriched.description = typeof enriched.description === 'string' ? enriched.description : '';
    enriched.parameterSize = enriched.parameterSize || this.extractParameterSize(enriched.apiModel || enriched.name || enriched.modelId);
    enriched.tags = this.buildModelTags(enriched, source);
    return enriched;
  }

  getInitials(text) {
    if (!text) {
      return '';
    }
    const sanitized = text.trim();
    if (!sanitized) {
      return '';
    }
    const parts = sanitized.split(/\s+/);
    if (parts.length === 1) {
      return sanitized.substring(0, 2).toUpperCase();
    }
    const initials = parts.slice(0, 2).map((part) => part.charAt(0)).join('');
    return initials.toUpperCase();
  }

  buildModelTags(model, source) {
    const providerName = model.providerName || source?.name || '未知来源';
    const parameterSize = model.parameterSize || '未知';
    const displayName = model.name || model.apiModel || model.modelId || '未命名模型';
    return [providerName, parameterSize, displayName].filter((item) => typeof item === 'string' && item.trim().length > 0);
  }

  extractParameterSize(identifier) {
    if (!identifier || typeof identifier !== 'string') {
      return '未知';
    }
    const match = identifier.match(/(\d+(?:\.\d+)?)(?:\s*)([kKmMgGtTpP]?)[bB](?![a-zA-Z])/);
    if (match) {
      const value = match[1];
      const unit = match[2] ? match[2].toUpperCase() : '';
      return `${value}${unit}B`;
    }
    return '未知';
  }
}

window.ModelModule = ModelModule;
