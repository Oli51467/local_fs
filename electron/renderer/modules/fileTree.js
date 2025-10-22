(function initFileTreeModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const state = {
    fileTreeEl: null,
    fileTreeContainer: null,
    selectedItemPath: null,
    expandedFolders: new Set(),
    draggedElement: null,
    draggedPath: null,
    dropIndicator: null,
    rootOverlay: null,
    copyShortcutListener: null,
    pasteShortcutListener: null,
    arrowNavigationListener: null,
    renameStylesInjected: false,
    dataRootPath: null,
    lastContextMenu: {
      path: null,
      timestamp: 0
    }
  };

  const dependencies = {
    getFileTreeEl: () => document.getElementById('file-tree'),
    getFileTreeContainer: () => document.getElementById('file-tree-container'),
    getExplorerModule: () => global.explorerModule,
    getFileViewer: () => global.fileViewer,
    setFileViewer: (viewer) => {
      global.fileViewer = viewer;
    },
    showModal: (options) => {
      if (typeof global.showModal === 'function') {
        global.showModal(options);
      }
    },
    closeAllModals: () => {
      if (typeof global.closeAllModals === 'function') {
        global.closeAllModals();
      }
    },
    showAlert: (message, type) => {
      if (typeof global.showAlert === 'function') {
        global.showAlert(message, type);
      } else if (type === 'error') {
        console.error(message);
      } else {
        console.log(message);
      }
    },
    showSuccessModal: (message) => {
      if (typeof global.showSuccessModal === 'function') {
        global.showSuccessModal(message);
      } else {
        dependencies.showModal({ type: 'success', message });
      }
    },
    showLoadingOverlay: (message) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.showLoadingOverlay === 'function') {
        overlayModule.showLoadingOverlay(message);
      }
    },
    hideLoadingOverlay: () => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.hideLoadingOverlay === 'function') {
        overlayModule.hideLoadingOverlay();
      }
    },
    setLoadingOverlayProgress: (...args) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.setLoadingOverlayProgress === 'function') {
        overlayModule.setLoadingOverlayProgress(...args);
      }
    },
    setLoadingOverlayIndeterminate: (...args) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.setLoadingOverlayIndeterminate === 'function') {
        overlayModule.setLoadingOverlayIndeterminate(...args);
      }
    },
    startLoadingOverlayProgressLoop: (...args) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.startLoadingOverlayProgressLoop === 'function') {
        overlayModule.startLoadingOverlayProgressLoop(...args);
      }
    },
    updateLoadingOverlayProgressLoop: (...args) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.updateLoadingOverlayProgressLoop === 'function') {
        overlayModule.updateLoadingOverlayProgressLoop(...args);
      }
    },
    stopLoadingOverlayProgressLoop: (...args) => {
      const overlayModule = modules.loadingOverlay;
      if (overlayModule && typeof overlayModule.stopLoadingOverlayProgressLoop === 'function') {
        overlayModule.stopLoadingOverlayProgressLoop(...args);
      }
    },
    updateFolderUploadStatus: async () => { },
    refreshFolderUploadIndicators: async () => { },
    resolveNodeRelativePath: (node) => {
      if (typeof global.resolveNodeRelativePath === 'function') {
        return global.resolveNodeRelativePath(node);
      }
      return 'data';
    }
  };

  const DOCUMENT_INFO_ENDPOINT = 'http://localhost:8000/api/document/info';
  let fileDetailOverlayElement = null;
  let fileDetailOverlayKeyHandler = null;

  async function resolveProjectAbsolutePath(pathValue) {
    if (!pathValue) {
      return null;
    }
    if (typeof window.fsAPI?.resolveProjectPath === 'function') {
      try {
        const resolved = await window.fsAPI.resolveProjectPath(pathValue);
        return resolved || null;
      } catch (error) {
        console.warn('解析项目路径失败:', error);
        return null;
      }
    }
    return pathValue;
  }

  function resolveProjectAbsolutePathSync(pathValue) {
    if (!pathValue) {
      return null;
    }
    if (typeof window.fsAPI?.resolveProjectPathSync === 'function') {
      try {
        const resolved = window.fsAPI.resolveProjectPathSync(pathValue);
        return resolved || null;
      } catch (error) {
        console.warn('解析项目路径失败:', error);
        return null;
      }
    }
    return pathValue;
  }

  async function ensureProjectAbsolutePath(pathValue) {
    const resolved = await resolveProjectAbsolutePath(pathValue);
    if (!resolved) {
      throw new Error('文件必须位于项目根目录内');
    }
    return resolved;
  }

  function computeRelativeFromRuntime(absolutePath) {
    if (!absolutePath) {
      return null;
    }
    try {
      const runtimePaths = typeof window.fsAPI?.getRuntimePathsSync === 'function'
        ? window.fsAPI.getRuntimePathsSync()
        : null;
      if (!runtimePaths?.externalRoot) {
        return null;
      }
      const normalizedAbs = String(absolutePath).replace(/\\/g, '/');
      const normalizedRoot = String(runtimePaths.externalRoot).replace(/\\/g, '/').replace(/\/+$/, '');
      if (!normalizedAbs.startsWith(normalizedRoot)) {
        return null;
      }
      const remainder = normalizedAbs.slice(normalizedRoot.length).replace(/^\/+/, '');
      return remainder || '';
    } catch (error) {
      console.warn('计算项目相对路径失败:', error);
      return null;
    }
  }

  async function toProjectRelativePath(pathValue) {
    if (!pathValue) {
      return null;
    }

    if (typeof window.fsAPI?.toProjectRelativePath === 'function') {
      try {
        const relative = await window.fsAPI.toProjectRelativePath(pathValue);
        if (relative !== null && relative !== undefined) {
          return relative;
        }
      } catch (error) {
        console.warn('转换项目相对路径失败:', error);
      }
    }

    const absolute = await resolveProjectAbsolutePath(pathValue);
    return computeRelativeFromRuntime(absolute);
  }

  function toProjectRelativePathSync(pathValue) {
    if (!pathValue) {
      return null;
    }

    if (typeof window.fsAPI?.toProjectRelativePathSync === 'function') {
      try {
        const relative = window.fsAPI.toProjectRelativePathSync(pathValue);
        if (relative !== null && relative !== undefined) {
          return relative;
        }
      } catch (error) {
        console.warn('转换项目相对路径失败:', error);
      }
    }

    const absolute = resolveProjectAbsolutePathSync(pathValue);
    return computeRelativeFromRuntime(absolute);
  }

  function escapeCssIdentifier(value) {
    if (typeof window.CSS?.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function findTreeElementByPath(pathValue) {
    if (!pathValue) {
      return null;
    }
    const escaped = escapeCssIdentifier(pathValue);
    return document.querySelector(`.file-item[data-path="${escaped}"]`);
  }

  async function resolveRelativePathForDetail(pathValue) {
    const element = findTreeElementByPath(pathValue);
    const datasetPath = element?.dataset?.relativePath;
    if (datasetPath && datasetPath !== 'data') {
      return datasetPath;
    }
    try {
      const relative = await toProjectRelativePath(pathValue);
      if (relative) {
        if (relative.startsWith('data')) {
          return relative;
        }
        return `data/${relative.replace(/^\/+/, '')}`;
      }
    } catch (error) {
      console.warn('获取文件相对路径失败:', error);
    }
    return datasetPath || null;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const normalized = bytes / (1024 ** exponent);
    const decimals = exponent === 0 ? 0 : normalized >= 100 ? 0 : normalized >= 10 ? 1 : 2;
    return `${normalized.toFixed(decimals)} ${units[exponent]}`;
  }

  function formatDisplayTime(displayValue, isoValue) {
    if (displayValue) {
      return displayValue;
    }
    if (!isoValue) {
      return null;
    }
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) {
      return isoValue;
    }
    try {
      return parsed.toLocaleString();
    } catch (error) {
      return parsed.toISOString();
    }
  }

  function closeFileDetailOverlay() {
    if (fileDetailOverlayElement) {
      fileDetailOverlayElement.remove();
      fileDetailOverlayElement = null;
    }
    if (fileDetailOverlayKeyHandler) {
      document.removeEventListener('keydown', fileDetailOverlayKeyHandler);
      fileDetailOverlayKeyHandler = null;
    }
  }

  function showFileDetailOverlay(detail) {
    closeFileDetailOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'file-detail-overlay';

    const card = document.createElement('div');
    card.className = 'file-detail-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', '文件详细信息');

    const header = document.createElement('div');
    header.className = 'file-detail-header';

    const title = document.createElement('div');
    title.className = 'file-detail-title';
    title.textContent = '文件详细信息';

    header.appendChild(title);

    const body = document.createElement('div');
    body.className = 'file-detail-body';

    const appendRow = (label, value, options = {}) => {
      const row = document.createElement('div');
      row.className = 'file-detail-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'file-detail-label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.className = 'file-detail-value';
      if (options.monospace) {
        valueEl.classList.add('file-detail-monospace');
      }
      if (options.summary) {
        valueEl.classList.add('file-detail-summary');
      }
      if (options.empty) {
        valueEl.classList.add('file-detail-empty');
      }
      const displayText = value ?? '';
      if (options.title) {
        valueEl.title = options.title;
      } else if (displayText) {
        valueEl.title = displayText;
      }
      valueEl.textContent = displayText || options.placeholder || '';

      valueEl.addEventListener('click', async (event) => {
        event.stopPropagation();
        const textForCopy = options.copyValue ?? displayText ?? '';
        if (!textForCopy) {
          return;
        }
        try {
          const clipboardText = String(textForCopy);
          if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(clipboardText);
          } else if (window?.fsAPI?.writeClipboardText) {
            await window.fsAPI.writeClipboardText(clipboardText);
          } else {
            throw new Error('当前环境不支持复制到剪贴板');
          }
        } catch (copyError) {
          console.warn('复制失败:', copyError);
        }
      });

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      body.appendChild(row);
      return valueEl;
    };

    const ellipsis = '…';
    const typeDisplay = (detail?.file_type || '').toString().toUpperCase() || ellipsis;
    const sizeDisplay = detail?.file_size != null ? formatBytes(detail.file_size) : ellipsis;
    const hashValue = detail?.file_hash || ellipsis;
    const mountTime = formatDisplayTime(detail?.upload_time, detail?.upload_time_iso) || ellipsis;
    const updatedTime = formatDisplayTime(detail?.updated_time, detail?.updated_time_iso) || ellipsis;
    const chunkCount = detail?.total_chunks != null ? String(detail.total_chunks) : ellipsis;

    const filenameRaw = detail?.filename || ellipsis;
    const filenameWithoutExt = (() => {
      if (!filenameRaw || filenameRaw === ellipsis) {
        return filenameRaw;
      }
      const parsed = filenameRaw.split('.');
      if (parsed.length <= 1) {
        return filenameRaw;
      }
      parsed.pop();
      return parsed.join('.') || filenameRaw;
    })();

    appendRow('文件名', filenameWithoutExt, {
      copyValue: filenameRaw,
      placeholder: ellipsis
    });
    appendRow('文件类型', typeDisplay);
    appendRow('文件大小', sizeDisplay);
    appendRow('内容哈希', hashValue, {
      monospace: true,
      title: hashValue
    });
    appendRow('挂载时间', mountTime);
    appendRow('更新时间', updatedTime);
    appendRow('切分块数量', chunkCount);

    const summaryRaw = (detail?.summary_text || detail?.summary_preview || '').trim();
    const summaryDisplay = summaryRaw || ellipsis;
    appendRow('主题信息', summaryDisplay, {
      summary: true,
      empty: !summaryRaw,
      title: summaryRaw || ''
    });

    card.appendChild(header);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        closeFileDetailOverlay();
      }
    });

    fileDetailOverlayKeyHandler = (event) => {
      if (event.key === 'Escape') {
        closeFileDetailOverlay();
      }
    };
    document.addEventListener('keydown', fileDetailOverlayKeyHandler);

    fileDetailOverlayElement = overlay;
  }

  async function handleShowDocumentDetails(itemPath) {
    if (!itemPath) {
      return;
    }
    const relativePath = await resolveRelativePathForDetail(itemPath);
    if (!relativePath || relativePath === 'data') {
      dependencies.showModal({
        type: 'warning',
        title: '无法获取详细信息',
        message: '该文件尚未挂载或不在数据目录中。',
        showCancel: false
      });
      return;
    }

    try {
      const response = await fetch(`${DOCUMENT_INFO_ENDPOINT}?file_path=${encodeURIComponent(relativePath)}`);
      const payload = await response.json();
      if (!response.ok) {
        const errorMessage = payload?.detail || payload?.message || `HTTP ${response.status}`;
        const errorInfo = Object.assign(new Error(errorMessage), {
          status: response.status,
          detail: payload?.detail || payload?.message || null
        });
        throw errorInfo;
      }
      showFileDetailOverlay(payload);
    } catch (error) {
      const message = error?.detail || error?.message || '请确认后端服务已启动并可访问。';
      const isNotMounted = error?.status === 404 && /未找到对应的文档记录/.test(message);
      dependencies.showModal({
        type: isNotMounted ? 'warning' : 'error',
        title: isNotMounted ? '文件尚未挂载' : '获取详细信息失败',
        message: isNotMounted ? '请先挂载该文件后，再查看详细信息。' : message,
        showCancel: false
      });
    }
  }

  function buildModelSummaryPayload() {
    const settingsModule = window.settingsModule;
    if (!settingsModule || typeof settingsModule.getModelSummaryConfig !== 'function') {
      return { enabled: false, model: null };
    }
    try {
      const config = settingsModule.getModelSummaryConfig();
      if (!config || typeof config !== 'object') {
        return { enabled: false, model: null };
      }
      if (!config.enabled || !config.model) {
        return { enabled: false, model: null };
      }
      return {
        enabled: true,
        model: { ...config.model }
      };
    } catch (error) {
      console.warn('读取模型摘要配置失败:', error);
      return { enabled: false, model: null };
    }
  }

  function toFileUrl(pathValue) {
    if (!pathValue) {
      return '';
    }
    let normalized = String(pathValue).replace(/\\/g, '/');
    if (/^[A-Za-z]:/.test(normalized)) {
      normalized = `/${normalized}`;
    }
    return `file://${encodeURI(normalized)}`;
  }

  function isExternalDragEvent(event) {
    const dt = event?.dataTransfer;
    if (!dt) {
      return false;
    }
    if (state.draggedElement) {
      return false;
    }
    if (dt.files && dt.files.length > 0) {
      return true;
    }
    const types = Array.from(dt.types || []);
    return types.includes('Files') || types.includes('text/uri-list');
  }

  function getExternalPathsFromEvent(event) {
    const dt = event?.dataTransfer;
    if (!dt) {
      return [];
    }
    if (state.draggedElement) {
      return [];
    }
    const paths = new Set();
    if (dt.files && dt.files.length > 0) {
      Array.from(dt.files).forEach((file) => {
        if (file?.path) {
          paths.add(file.path);
        }
      });
    }
    try {
      const uriList = dt.getData('text/uri-list');
      if (uriList) {
        uriList
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#') && line.startsWith('file:'))
          .forEach((uri) => {
            try {
              const url = new URL(uri);
              if (url.protocol === 'file:') {
                let pathname = decodeURIComponent(url.pathname || '');
                if (/^\/[A-Za-z]:/.test(pathname)) {
                  pathname = pathname.replace(/^\//, '');
                }
                paths.add(pathname);
              }
            } catch (parseError) {
              // ignore invalid uri
            }
          });
      }
    } catch (error) {
      // ignore getData errors (some browsers may throw)
    }
    return Array.from(paths);
  }

  async function importExternalFiles(targetDirectory, externalPaths) {
    if (!externalPaths || externalPaths.length === 0) {
      return;
    }
    try {
      const normalizedTarget = await ensureProjectAbsolutePath(targetDirectory);
      const response = await window.fsAPI.importFiles(normalizedTarget, externalPaths);
      if (!response?.success) {
        const message = response?.error || '导入失败';
        dependencies.showAlert(message, 'error');
        return;
      }
      const results = Array.isArray(response.results) ? response.results : [];
      const failed = results.filter((item) => item && item.success === false);
      if (failed.length === results.length && failed.length > 0) {
        dependencies.showAlert(failed[0].error || '导入失败', 'error');
      } else if (failed.length > 0) {
        dependencies.showAlert(`部分文件导入失败 (${failed.length}/${results.length})`, 'warning');
      } else {
        dependencies.showAlert('文件导入成功', 'success');
      }
      await loadFileTree();
    } catch (error) {
      dependencies.showAlert(`导入失败: ${error.message || error}`, 'error');
    }
  }

  const assetUrlCache = new Map();

  const backendProgressState = {
    fileTasks: new Map(),
    folderTasks: new Map(),
    pdfTasks: new Map() // tracks in-flight PDF deep-parse progress keyed by task id
  };

  let backendStatusListenerBound = false;

  function normalizeProgressKey(value) {
    if (!value) {
      return null;
    }
    return String(value)
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.+\//, '')
      .replace(/^\/+/, '');
  }

  function extractFileName(pathValue) {
    if (!pathValue) {
      return '';
    }
    const normalized = String(pathValue).replace(/\\/g, '/');
    const segments = normalized.split('/');
    return segments[segments.length - 1] || normalized;
  }

  async function getTrackingRelativePath(pathValue) {
    const candidates = [];
    if (pathValue) {
      candidates.push(pathValue);
    }

    const resolved = resolveProjectAbsolutePathSync(pathValue);
    if (resolved && resolved !== pathValue) {
      candidates.push(resolved);
    }

    for (const candidate of candidates) {
      try {
        const relative = await toProjectRelativePath(candidate);
        if (relative) {
          return relative;
        }
      } catch (error) {
        console.warn('获取项目相对路径失败:', error);
      }
    }

    if (resolved) {
      return computeRelativeFromRuntime(resolved) || resolved;
    }

    return pathValue;
  }

  function buildFolderOperationKey(operation, folderPathValue) {
    const normalizedFolder = normalizeProgressKey(folderPathValue);
    if (!operation || !normalizedFolder) {
      return null;
    }
    return `${operation}:${normalizedFolder}`;
  }

  function ensureBackendStatusListener() {
    if (backendStatusListenerBound) {
      return;
    }

    document.addEventListener('backendStatus', (event) => {
      const payload = event?.detail;
      if (!payload || typeof payload !== 'object') {
        return;
      }

      if (payload.event === 'document_upload') {
        handleDocumentUploadProgress(payload);
      } else if (payload.event === 'folder_operation') {
        handleFolderOperationProgress(payload);
      } else if (payload.event === 'pdf_parse') {
        handlePdfParseProgress(payload);
      }
    });

    backendStatusListenerBound = true;
  }

  function handleDocumentUploadProgress(payload) {
    const key = normalizeProgressKey(payload.file_path || payload.relative_path);
    if (!key) {
      return;
    }
    const task = backendProgressState.fileTasks.get(key);
    if (!task) {
      return;
    }

    const progress = typeof payload.progress === 'number' ? payload.progress : 0;
    const message = payload.message || task.message || `正在挂载 ${task.displayName || ''}`;
    const stageText = payload.stage || task.stage || '';

    dependencies.setLoadingOverlayProgress(progress, {
      message,
      stage: stageText || undefined
    });

    const status = payload.status || 'running';
    if (status !== 'running') {
      backendProgressState.fileTasks.delete(key);
    }
  }

  function handleFolderOperationProgress(payload) {
    const key = buildFolderOperationKey(payload.operation, payload.folder_path);
    if (!key) {
      return;
    }
    const task = backendProgressState.folderTasks.get(key);
    if (!task) {
      return;
    }

    const progress = typeof payload.progress === 'number' ? payload.progress : 0;
    const total = Number.isFinite(payload.total) ? payload.total : task.total;
    const completed = Number.isFinite(payload.completed) ? payload.completed : task.completed;

    if (Number.isFinite(total)) {
      task.total = total;
    }
    if (Number.isFinite(completed)) {
      task.completed = completed;
    }

    let stageParts = [];
    if (Number.isFinite(task.completed) && Number.isFinite(task.total) && task.total > 0) {
      stageParts.push(`进度 ${Math.min(task.completed, task.total)}/${task.total}`);
    }

    if (payload.last_file) {
      const lastName = extractFileName(payload.last_file);
      if (lastName) {
        const statusLabel = payload.last_file_success === false || payload.last_file_status === 'error'
          ? '失败'
          : '完成';
        stageParts.push(`${lastName} ${statusLabel}`);
      }
    }

    let status = payload.status || 'running';
    if (status !== 'running') {
      if (status === 'success') {
        stageParts = ['全部完成'];
      } else if (status === 'partial') {
        const failed = Number.isFinite(payload.failed) ? payload.failed : 0;
        stageParts = [`完成，失败 ${failed}`];
      } else if (status === 'failed') {
        stageParts = ['操作失败'];
      }
    }

    dependencies.setLoadingOverlayProgress(progress, {
      message: task.message || '正在处理文件夹…',
      stage: stageParts.join(' · ') || undefined
    });

    if (status !== 'running') {
      backendProgressState.folderTasks.delete(key);
    }
  }

  function handlePdfParseProgress(payload) {
    const taskId = payload.task_id || payload.taskId;
    if (!taskId) {
      return;
    }
    const task = backendProgressState.pdfTasks.get(taskId);
    if (!task) {
      return;
    }

    const progress = typeof payload.progress === 'number' ? payload.progress : 0;
    const message = payload.message || task.message || '正在解析 PDF…';
    const stageText = payload.stage || task.stage || '';

    task.message = message;
    task.stage = stageText;
    dependencies.setLoadingOverlayProgress(progress, {
      message,
      stage: stageText || undefined
    });

    const status = (payload.status || '').toLowerCase();
    if (status && status !== 'processing' && status !== 'running') {
      backendProgressState.pdfTasks.delete(taskId);
    }
  }

  const getAssetUrl = (relativePath) => {
    if (!relativePath) {
      return '';
    }
    if (assetUrlCache.has(relativePath)) {
      return assetUrlCache.get(relativePath);
    }

    let resolved = `./${relativePath.replace(/^([./\\])+/, '')}`;

    try {
      if (window.fsAPI && typeof window.fsAPI.getAssetPathSync === 'function') {
        const candidate = window.fsAPI.getAssetPathSync(relativePath);
        if (candidate) {
          resolved = candidate;
        }
      }
    } catch (error) {
      console.warn('解析资源路径失败，使用默认相对路径:', error);
    }

    assetUrlCache.set(relativePath, resolved);
    return resolved;
  };

  function configure(overrides = {}) {
    Object.keys(overrides).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(dependencies, key) && typeof overrides[key] === 'function') {
        dependencies[key] = overrides[key];
      }
    });
  }

  function ensureElements() {
    if (!state.fileTreeEl) {
      state.fileTreeEl = dependencies.getFileTreeEl();
    }
    if (!state.fileTreeContainer) {
      state.fileTreeContainer = dependencies.getFileTreeContainer();
    }
    return Boolean(state.fileTreeEl);
  }

  function getExplorerModule() {
    try {
      return dependencies.getExplorerModule ? dependencies.getExplorerModule() : global.explorerModule;
    } catch (error) {
      console.warn('获取 ExplorerModule 失败:', error);
      return global.explorerModule;
    }
  }

  function getFileViewer() {
    try {
      return dependencies.getFileViewer ? dependencies.getFileViewer() : global.fileViewer;
    } catch (error) {
      console.warn('获取文件查看器失败:', error);
      return global.fileViewer;
    }
  }

  function setFileViewer(viewer) {
    if (typeof dependencies.setFileViewer === 'function') {
      dependencies.setFileViewer(viewer);
    } else {
      global.fileViewer = viewer;
    }
  }

  function addUploadIndicator(filePath) {
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem && !fileItem.querySelector('.upload-indicator')) {
      const indicator = document.createElement('div');
      indicator.className = 'upload-indicator';
      const contentDiv = fileItem.querySelector('.file-item-content');
      if (contentDiv) {
        contentDiv.appendChild(indicator);
      } else {
        fileItem.appendChild(indicator);
      }
      fileItem.dataset.uploaded = 'true';
    }
  }

  function removeUploadIndicator(filePath) {
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (!fileItem) {
      return;
    }
    const indicator = fileItem.querySelector('.upload-indicator');
    if (indicator) {
      indicator.remove();
    }
    fileItem.dataset.uploaded = 'false';
  }

  function clearDragState() {
    state.draggedElement = null;
    state.draggedPath = null;
    if (state.fileTreeEl) {
      state.fileTreeEl.classList.remove('drag-over-root');
    }
    if (state.fileTreeContainer) {
      state.fileTreeContainer.classList.remove('drag-over-root');
    }
    document.querySelectorAll('.file-item').forEach((item) => {
      item.classList.remove('drag-over', 'drag-over-folder');
    });
    if (state.dropIndicator) {
      state.dropIndicator.style.display = 'none';
      state.dropIndicator.style.height = '2px';
      state.dropIndicator.style.backgroundColor = state.dropIndicator.dataset.defaultBg || '#007acc';
      state.dropIndicator.style.border = state.dropIndicator.dataset.defaultBorder || 'none';
    }
  }

  function ensureDropIndicator() {
    if (!state.dropIndicator) {
      state.dropIndicator = document.createElement('div');
      state.dropIndicator.style.cssText = [
        'position: absolute',
        'height: 2px',
        'background-color: #007acc',
        'border-radius: 1px',
        'pointer-events: none',
        'z-index: 1000',
        'display: none'
      ].join(';');
      state.dropIndicator.dataset.defaultBg = '#007acc';
      state.dropIndicator.dataset.defaultBorder = 'none';
      document.body.appendChild(state.dropIndicator);
    }
    return state.dropIndicator;
  }

  function ensureRootOverlay() {
    if (state.rootOverlay || !state.fileTreeContainer) {
      return state.rootOverlay;
    }
    const container = state.fileTreeContainer;
    const computedPosition = window.getComputedStyle(container).position;
    if (computedPosition === 'static') {
      container.dataset.originalPosition = 'static';
      container.style.position = 'relative';
    }
    const overlay = document.createElement('div');
    overlay.className = 'file-tree-root-overlay';
    overlay.style.cssText = [
      'position: absolute',
      'top: 0',
      'left: 0',
      'right: 0',
      'bottom: 0',
      'border: 1px dashed rgba(96, 165, 250, 0.9)',
      'background: rgba(255, 255, 255, 0.75)',
      'pointer-events: none',
      'border-radius: 6px',
      'display: none',
      'z-index: 1000'
    ].join(';');
    container.appendChild(overlay);
    state.rootOverlay = overlay;
    return overlay;
  }

  function showRootOverlay() {
    const overlay = ensureRootOverlay();
    if (overlay) {
      overlay.style.display = 'block';
    }
    if (state.fileTreeContainer) {
      state.fileTreeContainer.classList.add('drag-over-root');
    }
  }

  function hideRootOverlay() {
    if (state.rootOverlay) {
      state.rootOverlay.style.display = 'none';
    }
    if (state.fileTreeContainer) {
      state.fileTreeContainer.classList.remove('drag-over-root');
    }
  }

  function addDragAndDropSupport(element, node, isFolder) {
    element.draggable = true;

    element.addEventListener('dragstart', (event) => {
      state.draggedElement = element;
      state.draggedPath = node.path;
      element.style.opacity = '0.5';
      if (event.dataTransfer) {
        const fileUrl = toFileUrl(node.path);
        if (fileUrl) {
          try {
            event.dataTransfer.setData('text/uri-list', fileUrl);
            if (!isFolder) {
              event.dataTransfer.setData('DownloadURL', `application/octet-stream:${node.name || ''}:${fileUrl}`);
            }
          } catch (setDataError) {
            // ignore failures to set drag data for external targets
          }
        }
        event.dataTransfer.setData('text/plain', node.path);
        event.dataTransfer.effectAllowed = 'copyMove';
      }
      ensureDropIndicator();
    });

    element.addEventListener('dragend', () => {
      element.style.opacity = '1';
      clearDragState();
    });

    element.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (isExternalDragEvent(event)) {
        hideRootOverlay();
        element.classList.add(isFolder ? 'drag-over-folder' : 'drag-over');
        if (state.dropIndicator) {
          state.dropIndicator.style.display = 'none';
        }
        return;
      }
      if (state.draggedElement && state.draggedElement !== element) {
        element.classList.add(isFolder ? 'drag-over-folder' : 'drag-over');
      }
    });

    element.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (isExternalDragEvent(event)) {
        hideRootOverlay();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
        element.classList.add(isFolder ? 'drag-over-folder' : 'drag-over');
        if (state.dropIndicator) {
          state.dropIndicator.style.display = 'none';
        }
        return;
      }
      if (!state.draggedElement || state.draggedElement === element || !state.draggedPath) {
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      const indicator = ensureDropIndicator();
      if (!indicator) {
        return;
      }
      if (isFolder) {
        indicator.style.display = 'none';
        return;
      }
      if (state.draggedElement) {
        indicator.style.height = '2px';
        indicator.style.backgroundColor = indicator.dataset.defaultBg || '#007acc';
        indicator.style.border = indicator.dataset.defaultBorder || 'none';
        const rect = element.getBoundingClientRect();
        const elementMiddle = rect.top + rect.height / 2;
        indicator.style.display = 'block';
        indicator.style.left = `${rect.left}px`;
        indicator.style.width = `${rect.width}px`;
        indicator.style.top = event.clientY < elementMiddle ? `${rect.top - 1}px` : `${rect.bottom - 1}px`;
      } else {
        indicator.style.display = 'none';
      }
    });

    element.addEventListener('dragleave', (event) => {
      if (!element.contains(event.relatedTarget)) {
        element.classList.remove('drag-over', 'drag-over-folder');
      }
    });

    element.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      element.classList.remove('drag-over', 'drag-over-folder');
      const indicator = state.dropIndicator;
      if (indicator) {
        indicator.style.display = 'none';
      }

      const externalPaths = getExternalPathsFromEvent(event);
      if (externalPaths.length > 0) {
        const targetPath = isFolder
          ? node.path
          : (() => {
              const separatorIndex = Math.max(node.path.lastIndexOf('/'), node.path.lastIndexOf('\\'));
              return separatorIndex > -1 ? node.path.slice(0, separatorIndex) : node.path;
            })();
        await importExternalFiles(targetPath || state.dataRootPath || node.path, externalPaths);
        clearDragState();
        return;
      }

      const currentDraggedPath = state.draggedPath;
      clearDragState();
      if (!currentDraggedPath || currentDraggedPath === node.path) {
        return;
      }

      try {
        let targetPath;
        if (isFolder) {
          targetPath = node.path;
        } else {
          const separatorIndex = Math.max(node.path.lastIndexOf('/'), node.path.lastIndexOf('\\'));
          targetPath = separatorIndex > -1 ? node.path.slice(0, separatorIndex) : node.path;
        }
        const result = await global.fsAPI.moveItem(currentDraggedPath, targetPath);
        if (result?.success) {
          await loadFileTree();
          state.selectedItemPath = result.newPath;
          const explorer = getExplorerModule();
          if (explorer && typeof explorer.setSelectedItemPath === 'function') {
            explorer.setSelectedItemPath(result.newPath);
          }
        } else {
          const errorMessage = result?.error || '未知错误';
          console.error('移动文件失败:', errorMessage);
          dependencies.showAlert(`移动失败: ${errorMessage}`, 'error');
        }
      } catch (error) {
        console.error('移动文件异常:', error);
        dependencies.showAlert(`移动失败: ${error.message || error}`, 'error');
      }
    });
  }

  function hideContextMenu() {
    const existingMenu = document.querySelector('.context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }
  }

  async function unmountDocument(filePath, isFolder) {
    try {
      dependencies.closeAllModals();
      const absolutePath = await ensureProjectAbsolutePath(filePath);
      const unmountPath = toProjectRelativePathSync(absolutePath) || absolutePath;

      const fileItem = document.querySelector(`[data-path="${filePath}"]`);
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.add('uploading');
        }
      }

      const response = await fetch('http://localhost:8000/api/document/unmount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: unmountPath, is_folder: Boolean(isFolder) })
      });
      const result = await response.json();
      if (!response.ok) {
        const errorMessage = result.detail || result.error || `HTTP错误 ${response.status}`;
        dependencies.showAlert(`取消挂载失败: ${errorMessage}`, 'error');
        return;
      }

      if (result.status === 'success') {
        if ((result.unmounted_documents || 0) > 0 || (result.unmounted_vectors || 0) > 0) {
          removeUploadIndicator(filePath);
          dependencies.showModal({
            type: 'success',
            title: '操作成功',
            message: '取消挂载成功',
            showCancel: false
          });
        }
        setTimeout(async () => {
          const explorer = getExplorerModule();
          if (explorer && typeof explorer.refreshFileTree === 'function') {
            await explorer.refreshFileTree();
          } else {
            await loadFileTree();
          }
        }, 500);
      } else {
        const errorMessage = result.message || result.error || result.detail || '未知错误';
        dependencies.showModal({
          type: 'error',
          title: '取消挂载失败',
          message: errorMessage,
          showCancel: false
        });
      }
    } catch (error) {
      dependencies.showModal({
        type: 'error',
        title: '取消挂载失败',
        message: error.message || '取消挂载请求失败，请检查后端服务',
        showCancel: false
      });
    } finally {
      const fileItem = document.querySelector(`[data-path="${filePath}"]`);
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.remove('uploading');
        }
      }
    }
  }

  async function mountFolder(folderPath) {
    ensureBackendStatusListener();
    const overlayMessage = '正在挂载文件夹…';
    dependencies.setLoadingOverlayProgress(0.05, {
      message: overlayMessage,
      stage: '准备中'
    });
    let folderOperationKey = null;
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
      const relativeTracking = await getTrackingRelativePath(normalizedPath);
      folderOperationKey = buildFolderOperationKey('mount_folder', relativeTracking);
      if (folderOperationKey) {
        backendProgressState.folderTasks.set(folderOperationKey, {
          message: overlayMessage,
          total: 0,
          completed: 0
        });
      }
      const summaryPayload = buildModelSummaryPayload();
      const response = await fetch('http://localhost:8000/api/document/mount-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: normalizedPath,
          summary: summaryPayload
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || `挂载失败 (${response.status})`);
      }
      handleFolderOperationResult('挂载完成', data);
    } catch (error) {
      dependencies.showAlert(`挂载失败: ${error.message || error}`, 'error');
    } finally {
      if (folderOperationKey) {
        backendProgressState.folderTasks.delete(folderOperationKey);
      }
    }
  }

  async function remountFolder(folderPath) {
    ensureBackendStatusListener();
    const overlayMessage = '正在重新挂载文件夹…';
    dependencies.setLoadingOverlayProgress(0.05, {
      message: overlayMessage,
      stage: '准备中'
    });
    let folderOperationKey = null;
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
      const relativeTracking = await getTrackingRelativePath(normalizedPath);
      folderOperationKey = buildFolderOperationKey('remount_folder', relativeTracking);
      if (folderOperationKey) {
        backendProgressState.folderTasks.set(folderOperationKey, {
          message: overlayMessage,
          total: 0,
          completed: 0
        });
      }
      const summaryPayload = buildModelSummaryPayload();
      const response = await fetch('http://localhost:8000/api/document/remount-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_path: normalizedPath,
          force_reupload: true,
          summary: summaryPayload
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || `重新挂载失败 (${response.status})`);
      }
      handleFolderOperationResult('重新挂载完成', data);
    } catch (error) {
      dependencies.showAlert(`重新挂载失败: ${error.message || error}`, 'error');
    } finally {
      if (folderOperationKey) {
        backendProgressState.folderTasks.delete(folderOperationKey);
      }
      dependencies.hideLoadingOverlay();
    }
  }

  async function unmountFolder(folderPath) {
    let folderOperationKey = null;
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
      const relativeTracking = await getTrackingRelativePath(normalizedPath);
      folderOperationKey = null;
      const response = await fetch('http://localhost:8000/api/document/unmount-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: normalizedPath })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || `取消挂载失败 (${response.status})`);
      }
      handleFolderOperationResult('取消挂载完成', data);
    } catch (error) {
      dependencies.showAlert(`取消挂载失败: ${error.message || error}`, 'error');
    } finally {
      if (folderOperationKey) {
        backendProgressState.folderTasks.delete(folderOperationKey);
      }
      dependencies.hideLoadingOverlay();
    }
  }

  function handleFolderOperationResult(title, data, options = {}) {
    const failed = data.failed || 0;
    const statusKey = data.status || (failed > 0 ? 'partial' : 'success');
    if (data.folder && typeof dependencies.refreshFolderUploadIndicators === 'function') {
      dependencies.refreshFolderUploadIndicators(data.folder).catch((error) => {
        console.warn('批量操作后刷新上传状态失败:', error);
      });
    }

    let message = '操作已完成。';
    let modalType = 'success';
    if (statusKey === 'failed') {
      modalType = 'error';
      message = '操作失败，请稍后重试。';
    } else if (statusKey === 'partial') {
      modalType = 'warning';
      message = '操作完成，部分项目未成功处理。';
    }

    if (statusKey === 'success' && options.suppressSuccessModal) {
      setTimeout(async () => {
        const explorer = getExplorerModule();
        if (explorer && typeof explorer.refreshFileTree === 'function') {
          await explorer.refreshFileTree();
        } else {
          await loadFileTree();
        }
      }, 300);
      return;
    }

    dependencies.showModal({
      type: modalType,
      title,
      message,
      showCancel: false,
      onConfirm: async () => {
        const explorer = getExplorerModule();
        if (explorer && typeof explorer.refreshFileTree === 'function') {
          await explorer.refreshFileTree();
        } else {
          await loadFileTree();
        }
      }
    });
  }

  const PDF_PARSE_POLL_INTERVAL = 1200;

  async function pollPdfParseStatus(taskId) {
    const endpoint = `http://localhost:8000/api/document/parse-pdf/status/${taskId}`;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, PDF_PARSE_POLL_INTERVAL));
      const response = await fetch(endpoint);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error('解析进度响应格式错误');
      }
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `HTTP错误 ${response.status}`);
      }
      const progressValue = typeof payload.progress === 'number' ? payload.progress : null;
      const message = payload.message || '正在解析 PDF…';
      const stageLabel = payload.stage || payload.message || '正在解析';

      dependencies.setLoadingOverlayProgress(
        progressValue == null ? 0 : progressValue,
        {
          message,
          stage: stageLabel
        }
      );
      if (payload.status === 'success') {
        backendProgressState.pdfTasks.delete(taskId);
        return payload;
      }
      if (payload.status === 'error') {
        backendProgressState.pdfTasks.delete(taskId);
        throw new Error(payload.message || payload.detail || 'PDF解析失败');
      }
    }
  }

  async function handlePdfParseSuccess(result) {
    dependencies.showSuccessModal('PDF解析成功');
    setTimeout(async () => {
      try {
        const explorer = getExplorerModule();
        if (explorer && typeof explorer.refreshFileTree === 'function') {
          await explorer.refreshFileTree();
        } else {
          await loadFileTree();
        }
      } catch (error) {
        console.warn('刷新文件树失败:', error);
      }
    }, 400);
  }

  function extractFileName(filePath) {
    if (!filePath) {
      return '';
    }
    const normalized = String(filePath).trim();
    if (!normalized) {
      return '';
    }
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments.length ? segments[segments.length - 1] : normalized;
  }

  function getPathSelector(pathValue) {
    if (!pathValue) {
      return '[data-path=""]';
    }
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return `[data-path="${window.CSS.escape(pathValue)}"]`;
    }
    return `[data-path="${String(pathValue).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }

  function focusItemByPath(pathValue) {
    if (!pathValue) {
      return;
    }
    const selector = `.file-item${getPathSelector(pathValue)}`;
    const element = document.querySelector(selector);
    if (!element) {
      return;
    }
    document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
    element.classList.add('selected');
    try {
      element.focus({ preventScroll: true });
    } catch (focusError) {
      if (typeof element.focus === 'function') {
        element.focus();
      }
    }
    element.scrollIntoView({ block: 'nearest' });
    state.selectedItemPath = pathValue;
    const explorer = getExplorerModule();
    if (explorer && typeof explorer.setSelectedItemPath === 'function') {
      explorer.setSelectedItemPath(pathValue);
    }
  }

  function getVisibleTreeItems() {
    const candidates = document.querySelectorAll('.file-item[data-path]');
    return Array.from(candidates).filter((element) => {
      if (!element || !element.dataset || !element.dataset.path) {
        return false;
      }
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      return element.offsetParent !== null;
    });
  }

  function ensureRenameInputStyles() {
    if (state.renameStylesInjected) {
      return;
    }
    const style = document.createElement('style');
    style.textContent = [
      '.rename-input-wrapper {',
      '  display: flex;',
      '  align-items: center;',
      '  width: 100%;',
      '  min-height: 24px;',
      '}',
      '',
      '.rename-input-wrapper .file-item-content {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 3px;',
      '  flex: 1;',
      '  min-width: 0;',
      '}',
      '',
      '.rename-name-wrapper {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 3px;',
      '  flex: 1;',
      '  min-width: 0;',
      '}',
      '',
      '.rename-input-container {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 2px;',
      '  flex: 1;',
      '  min-width: 0;',
      '}',
      '',
      '.inline-rename-input {',
      '  flex: 1;',
      '  border: 1px solid var(--tree-border, #d1d5db);',
      '  background: var(--bg-color, #ffffff);',
      '  color: var(--text-color, #1f2933);',
      '  font-size: 12px;',
      '  line-height: 18px;',
      '  padding: 1px 6px;',
      '  height: 20px;',
      '  border-radius: 4px;',
      '  outline: none;',
      '  transition: border-color 0.15s ease, box-shadow 0.15s ease;',
      '  box-sizing: border-box;',
      '}',
      '',
      '.inline-rename-input:focus {',
      '  border-color: rgba(59, 130, 246, 0.6);',
      '  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);',
      '}',
      '',
      '.rename-extension {',
      '  font-size: 12px;',
      '  color: var(--text-secondary, #6b7280);',
      '  user-select: none;',
      '  max-width: 40%;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '',
      '.rename-folder-arrow {',
      '  width: 10px;',
      '  opacity: 0;',
      '}',
      ''
    ].join('\n');
    document.head.appendChild(style);
    state.renameStylesInjected = true;
  }


  function findTreeNodeByPath(node, targetPath) {
    if (!node || !targetPath) {
      return null;
    }
    const normalizedTarget = String(targetPath).replace(/\\/g, '/');
    const stack = [node];
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const currentPath = current.path ? String(current.path).replace(/\\/g, '/') : null;
      if (currentPath === normalizedTarget) {
        return current;
      }
      if (Array.isArray(current.children)) {
        for (let i = current.children.length - 1; i >= 0; i -= 1) {
          stack.push(current.children[i]);
        }
      }
    }
    return null;
  }

  function scheduleFocusOnPath(pathValue) {
    if (!pathValue) {
      return;
    }
    setTimeout(() => {
      focusItemByPath(pathValue);
    }, 60);
  }

  function getPasteTargetPath() {
    if (state.selectedItemPath) {
      return state.selectedItemPath;
    }
    return state.dataRootPath;
  }

  function formatFileSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size < 0) {
      return '';
    }
    if (size === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / 1024 ** exponent;
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
  }

  function showUploadSummaryModal(result, filePath) {
    const status = (result && result.status) || 'success';
    let message = '挂载完成';
    let modalType = 'success';
    if (status === 'updated') {
      message = '重新挂载完成';
      modalType = 'info';
    } else if (status === 'exists') {
      message = '文件已挂载';
      modalType = 'info';
    }
    dependencies.showModal({
      type: modalType,
      title: '提示',
      message,
      showCancel: false
    });
  }

  async function parsePdfToMarkdown(filePath) {
    ensureBackendStatusListener();
    const overlayMessage = '正在解析 PDF…';
    dependencies.setLoadingOverlayProgress(0.05, {
      message: overlayMessage,
      stage: '准备中'
    });
    let taskId = null;
    try {
      dependencies.closeAllModals();
      const requestPath = await ensureProjectAbsolutePath(filePath);
      const response = await fetch('http://localhost:8000/api/document/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: requestPath })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || result.error || `HTTP错误 ${response.status}`);
      }
      if (result.status === 'processing' && result.task_id) {
        taskId = result.task_id;
        backendProgressState.pdfTasks.set(taskId, {
          message: overlayMessage,
          filePath: requestPath,
          displayName: extractFileName(filePath)
        });
        const finalResult = await pollPdfParseStatus(result.task_id);
        backendProgressState.pdfTasks.delete(result.task_id);
        dependencies.setLoadingOverlayProgress(
          typeof finalResult.progress === 'number' ? finalResult.progress : 1,
          {
            message: overlayMessage,
            stage: finalResult.stage || '解析完成'
          }
        );
        await handlePdfParseSuccess(finalResult);
      } else if (result.status === 'success') {
        dependencies.setLoadingOverlayProgress(
          typeof result.progress === 'number' ? result.progress : 1,
          {
            message: overlayMessage,
            stage: result.stage || '解析完成'
          }
        );
        await handlePdfParseSuccess(result);
      } else if (result.status === 'error') {
        throw new Error(result.message || 'PDF解析失败');
      } else {
        throw new Error(result.message || '未知的解析状态');
      }
    } catch (error) {
      backendProgressState.pdfTasks.delete(taskId);
      dependencies.showModal({
        type: 'error',
        title: 'PDF解析失败',
        message: error.message || '解析请求失败，请检查后端服务',
        showCancel: false
      });
    } finally {
      backendProgressState.pdfTasks.delete(taskId);
      dependencies.hideLoadingOverlay();
    }
  }

  async function uploadFile(filePath) {
    ensureBackendStatusListener();
    const isPdfFile = filePath.toLowerCase().endsWith('.pdf');
    const overlayMessage = isPdfFile ? '正在挂载 PDF…' : '正在挂载…';
    dependencies.setLoadingOverlayProgress(0.05, {
      message: overlayMessage,
      stage: '准备中'
    });

    const uploadPath = await ensureProjectAbsolutePath(filePath);
    const trackingRelative = await getTrackingRelativePath(uploadPath);
    const progressKey = normalizeProgressKey(trackingRelative);
    if (progressKey) {
      backendProgressState.fileTasks.set(progressKey, {
        message: overlayMessage,
        stage: '准备中',
        displayName: extractFileName(filePath)
      });
    }

    let fileSizeBytes = null;
    if (typeof global.fsAPI?.getFileInfo === 'function') {
      try {
        const infoResult = await global.fsAPI.getFileInfo(uploadPath);
        if (infoResult?.success && infoResult.info && typeof infoResult.info.size === 'number') {
          fileSizeBytes = infoResult.info.size;
        }
      } catch (error) {
        console.warn('获取文件大小失败:', error);
      }
    }

    let fileItem = null;
    try {
      fileItem = document.querySelector(`[data-path="${filePath}"]`);
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.add('uploading');
        }
      }

      const summaryPayload = buildModelSummaryPayload();
      const response = await fetch('http://localhost:8000/api/document/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: uploadPath,
          summary: summaryPayload
        })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || result.error || `HTTP错误 ${response.status}`);
      }

      addUploadIndicator(filePath);
      showUploadSummaryModal(result, filePath);

      if (typeof dependencies.refreshFolderUploadIndicators === 'function') {
        const parentPath = filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
        if (parentPath) {
          dependencies.refreshFolderUploadIndicators(parentPath).catch((error) => {
            console.warn('上传后刷新上传状态失败:', error);
          });
        }
      }
    } catch (error) {
      dependencies.showAlert(`上传失败: ${error.message || error}`, 'error');
    } finally {
      if (progressKey) {
        backendProgressState.fileTasks.delete(progressKey);
      }
      dependencies.hideLoadingOverlay();
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.remove('uploading');
        }
      }
    }
  }

  async function reuploadFile(filePath) {
    dependencies.showLoadingOverlay('正在重新挂载…');
    try {
      dependencies.closeAllModals();
      const uploadPath = await ensureProjectAbsolutePath(filePath);
      const fileItem = document.querySelector(`[data-path="${filePath}"]`);
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.add('reuploading');
        }
      }
      const summaryPayload = buildModelSummaryPayload();
      const response = await fetch('http://localhost:8000/api/document/reupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: uploadPath,
          force_reupload: false,
          summary: summaryPayload
        })
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || result.error || `HTTP错误 ${response.status}`);
      }
      if (result.status === 'reuploaded') {
        addUploadIndicator(filePath);
        dependencies.showSuccessModal('文件重新上传成功');
      } else if (result.status === 'uploaded') {
        addUploadIndicator(filePath);
        dependencies.showSuccessModal('文件上传成功');
      } else if (result.status !== 'unchanged') {
        const errorMessage = result.message || result.error || result.detail || '未知错误';
        dependencies.showAlert(`重新上传失败: ${errorMessage}`, 'error');
      }
    } catch (error) {
      dependencies.showAlert(`重新上传失败: ${error.message || error}`, 'error');
    } finally {
      dependencies.hideLoadingOverlay();
      const fileItem = document.querySelector(`[data-path="${filePath}"]`);
      if (fileItem) {
        const indicator = fileItem.querySelector('.upload-indicator');
        if (indicator) {
          indicator.classList.remove('reuploading');
        }
      }
    }
  }

  async function refreshAllUploadStatus() {
    document.querySelectorAll('.file-item-file[data-path]').forEach((fileItem) => {
      const filePath = fileItem.dataset.path;
      if (filePath) {
        removeUploadIndicator(filePath);
      }
    });
  }

  function getFolderSvg() {
    const fillColor = 'rgba(37, 99, 235, 0.2)';
    const strokeColor = 'rgba(37, 99, 235, 0.7)';
    const topFill = 'rgba(37, 99, 235, 0.3)';
    return `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 7.25C3 6.00736 4.00736 5 5.25 5H9.17774C9.44351 5 9.69843 5.10536 9.89175 5.29289L11.3583 6.70711C11.5516 6.89464 11.8065 7 12.0723 7H18.75C19.9926 7 21 8.00736 21 9.25V16.75C21 17.9926 19.9926 19 18.75 19H5.25C4.00736 19 3 17.9926 3 16.75V7.25Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1" />
        <path d="M3 7.25C3 6.00736 4.00736 5 5.25 5H9.17774C9.44351 5 9.69843 5.10536 9.89175 5.29289L11.3583 6.70711C11.5516 6.89464 11.8065 7 12.0723 7H18.75C19.9926 7 21 8.00736 21 9.25" fill="${topFill}" />
      </svg>
    `;
  }

  function getFileIcon(fileName, isFolder = false, isExpanded = false) {
    if (isFolder) {
      if (isExpanded) {
        return getOpenFolderIcon();
      }
      return global.icons && global.icons.folder ? global.icons.folder : getFolderSvg();
    }
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'go':
        return `<img src="${getAssetUrl('dist/assets/go.png')}" style="width: 13px; height: 13px;" />`;
      case 'java':
        return `<img src="${getAssetUrl('dist/assets/java.png')}" style="width: 13px; height: 13px;" />`;
      case 'js':
      case 'jsx':
      case 'mjs':
        return `<img src="${getAssetUrl('dist/assets/js.png')}" style="width: 13px; height: 13px;" />`;
      case 'py':
      case 'pyw':
      case 'pyc':
      case 'pyo':
      case 'pyd':
        return `<img src="${getAssetUrl('dist/assets/python.png')}" style="width: 13px; height: 13px;" />`;
      case 'txt':
        return `<img src="${getAssetUrl('dist/assets/txt.png')}" style="width: 13px; height: 13px;" />`;
      case 'html':
      case 'htm':
        return `<img src="${getAssetUrl('dist/assets/html.png')}" style="width: 13px; height: 13px;" />`;
      case 'md':
      case 'markdown':
        return `<img src="${getAssetUrl('dist/assets/markdown.png')}" style="width: 13px; height: 13px;" />`;
      case 'pdf':
        return `<img src="${getAssetUrl('dist/assets/pdf.png')}" style="width: 13px; height: 13px;" />`;
      case 'docx':
      case 'doc':
        return `<img src="${getAssetUrl('dist/assets/docx.png')}" style="width: 13px; height: 13px;" />`;
      case 'pptx':
      case 'ppt':
        return `<img src="${getAssetUrl('dist/assets/ppt.png')}" style="width: 13px; height: 13px;" />`;
      case 'json':
        return `<img src="${getAssetUrl('dist/assets/json.png')}" style="width: 13px; height: 13px;" />`;
      case 'png':
      case 'apng':
      case 'bmp':
      case 'webp':
      case 'tif':
      case 'tiff':
      case 'svg':
      case 'heic':
      case 'heif':
        return `<img src="${getAssetUrl('dist/assets/png.png')}" style="width: 13px; height: 13px;" />`;
      case 'jpg':
      case 'jpe':
        return `<img src="${getAssetUrl('dist/assets/jpg.png')}" style="width: 13px; height: 13px;" />`;
      case 'jpeg':
        return `<img src="${getAssetUrl('dist/assets/jpeg.png')}" style="width: 13px; height: 13px;" />`;
      case 'gif':
        return `<img src="${getAssetUrl('dist/assets/gif.png')}" style="width: 13px; height: 13px;" />`;
      case 'xlsx':
      case 'xls':
        return `<img src="${getAssetUrl('dist/assets/xlsx.png')}" style="width: 13px; height: 13px;" />`;
      default:
        return global.icons?.file || '';
    }
  }

  function getOpenFolderIcon() {
    if (global.icons && typeof global.icons.folder === 'string') {
      return global.icons.folder
        .replace(/fill="[^"]*"/gi, 'fill="rgba(37, 99, 235, 0.18)"')
        .replace(/stroke="[^"]*"/gi, 'stroke="rgba(37, 99, 235, 0.65)"');
    }
    return getFolderSvg();
  }

  async function copyItemPathToClipboard(itemPath) {
    if (!itemPath) {
      return;
    }
    try {
      if (global.fsAPI?.copyItemToClipboard) {
        const result = await global.fsAPI.copyItemToClipboard(itemPath);
        if (!result?.success) {
          throw new Error(result?.error || '复制失败');
        }
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(itemPath);
      } else {
        throw new Error('当前环境不支持复制到剪贴板');
      }
    } catch (error) {
      console.error('复制到剪贴板失败:', error);
      dependencies.showAlert(error.message || '复制失败', 'error');
    }
  }

  async function compressFileSystemItem(itemPath) {
    if (!itemPath) {
      dependencies.showAlert('未找到目标文件或文件夹', 'error');
      return;
    }
    if (!global.fsAPI?.compressItem) {
      dependencies.showAlert('当前环境不支持压缩操作', 'warning');
      return;
    }
    dependencies.showLoadingOverlay('正在压缩…');
    try {
      const result = await global.fsAPI.compressItem(itemPath);
      if (!result?.success) {
        throw new Error(result?.error || '压缩失败');
      }
      const zipPath = result.zipPath;
      const zipName = extractFileName(zipPath);
      state.selectedItemPath = zipPath;
      dependencies.showAlert(`压缩成功：${zipName}`, 'success');
      await loadFileTree();
      scheduleFocusOnPath(zipPath);
    } catch (error) {
      console.error('压缩失败:', error);
      dependencies.showAlert(error.message || '压缩失败', 'error');
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  async function extractZipFile(zipPath) {
    if (!zipPath) {
      dependencies.showAlert('未找到压缩文件', 'error');
      return;
    }
    if (!global.fsAPI?.extractZip) {
      dependencies.showAlert('当前环境不支持解压操作', 'warning');
      return;
    }
    dependencies.showLoadingOverlay('正在解压…');
    try {
      const result = await global.fsAPI.extractZip(zipPath);
      if (!result?.success) {
        throw new Error(result?.error || '解压失败');
      }
      const extractedPath = result.extractedPath;
      if (!extractedPath) {
        throw new Error('解压失败：缺少目标路径');
      }
      state.selectedItemPath = extractedPath;
      dependencies.showAlert(`解压完成：${extractFileName(extractedPath)}`, 'success');
      await loadFileTree();
      scheduleFocusOnPath(extractedPath);
    } catch (error) {
      console.error('解压失败:', error);
      dependencies.showAlert(error.message || '解压失败', 'error');
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  async function pasteFromClipboard(targetOverride = null) {
    if (!global.fsAPI?.pasteFromClipboard) {
      dependencies.showAlert('当前环境不支持粘贴操作', 'warning');
      return;
    }
    const targetPath = targetOverride || getPasteTargetPath();
    if (!targetPath) {
      dependencies.showAlert('无法确定粘贴位置', 'warning');
      return;
    }
    dependencies.showLoadingOverlay('正在粘贴…');
    try {
      const result = await global.fsAPI.pasteFromClipboard(targetPath);
      if (!result?.success) {
        throw new Error(result?.error || '粘贴失败');
      }
      const items = Array.isArray(result.items) ? result.items : [];
      const focusPath = items.length ? items[items.length - 1] : targetPath;
      state.selectedItemPath = focusPath;
      await loadFileTree();
      scheduleFocusOnPath(focusPath);
    } catch (error) {
      console.error('粘贴失败:', error);
      dependencies.showAlert(error.message || '粘贴失败', 'error');
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  function bindClipboardShortcuts() {
    if (!state.copyShortcutListener) {
      state.copyShortcutListener = (event) => {
        const key = event.key || '';
        if (!(event.ctrlKey || event.metaKey)) {
          return;
        }
        if (event.shiftKey || event.altKey) {
          return;
        }
        if (key.toLowerCase() !== 'c') {
          return;
        }
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        if (!state.selectedItemPath) {
          return;
        }
        event.preventDefault();
        copyItemPathToClipboard(state.selectedItemPath);
      };
      document.addEventListener('keydown', state.copyShortcutListener);
    }

    if (!state.pasteShortcutListener) {
      state.pasteShortcutListener = (event) => {
        const key = event.key || '';
        if (!(event.ctrlKey || event.metaKey)) {
          return;
        }
        if (event.shiftKey || event.altKey) {
          return;
        }
        if (key.toLowerCase() !== 'v') {
          return;
        }
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        event.preventDefault();
        pasteFromClipboard();
      };
      document.addEventListener('keydown', state.pasteShortcutListener);
    }

    if (!state.arrowNavigationListener) {
      state.arrowNavigationListener = (event) => {
        const key = event.key || '';
        if (key !== 'ArrowUp' && key !== 'ArrowDown') {
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        const target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        if (!state.selectedItemPath) {
          return;
        }

        const items = getVisibleTreeItems();
        if (!items.length) {
          return;
        }

        const currentIndex = items.findIndex((element) => element.dataset.path === state.selectedItemPath);
        if (currentIndex === -1) {
          return;
        }

        const direction = key === 'ArrowUp' ? -1 : 1;
        let nextIndex = currentIndex + direction;

        while (nextIndex >= 0 && nextIndex < items.length) {
          const candidate = items[nextIndex];
          const candidatePath = candidate?.dataset?.path;
          if (candidatePath) {
            event.preventDefault();
            focusItemByPath(candidatePath);
            if (candidate && typeof global.fileTreeData === 'object') {
              const node = findTreeNodeByPath(global.fileTreeData, candidatePath);
              if (node && !Array.isArray(node.children)) {
                handleFileClick(node, candidate);
              }
            }
            break;
          }
          nextIndex += direction;
        }
      };
      document.addEventListener('keydown', state.arrowNavigationListener);
    }
  }

  function createContextMenu(x, y, itemPath, isFolder) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const isRoot = !itemPath;
    const safePath = itemPath || '';
    const isPdfFile = !isRoot && !isFolder && safePath.toLowerCase().endsWith('.pdf');

    const addMenuItem = ({ label, icon, onClick, disabled = false }) => {
      const item = document.createElement('div');
      item.className = 'context-menu-item';
      if (disabled) {
        item.classList.add('context-menu-item-disabled');
      }
      if (icon) {
        item.innerHTML = `<span class="context-menu-icon">${icon}</span>${label}`;
      } else {
        item.textContent = label;
      }
      if (!disabled && typeof onClick === 'function') {
        item.addEventListener('click', () => {
          hideContextMenu();
          onClick();
        });
      }
      menu.appendChild(item);
      return item;
    };

    const addSeparator = () => {
      const separator = document.createElement('div');
      separator.className = 'context-menu-separator';
      menu.appendChild(separator);
      return separator;
    };

    if (isRoot) {
      addMenuItem({
        label: '粘贴',
        icon: global.icons.paste || global.icons.file,
        onClick: () => pasteFromClipboard(state.dataRootPath)
      });
      addMenuItem({
        label: '新建文件',
        icon: global.icons.newFile,
        onClick: () => {
          const explorer = getExplorerModule();
          if (explorer && typeof explorer.createFile === 'function') {
            explorer.createFile();
          }
        }
      });
      addMenuItem({
        label: '新建文件夹',
        icon: global.icons.folder,
        onClick: () => {
          const explorer = getExplorerModule();
          if (explorer && typeof explorer.createFolder === 'function') {
            explorer.createFolder();
          }
        }
      });
      document.body.appendChild(menu);
      setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
      }, 0);
      return;
    }

    if (isFolder) {
      addMenuItem({
        label: '粘贴',
        icon: global.icons.paste || global.icons.file,
        onClick: () => pasteFromClipboard(itemPath)
      });
    }

    addMenuItem({
      label: '复制',
      icon: global.icons.copy || global.icons.file,
      onClick: () => copyItemPathToClipboard(itemPath)
    });

    addMenuItem({
      label: '压缩',
      icon: global.icons.archive || global.icons.folder,
      onClick: () => compressFileSystemItem(itemPath)
    });

    addSeparator();

    if (!isFolder) {
      addMenuItem({
        label: '详细信息',
        icon: global.icons.file,
        onClick: () => handleShowDocumentDetails(itemPath)
      });
    }

    addMenuItem({
      label: '重命名',
      icon: global.icons.newFile,
      onClick: () => {
        const explorer = getExplorerModule();
        if (explorer) {
          explorer.startRename(itemPath);
        }
      }
    });

    addMenuItem({
      label: '删除',
      icon: global.icons.trash,
      onClick: () => {
        const explorer = getExplorerModule();
        if (explorer) {
          explorer.deleteItem(itemPath);
        }
      }
    });

    addSeparator();

    addMenuItem({
      label: '挂载',
      icon: global.icons.import,
      onClick: () => {
        if (isFolder) {
          mountFolder(itemPath);
        } else {
          uploadFile(itemPath);
        }
      }
    });

    addMenuItem({
      label: '重新挂载',
      icon: global.icons.import,
      onClick: () => {
        if (isFolder) {
          remountFolder(itemPath);
        } else {
          reuploadFile(itemPath);
        }
      }
    });

    addMenuItem({
      label: '取消挂载',
      icon: global.icons.trash,
      onClick: () => {
        if (isFolder) {
          unmountFolder(itemPath);
        } else {
          unmountDocument(itemPath, false);
        }
      }
    });

    if (isPdfFile) {
      addSeparator();
      addMenuItem({
        label: '深度解析',
        icon: global.icons.file,
        onClick: () => parsePdfToMarkdown(itemPath)
      });
    }

    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu, { once: true });
    }, 0);
  }

  function handleFolderClick(node, div, childContainer, folderIcon, arrow, nodeRelativePath) {
    document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
    div.classList.add('selected');
    state.selectedItemPath = node.path;
    const explorer = getExplorerModule();
    if (explorer && typeof explorer.setSelectedItemPath === 'function') {
      explorer.setSelectedItemPath(node.path);
    }
    div.tabIndex = 0;
    div.focus();

    const isExpanded = state.expandedFolders.has(node.path);
    if (isExpanded) {
      state.expandedFolders.delete(node.path);
      childContainer.style.display = 'none';
      if (arrow) { arrow.style.transform = 'rotate(0deg)'; }
      folderIcon.innerHTML = getFileIcon(node.name, true, false);
    } else {
      state.expandedFolders.add(node.path);
      childContainer.style.display = 'block';
      if (arrow) { arrow.style.transform = 'rotate(90deg)'; }
      folderIcon.innerHTML = getFileIcon(node.name, true, true);
      if (typeof dependencies.updateFolderUploadStatus === 'function') {
        dependencies.updateFolderUploadStatus(nodeRelativePath);
      }
    }
  }

  function handleFileClick(node, div) {
    document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
    div.classList.add('selected');
    state.selectedItemPath = node.path;
    const explorer = getExplorerModule();
    if (explorer && typeof explorer.setSelectedItemPath === 'function') {
      explorer.setSelectedItemPath(node.path);
    }
    div.setAttribute('tabindex', '0');
    div.focus();

    let viewer = getFileViewer();

    // 如果已有的 viewer 无效（没有 openFile 方法），尝试恢复为真正的 FileViewer
    if (!viewer || typeof viewer.openFile !== 'function') {
      const explorerModule = getExplorerModule();
      if (explorerModule && typeof explorerModule.getFileViewer === 'function') {
        const fromExplorer = explorerModule.getFileViewer();
        if (fromExplorer && typeof fromExplorer.openFile === 'function') {
          viewer = fromExplorer;
          setFileViewer(viewer);
        }
      }

      // 如果仍未获取到有效实例，则尝试实例化全局 FileViewer
      if (!viewer || typeof viewer.openFile !== 'function') {
        const FileViewerCtor = global.FileViewer || window.FileViewer;
        const container = document.getElementById('file-content');
        if (typeof FileViewerCtor === 'function' && container) {
          try {
            viewer = new FileViewerCtor(container);
            setFileViewer(viewer);
          } catch (e) {
            console.warn('初始化 FileViewer 失败:', e);
          }
        }
      }
    }

    if (viewer && typeof viewer.openFile === 'function') {
      viewer.openFile(node.path).catch((error) => {
        console.error('文件打开失败:', error);
      });
    } else {
      console.warn('未找到有效的文件查看器，无法打开文件:', node.path);
    }
  }

  function renderTree(node, container, isRoot = false, depth = 0) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.dataset.path = node.path;
    const nodeRelativePath = dependencies.resolveNodeRelativePath(node);
    div.dataset.relativePath = nodeRelativePath;
    div.style.paddingLeft = `${depth * 12}px`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'file-item-content';
    if (state.selectedItemPath === node.path) {
      div.classList.add('selected');
    }

    if (node.children) {
      div.classList.add('folder-item');
      const isExpanded = state.expandedFolders.has(node.path);

      const nameWrapper = document.createElement('span');
      nameWrapper.className = 'file-name';

      // 还原更小的浅灰色开放式箭头（两段线）
      const arrow = document.createElement('span');
      arrow.className = 'folder-arrow';
      arrow.style.color = '#9aa0a6';
      arrow.innerHTML = `
        <svg width="8" height="8" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <polyline points="2,1 8,5 2,9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      `;
      nameWrapper.appendChild(arrow);

      const folderIcon = document.createElement('span');
      folderIcon.className = 'file-icon-wrapper';
      folderIcon.innerHTML = getFileIcon(node.name, true, isExpanded);
      nameWrapper.appendChild(folderIcon);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name-text';
      nameSpan.textContent = node.name;
      nameWrapper.appendChild(nameSpan);
      contentDiv.appendChild(nameWrapper);

      div.appendChild(contentDiv);
      container.appendChild(div);
      addDragAndDropSupport(div, node, true);

      const childContainer = document.createElement('div');
      childContainer.dataset.parent = node.path;
      childContainer.dataset.parentRelative = nodeRelativePath;
      childContainer.style.display = isExpanded ? 'block' : 'none';
      node.children.forEach((child) => renderTree(child, childContainer, false, depth + 1));
      container.appendChild(childContainer);

      // 初始化箭头方向
      if (arrow) {
        arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      }

      if (isExpanded && typeof dependencies.updateFolderUploadStatus === 'function') {
        dependencies.updateFolderUploadStatus(nodeRelativePath);
      }

      div.addEventListener('click', (event) => {
        event.stopPropagation();
        handleFolderClick(node, div, childContainer, folderIcon, arrow, nodeRelativePath);
      });

      div.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        state.selectedItemPath = node.path;
        const explorer = getExplorerModule();
        if (explorer && typeof explorer.setSelectedItemPath === 'function') {
          explorer.setSelectedItemPath(node.path);
        }
        createContextMenu(event.pageX, event.pageY, node.path, true);
      });
    } else {
      div.classList.add('file-item-file');
      div.dataset.fileName = node.name;

      const nameWrapper = document.createElement('span');
      nameWrapper.className = 'file-name';
      // 文件圆点，颜色淡灰，与箭头垂直对齐
      const fileDot = document.createElement('span');
      fileDot.className = 'file-dot';
      fileDot.innerHTML = `
        <svg width="8" height="8" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="5" cy="5" r="2.5" fill="currentColor" />
        </svg>
      `;
      nameWrapper.appendChild(fileDot);

      const fileIconWrapper = document.createElement('span');
      fileIconWrapper.className = 'file-icon-wrapper';
      fileIconWrapper.innerHTML = getFileIcon(node.name, false);
      nameWrapper.appendChild(fileIconWrapper);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name-text';
      nameSpan.textContent = node.name;
      nameWrapper.appendChild(nameSpan);
      contentDiv.appendChild(nameWrapper);
      div.appendChild(contentDiv);
      addDragAndDropSupport(div, node, false);

      div.addEventListener('click', (event) => {
        event.stopPropagation();
        handleFileClick(node, div);
      });

      div.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
        div.classList.add('selected');
        state.selectedItemPath = node.path;
        const explorer = getExplorerModule();
        if (explorer && typeof explorer.setSelectedItemPath === 'function') {
          explorer.setSelectedItemPath(node.path);
        }
        const now = Date.now();
        const last = state.lastContextMenu;
        if (
          last &&
          last.path === node.path &&
          now - last.timestamp <= 400
        ) {
          hideContextMenu();
          state.lastContextMenu = { path: null, timestamp: 0 };
          handleShowDocumentDetails(node.path);
          return;
        }
        state.lastContextMenu = { path: node.path, timestamp: now };
        createContextMenu(event.pageX, event.pageY, node.path, false);
      });
      if (node.name && node.name.toLowerCase().endsWith('.zip')) {
        div.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          extractZipFile(node.path);
        });
      }
      container.appendChild(div);
    }
  }

  async function loadFileTree() {
    if (!ensureElements()) {
      console.warn('无法初始化文件树：未找到容器');
      return;
    }
    try {
      const tree = await global.fsAPI.getFileTree();
      global.fileTreeData = tree;
      if (tree && tree.path) {
        state.dataRootPath = tree.path;
      }
      state.fileTreeEl.dataset.parentRelative = 'data';
      state.fileTreeEl.innerHTML = '';
      if (Array.isArray(tree.children)) {
        tree.children.forEach((child) => renderTree(child, state.fileTreeEl, true, 0));
      }
      // 空状态占位：当没有任何文件/文件夹时显示提示
      if (!Array.isArray(tree.children) || tree.children.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'file-tree-empty-placeholder';
        placeholder.textContent = '你可以新建或导入文件📃';
        placeholder.style.cursor = 'pointer';
        placeholder.setAttribute('role', 'button');
        placeholder.tabIndex = 0;
        // 顶对齐：确保占位框贴顶部并覆盖可视宽度
        // 具体宽度与边距由 CSS 控制，这里只确保不出现额外空隙
        placeholder.style.marginTop = '-5px';
        // 点击导入：调用 ExplorerModule.importFiles（打开本地文件夹）
        const explorer = getExplorerModule();
        const handleImport = () => {
          if (explorer && typeof explorer.importFiles === 'function') {
            explorer.importFiles();
          }
        };
        placeholder.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleImport();
        });
        placeholder.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            handleImport();
          }
        });
        state.fileTreeEl.appendChild(placeholder);
      }
      if (typeof dependencies.updateFolderUploadStatus === 'function') {
        await dependencies.updateFolderUploadStatus('data');
      }
      if (state.selectedItemPath) {
        scheduleFocusOnPath(state.selectedItemPath);
      }
    } catch (error) {
      console.error('加载文件树失败:', error);
    }
  }

  function clearFileTreeSelection() {
    document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
    state.selectedItemPath = null;
    const explorer = getExplorerModule();
    if (explorer && typeof explorer.setSelectedItemPath === 'function') {
      explorer.setSelectedItemPath(null);
    }
  }

  function bindRootEvents() {
    if (!state.fileTreeEl) {
      return;
    }
    if (state.fileTreeContainer) {
      state.fileTreeContainer.addEventListener('contextmenu', (event) => {
        if (event.target.closest('.file-item')) {
          return;
        }
        event.preventDefault();
        clearFileTreeSelection();
        createContextMenu(event.pageX, event.pageY, null, true);
      });
    }
    const handleRootDragEnter = (event) => {
      event.preventDefault();
      const targetItem = event.target instanceof Element ? event.target.closest('.file-item[data-path]') : null;
      if (targetItem) {
        hideRootOverlay();
        return;
      }
      // 显示根目录虚线边框（支持内部拖拽和外部拖拽）
      showRootOverlay();
      if (state.dropIndicator) {
        state.dropIndicator.style.display = 'none';
      }
    };

    const handleRootDragOver = (event) => {
      event.preventDefault();
      const external = isExternalDragEvent(event);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = external ? 'copy' : 'move';
      }
      const targetItem = event.target instanceof Element ? event.target.closest('.file-item[data-path]') : null;
      if (targetItem) {
        hideRootOverlay();
        return;
      }
      // 在非目标项区域显示根目录虚线边框（内部/外部拖拽均支持）
      showRootOverlay();
      if (state.dropIndicator) {
        state.dropIndicator.style.display = 'none';
      }
    };

    const handleRootDragLeave = (event) => {
      const related = event.relatedTarget;
      const withinTree = related && (state.fileTreeEl?.contains(related) || state.fileTreeContainer?.contains(related));
      if (!withinTree) {
        hideRootOverlay();
      }
    };

    state.fileTreeEl.addEventListener('dragenter', handleRootDragEnter);
    state.fileTreeEl.addEventListener('dragover', handleRootDragOver);
    state.fileTreeEl.addEventListener('dragleave', handleRootDragLeave);
    if (state.fileTreeContainer) {
      state.fileTreeContainer.addEventListener('dragenter', handleRootDragEnter);
      state.fileTreeContainer.addEventListener('dragover', handleRootDragOver);
      state.fileTreeContainer.addEventListener('dragleave', handleRootDragLeave);
    }
    const handleRootDrop = async (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideRootOverlay();
      const externalPaths = getExternalPathsFromEvent(event);
      if (externalPaths.length > 0) {
        let targetRoot = state.dataRootPath || (global.fileTreeData && global.fileTreeData.path);
        if (!targetRoot) {
          try {
            const tree = await global.fsAPI.getFileTree();
            if (tree && tree.path) {
              targetRoot = tree.path;
              state.dataRootPath = tree.path;
            }
          } catch (resolveError) {
            console.warn('解析文件树根路径失败:', resolveError);
          }
        }
        await importExternalFiles(targetRoot, externalPaths);
        clearDragState();
        return;
      }
      const currentDraggedPath = state.draggedPath;
      clearDragState();
      if (!currentDraggedPath) {
        return;
      }
      try {
        const tree = await global.fsAPI.getFileTree();
        const rootPath = tree.path;
        const draggedItemName = currentDraggedPath.split(/[\\/]/).pop();
        const parentSeparator = Math.max(currentDraggedPath.lastIndexOf('/'), currentDraggedPath.lastIndexOf('\\'));
        const draggedParentDir = parentSeparator > -1 ? currentDraggedPath.slice(0, parentSeparator) : '';
        if (draggedParentDir === rootPath) {
          return;
        }
        const result = await global.fsAPI.moveItem(currentDraggedPath, rootPath);
        if (result?.success) {
          await loadFileTree();
          state.selectedItemPath = result.newPath;
          const explorer = getExplorerModule();
          if (explorer && typeof explorer.setSelectedItemPath === 'function') {
            explorer.setSelectedItemPath(result.newPath);
          }
          setTimeout(() => {
            const selector = `.file-item${getPathSelector(result.newPath)}`;
            const newElement = document.querySelector(selector);
            if (newElement) {
              newElement.classList.add('selected');
              newElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
        } else {
          const errorMessage = result?.error || '未知错误';
          dependencies.showAlert(`移动到根目录失败: ${errorMessage}`, 'error');
        }
      } catch (error) {
        dependencies.showAlert(`移动到根目录时出错: ${error.message || error}`, 'error');
      }
    };

    state.fileTreeEl.addEventListener('drop', handleRootDrop);
    if (state.fileTreeContainer) {
      state.fileTreeContainer.addEventListener('drop', handleRootDrop);
    }
  }

  function initFileTree() {
    if (!ensureElements()) {
      return;
    }
    ensureBackendStatusListener();
    bindRootEvents();
    bindClipboardShortcuts();
    if (state.fileTreeContainer) {
      state.fileTreeContainer.addEventListener('click', (event) => {
        if (!event.target.closest('.file-item')) {
          clearFileTreeSelection();
        }
      });
    }
    global.createRenameInput = createRenameInput;
  }

  function createRenameInput(element, itemPath, currentName, isFolder) {
    ensureRenameInputStyles();
    element.style.display = 'none';

    const paddingLeft = element.style.paddingLeft || '0px';
    const depth = parseInt(paddingLeft, 10) / 12;
    let nameWithoutExt = currentName;
    let fileExtension = '';
    if (!isFolder && currentName.includes('.')) {
      const lastDotIndex = currentName.lastIndexOf('.');
      nameWithoutExt = currentName.substring(0, lastDotIndex);
      fileExtension = currentName.substring(lastDotIndex);
    }

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'file-item rename-input-wrapper';
    inputWrapper.style.paddingLeft = `${depth * 12}px`;
    inputWrapper.style.width = '100%';
    inputWrapper.dataset.path = itemPath;
    if (element.dataset && element.dataset.relativePath) {
      inputWrapper.dataset.relativePath = element.dataset.relativePath;
    }

    const originalContent = element.querySelector('.file-item-content');
    const originalTextSpan = originalContent ? originalContent.querySelector('.file-name-text') : null;
    const measuredWidth = originalTextSpan ? originalTextSpan.getBoundingClientRect().width : null;

    let contentDiv = null;
    if (originalContent) {
      contentDiv = originalContent.cloneNode(true);
      contentDiv.classList.add('rename-input-content');
    } else {
      contentDiv = document.createElement('div');
      contentDiv.className = 'file-item-content rename-input-content';
      const nameWrapperFallback = document.createElement('span');
      nameWrapperFallback.className = 'file-name rename-name-wrapper';
      contentDiv.appendChild(nameWrapperFallback);
      const iconFallback = document.createElement('span');
      iconFallback.className = 'file-icon-wrapper';
      iconFallback.innerHTML = getFileIcon(currentName, isFolder, false);
      nameWrapperFallback.appendChild(iconFallback);
      const textFallback = document.createElement('span');
      textFallback.className = 'file-name-text';
      textFallback.textContent = currentName;
      nameWrapperFallback.appendChild(textFallback);
    }
    inputWrapper.appendChild(contentDiv);

    const nameWrapper = contentDiv.querySelector('.file-name');
    const textSpan = nameWrapper ? nameWrapper.querySelector('.file-name-text') : null;
    const inputContainer = document.createElement('span');
    inputContainer.className = 'rename-input-container';
    inputContainer.style.flex = '1';
    inputContainer.style.minWidth = '0';

    if (textSpan) {
      textSpan.replaceWith(inputContainer);
    } else if (nameWrapper) {
      nameWrapper.appendChild(inputContainer);
    } else {
      contentDiv.appendChild(inputContainer);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = nameWithoutExt;
    input.className = 'inline-rename-input';
    input.setAttribute('spellcheck', 'false');
    const estimatedWidth = measuredWidth ? Math.max(measuredWidth + 12, 64) : Math.max(nameWithoutExt.length * 8 + 24, 64);
    input.style.width = `${Math.min(estimatedWidth, 360)}px`;
    input.style.maxWidth = '100%';
    input.style.minWidth = '48px';
    input.style.flex = '0 0 auto';
    input.style.height = '20px';
    input.style.lineHeight = '18px';

    inputContainer.appendChild(input);

    if (!isFolder && fileExtension) {
      const extensionSpan = document.createElement('span');
      extensionSpan.textContent = fileExtension;
      extensionSpan.className = 'rename-extension';
      inputContainer.appendChild(extensionSpan);
    }

    element.parentNode.insertBefore(inputWrapper, element.nextSibling);

    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(0, end);
    });

    const explorer = getExplorerModule();
    function finishRename(applyChange) {
      inputWrapper.remove();
      element.style.display = '';
      if (!applyChange || !explorer) {
        if (explorer && typeof explorer.onRenameFinished === 'function') {
          explorer.onRenameFinished();
        }
        return;
      }
      const newName = input.value.trim() + fileExtension;
      if (newName && newName !== currentName && typeof explorer.applyRename === 'function') {
        explorer.applyRename(itemPath, newName, isFolder);
      } else if (explorer && typeof explorer.onRenameFinished === 'function') {
        explorer.onRenameFinished();
      }
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        finishRename(true);
      } else if (event.key === 'Escape') {
        finishRename(false);
      }
    });
    input.addEventListener('blur', () => finishRename(true));
  }

  modules.fileTree = {
    configure,
    init: initFileTree,
    loadFileTree,
    addUploadIndicator,
    removeUploadIndicator,
    uploadFile,
    reuploadFile,
    parsePdfToMarkdown,
    mountFolder,
    remountFolder,
    unmountFolder,
    unmountDocument,
    refreshAllUploadStatus,
    clearSelection: clearFileTreeSelection,
    getSelectedItemPath: () => state.selectedItemPath,
    setSelectedItemPath: (value) => {
      state.selectedItemPath = value;
    },
    getExpandedFolders: () => state.expandedFolders,
    getFileIcon,
  };

  Object.defineProperty(global, 'selectedItemPath', {
    configurable: true,
    get: () => state.selectedItemPath,
    set: (value) => {
      state.selectedItemPath = value;
    }
  });

  Object.defineProperty(global, 'expandedFolders', {
    configurable: true,
    get: () => state.expandedFolders,
    set: (value) => {
      if (value instanceof Set) {
        state.expandedFolders = value;
      } else if (Array.isArray(value)) {
        state.expandedFolders = new Set(value);
      }
    }
  });

  global.loadFileTree = loadFileTree;
  global.renderTree = renderTree;
})(window);
