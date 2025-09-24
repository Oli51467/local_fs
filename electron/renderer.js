const fileTreeEl = document.getElementById('file-tree');
const fileContentEl = document.getElementById('file-content');
// 设置相关元素已移至设置模块管理

// 初始化文件查看器
let fileViewer = null;

// initFileViewer 函数已移至 ExplorerModule

// 渲染SVG图标
function renderIcons() {
  document.getElementById('file-icon').innerHTML = icons.file;
  document.getElementById('search-icon').innerHTML = icons.search;
  document.getElementById('settings-icon').innerHTML = icons.settings;
  document.getElementById('test-icon').innerHTML = icons.test;
  document.getElementById('database-icon').innerHTML = icons.database;
  // 资源管理器相关图标渲染已移至资源管理器模块
}

// 主题设置
// 拖拽相关CSS样式
const dragStyles = `
  .file-item.drag-over {
    border: 1px dashed #007acc;
    background-color: transparent !important;
  }
  .file-item.drag-over-folder {
    border: 1px solid #007acc;
    background-color: rgba(0, 122, 204, 0.1) !important;
  }
  #file-tree.drag-over-root {
    background-color: rgba(0, 122, 204, 0.05) !important;
    border: 2px dashed #007acc !important;
  }
`;

// 添加拖拽样式到页面
const styleSheet = document.createElement('style');
styleSheet.textContent = dragStyles;
document.head.appendChild(styleSheet);

// 初始化设置模块、资源管理器模块、测试模块、数据库模块和事件绑定
let settingsModule;
let explorerModule;
let testModule;
let databaseModule;
let splashScreen;

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化启动页面
  splashScreen = new SplashScreen();
  
  // 监听应用准备就绪事件
  document.addEventListener('appReady', async () => {
    // 渲染侧边栏图标
    renderIcons();
    
    settingsModule = new SettingsModule();
    await settingsModule.init();
    
    databaseModule = new DatabaseModule();
    
    // 默认显示文件页面
    settingsModule.showFilePage();
    
    explorerModule = new ExplorerModule();
    
    // 初始化测试模块
    testModule = new TestModule();
    await testModule.init();
    
    // 获取ExplorerModule中的fileViewer实例
    fileViewer = explorerModule.getFileViewer();
    console.log('FileViewer初始化状态:', fileViewer ? '成功' : '失败');
    
    // 绑定剩余的事件监听器
    bindEventListeners();
    
    // 监听数据更新事件，刷新文件上传状态
    document.addEventListener('dataUpdated', async (event) => {
      console.log('接收到数据更新事件:', event.detail);
      
      // 刷新文件树中的上传状态标记
      if (databaseModule && databaseModule.refreshUploadStatus) {
        await databaseModule.refreshUploadStatus();
      }
      
      // 如果当前显示的是数据库页面，也刷新数据库相关内容
      if (document.getElementById('database-page').style.display === 'block') {
        if (event.detail.type === 'sqlite' || event.detail.type === 'all') {
          // 刷新SQLite数据
          if (databaseModule && databaseModule.getAllTables) {
            setTimeout(() => databaseModule.getAllTables(), 500);
          }
        }
        if (event.detail.type === 'faiss' || event.detail.type === 'all') {
          // 刷新Faiss统计信息
          if (databaseModule && databaseModule.getFaissStatistics) {
            setTimeout(() => databaseModule.getFaissStatistics(), 500);
          }
        }
      }
    });
  });
});

// 当前选中的文件或文件夹路径
let selectedItemPath = null;
let expandedFolders = new Set(); // 记录展开的文件夹路径

// 拖拽相关变量
let draggedElement = null;
let draggedPath = null;
let dropIndicator = null;

// 添加拖拽和放置支持
function addDragAndDropSupport(element, node, isFolder) {
  // 设置元素可拖拽
  element.draggable = true;
  
  // 拖拽开始事件
  element.addEventListener('dragstart', (e) => {
    draggedElement = element;
    draggedPath = node.path;
    element.style.opacity = '0.5';
    
    // 设置拖拽数据
    e.dataTransfer.setData('text/plain', node.path);
    e.dataTransfer.effectAllowed = 'move';
    
    // 创建拖拽指示器
    if (!dropIndicator) {
      dropIndicator = document.createElement('div');
      dropIndicator.style.cssText = `
        position: absolute;
        height: 2px;
        background-color: #007acc;
        border-radius: 1px;
        pointer-events: none;
        z-index: 1000;
        display: none;
      `;
      document.body.appendChild(dropIndicator);
    }
  });
  
  // 拖拽结束事件
  element.addEventListener('dragend', (e) => {
    element.style.opacity = '1';
    draggedElement = null;
    draggedPath = null;
    
    // 清理所有拖拽样式
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('drag-over', 'drag-over-folder');
    });
    
    // 清理文件树容器的根目录拖拽样式
    if (fileTreeEl) {
      fileTreeEl.classList.remove('drag-over-root');
    }
    
    // 隐藏拖拽指示器
    if (dropIndicator) {
      dropIndicator.style.display = 'none';
    }
  });
  
  // 拖拽进入事件
  element.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (draggedElement && draggedElement !== element) {
      if (isFolder) {
        element.classList.add('drag-over-folder');
      } else {
        element.classList.add('drag-over');
      }
    }
  });
  
  // 拖拽悬停事件
  element.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedElement && draggedElement !== element && dropIndicator) {
      const rect = element.getBoundingClientRect();
      const mouseY = e.clientY;
      const elementMiddle = rect.top + rect.height / 2;
      
      if (isFolder) {
        // 文件夹：显示整个文件夹高亮
        dropIndicator.style.display = 'none';
      } else {
        // 文件：根据鼠标位置显示插入线
        dropIndicator.style.display = 'block';
        dropIndicator.style.left = rect.left + 'px';
        dropIndicator.style.width = rect.width + 'px';
        
        if (mouseY < elementMiddle) {
          // 插入到文件上方（移动到文件的父目录）
          dropIndicator.style.top = rect.top - 1 + 'px';
        } else {
          // 插入到文件下方（移动到文件的父目录）
          dropIndicator.style.top = rect.bottom - 1 + 'px';
        }
      }
    }
  });
  
  // 拖拽离开事件
  element.addEventListener('dragleave', (e) => {
    // 只有当鼠标真正离开元素时才移除样式
    if (!element.contains(e.relatedTarget)) {
      element.classList.remove('drag-over', 'drag-over-folder');
    }
  });
  
  // 放置事件
  element.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 清理拖拽样式
    element.classList.remove('drag-over', 'drag-over-folder');
    
    if (draggedPath && draggedPath !== node.path) {
      let targetPath;
      
      if (isFolder) {
        // 放置到文件夹中
        targetPath = node.path;
      } else {
        // 放置到文件的父目录中
        targetPath = node.path.substring(0, node.path.lastIndexOf('/')) || node.path.substring(0, node.path.lastIndexOf('\\'));
      }
      
      try {
        const result = await window.fsAPI.moveItem(draggedPath, targetPath);
        if (result.success) {
          // 移动成功，刷新文件树
          await loadFileTree();
          // 选中移动后的文件
          selectedItemPath = result.newPath;
          if (explorerModule) {
            explorerModule.setSelectedItemPath(result.newPath);
          }
          
          // 检查数据库更新状态
          if (result.dbUpdateSuccess === false) {
            console.warn('数据库路径更新失败:', result.dbUpdateMessage);
            showAlert(`警告: 文件移动成功，但数据库路径更新失败。这可能影响搜索功能。\n错误: ${result.dbUpdateMessage}`, 'warning');
          }
        } else {
          showAlert(`移动失败: ${result.error}`, 'error');
        }
      } catch (error) {
        console.error('移动文件失败:', error);
        showAlert(`移动失败: ${error.message}`, 'error');
      }
    }
  });
}

// 获取文件图标
function getFileIcon(fileName, isFolder = false, isExpanded = false) {
  if (isFolder) {
    return isExpanded ? window.icons.folderOpen : window.icons.folder;
  }
  
  // 根据文件扩展名返回对应的图标
  const ext = fileName.toLowerCase().split('.').pop();
  
  switch (ext) {
    case 'txt':
      return '<img src="./dist/assets/txt.png" style="width: 13px; height: 13px;" />';
    case 'html':
    case 'htm':
      return '<img src="./dist/assets/html.png" style="width: 13px; height: 13px;" />';
    case 'md':
    case 'markdown':
      return '<img src="./dist/assets/markdown.png" style="width: 13px; height: 13px;" />';
    case 'pdf':
      return '<img src="./dist/assets/pdf.png" style="width: 13px; height: 13px;" />';
    case 'docx':
    case 'doc':
      return '<img src="./dist/assets/docx.png" style="width: 13px; height: 13px;" />';
    case 'pptx':
    case 'ppt':
      return '<img src="./dist/assets/ppt.png" style="width: 13px; height: 13px;" />';
    case 'json':
      return '<img src="./dist/assets/json.png" style="width: 13px; height: 13px;" />';
    default:
      // 其他文件类型使用默认文件图标
      return window.icons.file;
  }
}

// 创建右键菜单
function createContextMenu(x, y, itemPath, isFolder) {
  // 移除已存在的菜单
  const existingMenu = document.querySelector('.context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  
  // 重命名菜单项
  const renameItem = document.createElement('div');
  renameItem.className = 'context-menu-item';
  renameItem.innerHTML = `<span class="context-menu-icon">${window.icons.newFile}</span>重命名`;
  renameItem.addEventListener('click', () => {
    hideContextMenu();
    if (explorerModule) {
      explorerModule.startRename(itemPath);
    }
  });

  // 删除菜单项
  const deleteItem = document.createElement('div');
  deleteItem.className = 'context-menu-item';
  deleteItem.innerHTML = `<span class="context-menu-icon">${window.icons.trash}</span>删除`;
  deleteItem.addEventListener('click', () => {
    hideContextMenu();
    if (explorerModule) {
      explorerModule.deleteItem(itemPath);
    }
  });

  // 分隔线
  const separator = document.createElement('div');
  separator.className = 'context-menu-separator';

  // 上传菜单项（仅对文件显示）
  const uploadItem = document.createElement('div');
  uploadItem.className = 'context-menu-item';
  uploadItem.innerHTML = `<span class="context-menu-icon">${window.icons.import}</span>上传`;
  
  if (isFolder) {
    uploadItem.classList.add('disabled');
  } else {
    uploadItem.addEventListener('click', () => {
      hideContextMenu();
      uploadFile(itemPath);
    });
  }

  // 重新上传菜单项（仅对文件显示）
  const reuploadItem = document.createElement('div');
  reuploadItem.className = 'context-menu-item';
  reuploadItem.innerHTML = `<span class="context-menu-icon">${window.icons.import}</span>重新上传`;
  
  if (isFolder) {
    reuploadItem.classList.add('disabled');
  } else {
    reuploadItem.addEventListener('click', () => {
      hideContextMenu();
      reuploadFile(itemPath);
    });
  }

  // 取消挂载菜单项
  const unmountItem = document.createElement('div');
  unmountItem.className = 'context-menu-item';
  unmountItem.innerHTML = `<span class="context-menu-icon">${window.icons.trash}</span>取消挂载`;
  unmountItem.addEventListener('click', () => {
    hideContextMenu();
    unmountDocument(itemPath, isFolder);
  });
  
  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  menu.appendChild(unmountItem);
  menu.appendChild(separator);
  menu.appendChild(uploadItem);
  menu.appendChild(reuploadItem);
  
  document.body.appendChild(menu);
  
  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

// 取消挂载文档函数
async function unmountDocument(filePath, isFolder) {
  try {
    console.log('取消挂载文档路径:', filePath);
    
    // 确保使用相对路径，因为数据库存储的是相对路径格式
    let unmountPath = filePath;
    
    // 如果传入的是绝对路径，转换为相对路径
    if (filePath.startsWith('/')) {
      // 提取相对于项目根目录的路径
      const projectRoot = '/Users/dingjianan/Desktop/fs/';
      if (filePath.startsWith(projectRoot)) {
        unmountPath = filePath.substring(projectRoot.length);
      } else {
        // 如果路径不包含项目根目录，尝试查找data目录
        const dataIndex = filePath.indexOf('/data/');
        if (dataIndex !== -1) {
          unmountPath = filePath.substring(dataIndex + 1); // 包含data/
        } else {
          // 最后手段：使用文件名
          const parts = filePath.split('/');
          unmountPath = parts[parts.length - 1];
        }
      }
    }
    
    console.log('转换后的取消挂载路径:', unmountPath);
    
    // 显示取消挂载状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.add('uploading');
      }
    }
    
    // 调用后端取消挂载接口
    const response = await fetch('http://localhost:8000/api/document/unmount', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_path: unmountPath,
        is_folder: isFolder
      })
    });
    
    const result = await response.json();
    
    // 检查HTTP响应状态
    if (!response.ok) {
      // HTTP错误（4xx, 5xx等）
      const errorMessage = result.detail || result.error || `HTTP错误 ${response.status}`;
      console.error('取消挂载失败:', errorMessage);
      showAlert(`取消挂载失败: ${errorMessage}`, 'error');
      return;
    }
    
    // 检查业务逻辑状态
    if (result.status === 'success') {
      // 只有在实际取消挂载了文档时才显示成功提示
      if (result.unmounted_documents > 0 || result.unmounted_vectors > 0) {
        removeUploadIndicator(filePath);
        console.log('取消挂载成功:', filePath);
        // 显示成功提示（使用自定义模态框）
        showModal({
          type: 'success',
          title: '操作成功',
          message: `取消挂载成功：${result.message}`,
          showCancel: false,
          onConfirm: null
        });
      } else {
        // 没有找到要取消挂载的文档，不显示成功提示
        console.log('取消挂载完成，但未找到相关文档:', filePath);
      }
      
      // 延迟刷新文件树，让用户先看到成功提示
      setTimeout(async () => {
        // 刷新文件树以更新状态
        if (window.explorerModule && window.explorerModule.refreshFileTree) {
          await window.explorerModule.refreshFileTree();
        } else {
          // 如果explorerModule不可用，使用备用方案刷新文件树
          await loadFileTree();
        }
      }, 500); // 延迟500ms执行
    } else {
      // 处理业务逻辑错误
      const errorMessage = result.message || result.error || result.detail || '未知错误';
      console.error('取消挂载失败:', errorMessage);
      showModal({
        type: 'error',
        title: '取消挂载失败',
        message: errorMessage,
        showCancel: false,
        onConfirm: null
      });
    }
  } catch (error) {
    console.error('取消挂载请求失败:', error);
    // 显示更详细的错误信息
    const errorMessage = error.message || '取消挂载请求失败，请检查后端服务';
    showModal({
      type: 'error',
      title: '取消挂载失败',
      message: errorMessage,
      showCancel: false,
      onConfirm: null
    });
  } finally {
    // 移除取消挂载状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.remove('uploading');
      }
    }
  }
}

// 隐藏右键菜单
function hideContextMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
  }
}

// 取消挂载文档函数
async function unmountDocument(filePath) {
  try {
    // 关闭所有现有提示框，避免重复
    closeAllModals();
    
    // 确保使用相对路径，因为数据库存储的是相对路径格式
    let unmountPath = filePath;
    
    // 如果传入的是绝对路径，转换为相对路径
    if (filePath.startsWith('/')) {
      // 提取相对于项目根目录的路径
      const projectRoot = '/Users/dingjianan/Desktop/fs/';
      if (filePath.startsWith(projectRoot)) {
        unmountPath = filePath.substring(projectRoot.length);
      } else {
        // 如果路径不包含项目根目录，尝试查找data目录
        const dataIndex = filePath.indexOf('/data/');
        if (dataIndex !== -1) {
          unmountPath = filePath.substring(dataIndex + 1); // 包含data/
        } else {
          // 最后手段：使用文件名
          const parts = filePath.split('/');
          unmountPath = parts[parts.length - 1];
        }
      }
    }
    
    console.log('取消挂载文件路径:', unmountPath);
    
    const response = await fetch(`http://localhost:8000/api/document/unmount`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_path: unmountPath,
        is_folder: false
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      // 只有在实际取消挂载了文档时才显示成功提示
      if (data.unmounted_documents > 0 || data.unmounted_vectors > 0) {
        // 显示成功提示
        showModal({
          type: 'success',
          title: '操作成功',
          message: '文档取消挂载成功',
          showCancel: false,
          onConfirm: null
        });
      } else {
        // 没有找到要取消挂载的文档，不显示成功提示
        console.log('取消挂载完成，但未找到相关文档:', unmountPath);
      }
      
      // 移除文件的上传指示器
      const fileElement = document.querySelector(`[data-path="${filePath}"]`);
      if (fileElement) {
        // 调用database模块的removeUploadIndicator方法
        if (window.database && window.database.removeUploadIndicator) {
          window.database.removeUploadIndicator(fileElement);
        } else {
          // 如果database模块不可用，直接移除指示器
          const indicator = fileElement.querySelector('.upload-indicator');
          if (indicator) {
            indicator.remove();
          }
        }
      }
      
      // 延迟刷新文件树，让用户先看到成功提示
      setTimeout(async () => {
        // 刷新文件树以更新状态
        if (window.explorerModule && window.explorerModule.refreshFileTree) {
          await window.explorerModule.refreshFileTree();
        } else {
          // 如果explorerModule不可用，使用备用方案刷新文件树
          await loadFileTree();
        }
      }, 500); // 延迟500ms执行
    } else {
      showAlert(`取消挂载失败: ${data.detail || '未知错误'}`, 'error');
    }
  } catch (error) {
    showAlert(`取消挂载时发生错误: ${error.message}`, 'error');
  }
}

// 上传文件函数
async function uploadFile(filePath) {
  try {
    // 确保使用完整路径，因为后端需要验证文件存在
    let uploadPath = filePath;
    
    // 如果传入的是相对路径，转换为绝对路径
    if (!filePath.startsWith('/')) {
      // 假设是相对路径，添加项目根目录前缀
      uploadPath = `/Users/dingjianan/Desktop/fs/${filePath}`;
    }
    
    console.log('上传文件路径:', uploadPath);
    
    // 显示上传状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.add('uploading');
      }
    }
    
    // 调用后端上传接口
    const response = await fetch('http://localhost:8000/api/document/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_path: uploadPath
      })
    });
    
    const result = await response.json();
    
    // 检查HTTP响应状态
    if (!response.ok) {
      // HTTP错误（4xx, 5xx等）
      const errorMessage = result.detail || result.error || `HTTP错误 ${response.status}`;
      console.error('文件上传失败:', errorMessage);
      showAlert(`上传失败: ${errorMessage}`, 'error');
      return;
    }
    
    // 检查业务逻辑状态
    if (result.status === 'success') {
      // 新文件上传成功
      addUploadIndicator(filePath);
      console.log('文件上传成功:', uploadPath);
      // 显示成功提示（使用自定义模态框）
      showSuccessModal('文件上传成功');
    } else if (result.status === 'exists') {
      // 文件已存在（相同内容的文件已上传过）
      addUploadIndicator(filePath);
      console.log('文件已上传:', uploadPath);
      // 显示已存在提示（使用自定义模态框）
      showSuccessModal('文件已上传');
    } else if (result.status === 'updated') {
      // 文件路径更新（检测到文件移动）
      addUploadIndicator(filePath);
      console.log('文件路径已更新:', uploadPath);
      // 显示路径更新提示（使用自定义模态框）
      showSuccessModal('文件已上传');
    } else {
      // 处理业务逻辑错误
      const errorMessage = result.message || result.error || result.detail || '未知错误';
      console.error('文件上传失败:', errorMessage);
      showAlert(`上传失败: ${errorMessage}`, 'error');
    }
  } catch (error) {
    console.error('上传请求失败:', error);
    // 显示更详细的错误信息
    const errorMessage = error.message || '上传请求失败，请检查后端服务';
    showAlert(`上传失败: ${errorMessage}`, 'error');
  } finally {
    // 移除上传状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.remove('uploading');
      }
    }
  }
}

// 通用提示框函数
function showModal(options) {
  const {
    type = 'info', // 'success', 'error', 'warning', 'info'
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = false,
    onConfirm = null,
    onCancel = null
  } = options;

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
  
  // 标题样式和文本
  const titleElement = document.createElement('h3');
  const titleConfig = {
    success: { text: title || '操作成功', color: '#28a745' },
    error: { text: title || '操作失败', color: '#dc3545' },
    warning: { text: title || '警告', color: '#ffc107' },
    info: { text: title || '提示', color: '#17a2b8' }
  };
  
  titleElement.textContent = titleConfig[type].text;
  titleElement.style.cssText = `
    margin: 0 0 15px 0;
    font-size: 16px;
    font-weight: bold;
    color: ${titleConfig[type].color};
  `;
  
  // 消息内容
  const messageElement = document.createElement('p');
  messageElement.textContent = message;
  messageElement.style.cssText = `
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
  if (showCancel) {
    const cancelButton = document.createElement('button');
    cancelButton.textContent = cancelText;
    cancelButton.style.cssText = `
      padding: 8px 16px;
      border: 1px solid var(--tree-border);
      background: var(--bg-color);
      color: var(--text-color);
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    
    cancelButton.addEventListener('click', () => {
      document.body.removeChild(overlay);
      if (onCancel) onCancel();
    });
    
    buttonContainer.appendChild(cancelButton);
  }
  
  // 确定按钮
  const confirmButton = document.createElement('button');
  confirmButton.textContent = confirmText;
  const buttonColor = type === 'error' ? '#dc3545' : 
                     type === 'warning' ? '#ffc107' :
                     type === 'success' ? '#28a745' : '#17a2b8';
  
  confirmButton.style.cssText = `
    padding: 8px 16px;
    border: none;
    background: ${buttonColor};
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  
  confirmButton.addEventListener('click', () => {
    document.body.removeChild(overlay);
    if (onConfirm) onConfirm();
  });
  
  // 组装弹窗
  buttonContainer.appendChild(confirmButton);
  modal.appendChild(titleElement);
  modal.appendChild(messageElement);
  modal.appendChild(buttonContainer);
  overlay.appendChild(modal);
  
  // 显示弹窗
  document.body.appendChild(overlay);
  
  // 点击遮罩层关闭弹窗（仅信息类）
  if (type === 'info' || type === 'success') {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
  }
}

// 关闭所有模态框
function closeAllModals() {
  const overlays = document.querySelectorAll('div[style*="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5);"]');
  overlays.forEach(overlay => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  });
}

// 简化的提示函数（替代alert）
function showAlert(message, type = 'info') {
  showModal({
    type: type,
    message: message
  });
}

// 显示自定义成功提示框
function showSuccessModal(message) {
  showModal({
    type: 'success',
    message: message
  });
}

// 添加上传标记
function addUploadIndicator(filePath) {
  const fileItem = document.querySelector(`[data-path="${filePath}"]`);
  if (fileItem && !fileItem.querySelector('.upload-indicator')) {
    const indicator = document.createElement('div');
    indicator.className = 'upload-indicator';
    // 将指示器添加到contentDiv内部，而不是fileItem末尾
    const contentDiv = fileItem.querySelector('div');
    if (contentDiv) {
      contentDiv.appendChild(indicator);
    } else {
      fileItem.appendChild(indicator);
    }
  }
}

// 重新上传文件函数
async function reuploadFile(filePath) {
  try {
    // 关闭所有现有提示框，避免重复
    closeAllModals();
    
    // 确保使用完整路径，因为后端需要验证文件存在
    let uploadPath = filePath;

    // 如果传入的是相对路径，转换为绝对路径
    if (!filePath.startsWith('/')) {
      // 假设是相对路径，添加项目根目录前缀
      uploadPath = `/Users/dingjianan/Desktop/fs/${filePath}`;
    }

    console.log('重新上传文件路径:', uploadPath);

    // 显示重新上传状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.add('reuploading');
      }
    }

    // 调用后端重新上传接口
    const response = await fetch('http://localhost:8000/api/document/reupload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_path: uploadPath,
        force_reupload: false  // 默认不强制重新上传，让后端自动判断
      })
    });

    const result = await response.json();

    // 检查HTTP响应状态
    if (!response.ok) {
      // HTTP错误（4xx, 5xx等）
      const errorMessage = result.detail || result.error || `HTTP错误 ${response.status}`;
      console.error('文件重新上传失败:', errorMessage);
      showAlert(`重新上传失败: ${errorMessage}`, 'error');
      return;
    }

    // 检查业务逻辑状态
    if (result.status === 'reuploaded') {
      // 重新上传成功
      addUploadIndicator(filePath);
      console.log('文件重新上传成功:', uploadPath);
      // 重新上传成功时显示提示（使用自定义模态框）
      showSuccessModal('文件重新上传成功');
    } else if (result.status === 'uploaded') {
      // 新上传成功（之前未上传过）
      addUploadIndicator(filePath);
      console.log('文件上传成功:', uploadPath);
      // 新上传成功时显示提示（使用自定义模态框）
      showSuccessModal('文件上传成功');
    } else if (result.status === 'unchanged') {
      // 文件内容未改变 - 静默处理，不显示提示
      console.log('文件内容未改变，无需重新上传:', uploadPath);
      // 不显示任何提示，保持静默
    } else {
      // 处理业务逻辑错误
      const errorMessage = result.message || result.error || result.detail || '未知错误';
      console.error('文件重新上传失败:', errorMessage);
      showAlert(`重新上传失败: ${errorMessage}`, 'error');
    }
  } catch (error) {
    console.error('重新上传请求失败:', error);
    // 显示更详细的错误信息
    const errorMessage = error.message || '重新上传请求失败，请检查后端服务';
    showAlert(`重新上传失败: ${errorMessage}`, 'error');
  } finally {
    // 移除重新上传状态
    const fileItem = document.querySelector(`[data-path="${filePath}"]`);
    if (fileItem) {
      const indicator = fileItem.querySelector('.upload-indicator');
      if (indicator) {
        indicator.classList.remove('reuploading');
      }
    }
  }
}



// 批量刷新文件上传状态
async function refreshAllUploadStatus() {
  console.log('开始刷新所有文件上传状态...');
  
  // 获取所有文件项
  const fileItems = document.querySelectorAll('.file-item-file[data-path]');
  
  for (const fileItem of fileItems) {
    const filePath = fileItem.dataset.path;
    if (filePath) {
      try {
        // 移除上传状态标记（不再通过API检查，由上传操作直接控制）
        removeUploadIndicator(filePath);
      } catch (error) {
        console.error(`刷新文件 ${filePath} 状态失败:`, error);
      }
    }
  }
  
  console.log('文件上传状态刷新完成');
}

// 渲染文件树（递归）
function renderTree(node, container, isRoot = false, depth = 0) {
  const div = document.createElement('div');
  div.className = 'file-item';
  div.dataset.path = node.path;
  
  // 设置缩进
  const indentSize = depth * 12; // 每层缩进12px
  div.style.paddingLeft = indentSize + 'px';
  
  // 创建内容容器
  const contentDiv = document.createElement('div');
  contentDiv.style.display = 'flex';
  contentDiv.style.alignItems = 'center';
  contentDiv.style.gap = '4px';
  
  // 设置选中状态
  if (selectedItemPath === node.path) {
    div.classList.add('selected');
  }

  if (node.children) {
    div.classList.add('folder-item');
    
    // 添加箭头图标
    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.style.fontSize = '8px';
    arrow.style.color = '#888';
    arrow.style.transition = 'transform 0.2s';
    arrow.className = 'folder-arrow';
    arrow.style.transform = 'rotate(90deg)'; // 默认展开状态
    contentDiv.appendChild(arrow);
    
    // 添加文件夹图标
    const folderIcon = document.createElement('span');
    const isExpanded = expandedFolders.has(node.path);
    folderIcon.innerHTML = getFileIcon(node.name, true, isExpanded);
    folderIcon.style.display = 'flex';
    folderIcon.style.alignItems = 'center';
    folderIcon.style.fontSize = '10px';
    folderIcon.style.width = '13px';
    folderIcon.style.height = '13px';
    folderIcon.className = 'folder-icon';
    contentDiv.appendChild(folderIcon);
    
    // 添加文件名
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    nameSpan.style.fontSize = '13px';
    contentDiv.appendChild(nameSpan);
    
    div.appendChild(contentDiv);
    container.appendChild(div);
    
    // 添加拖拽功能
    addDragAndDropSupport(div, node, true);
    
    const childContainer = document.createElement('div');
    childContainer.dataset.parent = node.path;
    // 根据expandedFolders状态决定是否展开
    childContainer.style.display = isExpanded ? 'block' : 'none';
    arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    node.children.forEach(child => renderTree(child, childContainer, false, depth + 1));
    container.appendChild(childContainer);
    
    // 文件夹点击事件 - 负责选中和展开/收起
    div.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止事件冒泡到文件树容器
      
      // 清除所有选中状态
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      // 设置当前选中状态
      div.classList.add('selected');
      selectedItemPath = node.path;
      // 同步到ExplorerModule
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
      // 确保文件夹项获得焦点，以便键盘事件能正常工作
      div.focus();
      div.tabIndex = 0; // 确保元素可以获得焦点
      
      // 切换展开/收起状态
      const isCurrentlyExpanded = expandedFolders.has(node.path);
      if (isCurrentlyExpanded) {
        expandedFolders.delete(node.path);
        childContainer.style.display = 'none';
        arrow.style.transform = 'rotate(0deg)';
        folderIcon.innerHTML = getFileIcon(node.name, true, false);
      } else {
        expandedFolders.add(node.path);
        childContainer.style.display = 'block';
        arrow.style.transform = 'rotate(90deg)';
        folderIcon.innerHTML = getFileIcon(node.name, true, true);
      }
    });
    
    // 添加右键菜单事件
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 先选中该项
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedItemPath = node.path;
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
      // 显示右键菜单
      createContextMenu(e.pageX, e.pageY, node.path, true);
    });
    

  } else {
    div.classList.add('file-item-file');
    
    // 添加文件图标
    const fileIcon = document.createElement('span');
    fileIcon.innerHTML = getFileIcon(node.name, false);
    fileIcon.style.display = 'flex';
    fileIcon.style.alignItems = 'center';
    fileIcon.style.fontSize = '10px';
    fileIcon.style.width = '12px';
    fileIcon.style.height = '12px';
    fileIcon.style.marginLeft = '11px'; // 与文件夹箭头对齐
    contentDiv.appendChild(fileIcon);
    
    // 添加文件名
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    nameSpan.style.fontSize = '12px';
    contentDiv.appendChild(nameSpan);
    
    div.appendChild(contentDiv);
    
    // 添加拖拽功能
    addDragAndDropSupport(div, node, false);
    
    div.addEventListener('click', async (e) => {
      e.stopPropagation(); // 防止事件冒泡到文件树容器
      // 清除所有选中状态
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      // 设置当前选中状态
      div.classList.add('selected');
      selectedItemPath = node.path;
      // 同步到ExplorerModule
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
      // 确保文件项获得焦点，以便键盘事件能正常工作
      div.setAttribute('tabindex', '0'); // 确保元素可以获得焦点
      div.focus();
      
      // 使用文件查看器打开文件
      if (fileViewer) {
        try {
          await fileViewer.openFile(node.path);
        } catch (error) {
          console.error('文件打开失败:', error);
        }
      }
    });
    
    // 添加右键菜单事件
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 先选中该项
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      selectedItemPath = node.path;
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
      // 显示右键菜单
      createContextMenu(e.pageX, e.pageY, node.path, false);
    });
    container.appendChild(div);
  }
}

// 实现文件树容器宽度调整功能
function initResizer() {
  const resizer = document.getElementById('file-tree-resizer');
  const fileTreeContainer = document.getElementById('file-tree-container');
  const resourceTitle = document.getElementById('resource-title');
  
  let startX, startWidth;
  
  // 根据容器宽度更新标题
  function updateResourceTitle(width) {
    // 始终显示完整的"资源管理器"
    resourceTitle.textContent = '资源管理器';
  }
  
  function startResize(e) {
    startX = e.clientX;
    startWidth = parseInt(document.defaultView.getComputedStyle(fileTreeContainer).width, 10);
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
  
  function resize(e) {
    const newWidth = startWidth + (e.clientX - startX);
    // 限制最小和最大宽度，确保能显示完整的"资源管理器"
    if (newWidth >= 180 && newWidth <= 500) {
      fileTreeContainer.style.width = `${newWidth}px`;
      updateResourceTitle(newWidth);
    }
  }
  
  function stopResize() {
    document.removeEventListener('mousemove', resize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
  
  // 初始检查宽度
  updateResourceTitle(parseInt(document.defaultView.getComputedStyle(fileTreeContainer).width, 10));
  
  resizer.addEventListener('mousedown', startResize);
}


// 创建内联编辑输入框
// createInlineInput 函数已移至 ExplorerModule

// createFolder 和 createFile 函数已移至 ExplorerModule

// startRename 函数已移至 ExplorerModule

// 创建重命名输入框
function createRenameInput(element, itemPath, currentName, isFolder) {
  // 隐藏原始元素
  element.style.display = 'none';
  
  // 计算缩进深度
  const paddingLeft = element.style.paddingLeft || '0px';
  const depth = parseInt(paddingLeft) / 12;
  
  // 分离文件名和扩展名（仅对文件有效）
  let nameWithoutExt = currentName;
  let fileExtension = '';
  
  if (!isFolder && currentName.includes('.')) {
    const lastDotIndex = currentName.lastIndexOf('.');
    nameWithoutExt = currentName.substring(0, lastDotIndex);
    fileExtension = currentName.substring(lastDotIndex);
  }
  
  const input = document.createElement('input');
  input.type = 'text';
  input.value = nameWithoutExt; // 只显示文件名部分，不包含扩展名
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
  inputContainer.style.paddingLeft = paddingLeft;
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
    arrow.style.transform = 'rotate(90deg)';
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
  
  // 插入到原始元素之前
  element.parentElement.insertBefore(inputContainer, element);
  
  // 自动聚焦并选中文本
  input.focus();
  input.select();
  
  // 添加标志位防止重复处理
  let isProcessing = false;
  let isCompleted = false;
  
  // 设置重命名状态
  if (explorerModule) {
    explorerModule.isRenaming = true;
  }
  
  // 处理重命名完成
  const handleComplete = async (source = 'unknown') => {
    if (isProcessing || isCompleted) return;
    isProcessing = true;
    
    const inputValue = input.value.trim();
    // 构建完整的新名称（文件需要加上扩展名）
    const newName = isFolder ? inputValue : inputValue + fileExtension;
    
    // 如果名称为空或与原名称相同，直接取消
    if (!inputValue || newName === currentName) {
      handleCancel();
      return;
    }
    
    try {
       const result = await window.fsAPI.renameItem(itemPath, newName);
       if (result.success) {
         isCompleted = true;
         await loadFileTree();
         // 重新选中重命名后的项目
         selectedItemPath = result.newPath;
         // 清理
         cleanup();
       } else {
         // 重命名失败时显示错误并重置状态
         showAlert(`重命名失败: ${result.error}`, 'error');
         isProcessing = false;
         input.focus();
         input.select();
       }
     } catch (error) {
       console.error('重命名失败:', error);
       showAlert(`重命名失败: ${error.message}`, 'error');
       isProcessing = false;
       input.focus();
       input.select();
     }
  };
  
  // 处理取消
  const handleCancel = () => {
    if (isCompleted) return;
    isCompleted = true;
    cleanup();
  };
  
  // 清理函数
  const cleanup = () => {
    if (inputContainer && inputContainer.parentElement) {
      inputContainer.remove();
    }
    if (element) {
      element.style.display = '';
    }
    // 重置重命名状态
    if (explorerModule) {
      explorerModule.isRenaming = false;
    }
  };
  
  // 回车确认，ESC取消
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // 延迟处理，确保输入框完全聚焦
      setTimeout(() => {
        handleComplete('keydown');
      }, 50);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleCancel();
    }
  });
  
  // 失去焦点时不自动确认，避免与回车事件冲突
  input.addEventListener('blur', (e) => {
    // 延迟处理，给回车事件优先权
    setTimeout(() => {
      if (!isCompleted && !isProcessing) {
        handleComplete('blur');
      }
    }, 100);
  });
}

// 检查所有文件的上传状态


// 加载文件树加载并渲染文件树
async function loadFileTree() {
  try {
    const tree = await window.fsAPI.getFileTree();
    window.fileTreeData = tree; // 保存文件树数据供其他函数使用
    fileTreeEl.innerHTML = '';
    // 直接渲染子文件，不显示根目录
    if (tree.children && tree.children.length > 0) {
      tree.children.forEach(child => renderTree(child, fileTreeEl, true, 0));
    }
    

  } catch (error) {
    console.error('加载文件树失败:', error);
  }
}

// refreshFileTree 函数已移至 ExplorerModule

// isSelectedItemFolder 函数已移至 ExplorerModule

// importFiles 函数已移至 ExplorerModule

// createDeleteModal 函数已移至 ExplorerModule

// 连接Python后端API
async function testPythonBackend() {
  try {
    const response = await fetch('http://127.0.0.1:8000/health');
    const data = await response.json();
    console.log('Python后端健康检查:', data);
    return data;
  } catch (error) {
    console.error('无法连接到Python后端:', error);
    return null;
  }
}

// 在初始化时测试Python后端连接
(async () => {
  // 等待Python后端启动
  await testPythonBackend();
  
  // 渲染图标
  renderIcons();
  
  // 资源管理器相关初始化已移至 ExplorerModule
})();

// 搜索模式状态
let isSearchMode = false;

// 切换到搜索模式
function switchToSearchMode() {
  isSearchMode = true;
  
  // 如果当前在设置页面，先切换到文件页面
  if (settingsModule) {
    settingsModule.showFilePage();
  }
  
  // 隐藏测试页面
  if (testModule) {
    testModule.hideTestPage();
  }
  
  // 隐藏数据库页面
  const databasePage = document.getElementById('database-page');
  if (databasePage) {
    databasePage.style.display = 'none';
  }
  
  // 隐藏文件树
  document.getElementById('file-tree').style.display = 'none';
  
  // 显示搜索区域
  document.getElementById('search-area').style.display = 'block';
  
  // 更改资源管理器标题
  document.getElementById('resource-title').textContent = '搜索';
  
  // 隐藏顶部banner的五个操作按钮
  const headerButtons = document.querySelectorAll('#file-tree-header > div > button');
  headerButtons.forEach(btn => {
    btn.style.display = 'none';
  });
  
  // 聚焦搜索输入框
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.focus();
  }
}

// 切换到文件模式
function switchToFileMode() {
  isSearchMode = false;
  
  // 隐藏测试页面
  if (testModule) {
    testModule.hideTestPage();
  }
  
  // 隐藏数据库页面
  const databasePage = document.getElementById('database-page');
  if (databasePage) {
    databasePage.style.display = 'none';
  }
  
  // 显示文件树
  document.getElementById('file-tree').style.display = 'block';
  
  // 隐藏搜索区域
  document.getElementById('search-area').style.display = 'none';
  
  // 恢复资源管理器标题
  document.getElementById('resource-title').textContent = '资源管理器';
  
  // 显示顶部banner的五个操作按钮
  const headerButtons = document.querySelectorAll('#file-tree-header > div > button');
  headerButtons.forEach(btn => {
    btn.style.display = 'inline-block';
  });
  
  // 清空搜索输入框
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.value = '';
  }
}

// 绑定剩余事件监听器的函数
function bindEventListeners() {
  // 资源管理器相关事件绑定已移至 ExplorerModule
  // 这里只保留其他模块的事件绑定
  
  // 搜索按钮事件
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      switchToSearchMode();
    });
  }
  
  // 数据库按钮事件
  const databaseBtn = document.getElementById('database-btn');
  if (databaseBtn) {
    databaseBtn.addEventListener('click', () => {
      if (databaseModule) {
        databaseModule.showDatabasePage();
      }
    });
  }
  
  // 文件按钮事件（切换回文件模式）
  const toggleTreeBtn = document.getElementById('toggle-tree');
  if (toggleTreeBtn) {
    toggleTreeBtn.addEventListener('click', () => {
      if (isSearchMode) {
        switchToFileMode();
      }
      // 原有的文件树切换逻辑由ExplorerModule处理
    });
  }
  
  // 添加文件树容器点击事件，实现点击空白处取消选中
  if (fileTreeEl) {
    fileTreeEl.addEventListener('click', (e) => {
      // 如果点击的是文件树容器本身（空白处），而不是文件项
      if (e.target === fileTreeEl) {
        // 清除所有选中状态
        document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
        selectedItemPath = null;
        // 同步到ExplorerModule
        if (explorerModule) {
          explorerModule.setSelectedItemPath(null);
        }
      }
    });
  }
  
  // 添加文件树容器根目录拖拽支持
  if (fileTreeEl) {
    // 拖拽进入事件
    fileTreeEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (draggedElement && draggedPath) {
        fileTreeEl.classList.add('drag-over-root');
      }
    });
    
    // 拖拽悬停事件
    fileTreeEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedElement && draggedPath) {
        fileTreeEl.classList.add('drag-over-root');
        // 隐藏拖拽指示器
        if (dropIndicator) {
          dropIndicator.style.display = 'none';
        }
      }
    });
    
    // 拖拽离开事件
    fileTreeEl.addEventListener('dragleave', (e) => {
      // 只有当鼠标真正离开文件树容器时才移除样式
      if (!fileTreeEl.contains(e.relatedTarget)) {
        fileTreeEl.classList.remove('drag-over-root');
      }
    });
    
    // 放置事件 - 移动到根目录
    fileTreeEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      fileTreeEl.classList.remove('drag-over-root');
      
      // 保存拖拽路径的副本，因为 draggedPath 可能在后续处理中被清空
      const currentDraggedPath = draggedPath;
      
      if (currentDraggedPath) {
        try {
          // 获取文件树的根目录路径
          const tree = await window.fsAPI.getFileTree();
          const rootPath = tree.path; // 获取实际的根目录路径
          
          // 检查文件是否已经在根目录
          const draggedItemName = currentDraggedPath.split('/').pop() || currentDraggedPath.split('\\').pop();
          const wouldBeNewPath = rootPath + '/' + draggedItemName;
          
          // 如果文件已经在根目录（拖拽路径的父目录就是根目录），则不需要移动
          const draggedParentDir = currentDraggedPath.substring(0, currentDraggedPath.lastIndexOf('/')) || 
                                 currentDraggedPath.substring(0, currentDraggedPath.lastIndexOf('\\'));
          
          if (draggedParentDir === rootPath) {
            console.log('文件已经在根目录，无需移动:', currentDraggedPath);
            return; // 直接返回，不进行任何操作
          }
          
          console.log('移动到根目录:', currentDraggedPath, '目标路径:', rootPath);
          const result = await window.fsAPI.moveItem(currentDraggedPath, rootPath);
          
          if (result.success) {
            console.log('成功移动到根目录');
            // 重新加载文件树
            await loadFileTree();
            
            // 选中移动后的文件
            selectedItemPath = result.newPath;
            if (explorerModule) {
              explorerModule.setSelectedItemPath(result.newPath);
            }
            
            // 在DOM中设置选中状态
            setTimeout(() => {
              const newElement = document.querySelector(`[data-path="${result.newPath}"]`);
              if (newElement) {
                newElement.classList.add('selected');
                newElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
            
          } else {
            console.error('移动到根目录失败:', result.error);
            showAlert('移动到根目录失败: ' + result.error, 'error');
          }
        } catch (error) {
          console.error('移动到根目录时出错:', error);
          showAlert('移动到根目录时出错: ' + error.message, 'error');
        }
      }
    });
  }
}

// 初始化应用
(async () => {
  // 初始化拖拽调整功能
  initResizer();
  
  // 获取并显示文件树
  await loadFileTree();
})();

// 将 createRenameInput 函数暴露到全局作用域
window.createRenameInput = createRenameInput;

