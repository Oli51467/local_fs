(function initFileTreeModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const state = {
    fileTreeEl: null,
    fileTreeContainer: null,
    selectedItemPath: null,
    expandedFolders: new Set(),
    draggedElement: null,
    draggedPath: null,
    dropIndicator: null
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

  const assetUrlCache = new Map();

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
    document.querySelectorAll('.file-item').forEach((item) => {
      item.classList.remove('drag-over', 'drag-over-folder');
    });
    if (state.dropIndicator) {
      state.dropIndicator.style.display = 'none';
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
      document.body.appendChild(state.dropIndicator);
    }
    return state.dropIndicator;
  }

  function addDragAndDropSupport(element, node, isFolder) {
    element.draggable = true;

    element.addEventListener('dragstart', (event) => {
      state.draggedElement = element;
      state.draggedPath = node.path;
      element.style.opacity = '0.5';
      if (event.dataTransfer) {
        event.dataTransfer.setData('text/plain', node.path);
        event.dataTransfer.effectAllowed = 'move';
      }
      ensureDropIndicator();
    });

    element.addEventListener('dragend', () => {
      element.style.opacity = '1';
      clearDragState();
    });

    element.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (state.draggedElement && state.draggedElement !== element) {
        element.classList.add(isFolder ? 'drag-over-folder' : 'drag-over');
      }
    });

    element.addEventListener('dragover', (event) => {
      event.preventDefault();
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
      const rect = element.getBoundingClientRect();
      const elementMiddle = rect.top + rect.height / 2;
      indicator.style.display = 'block';
      indicator.style.left = `${rect.left}px`;
      indicator.style.width = `${rect.width}px`;
      indicator.style.top = event.clientY < elementMiddle ? `${rect.top - 1}px` : `${rect.bottom - 1}px`;
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
    dependencies.showLoadingOverlay(isFolder ? '正在取消挂载文件夹…' : '正在取消挂载…');
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
      dependencies.hideLoadingOverlay();
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
    dependencies.showLoadingOverlay('正在挂载文件夹…');
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
      const response = await fetch('http://localhost:8000/api/document/mount-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: normalizedPath })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || `挂载失败 (${response.status})`);
      }
      handleFolderOperationResult('挂载完成', data);
    } catch (error) {
      dependencies.showAlert(`挂载失败: ${error.message || error}`, 'error');
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  async function remountFolder(folderPath) {
    dependencies.showLoadingOverlay('正在重新挂载文件夹…');
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
      const response = await fetch('http://localhost:8000/api/document/remount-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: normalizedPath, force_reupload: true })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || `重新挂载失败 (${response.status})`);
      }
      handleFolderOperationResult('重新挂载完成', data);
    } catch (error) {
      dependencies.showAlert(`重新挂载失败: ${error.message || error}`, 'error');
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  async function unmountFolder(folderPath) {
    dependencies.showLoadingOverlay('正在取消挂载文件夹…');
    try {
      const normalizedPath = await ensureProjectAbsolutePath(folderPath);
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
      dependencies.hideLoadingOverlay();
    }
  }

  function handleFolderOperationResult(title, data) {
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
      dependencies.setLoadingOverlayIndeterminate({
        message: '正在解析 PDF…',
        stage: payload.stage || payload.message || '正在解析'
      });
      if (payload.status === 'success') {
        return payload;
      }
      if (payload.status === 'error') {
        throw new Error(payload.message || payload.detail || 'PDF解析失败');
      }
    }
  }

  async function handlePdfParseSuccess(result) {
    const markdownPath = result.markdown_path ? `\n位置：${result.markdown_path}` : '';
    dependencies.showSuccessModal(`PDF解析成功${markdownPath}`.trim());
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
    dependencies.setLoadingOverlayIndeterminate({
      message: '正在解析 PDF…',
      stage: '正在解析 PDF…'
    });
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
        const finalResult = await pollPdfParseStatus(result.task_id);
        dependencies.setLoadingOverlayIndeterminate({
          message: '正在解析 PDF…',
          stage: finalResult.stage || '解析完成'
        });
        await handlePdfParseSuccess(finalResult);
      } else if (result.status === 'success') {
        dependencies.setLoadingOverlayIndeterminate({
          message: '正在解析 PDF…',
          stage: result.stage || '解析完成'
        });
        await handlePdfParseSuccess(result);
      } else if (result.status === 'error') {
        throw new Error(result.message || 'PDF解析失败');
      } else {
        throw new Error(result.message || '未知的解析状态');
      }
    } catch (error) {
      dependencies.showModal({
        type: 'error',
        title: 'PDF解析失败',
        message: error.message || '解析请求失败，请检查后端服务',
        showCancel: false
      });
    } finally {
      dependencies.hideLoadingOverlay();
    }
  }

  async function uploadFile(filePath) {
    const isPdfFile = filePath.toLowerCase().endsWith('.pdf');
    const overlayMessage = isPdfFile ? '正在挂载 PDF…' : '正在挂载…';
    if (isPdfFile) {
      dependencies.setLoadingOverlayIndeterminate({
        message: overlayMessage,
        stage: '正在解析 PDF…'
      });
    } else {
      dependencies.showLoadingOverlay(overlayMessage);
    }

    const uploadPath = await ensureProjectAbsolutePath(filePath);

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

      const response = await fetch('http://localhost:8000/api/document/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: uploadPath })
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
      const response = await fetch('http://localhost:8000/api/document/reupload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: uploadPath, force_reupload: false })
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

  function createContextMenu(x, y, itemPath, isFolder) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const isPdfFile = !isFolder && itemPath.toLowerCase().endsWith('.pdf');

    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.innerHTML = `<span class="context-menu-icon">${global.icons.newFile}</span>重命名`;
    renameItem.addEventListener('click', () => {
      hideContextMenu();
      const explorer = getExplorerModule();
      if (explorer) {
        explorer.startRename(itemPath);
      }
    });

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.innerHTML = `<span class="context-menu-icon">${global.icons.trash}</span>删除`;
    deleteItem.addEventListener('click', () => {
      hideContextMenu();
      const explorer = getExplorerModule();
      if (explorer) {
        explorer.deleteItem(itemPath);
      }
    });

    const separator1 = document.createElement('div');
    separator1.className = 'context-menu-separator';

    const mountItem = document.createElement('div');
    mountItem.className = 'context-menu-item';
    mountItem.innerHTML = `<span class="context-menu-icon">${global.icons.import}</span>挂载`;
    if (isFolder) {
      mountItem.addEventListener('click', () => {
        hideContextMenu();
        mountFolder(itemPath);
      });
    } else {
      mountItem.addEventListener('click', () => {
        hideContextMenu();
        uploadFile(itemPath);
      });
    }

    let parsePdfItem = null;
    if (isPdfFile) {
      parsePdfItem = document.createElement('div');
      parsePdfItem.className = 'context-menu-item';
      parsePdfItem.innerHTML = `<span class="context-menu-icon">${global.icons.file}</span>深度解析`;
      parsePdfItem.addEventListener('click', () => {
        hideContextMenu();
        parsePdfToMarkdown(itemPath);
      });
    }

    const remountItem = document.createElement('div');
    remountItem.className = 'context-menu-item';
    remountItem.innerHTML = `<span class="context-menu-icon">${global.icons.import}</span>重新挂载`;
    if (isFolder) {
      remountItem.addEventListener('click', () => {
        hideContextMenu();
        remountFolder(itemPath);
      });
    } else {
      remountItem.addEventListener('click', () => {
        hideContextMenu();
        reuploadFile(itemPath);
      });
    }

    const unmountItem = document.createElement('div');
    unmountItem.className = 'context-menu-item';
    unmountItem.innerHTML = `<span class="context-menu-icon">${global.icons.trash}</span>取消挂载`;
    unmountItem.addEventListener('click', () => {
      hideContextMenu();
      if (isFolder) {
        unmountFolder(itemPath);
      } else {
        unmountDocument(itemPath, false);
      }
    });

    const separator2 = document.createElement('div');
    separator2.className = 'context-menu-separator';

    menu.appendChild(renameItem);
    menu.appendChild(deleteItem);
    menu.appendChild(separator1);
    menu.appendChild(mountItem);
    menu.appendChild(unmountItem);
    menu.appendChild(remountItem);
    if (parsePdfItem) {
      menu.appendChild(separator2);
      menu.appendChild(parsePdfItem);
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
      arrow.style.transform = 'rotate(0deg)';
      folderIcon.innerHTML = getFileIcon(node.name, true, false);
    } else {
      state.expandedFolders.add(node.path);
      childContainer.style.display = 'block';
      arrow.style.transform = 'rotate(90deg)';
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
    if (!viewer && global.ImageViewer) {
      viewer = new global.ImageViewer();
      setFileViewer(viewer);
    }
    if (viewer && typeof viewer.openFile === 'function') {
      viewer.openFile(node.path).catch((error) => {
        console.error('文件打开失败:', error);
      });
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
      const arrow = document.createElement('span');
      arrow.textContent = '▶';
      arrow.className = 'folder-arrow';
      arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      contentDiv.appendChild(arrow);

      const nameWrapper = document.createElement('span');
      nameWrapper.className = 'file-name';
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
      arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
      node.children.forEach((child) => renderTree(child, childContainer, false, depth + 1));
      container.appendChild(childContainer);

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
        createContextMenu(event.pageX, event.pageY, node.path, false);
      });
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
      state.fileTreeEl.dataset.parentRelative = 'data';
      state.fileTreeEl.innerHTML = '';
      if (Array.isArray(tree.children)) {
        tree.children.forEach((child) => renderTree(child, state.fileTreeEl, true, 0));
      }
      if (typeof dependencies.updateFolderUploadStatus === 'function') {
        await dependencies.updateFolderUploadStatus('data');
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
    state.fileTreeEl.addEventListener('dragenter', (event) => {
      event.preventDefault();
      if (state.draggedElement && state.draggedPath) {
        state.fileTreeEl.classList.add('drag-over-root');
      }
    });
    state.fileTreeEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      if (state.draggedElement && state.draggedPath) {
        state.fileTreeEl.classList.add('drag-over-root');
        if (state.dropIndicator) {
          state.dropIndicator.style.display = 'none';
        }
      }
    });
    state.fileTreeEl.addEventListener('dragleave', (event) => {
      if (!state.fileTreeEl.contains(event.relatedTarget)) {
        state.fileTreeEl.classList.remove('drag-over-root');
      }
    });
    state.fileTreeEl.addEventListener('drop', async (event) => {
      event.preventDefault();
      state.fileTreeEl.classList.remove('drag-over-root');
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
            const newElement = document.querySelector(`[data-path="${result.newPath}"]`);
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
    });
  }

  function initFileTree() {
    if (!ensureElements()) {
      return;
    }
    bindRootEvents();
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
    inputWrapper.className = 'rename-input-wrapper';
    inputWrapper.style.paddingLeft = `${depth * 12}px`;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = nameWithoutExt;
    input.className = 'rename-input';
    inputWrapper.appendChild(input);
    if (!isFolder && fileExtension) {
      const extensionSpan = document.createElement('span');
      extensionSpan.textContent = fileExtension;
      extensionSpan.className = 'rename-extension';
      inputWrapper.appendChild(extensionSpan);
    }
    element.parentNode.insertBefore(inputWrapper, element.nextSibling);
    input.focus();
    input.select();
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
      } else {
        // 未发生变化也需要重置状态
        if (explorer && typeof explorer.onRenameFinished === 'function') {
          explorer.onRenameFinished();
        }
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
