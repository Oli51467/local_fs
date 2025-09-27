/**
 * 资源管理器模块
 * 负责管理文件树上方的banner区域和五个按钮的功能
 */
class ExplorerModule {
  constructor() {
    this.selectedItemPath = null;
    this.expandedFolders = new Set();
    this.fileTreeEl = document.getElementById('file-tree');
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
        alert('请先选择要删除的文件或文件夹');
        return;
      }
      
      // 通过文件树数据判断是文件还是文件夹
      const isFolder = this.isSelectedItemFolder(this.selectedItemPath);
      this.createDeleteModal(this.selectedItemPath, isFolder);
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
        // 检查当前焦点是否在文本编辑区域
        const activeElement = document.activeElement;
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
  createFolder() {
    let targetPath = this.selectedItemPath;
    let targetContainer;
    
    if (this.selectedItemPath) {
      // 在选中的文件夹下创建
      const selectedElement = document.querySelector(`[data-path="${this.selectedItemPath}"]`);
      if (selectedElement && selectedElement.classList.contains('folder-item')) {
        // 确保文件夹的子容器存在
        let childContainer = selectedElement.nextElementSibling;
        if (!childContainer || !childContainer.dataset.parent) {
          childContainer = document.createElement('div');
          childContainer.dataset.parent = this.selectedItemPath;
          childContainer.style.display = 'block';
          selectedElement.parentElement.insertBefore(childContainer, selectedElement.nextSibling);
        } else {
          // 如果子容器存在但被收起，则展开它
          this.expandedFolders.add(this.selectedItemPath);
          childContainer.style.display = 'block';
          const arrow = selectedElement.querySelector('.folder-arrow');
          if (arrow) {
            arrow.style.transform = 'rotate(90deg)';
          }
          const folderIcon = selectedElement.querySelector('.folder-icon');
          if (folderIcon) {
            const folderName = selectedElement.textContent.trim();
            folderIcon.innerHTML = getFileIcon(folderName, true, true);
          }
        }
        targetContainer = childContainer;
      } else {
        // 如果选中的是文件，在其父目录创建
        const parentContainer = selectedElement.parentElement;
        targetContainer = parentContainer;
        // 获取文件的父目录路径
        const filePath = this.selectedItemPath;
        const lastSlashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        targetPath = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : parentContainer.dataset.parent;
      }
    } else {
      // 在data目录下创建（资源管理器最下方）
      targetContainer = this.fileTreeEl;
      // 获取data目录路径
      window.fsAPI.getFileTree().then(tree => {
        targetPath = tree.path;
        // 确保容器存在且可见
        if (!targetContainer.parentElement) {
          document.body.appendChild(targetContainer);
        }
        this.createInlineInput(targetContainer, targetPath, true);
      });
      return;
    }
    
    this.createInlineInput(targetContainer, targetPath, true);
  }

  // 新建文件功能
  createFile() {
    let targetPath = this.selectedItemPath;
    let targetContainer;
    
    if (this.selectedItemPath) {
      // 在选中的文件夹下创建
      const selectedElement = document.querySelector(`[data-path="${this.selectedItemPath}"]`);
      if (selectedElement && selectedElement.classList.contains('folder-item')) {
        // 确保文件夹的子容器存在
        let childContainer = selectedElement.nextElementSibling;
        if (!childContainer || !childContainer.dataset.parent) {
          childContainer = document.createElement('div');
          childContainer.dataset.parent = this.selectedItemPath;
          childContainer.style.display = 'block';
          selectedElement.parentElement.insertBefore(childContainer, selectedElement.nextSibling);
        } else {
          // 如果子容器存在但被收起，则展开它
          this.expandedFolders.add(this.selectedItemPath);
          childContainer.style.display = 'block';
          const arrow = selectedElement.querySelector('.folder-arrow');
          if (arrow) {
            arrow.style.transform = 'rotate(90deg)';
          }
          const folderIcon = selectedElement.querySelector('.folder-icon');
          if (folderIcon) {
            const folderName = selectedElement.textContent.trim();
            folderIcon.innerHTML = getFileIcon(folderName, true, true);
          }
        }
        targetContainer = childContainer;
      } else {
        // 如果选中的是文件，在其父目录创建
        const parentContainer = selectedElement.parentElement;
        targetContainer = parentContainer;
        // 获取文件的父目录路径
        const filePath = this.selectedItemPath;
        // 使用字符串操作获取父目录路径，避免require问题
        const lastSlashIndex = filePath.lastIndexOf('/');
        targetPath = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : filePath;
      }
    } else {
      // 在data目录下创建（资源管理器最下方）
      targetContainer = this.fileTreeEl;
      // 获取data目录路径
      window.fsAPI.getFileTree().then(tree => {
        targetPath = tree.path;
        // 确保容器存在且可见
        if (!targetContainer.parentElement) {
          document.body.appendChild(targetContainer);
        }
        this.createInlineInput(targetContainer, targetPath, false);
      });
      return;
    }
    
    this.createInlineInput(targetContainer, targetPath, false);
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
      const parentElement = document.querySelector(`[data-path="${container.dataset.parent}"]`);
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
      // 添加箭头图标（文件夹）
      const arrow = document.createElement('span');
      arrow.textContent = '▶';
      arrow.style.fontSize = '8px';
      arrow.style.color = '#888';
      contentDiv.appendChild(arrow);
      
      // 添加文件夹图标
      const folderIcon = document.createElement('span');
      folderIcon.innerHTML = getFileIcon('', true);
      folderIcon.style.display = 'flex';
      folderIcon.style.alignItems = 'center';
      folderIcon.style.fontSize = '10px';
      folderIcon.style.width = '13px';
      folderIcon.style.height = '13px';
      contentDiv.appendChild(folderIcon);
    } else {
      // 添加文件图标
      const fileIcon = document.createElement('span');
      fileIcon.innerHTML = getFileIcon('', false);
      fileIcon.style.display = 'flex';
      fileIcon.style.alignItems = 'center';
      fileIcon.style.fontSize = '10px';
      fileIcon.style.width = '12px';
      fileIcon.style.height = '12px';
      fileIcon.style.marginLeft = '11px'; // 与文件夹箭头对齐
      contentDiv.appendChild(fileIcon);
    }
    
    contentDiv.appendChild(input);
    inputContainer.appendChild(contentDiv);
    
    // 插入到容器中
    container.appendChild(inputContainer);
    
    // 自动聚焦
    input.focus();
    
    // 处理输入完成
    let isCompleting = false;
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
    };
    
    // 回车确认
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.removeEventListener('blur', handleComplete); // 移除blur监听器
        handleComplete();
      } else if (e.key === 'Escape') {
        inputContainer.remove();
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
    try {
      const tree = await window.fsAPI.getFileTree();
      window.fileTreeData = tree;
      this.fileTreeEl.innerHTML = '';
      if (tree && tree.children) {
        tree.children.forEach(child => renderTree(child, this.fileTreeEl, false, 0));
      }
      const rootContainer = document.getElementById('file-tree');
      if (rootContainer) {
        rootContainer.dataset.parentRelative = 'data';
      }
      if (window.updateFolderUploadStatus) {
        await window.updateFolderUploadStatus('data');
      }
    } catch (error) {
      console.error('加载文件树失败:', error);
      this.fileTreeEl.innerHTML = '<div style="padding: 10px; color: #ff6b6b;">加载失败</div>';
    }
  }

  // 导入文件功能
  async importFiles() {
    try {
      const result = await window.fsAPI.selectFiles();
      if (result && result.success && result.filePaths && result.filePaths.length > 0) {
        // 确定目标路径
        let targetPath;
        if (this.selectedItemPath) {
          const selectedElement = document.querySelector(`[data-path="${this.selectedItemPath}"]`);
          if (selectedElement && selectedElement.classList.contains('folder-item')) {
            targetPath = this.selectedItemPath;
          } else {
            // 如果选中的是文件，获取其父目录路径
            const filePath = this.selectedItemPath;
            const lastSlashIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
            if (lastSlashIndex > 0) {
              targetPath = filePath.substring(0, lastSlashIndex);
            } else {
              // 如果文件在根目录，获取根目录路径
              const tree = await window.fsAPI.getFileTree();
              targetPath = tree.path;
            }
          }
        } else {
          // 如果没有选中项，导入到根目录
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
            // 否则显示详细统计
            let message = `成功导入 ${successCount} 个文件`;
            if (failCount > 0) {
              message += `，失败 ${failCount} 个`;
            }
            showAlert(message, 'info');
          }
        } catch (error) {
          console.error('导入文件失败:', error);
          showAlert(`导入文件失败: ${error.message}`, 'error');
          return;
        }
        
        // 刷新文件树
        await this.loadFileTree();
      }
    } catch (error) {
      console.error('导入文件失败:', error);
      showAlert(`导入文件失败: ${error.message}`, 'error');
    }
  }

  // 判断选中项是否为文件夹
  isSelectedItemFolder(itemPath) {
    const selectedElement = document.querySelector(`[data-path="${itemPath}"]`);
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
    
    const element = document.querySelector(`[data-path="${targetPath}"]`);
    if (!element) return;
    
    // 设置重命名状态
    this.isRenaming = true;
    
    const isFolder = element.classList.contains('folder-item');
    const currentName = element.textContent.trim();
    
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

  // 删除项目（公开接口）
  deleteItem(itemPath) {
    if (!itemPath) {
      console.warn('没有提供要删除的项目路径');
      showAlert('请先选择要删除的文件或文件夹', 'warning');
      return;
    }
    
    const isFolder = itemPath.includes('.') ? false : true; // 简单判断是否为文件夹
    this.createDeleteModal(itemPath, isFolder);
  }

  // 创建删除确认弹窗
  createDeleteModal(itemPath, isFolder) {
    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // 创建弹窗
    const modal = document.createElement('div');
    modal.style.cssText = `
      background-color: var(--bg-color);
      border-radius: 8px;
      padding: 20px;
      min-width: 300px;
      max-width: 500px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      color: var(--text-color);
    `;
    
    // 标题
    const title = document.createElement('h3');
    title.textContent = '确认删除';
    title.style.cssText = `
      margin: 0 0 15px 0;
      font-size: 16px;
      font-weight: bold;
    `;
    
    // 消息内容
    const message = document.createElement('p');
    const itemName = itemPath.split('/').pop() || itemPath.split('\\').pop();
    if (isFolder) {
      message.textContent = `是否确认删除该文件夹及该文件夹下的所有文件？\n\n文件夹名称：${itemName}`;
    } else {
      message.textContent = `是否确认删除文件？\n\n文件名称：${itemName}`;
    }
    message.style.cssText = `
      margin: 0 0 20px 0;
      line-height: 1.5;
      white-space: pre-line;
    `;
    
    // 按钮容器
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    `;
    
    // 取消按钮
    const cancelButton = document.createElement('button');
    cancelButton.textContent = '取消';
    cancelButton.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--tree-border);
      background: var(--bg-color);
      color: var(--text-color);
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    
    // 确认按钮
    const confirmButton = document.createElement('button');
    confirmButton.textContent = '删除';
    confirmButton.style.cssText = `
      padding: 8px 16px;
      border: none;
      background: #dc3545;
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    
    // 按钮事件
    cancelButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    confirmButton.addEventListener('click', async () => {
      try {
        if (isFolder) {
          await window.fsAPI.deleteItem(itemPath);
          // 对于文件夹，需要关闭文件夹内所有打开的文件tab
          this.closeTabsInFolder(itemPath);
        } else {
          await window.fsAPI.deleteItem(itemPath);
          // 对于单个文件，关闭对应的tab
          if (this.fileViewer) {
            this.fileViewer.closeTabByFilePath(itemPath);
          }
        }
        
        // 清除选中状态
        this.selectedItemPath = null;
        
        // 刷新文件树
        await this.loadFileTree();
        
        // 关闭弹窗
        document.body.removeChild(overlay);
      } catch (error) {
        console.error('删除失败:', error);
        showAlert(`删除失败: ${error.message}`, 'error');
      }
    });
    
    // 组装弹窗
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(confirmButton);
    modal.appendChild(title);
    modal.appendChild(message);
    modal.appendChild(buttonContainer);
    overlay.appendChild(modal);
    
    // 显示弹窗
    document.body.appendChild(overlay);
    
    // 点击遮罩层关闭弹窗
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
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
