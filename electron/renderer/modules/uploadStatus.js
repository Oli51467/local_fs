(function initUploadStatusModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const UPLOAD_STATUS_ENDPOINT = 'http://localhost:8000/api/document/upload-status';

  let fileTreeRoot = null;
  let expandedFoldersAccessor = () => global.expandedFolders;

  function setFileTreeRoot(element) {
    fileTreeRoot = element && element instanceof HTMLElement ? element : null;
    if (!fileTreeRoot) {
      fileTreeRoot = document.getElementById('file-tree');
    }
    return fileTreeRoot;
  }

  function getFileTreeRoot() {
    if (fileTreeRoot && document.body.contains(fileTreeRoot)) {
      return fileTreeRoot;
    }
    return setFileTreeRoot();
  }

  function setExpandedFoldersAccessor(fn) {
    if (typeof fn === 'function') {
      expandedFoldersAccessor = fn;
    }
  }

  function getExpandedFolders() {
    try {
      const result = expandedFoldersAccessor && expandedFoldersAccessor();
      return result instanceof Set ? result : null;
    } catch (error) {
      console.warn('获取展开文件夹集合失败:', error);
      return null;
    }
  }

  function normalizeRelativeFolderPath(relativePath) {
    if (!relativePath) {
      return 'data';
    }
    let cleaned = String(relativePath).trim().replace(/\\/g, '/');
    if (!cleaned || cleaned === '.' || cleaned === './') {
      return 'data';
    }
    cleaned = cleaned.replace(/^\.+\//, '');
    cleaned = cleaned.replace(/^\/+/, '');
    if (!cleaned.startsWith('data')) {
      cleaned = `data/${cleaned}`;
    }
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned || 'data';
  }

  function formatFolderPathForApi(relativePath) {
    const normalized = normalizeRelativeFolderPath(relativePath);
    return `/${normalized}/`;
  }

  function computeRelativePathFromAbsolute(absolutePath) {
    if (!absolutePath) {
      return 'data';
    }
    const normalizedAbs = absolutePath.replace(/\\/g, '/');
    const rootPath = global.fileTreeData && global.fileTreeData.path
      ? global.fileTreeData.path.replace(/\\/g, '/').replace(/\/+$/, '')
      : null;
    if (rootPath && normalizedAbs.startsWith(rootPath)) {
      const remainder = normalizedAbs.slice(rootPath.length).replace(/^\/+/, '');
      return remainder ? `data/${remainder}` : 'data';
    }
    const markerIndex = normalizedAbs.indexOf('/data/');
    if (markerIndex !== -1) {
      return normalizedAbs.slice(markerIndex + 1).replace(/\/+$/, '');
    }
    if (normalizedAbs.endsWith('/data')) {
      return 'data';
    }
    return 'data';
  }

  function resolveNodeRelativePath(node) {
    if (!node) {
      return 'data';
    }
    if (node.relativePath) {
      return normalizeRelativeFolderPath(node.relativePath);
    }
    return normalizeRelativeFolderPath(computeRelativePathFromAbsolute(node.path));
  }

  function getFolderContainerByRelativePath(relativeFolderPath) {
    const normalized = normalizeRelativeFolderPath(relativeFolderPath);
    if (!normalized || normalized === 'data') {
      return getFileTreeRoot();
    }
    return document.querySelector(`div[data-parent-relative="${normalized}"]`);
  }

  function ensureUploadIndicatorElement(fileElement) {
    let indicator = fileElement.querySelector('.upload-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'upload-indicator';
      indicator.title = '已上传';
      const contentDiv = fileElement.querySelector('.file-item-content');
      const targetContainer = contentDiv || fileElement;
      targetContainer.appendChild(indicator);
    }
    indicator.classList.remove('uploading', 'reuploading');
    return indicator;
  }

  function updateUploadIndicatorForElement(fileElement, isUploaded) {
    if (!fileElement) {
      return;
    }
    const existing = fileElement.querySelector('.upload-indicator');
    if (isUploaded) {
      ensureUploadIndicatorElement(fileElement);
      fileElement.dataset.uploaded = 'true';
    } else if (existing) {
      existing.remove();
      fileElement.dataset.uploaded = 'false';
    } else {
      fileElement.dataset.uploaded = 'false';
    }
  }

  function applyUploadStatusToFolder(relativeFolderPath, filesStatus) {
    const container = getFolderContainerByRelativePath(relativeFolderPath);
    if (!container) {
      return;
    }
    const directFiles = container.querySelectorAll(':scope > .file-item-file');
    directFiles.forEach((fileElement) => {
      const fileName = fileElement.dataset.fileName || '';
      const uploaded = Boolean(filesStatus && filesStatus[fileName]);
      updateUploadIndicatorForElement(fileElement, uploaded);
    });
  }

  async function updateFolderUploadStatus(relativeFolderPath) {
    const normalized = normalizeRelativeFolderPath(relativeFolderPath);
    const container = getFolderContainerByRelativePath(normalized);
    if (!container) {
      return;
    }
    try {
      const response = await fetch(UPLOAD_STATUS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: formatFolderPathForApi(normalized) })
      });
      if (!response.ok) {
        throw new Error(`接口返回状态 ${response.status}`);
      }
      const data = await response.json();
      applyUploadStatusToFolder(normalized, data.files || {});
    } catch (error) {
      console.error(`获取文件夹 ${normalized} 上传状态失败:`, error);
    }
  }

  async function refreshVisibleFolderUploadStatus() {
    const targets = new Set(['data']);
    document.querySelectorAll('div[data-parent-relative]').forEach((container) => {
      const relative = container.dataset.parentRelative;
      if (!relative) {
        return;
      }
      if (container.style.display !== 'none') {
        targets.add(relative);
      }
    });
    for (const relative of targets) {
      await updateFolderUploadStatus(relative);
    }
  }

  async function refreshFolderUploadIndicators(folderPath) {
    if (!folderPath) {
      return;
    }

    const expandedFolders = getExpandedFolders();
    if (!expandedFolders) {
      return;
    }

    try {
      const normalizedAbs = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const targets = new Set();

      const baseRelative = normalizedAbs.startsWith('/')
        ? computeRelativePathFromAbsolute(normalizedAbs)
        : normalizeRelativeFolderPath(folderPath);

      if (baseRelative) {
        targets.add(baseRelative);
      }

      const prefix = normalizedAbs ? `${normalizedAbs}/` : '';

      expandedFolders.forEach((absPath) => {
        if (!absPath) {
          return;
        }
        const candidate = String(absPath).replace(/\\/g, '/').replace(/\/+$/, '');
        if (candidate === normalizedAbs || (prefix && candidate.startsWith(prefix))) {
          const relative = computeRelativePathFromAbsolute(candidate);
          if (relative) {
            targets.add(relative);
          }
        }
      });

      for (const relative of targets) {
        await updateFolderUploadStatus(relative);
      }
    } catch (error) {
      console.warn('刷新文件夹上传指示器失败:', error);
    }
  }

  const api = {
    UPLOAD_STATUS_ENDPOINT,
    setFileTreeRoot,
    setExpandedFoldersAccessor,
    normalizeRelativeFolderPath,
    formatFolderPathForApi,
    computeRelativePathFromAbsolute,
    resolveNodeRelativePath,
    getFolderContainerByRelativePath,
    ensureUploadIndicatorElement,
    updateUploadIndicatorForElement,
    applyUploadStatusToFolder,
    updateFolderUploadStatus,
    refreshVisibleFolderUploadStatus,
    refreshFolderUploadIndicators
  };

  modules.uploadStatus = api;

  global.updateFolderUploadStatus = updateFolderUploadStatus;
  global.refreshVisibleFolderUploadStatus = refreshVisibleFolderUploadStatus;
})(window);

