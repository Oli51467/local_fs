class ChatFilePanel {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('chat-file-tree');
    this.panelEl = options.panelEl || document.getElementById('chat-file-panel');
    this.toggleBtn = options.toggleBtn || document.getElementById('chat-file-toggle-btn');
    this.closeBtn = options.closeBtn || document.getElementById('chat-file-panel-close');
    this.toggleIconEl = document.getElementById('chat-file-toggle-icon');
    this.closeIconEl = document.getElementById('chat-file-panel-close-icon');
    this.onVisibilityChange = typeof options.onVisibilityChange === 'function' ? options.onVisibilityChange : null;
    this.runtime = {
      fileTreeData: null,
      expanded: new Set(),
      selected: new Set(),
      listeners: {
        selection: new Set()
      }
    };
    this.icons = window.icons || {};
    this.uploadStatusModule = window.RendererModules?.uploadStatus || null;
    this.nodeLookup = new Map();
    this.statusRequests = new Map();
    this.uploadStatusEndpoint = this.uploadStatusModule?.UPLOAD_STATUS_ENDPOINT
      || 'http://localhost:8000/api/document/upload-status';
    this.loadInFlight = null;
    this.pendingSelectionBroadcast = null;
    this.initialize();
  }

  initialize() {
    if (this.toggleIconEl) {
      this.toggleIconEl.innerHTML = this.icons.file || '';
    }
    if (this.closeIconEl) {
      this.closeIconEl.innerHTML = window.icons?.chevronRight || '';
    }

    this.bindPanelToggle();
    this.bindKeyboardShortcuts();

    if (this.container) {
      this.container.addEventListener('contextmenu', (event) => {
        event.preventDefault();
      });
    }
    if (this.panelEl) {
      this.panelEl.addEventListener('contextmenu', (event) => {
        event.preventDefault();
      });
    }
  }

  bindPanelToggle() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        const next = !this.panelEl?.classList.contains('is-open');
        this.setPanelVisibility(next);
        if (next && !this.runtime.fileTreeData) {
          this.loadFileTree();
        }
      });
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.setPanelVisibility(false));
    }
  }

  bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (!this.panelEl?.classList.contains('is-open')) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === 'a') {
        event.preventDefault();
        this.selectAllFiles();
      }
      if (event.key === 'Escape') {
        this.setPanelVisibility(false);
      }
    });
  }

  setPanelVisibility(visible) {
    if (!this.panelEl || !this.toggleBtn) {
      return;
    }
    const wasOpen = this.panelEl.classList.contains('is-open');
    const nextState = Boolean(visible);
    this.panelEl.classList.toggle('is-open', nextState);
    this.toggleBtn.setAttribute('aria-pressed', nextState ? 'true' : 'false');
    this.toggleBtn.setAttribute('aria-expanded', nextState ? 'true' : 'false');
    this.panelEl.setAttribute('aria-hidden', nextState ? 'false' : 'true');
    if (nextState && !this.runtime.fileTreeData) {
      this.loadFileTree();
    }
    if (this.onVisibilityChange && wasOpen !== nextState) {
      try {
        this.onVisibilityChange(nextState);
      } catch (error) {
        console.warn('聊天文件面板可见状态回调失败:', error);
      }
    }
  }

  async loadFileTree() {
    if (this.loadInFlight) {
      return this.loadInFlight;
    }
    if (!window.fsAPI || typeof window.fsAPI.getFileTree !== 'function') {
      console.warn('fsAPI.getFileTree is unavailable');
      return;
    }
    const loadingPromise = window.fsAPI.getFileTree()
      .then((tree) => {
        this.runtime.fileTreeData = tree;
        window.chatFileTreeData = tree;
        this.renderTree();
        return tree;
      })
      .catch((error) => {
        console.error('加载聊天文件树失败:', error);
        if (this.container) {
          this.container.innerHTML = `<div class="chat-file-tree-empty">无法加载文件列表</div>`;
        }
      })
      .finally(() => {
        this.loadInFlight = null;
      });
    this.loadInFlight = loadingPromise;
    return loadingPromise;
  }

  renderTree() {
    if (!this.container) {
      return;
    }
    const tree = this.runtime.fileTreeData;
    this.container.innerHTML = '';
    this.nodeLookup.clear();
    if (!tree || !Array.isArray(tree.children) || tree.children.length === 0) {
      this.container.innerHTML = '<div class="chat-file-tree-empty">暂无文件</div>';
      return;
    }
    const fragment = document.createDocumentFragment();
    tree.children.forEach((child) => {
      this.renderBranch(child, 0, fragment);
    });
    this.container.appendChild(fragment);
    this.ensureFolderStatus('data');
  }

  renderBranch(node, depth, parentContainer) {
    const item = this.createItemNode(node, depth);
    parentContainer.appendChild(item);
    if (Array.isArray(node.children) && node.children.length >= 0) {
      const container = document.createElement('div');
      const relative = this.resolveRelativePath(node);
      container.className = 'chat-file-children';
      container.dataset.parent = node.path;
      container.dataset.parentRelative = relative;
      container.dataset.depth = String(depth + 1);
      const expanded = this.runtime.expanded.has(node.path);
      container.style.display = expanded ? 'block' : 'none';
      container.setAttribute('role', 'group');
      container.dataset.rendered = expanded ? 'true' : 'false';
      parentContainer.appendChild(container);
      if (expanded) {
        this.renderChildNodes(node, container, depth + 1);
        this.ensureFolderStatus(relative);
      }
    }
  }

  renderChildNodes(parentNode, container, depth) {
    if (!Array.isArray(parentNode.children) || !container) {
      return;
    }
    container.innerHTML = '';
    parentNode.children.forEach((child) => this.renderBranch(child, depth, container));
    container.dataset.rendered = 'true';
  }

  createItemNode(node, depth) {
    const isFolder = Array.isArray(node.children) && node.children.length >= 0;
    const relativePath = this.resolveRelativePath(node);
    const item = document.createElement('div');
    item.className = 'file-item';
    if (isFolder) {
      item.classList.add('folder-item');
    } else {
      item.classList.add('file-item-file', 'is-selectable');
    }
    item.dataset.path = node.path;
    item.dataset.relativePath = relativePath;
    item.dataset.type = isFolder ? 'folder' : 'file';
    const depthLevel = Number(depth) || 0;
    item.dataset.depth = String(depthLevel);
    item.style.setProperty('--chat-depth-level', depthLevel);
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', `${depth + 1}`);
    const isExpanded = isFolder && this.runtime.expanded.has(node.path);
    if (isFolder) {
      item.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      if (isExpanded) {
        item.classList.add('is-expanded');
      }
    }
    item.setAttribute('aria-selected', this.runtime.selected.has(node.path) ? 'true' : 'false');
    if (this.runtime.selected.has(node.path)) {
      item.dataset.selected = 'true';
    }
    this.nodeLookup.set(node.path, node);

    const content = document.createElement('div');
    content.className = 'file-item-content';
    item.appendChild(content);

    const nameWrapper = document.createElement('span');
    nameWrapper.className = 'file-name';
    content.appendChild(nameWrapper);

    if (!isFolder) {
      item.dataset.fileName = node.name;
    }

    const bullet = document.createElement('span');
    bullet.className = 'file-bullet';
    bullet.textContent = '•';
    nameWrapper.appendChild(bullet);

    const icon = document.createElement('span');
    icon.className = 'file-icon-wrapper';
    icon.innerHTML = this.getFileIcon(node.name, isFolder, isExpanded);
    nameWrapper.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'file-name-text';
    text.textContent = node.name;
    nameWrapper.appendChild(text);

    item.addEventListener('click', (event) => {
      event.stopPropagation();
      if (isFolder) {
        this.toggleFolder(node.path);
        return;
      }
      this.toggleSelection(node.path);
    });

    return item;
  }

  toggleFolder(path) {
    const node = this.nodeLookup.get(path);
    if (!node || !Array.isArray(node.children)) {
      return;
    }
    const expanded = this.runtime.expanded.has(path);
    const next = !expanded;
    if (next) {
      this.runtime.expanded.add(path);
    } else {
      this.runtime.expanded.delete(path);
    }
    const escaped = this.escapeSelector(path);
    const itemDom = this.container?.querySelector(`.file-item[data-path="${escaped}"]`);
    const childContainer = itemDom?.nextElementSibling?.dataset?.parent === path
      ? itemDom.nextElementSibling
      : this.container?.querySelector(`.chat-file-children[data-parent="${escaped}"]`);
    if (itemDom) {
      itemDom.setAttribute('aria-expanded', next ? 'true' : 'false');
      itemDom.classList.toggle('is-expanded', next);
      const iconWrapper = itemDom.querySelector('.file-icon-wrapper');
      if (iconWrapper) {
        iconWrapper.innerHTML = this.getFileIcon(node.name, true, next);
      }
    }
    if (childContainer) {
      if (next && childContainer.dataset.rendered !== 'true') {
        const depth = Number(childContainer.dataset.depth) || (Number(itemDom?.dataset.depth) + 1) || 1;
        this.renderChildNodes(node, childContainer, depth);
      }
      childContainer.style.display = next ? 'block' : 'none';
      if (next) {
        const relative = childContainer.dataset.parentRelative || this.resolveRelativePath(node);
        this.ensureFolderStatus(relative);
      } else {
        const normalizedPath = String(path || '').replace(/\\/g, '/');
        const prefix = `${normalizedPath}/`;
        const toRemove = [];
        this.runtime.selected.forEach((selectedPath) => {
          const normalizedSelected = String(selectedPath || '').replace(/\\/g, '/');
          if (normalizedSelected === normalizedPath || normalizedSelected.startsWith(prefix)) {
            toRemove.push(selectedPath);
          }
        });
        const selectionChanged = toRemove.length > 0;
        toRemove.forEach((selectedPath) => this.runtime.selected.delete(selectedPath));
        childContainer.querySelectorAll('.file-item.is-selectable[data-selected="true"]').forEach((el) => {
          el.dataset.selected = 'false';
          el.setAttribute('aria-selected', 'false');
        });
        if (selectionChanged) {
          this.scheduleSelectionBroadcast(true);
        }
      }
    }
  }

  toggleSelection(path) {
    const node = this.nodeLookup.get(path);
    if (node && Array.isArray(node.children)) {
      return;
    }
    if (this.runtime.selected.has(path)) {
      this.runtime.selected.delete(path);
    } else {
      this.runtime.selected.add(path);
    }
    const target = this.container?.querySelector(`.file-item.is-selectable[data-path="${this.escapeSelector(path)}"]`);
    if (target) {
      target.dataset.selected = this.runtime.selected.has(path) ? 'true' : 'false';
      target.setAttribute('aria-selected', target.dataset.selected === 'true' ? 'true' : 'false');
    }
    this.scheduleSelectionBroadcast();
  }

  selectAllFiles() {
    if (!this.container) {
      return;
    }
    this.runtime.selected.clear();
    this.container.querySelectorAll('.file-item.is-selectable[data-path]').forEach((el) => {
      el.dataset.selected = 'false';
      el.setAttribute('aria-selected', 'false');
    });
    this.container.querySelectorAll('.file-item.is-selectable[data-path]').forEach((el) => {
      if (!el.offsetParent) {
        return;
      }
      const path = el.dataset.path;
      this.runtime.selected.add(path);
      el.dataset.selected = 'true';
      el.setAttribute('aria-selected', 'true');
    });
    this.scheduleSelectionBroadcast(true);
  }

  scheduleSelectionBroadcast(immediate = false) {
    if (this.pendingSelectionBroadcast) {
      cancelAnimationFrame(this.pendingSelectionBroadcast);
    }
    if (immediate) {
      this.broadcastSelection();
      return;
    }
    this.pendingSelectionBroadcast = requestAnimationFrame(() => {
      this.pendingSelectionBroadcast = null;
      this.broadcastSelection();
    });
  }

  broadcastSelection() {
    const payload = Array.from(this.runtime.selected);
    this.runtime.listeners.selection.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.warn('文件选择事件处理失败:', error);
      }
    });
    const event = new CustomEvent('chatFileSelectionChanged', { detail: { paths: payload } });
    document.dispatchEvent(event);
  }

  onSelectionChange(callback) {
    if (typeof callback === 'function') {
      this.runtime.listeners.selection.add(callback);
      return () => this.runtime.listeners.selection.delete(callback);
    }
    return () => { };
  }

  resolveRelativePath(node) {
    const resolve = this.uploadStatusModule?.resolveNodeRelativePath;
    if (typeof resolve === 'function') {
      try {
        return resolve(node);
      } catch (error) {
        console.warn('解析相对路径失败:', error);
      }
    }
    if (!node?.path) {
      return 'data';
    }
    if (node.relativePath) {
      return node.relativePath;
    }
    if (window.RendererModules?.fileTree?.resolveNodeRelativePath) {
      try {
        return window.RendererModules.fileTree.resolveNodeRelativePath(node);
      } catch (error) {
        console.warn('fallback resolve relative path failed:', error);
      }
    }
    return 'data';
  }

  getFileIcon(name, isFolder, expanded) {
    if (window.RendererModules?.fileTree?.getFileIcon) {
      try {
        return window.RendererModules.fileTree.getFileIcon(name, isFolder, expanded);
      } catch (error) {
        console.warn('调用文件树图标失败:', error);
      }
    }
    if (isFolder) {
      return expanded ? (this.icons.folderOpen || '') : (this.icons.folder || '');
    }
    return this.icons.file || '';
  }

  escapeSelector(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
  }

  normalizeRelativeFolderPath(relativePath) {
    if (!relativePath) {
      return 'data';
    }
    let cleaned = String(relativePath).trim().replace(/\\/g, '/');
    if (!cleaned || cleaned === '.' || cleaned === './') {
      return 'data';
    }
    cleaned = cleaned.replace(/^\.+\//, '');
    cleaned = cleaned.replace(/^\/+/,'');
    if (!cleaned.startsWith('data')) {
      cleaned = `data/${cleaned}`;
    }
    cleaned = cleaned.replace(/\/+$/, '');
    return cleaned || 'data';
  }

  formatFolderPathForApi(relativePath) {
    const normalized = this.normalizeRelativeFolderPath(relativePath);
    return `/${normalized}/`;
  }

  getFolderContainerByRelativePath(relativePath) {
    const normalized = this.normalizeRelativeFolderPath(relativePath);
    if (normalized === 'data') {
      return this.container;
    }
    return this.container?.querySelector(`.chat-file-children[data-parent-relative="${normalized}"]`);
  }

  ensureUploadIndicatorElement(fileElement) {
    let indicator = fileElement.querySelector('.upload-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'upload-indicator';
      const contentDiv = fileElement.querySelector('.file-item-content');
      (contentDiv || fileElement).appendChild(indicator);
    }
    fileElement.dataset.uploaded = 'true';
    return indicator;
  }

  updateUploadIndicatorForElement(fileElement, uploaded) {
    if (!fileElement) {
      return;
    }
    const existing = fileElement.querySelector('.upload-indicator');
    if (uploaded) {
      this.ensureUploadIndicatorElement(fileElement);
    } else if (existing) {
      existing.remove();
      fileElement.dataset.uploaded = 'false';
    } else {
      fileElement.dataset.uploaded = 'false';
    }
  }

  applyUploadStatusToFolder(relativePath, filesStatus) {
    const container = this.getFolderContainerByRelativePath(relativePath);
    if (!container) {
      return;
    }
    const files = container.querySelectorAll(':scope > .file-item-file');
    files.forEach((fileElement) => {
      const fileName = fileElement.dataset.fileName || '';
      const uploaded = Boolean(filesStatus && filesStatus[fileName]);
      this.updateUploadIndicatorForElement(fileElement, uploaded);
    });
  }

  ensureFolderStatus(relativePath) {
    const normalized = this.normalizeRelativeFolderPath(relativePath);
    if (!this.uploadStatusEndpoint || !normalized) {
      return;
    }
    if (this.statusRequests.has(normalized)) {
      return;
    }
    const request = this.fetchFolderStatus(normalized)
      .catch((error) => {
        console.warn('获取文件上传状态失败:', error);
      })
      .finally(() => {
        this.statusRequests.delete(normalized);
      });
    this.statusRequests.set(normalized, request);
  }

  async fetchFolderStatus(normalizedRelative) {
    const container = this.getFolderContainerByRelativePath(normalizedRelative);
    if (!container) {
      return;
    }
    const response = await fetch(this.uploadStatusEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: this.formatFolderPathForApi(normalizedRelative) })
    });
    if (!response.ok) {
      throw new Error(`接口返回状态 ${response.status}`);
    }
    const data = await response.json();
    this.applyUploadStatusToFolder(normalizedRelative, data.files || {});
  }

  getSelectedPaths() {
    return Array.from(this.runtime.selected);
  }

  clearSelection() {
    if (this.runtime.selected.size === 0) {
      return;
    }
    this.runtime.selected.clear();
    if (this.container) {
      this.container.querySelectorAll('.file-item.is-selectable[data-selected="true"]').forEach((el) => {
        el.dataset.selected = 'false';
        el.setAttribute('aria-selected', 'false');
      });
    }
    this.scheduleSelectionBroadcast(true);
  }
}

window.ChatFilePanel = ChatFilePanel;
