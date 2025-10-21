const escapeForSelector = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  if (window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(value);
  }
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\"/g, '\\"')
    .replace(/\n/g, '\\n');
};

const findElementByPath = (path) => {
  if (!path) {
    return null;
  }
  const escaped = escapeForSelector(path);
  return document.querySelector(`[data-path="${escaped}"]`);
};

const getFileTreeIcon = (name = '', isFolder = false, isExpanded = false) => {
  const fileTreeModule = window.RendererModules?.fileTree;
  if (fileTreeModule && typeof fileTreeModule.getFileIcon === 'function') {
    return fileTreeModule.getFileIcon(name, isFolder, isExpanded);
  }
  const fallback = window.getFileIcon;
  if (typeof fallback === 'function') {
    try {
      return fallback(name, isFolder, isExpanded);
    } catch (error) {
      console.warn('调用全局getFileIcon失败:', error);
    }
  }
  return '';
};

/**
 * 资源管理器模块
 * 负责管理文件树上方的banner区域和五个按钮的功能
 */
class ExplorerModule {
  constructor() {
    this.selectedItemPath = null;
    this.expandedFolders = new Set();
    this.fileTreeEl = document.getElementById('file-tree');
    this.fileTreeContainerEl = document.getElementById('file-tree-container');
    this.fileContentEl = document.getElementById('file-content');
    this.fileViewer = null;
    this.isRenaming = false; // 添加重命名状态标志
    
    // 将全局变量绑定到模块实例
    window.selectedItemPath = null;
    window.expandedFolders = this.expandedFolders;
    
    this.init();
  }

  init() {
    this.initFileViewer();
    this.renderIcons();
    this.bindEvents();
    this.initResizer();
  }

  // 初始化文件查看器
  initFileViewer() {
    if (this.fileContentEl && typeof FileViewer !== 'undefined') {
      this.fileViewer = new FileViewer(this.fileContentEl);
    }
  }

  // 渲染SVG图标
  renderIcons() {
    document.getElementById('folder-icon').innerHTML = icons.folder;
    document.getElementById('new-file-icon').innerHTML = icons.newFile;
    document.getElementById('refresh-icon').innerHTML = icons.refresh;
    document.getElementById('import-icon').innerHTML = icons.import;
    document.getElementById('trash-icon').innerHTML = icons.trash;
    
    // 添加悬浮提示
    document.getElementById('new-folder').title = '新建文件夹';
    document.getElementById('new-file').title = '新建文件';
    document.getElementById('import-files').title = '导入文件';
    document.getElementById('refresh-tree').title = '刷新';
    document.getElementById('delete-item').title = '删除';
  }

  // 绑定事件监听器
  bindEvents() {
    // 绑定新建文件夹和新建文件按钮事件
    document.getElementById('new-folder').addEventListener('click', () => this.createFolder());
    document.getElementById('new-file').addEventListener('click', () => this.createFile());
    document.getElementById('refresh-tree').addEventListener('click', () => this.refreshFileTree());
    document.getElementById('import-files').addEventListener('click', () => this.importFiles());
    
    // 绑定删除按钮事件
    document.getElementById('delete-item').addEventListener('click', () => {
      if (!this.selectedItemPath) {
        if (typeof window.showAlert === 'function') {
          window.showAlert('请先选择要删除的文件或文件夹', 'warning');
        } else {
          console.warn('showAlert 未初始化，fallback 到浏览器原生提示');
          alert('请先选择要删除的文件或文件夹');
        }
        return;
      }
      
      // 通过文件树数据判断是文件还是文件夹
      const isFolder = this.isSelectedItemFolder(this.selectedItemPath);
      this.performDeletion(this.selectedItemPath, isFolder).catch((error) => {
        console.error('删除失败:', error);
      });
    });

    // 添加键盘事件监听器
    document.addEventListener('keydown', (e) => {
      // 检查是否有选中的文件项，这是处理Enter键的前提条件
      if (!this.selectedItemPath) {
        return;
      }

      // 只有在不在重命名状态时才处理键盘事件
      if (this.isRenaming) {
        return;
      }
      
      // 检查是否按下了Enter键
      if (e.key === 'Enter') {
        const activeElement = document.activeElement;
        const target = e.target instanceof Node ? e.target : null;
        const isWithinTree = (
          (target && (
            (this.fileTreeEl && this.fileTreeEl.contains(target)) ||
            (this.fileTreeContainerEl && this.fileTreeContainerEl.contains(target))
          )) ||
          (activeElement && (
            (this.fileTreeEl && this.fileTreeEl.contains(activeElement)) ||
            (this.fileTreeContainerEl && this.fileTreeContainerEl.contains(activeElement))
          ))
        );
        if (!isWithinTree) {
          return;
        }

        // 检查当前焦点是否在文本编辑区域
        if (activeElement) {
          // 如果焦点在文本输入区域，不触发重命名
          const tagName = activeElement.tagName.toLowerCase();
          if (tagName === 'textarea' || 
              tagName === 'input' || 
              activeElement.contentEditable === 'true' ||
              activeElement.classList.contains('txt-editor') ||
              activeElement.classList.contains('markdown-editor-textarea')) {
            return; // 不处理，让文本编辑器正常处理回车键
          }
        }
        
        // 阻止事件冒泡，防止与其他键盘事件冲突
        e.stopPropagation();
        e.preventDefault();
        
        // 延迟处理，确保状态稳定
        setTimeout(() => {
          this.startRename(this.selectedItemPath);
        }, 50);
      }
    });
  }

  // 初始化拖拽调整功能
  initResizer() {
    const fileTreeContainer = document.getElementById('file-tree-container');
    const resizer = document.getElementById('file-tree-resizer');
    const resourceTitle = document.getElementById('resource-title');
    
    let startX, startWidth;
    
    // 根据容器宽度更新标题
    const updateResourceTitle = (width) => {
      // 始终显示完整的"资源管理器"
      resourceTitle.textContent = '资源管理器';
    };
    
    const startResize = (e) => {
      startX = e.clientX;
      startWidth = parseInt(document.defaultView.getComputedStyle(fileTreeContainer).width, 10);
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    };
    
    const resize = (e) => {
      const newWidth = startWidth + (e.clientX - startX);
      // 限制最小和最大宽度，确保能显示完整的"资源管理器"
      if (newWidth >= 180 && newWidth <= 500) {
        fileTreeContainer.style.width = `${newWidth}px`;
        updateResourceTitle(newWidth);
      }
    };
    
    const stopResize = () => {
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    resizer.addEventListener('mousedown', startResize);
  }

  // 新建文件夹功能
  async createFolder() {
    try {
      const { container, parentPath } = await this.resolveCreationTarget();
      if (!container || !parentPath) {
        showAlert('无法确定目标目录，请重试', 'error');
        return;
      }
      this.createInlineInput(container, parentPath, true);
    } catch (error) {
      console.error('准备创建文件夹失败:', error);
      showAlert(error.message || '无法创建文件夹', 'error');
    }
  }

  async createFile() {
    try {
      const { container, parentPath } = await this.resolveCreationTarget();
      if (!container || !parentPath) {
        showAlert('无法确定目标目录，请重试', 'error');
        return;
      }
      this.createInlineInput(container, parentPath, false);
    } catch (error) {
      console.error('准备创建文件失败:', error);
      showAlert(error.message || '无法创建文件', 'error');
    }
  }

  async resolveCreationTarget() {
    const ensureVisibleContainer = (el) => {
      if (el && !el.parentElement) {
        document.body.appendChild(el);
      }
    };

    const selectedPath = this.selectedItemPath;
    if (selectedPath) {
      const selectedElement = findElementByPath(selectedPath);
      if (!selectedElement) {
        await this.loadFileTree();
        const refreshedElement = findElementByPath(selectedPath);
        if (!refreshedElement) {
          throw new Error('无法定位选中的目录');
        }
        return this.resolveCreationTarget();
      }

      if (selectedElement.classList.contains('folder-item')) {
        let childContainer = selectedElement.nextElementSibling;
        if (!childContainer || !childContainer.dataset.parent) {
          childContainer = document.createElement('div');
          childContainer.dataset.parent = selectedPath;
          childContainer.style.display = 'block';
          selectedElement.parentElement.insertBefore(childContainer, selectedElement.nextSibling);
        } else {
          this.expandedFolders.add(selectedPath);
          childContainer.style.display = 'block';
          const arrow = selectedElement.querySelector('.folder-arrow');
          if (arrow) {
            arrow.style.transform = 'rotate(90deg)';
          }
          const folderIcon = selectedElement.querySelector('.folder-icon, .file-icon-wrapper');
          if (folderIcon) {
            folderIcon.innerHTML = getFileTreeIcon(selectedElement.textContent.trim(), true, true);
          }
        }
        ensureVisibleContainer(childContainer);
        return { container: childContainer, parentPath: selectedPath };
      }

      const parentContainer = selectedElement.parentElement;
      const filePath = selectedPath;
      const lastSlashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      const parentPath = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : parentContainer?.dataset.parent;
      if (!parentPath) {
        throw new Error('无法解析父目录');
      }
      ensureVisibleContainer(parentContainer);
      return { container: parentContainer, parentPath };
    }

    const tree = await window.fsAPI.getFileTree();
    if (!tree || !tree.path) {
      throw new Error('未能获取根目录');
    }
    ensureVisibleContainer(this.fileTreeEl);
    return { container: this.fileTreeEl, parentPath: tree.path };
  }

  // 创建内联输入框
  createInlineInput(container, parentPath, isFolder = false) {
    // 检查是否已经存在输入框，如果存在则移除
    const existingInput = container.querySelector('.inline-input-container');
    if (existingInput) {
      existingInput.remove();
    }
    
    // 计算当前层级深度
    let depth = 0;
    if (container.dataset.parent) {
      // 如果是子容器，需要计算父级深度
      const parentElement = findElementByPath(container.dataset.parent);
      if (parentElement) {
        const parentPadding = parentElement.style.paddingLeft || '0px';
        depth = parseInt(parentPadding) / 12 + 1;
      }
    }
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-input';
    
    // 根据当前主题设置样式
    const isDark = document.body.classList.contains('dark-theme');
    const backgroundColor = isDark ? '#1e1e1e' : '#ffffff';
    const textColor = isDark ? '#cccccc' : '#333333';
    const borderColor = isDark ? '#007acc' : '#0078d4';
    
    input.style.cssText = `
      border: 1px solid ${borderColor};
      background: ${backgroundColor};
      color: ${textColor};
      padding: 2px 4px;
      font-size: 11px;
      outline: none;
      width: 120px;
      border-radius: 2px;
    `;
    
    const inputContainer = document.createElement('div');
    inputContainer.className = 'inline-input-container file-item';
    inputContainer.style.paddingLeft = (depth * 12) + 'px';
    inputContainer.style.display = 'flex';
    inputContainer.style.alignItems = 'center';
    inputContainer.style.gap = '3px';
    
    // 创建内容容器
    const contentDiv = document.createElement('div');
    contentDiv.style.display = 'flex';
    contentDiv.style.alignItems = 'center';
    contentDiv.style.gap = '4px';
    
    if (isFolder) {
      // 添加文件夹图标
      const folderIcon = document.createElement('span');
      folderIcon.innerHTML = getFileTreeIcon('', true);
      folderIcon.style.display = 'flex';
      folderIcon.style.alignItems = 'center';
      folderIcon.style.fontSize = '10px';
      folderIcon.style.width = '13px';
      folderIcon.style.height = '13px';
      contentDiv.appendChild(folderIcon);
    } else {
      // 添加文件图标
      const fileIcon = document.createElement('span');
      fileIcon.innerHTML = getFileTreeIcon('', false);
      fileIcon.style.display = 'flex';
      fileIcon.style.alignItems = 'center';
      fileIcon.style.fontSize = '10px';
      fileIcon.style.width = '12px';
      fileIcon.style.height = '12px';
      contentDiv.appendChild(fileIcon);
    }
    
    contentDiv.appendChild(input);
    inputContainer.appendChild(contentDiv);
    
    // 插入前：如果存在空占位框，移除之，并将输入框置顶
    const rootTree = document.getElementById('file-tree');
    if (rootTree) {
      const ph = rootTree.querySelector('.file-tree-empty-placeholder');
      if (ph) ph.remove();
    }
    // 插入到容器顶部
    if (container.firstChild) {
      container.insertBefore(inputContainer, container.firstChild);
    } else {
      container.appendChild(inputContainer);
    }
    
    // 自动聚焦
    input.focus();
    
    // 处理输入完成
    let isCompleting = false;
    const restorePlaceholderIfEmpty = () => {
      const rootTree = document.getElementById('file-tree');
      if (!rootTree) return;
      const hasItems = rootTree.querySelector('.file-item');
      if (!hasItems) {
        const ph = document.createElement('div');
        ph.className = 'file-tree-empty-placeholder';
        ph.textContent = '你可以新建或导入文件📃';
        ph.style.cursor = 'pointer';
        ph.setAttribute('role', 'button');
        ph.tabIndex = 0;
        ph.style.marginTop = '-5px';
        const handleImport = () => this.importFiles();
        ph.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handleImport(); });
        ph.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleImport(); }
        });
        rootTree.appendChild(ph);
      }
    };
    const handleComplete = async () => {
      if (isCompleting) return; // 防止重复执行
      isCompleting = true;
      
      const name = input.value.trim();
      if (name) {
        try {
          if (isFolder) {
            await window.fsAPI.createFolder(parentPath, name);
          } else {
            await window.fsAPI.createFile(parentPath, name);
          }
          await this.loadFileTree();
        } catch (error) {
          console.error('创建失败:', error);
          showAlert(`创建失败: ${error.message}`, 'error');
        }
      }
      inputContainer.remove();
      if (!name) restorePlaceholderIfEmpty();
    };
    
    // 回车确认
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.removeEventListener('blur', handleComplete); // 移除blur监听器
        handleComplete();
      } else if (e.key === 'Escape') {
        inputContainer.remove();
        restorePlaceholderIfEmpty();
      }
    });
    
    // 失去焦点确认
    input.addEventListener('blur', handleComplete);
  }

  // 刷新文件树
  async refreshFileTree() {
    await this.loadFileTree();
  }

  // 加载文件树
  async loadFileTree() {
    const fileTreeModule = window.RendererModules && window.RendererModules.fileTree;
    if (fileTreeModule && typeof fileTreeModule.loadFileTree === 'function') {
      await fileTreeModule.loadFileTree();
      return;
    }
    try {
      const tree = await window.fsAPI.getFileTree();
      window.fileTreeData = tree;
      this.fileTreeEl.innerHTML = '';
      if (tree && tree.children) {
        tree.children.forEach(child => renderTree(child, this.fileTreeEl, false, 0));
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'file-tree-empty-placeholder';
        placeholder.textContent = '你可以新建或导入文件📃';
        this.fileTreeEl.appendChild(placeholder);
      }
      const rootContainer = document.getElementById('file-tree');
      if (rootContainer) {
        rootContainer.dataset.parentRelative = 'data';
      }
      if (window.updateFolderUploadStatus) {
        try {
          if (typeof window.refreshVisibleFolderUploadStatus === 'function') {
            await window.refreshVisibleFolderUploadStatus();
          } else {
            await window.updateFolderUploadStatus('data');
          }
        } catch (statusError) {
          console.warn('刷新上传状态失败:', statusError);
        }
      }
    } catch (error) {
      console.error('加载文件树失败:', error);
      this.fileTreeEl.innerHTML = '<div style="padding: 10px; color: #ff6b6b;">加载失败</div>';
    }
  }

  // 导入文件功能
  async importFiles() {
    try {
      // 在打开选择器之前锁定当前选中路径，防止根容器点击清空
      let selectedPath;
      const domSelectedBefore = document.querySelector('.selected[data-path]');
      if (domSelectedBefore && domSelectedBefore.dataset && domSelectedBefore.dataset.path) {
        selectedPath = domSelectedBefore.dataset.path;
        // 同步到模块状态，保证下一次取值一致
        this.setSelectedItemPath(selectedPath);
      } else if (this.selectedItemPath) {
        selectedPath = this.selectedItemPath;
      }

      const result = await window.fsAPI.selectFiles();
      if (result && result.success && result.filePaths && result.filePaths.length > 0) {
        // 预判选择项类型（文件/文件夹）
        let hasDirectory = false;
        try {
          const infos = await Promise.all(result.filePaths.map(p => window.fsAPI.getFileInfo(p)));
          hasDirectory = infos.some(res => res && res.success && res.info && res.info.isDirectory);
        } catch (e) {
          console.warn('获取选择项类型失败:', e);
        }

        // 目标路径：优先使用之前锁定的选中路径（仅限文件夹），否则回退根目录
        let targetPath;
        if (selectedPath && this.isSelectedItemFolder(selectedPath)) {
          // 只有选中的是文件夹时，导入到该文件夹
          targetPath = selectedPath;
        } else {
          // 选中的是文件或没有选中项，导入到根目录
          const tree = await window.fsAPI.getFileTree();
          targetPath = tree.path;
        }
        
        // 导入文件到目标路径
        try {
          const importResult = await window.fsAPI.importFiles(targetPath, result.filePaths);
          if (!importResult.success) {
            showAlert(`导入失败: ${importResult.error}`, 'error');
            return;
          }
          
          // 显示导入结果
          const successCount = importResult.results.filter(r => r.success).length;
          const failCount = importResult.results.filter(r => !r.success).length;
          
          // 检查是否所有失败都是因为选择了data目录下的文件
          const dataDirectoryErrors = importResult.results.filter(r => 
            !r.success && r.error && r.error.includes('不能导入系统数据目录下的文件')
          );
          
          if (failCount > 0 && dataDirectoryErrors.length === failCount && successCount === 0) {
            // 如果所有文件都是因为在data目录下而被拒绝，显示简单提示
            showAlert('无法导入该文件夹，不能导入系统数据目录下的文件', 'warning');
          } else {
            // 成功提示仅在包含文件夹时显示；文件导入只提示失败
            if (hasDirectory) {
              let message = `成功导入 ${successCount} 个文件/文件夹`;
              if (failCount > 0) {
                message += `，失败 ${failCount} 个`;
              }
              showAlert(message, failCount > 0 ? 'warning' : 'success');
            } else if (failCount > 0) {
              showAlert(`导入失败 ${failCount} 个文件`, 'error');
            }
          }

          // 刷新文件树显示导入结果
          await this.refreshFileTree();
        } catch (importError) {
          console.error('导入过程出错:', importError);
          showAlert('导入过程出错', 'error');
        }
      }
    } catch (error) {
      console.error('选择文件出错:', error);
      showAlert('选择文件出错', 'error');
    }
  }

  // 判断选中项是否为文件夹
  isSelectedItemFolder(itemPath) {
    const selectedElement = findElementByPath(itemPath);
    return selectedElement && selectedElement.classList.contains('folder-item');
  }

  // 开始重命名
  startRename(itemPath = null) {
    // 如果已经在重命名状态，直接返回
    if (this.isRenaming) {
      return;
    }
    
    const targetPath = itemPath || this.selectedItemPath;
    if (!targetPath) {
      console.warn('没有选中的文件或文件夹');
      return;
    }
    
    const element = findElementByPath(targetPath);
    if (!element) return;
    
    // 设置重命名状态
    this.isRenaming = true;
    
    const isFolder = element.classList.contains('folder-item');
    // 仅提取纯文件名文本，避免包含文件夹箭头或图标字符串
    const nameEl = element.querySelector('.file-name-text');
    const currentName = nameEl ? nameEl.textContent.trim() : element.textContent.trim();
    
    this.createRenameInput(element, targetPath, currentName, isFolder);
  }

  // 创建重命名输入框
  createRenameInput(element, itemPath, currentName, isFolder) {
    // 调用全局的 createRenameInput 函数
    if (typeof window.createRenameInput === 'function') {
      window.createRenameInput(element, itemPath, currentName, isFolder);
    } else {
      console.error('createRenameInput 函数未找到');
      showAlert('重命名功能初始化失败', 'error');
    }
  }

  // 提交重命名并同步UI
  async applyRename(itemPath, newName, isFolder) {
    try {
      const parentDir = itemPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const newPath = parentDir ? `${parentDir}/${newName}` : newName;

      const result = await window.fsAPI.renameItem(itemPath, newName);
      if (!result || result.success !== true) {
        const errorMsg = (result && result.error) ? result.error : '重命名失败';
        showAlert(errorMsg, 'error');
        this.isRenaming = false;
        return;
      }

      // 刷新文件树
      await this.loadFileTree();

      // 更新选中项路径为新路径
      this.setSelectedItemPath(newPath);

      // 同步标签页：更新打开文件的标题或路径
      if (this.fileViewer && this.fileViewer.tabManager) {
        // 如果是文件，尝试更新对应tab标题与路径
        const tabManager = this.fileViewer.tabManager;
        const allTabs = tabManager.getAllTabs();
        allTabs.forEach(tab => {
          if (!tab.filePath) return;
          const oldPathNorm = tab.filePath.replace(/\\/g, '/');
          const isSameFile = oldPathNorm === itemPath.replace(/\\/g, '/');
          if (isSameFile) {
            // 更新tab内部记录的文件名
            const newTitle = newName;
            tabManager.updateTabTitle(tab.filePath, newTitle);
            // 由于tabId等于文件路径，重命名后无法简单变更id；关闭旧tab以避免状态错乱
            tabManager.closeTabByFilePath(itemPath);
          }
        });
      }

      // 如果是重命名文件夹，关闭该文件夹内所有打开的文件tab
      if (isFolder) {
        this.closeTabsInFolder(itemPath);
      }
      this.isRenaming = false;
    } catch (error) {
      console.error('重命名失败:', error);
      showAlert(`重命名失败: ${error.message}`, 'error');
      this.isRenaming = false;
    }
  }

  // 重命名流程结束时的清理（在未实际提交变更或取消时也应调用）
  onRenameFinished() {
    this.isRenaming = false;
  }

  // 删除项目（公开接口）
  async deleteItem(itemPath) {
    const targetPath = itemPath || this.selectedItemPath;
    if (!targetPath) {
      console.warn('没有提供要删除的项目路径');
      showAlert('请先选择要删除的文件或文件夹', 'warning');
      return;
    }

    const isFolder = this.isSelectedItemFolder(targetPath);
    try {
      await this.performDeletion(targetPath, isFolder);
    } catch (error) {
      console.error('删除失败:', error);
      const content = `删除失败: ${error.message}`;
      if (typeof window.showAlert === 'function') {
        window.showAlert(content, 'error');
      } else {
        console.error(content);
      }
    }
  }

  async performDeletion(itemPath, isFolder) {
    if (!itemPath) {
      return;
    }

    const executeDeletion = async () => {
      await window.fsAPI.deleteItem(itemPath);
      if (isFolder) {
        this.closeTabsInFolder(itemPath);
      } else if (this.fileViewer) {
        this.fileViewer.closeTabByFilePath(itemPath);
      }
      this.selectedItemPath = null;
      await this.loadFileTree();
    };

    if (!isFolder) {
      try {
        await executeDeletion();
      } catch (error) {
        console.error('删除失败:', error);
        if (typeof window.showAlert === 'function') {
          window.showAlert(`删除失败: ${error.message}`, 'error');
        } else {
          console.error('删除失败:', error.message);
        }
        throw error;
      }
      return;
    }

    const confirmDeletion = async () => {
      try {
        await executeDeletion();
      } catch (error) {
        console.error('删除失败:', error);
        if (typeof window.showAlert === 'function') {
          window.showAlert(`删除失败: ${error.message}`, 'error');
        } else {
          console.error('删除失败:', error.message);
        }
        throw error;
      }
    };

    if (typeof window.showModal === 'function') {
      window.showModal({
        type: 'warning',
        title: '确认删除',
        message: '是否确认删除该文件夹及其所有内容？',
        confirmText: '删除',
        cancelText: '取消',
        showCancel: true,
        onConfirm: () => {
          confirmDeletion().catch((error) => console.error('删除失败:', error));
        }
      });
      return;
    }

    const confirmed = window.confirm('是否确认删除该文件夹及其所有内容？');
    if (confirmed) {
      await confirmDeletion();
    }
  }

  // 创建删除确认弹窗（兼容旧调用，直接执行删除）
  createDeleteModal(itemPath, isFolder) {
    this.performDeletion(itemPath, isFolder).catch((error) => {
      console.error('删除失败:', error);
    });
  }

  // 获取选中项路径
  getSelectedItemPath() {
    return this.selectedItemPath;
  }

  // 设置选中项路径
  setSelectedItemPath(path) {
    this.selectedItemPath = path;
    window.selectedItemPath = path; // 同步全局变量
  }

  // 获取展开的文件夹集合
  getExpandedFolders() {
    return this.expandedFolders;
  }

  // 获取文件查看器实例
  getFileViewer() {
    return this.fileViewer;
  }

  // 关闭文件夹内所有打开的文件tab
  closeTabsInFolder(folderPath) {
    if (!this.fileViewer || !this.fileViewer.tabManager) {
      return;
    }

    // 获取所有打开的tab
    const allTabs = this.fileViewer.tabManager.getAllTabs();
    
    // 遍历所有tab，找到在被删除文件夹内的文件
    allTabs.forEach(tab => {
      if (tab.filePath && this.isFileInFolder(tab.filePath, folderPath)) {
        this.fileViewer.closeTabByFilePath(tab.filePath);
      }
    });
  }

  // 检查文件是否在指定文件夹内
  isFileInFolder(filePath, folderPath) {
    // 标准化路径分隔符
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    const normalizedFolderPath = folderPath.replace(/\\/g, '/');
    
    // 确保文件夹路径以/结尾
    const folderPathWithSlash = normalizedFolderPath.endsWith('/') ? 
      normalizedFolderPath : normalizedFolderPath + '/';
    
    // 检查文件路径是否以文件夹路径开头
    return normalizedFilePath.startsWith(folderPathWithSlash);
  }
}
