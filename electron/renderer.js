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
        } else {
          alert(`移动失败: ${result.error}`);
        }
      } catch (error) {
        console.error('移动文件失败:', error);
        alert(`移动失败: ${error.message}`);
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
  
  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  menu.appendChild(separator);
  menu.appendChild(uploadItem);
  
  document.body.appendChild(menu);
  
  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

// 隐藏右键菜单
function hideContextMenu() {
  const menu = document.querySelector('.context-menu');
  if (menu) {
    menu.remove();
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
      alert(`上传失败: ${errorMessage}`);
      return;
    }
    
    // 检查业务逻辑状态
    if (result.status === 'success' || result.status === 'exists') {
      // 上传成功或文件已存在，都视为成功，添加已上传标记
      addUploadIndicator(filePath);
      console.log('文件上传成功:', uploadPath, result.message);
      // 显示成功提示
      alert(result.message || '文件上传成功');
    } else {
      // 处理业务逻辑错误
      const errorMessage = result.message || result.error || result.detail || '未知错误';
      console.error('文件上传失败:', errorMessage);
      alert(`上传失败: ${errorMessage}`);
    }
  } catch (error) {
    console.error('上传请求失败:', error);
    // 显示更详细的错误信息
    const errorMessage = error.message || '上传请求失败，请检查后端服务';
    alert(`上传失败: ${errorMessage}`);
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

// 检查文件是否已上传
async function checkUploadStatus(filePath) {
  try {
    // 确保使用完整路径，因为后端需要验证文件存在
    let uploadPath = filePath;
    
    // 如果传入的是相对路径，转换为绝对路径
    if (!filePath.startsWith('/')) {
      // 假设是相对路径，添加项目根目录前缀
      uploadPath = `/Users/dingjianan/Desktop/fs/${filePath}`;
    }
    
    console.log('检查文件上传状态:', uploadPath);
    
    const response = await fetch('http://localhost:8000/api/documents/exists', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file_path: uploadPath
      })
    });
    
    if (!response.ok) {
      console.error('API响应错误:', response.status);
      return false;
    }
    
    const result = await response.json();
    return result.exists || false;
  } catch (error) {
    console.error('检查上传状态失败:', error);
    return false;
  }
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
    
    // 异步检查文件上传状态并添加标记
    (async () => {
      const isUploaded = await checkUploadStatus(node.path);
      if (isUploaded) {
        addUploadIndicator(node.path);
      }
    })();
    
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
         alert(`重命名失败: ${result.error}`);
         isProcessing = false;
         input.focus();
         input.select();
       }
     } catch (error) {
       console.error('重命名失败:', error);
       alert(`重命名失败: ${error.message}`);
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
async function checkAllFilesUploadStatus(node) {
  if (!node) return;
  
  // 如果是文件，检查上传状态
  if (!node.isFolder && node.path) {
    try {
      // 提取相对于项目根目录的路径
      let relativePath = node.path;
      
      // 如果是绝对路径，提取相对于项目根目录的路径
      if (node.path.startsWith('/')) {
        // 查找data目录的位置
        const dataIndex = node.path.indexOf('/data/');
        if (dataIndex !== -1) {
          relativePath = node.path.substring(dataIndex + 1); // 移除开头的'/'
        } else {
          // 如果找不到data目录，使用文件名
          const parts = node.path.split('/');
          relativePath = parts[parts.length - 1];
        }
      }
      
      // 确保路径格式正确（移除开头的../）
      relativePath = relativePath.replace(/^\.\.\//, '');
      
      console.log('检查文件上传状态:', node.path, '->', relativePath);
      const isUploaded = await checkUploadStatus(relativePath);
      if (isUploaded) {
        // 找到对应的文件元素并添加上传标记
        const fileElement = document.querySelector(`[data-path="${node.path}"]`);
        if (fileElement) {
          addUploadIndicator(fileElement);
        }
      }
    } catch (error) {
      console.error(`检查文件上传状态失败: ${node.path}`, error);
    }
  }
  
  // 递归检查子项
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      await checkAllFilesUploadStatus(child);
    }
  }
}

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
    
    // 检查所有文件的上传状态
    setTimeout(async () => {
      await checkAllFilesUploadStatus(tree);
    }, 100); // 稍微延迟，确保DOM渲染完成
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

