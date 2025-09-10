const fileTreeEl = document.getElementById('file-tree');
const fileContentEl = document.getElementById('file-content');
// 设置相关元素已移至设置模块管理

// 初始化文件查看器
let fileViewer = null;

// initFileViewer 函数已移至 ExplorerModule

// 渲染SVG图标
function renderIcons() {
  document.getElementById('file-icon').innerHTML = icons.file;
  document.getElementById('settings-icon').innerHTML = icons.settings;
  // 资源管理器相关图标渲染已移至资源管理器模块
}

// 主题设置
// 初始化设置模块、资源管理器模块和事件绑定
let settingsModule;
let explorerModule;
document.addEventListener('DOMContentLoaded', () => {
  settingsModule = new SettingsModule();
  explorerModule = new ExplorerModule();
  
  // 获取ExplorerModule中的fileViewer实例
  fileViewer = explorerModule.getFileViewer();
  
  // 绑定剩余的事件监听器
  bindEventListeners();
});

// 当前选中的文件或文件夹路径
let selectedItemPath = null;
let expandedFolders = new Set(); // 记录展开的文件夹路径

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
  contentDiv.style.gap = '3px';
  
  // 设置选中状态
  if (selectedItemPath === node.path) {
    div.classList.add('selected');
  }

  if (node.children) {
    div.style.fontWeight = 'bold';
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
    folderIcon.style.width = '12px';
    folderIcon.style.height = '12px';
    folderIcon.className = 'folder-icon';
    contentDiv.appendChild(folderIcon);
    
    // 添加文件名
    const nameSpan = document.createElement('span');
    nameSpan.textContent = node.name;
    nameSpan.style.fontSize = '13px';
    contentDiv.appendChild(nameSpan);
    
    div.appendChild(contentDiv);
    container.appendChild(div);
    
    const childContainer = document.createElement('div');
    childContainer.dataset.parent = node.path;
    // 根据expandedFolders状态决定是否展开
    childContainer.style.display = isExpanded ? 'block' : 'none';
    arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    node.children.forEach(child => renderTree(child, childContainer, false, depth + 1));
    container.appendChild(childContainer);
    
    // 文件夹点击事件 - 负责选中和展开/收起
    div.addEventListener('click', (e) => {
      e.stopPropagation(); // 防止事件冒泡
      
      // 清除所有选中状态
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      // 设置当前选中状态
      div.classList.add('selected');
      selectedItemPath = node.path;
      // 同步到ExplorerModule
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
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
    
    div.addEventListener('click', async (e) => {
      e.stopPropagation(); // 防止事件冒泡
      // 清除所有选中状态
      document.querySelectorAll('.file-item.selected').forEach(el => el.classList.remove('selected'));
      // 设置当前选中状态
      div.classList.add('selected');
      selectedItemPath = node.path;
      // 同步到ExplorerModule
      if (explorerModule) {
        explorerModule.setSelectedItemPath(node.path);
      }
      
      // 使用文件查看器打开文件
      if (fileViewer) {
        await fileViewer.openFile(node.path);
      }
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
  contentDiv.style.gap = '3px';
  
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
    folderIcon.style.width = '12px';
    folderIcon.style.height = '12px';
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
  };
  
  // 回车确认，ESC取消
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleComplete('keydown');
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

// 绑定剩余事件监听器的函数
function bindEventListeners() {
  // 资源管理器相关事件绑定已移至 ExplorerModule
  // 这里只保留其他模块的事件绑定
}

// 初始化应用
(async () => {
  // 初始化拖拽调整功能
  initResizer();
  
  // 获取并显示文件树
  await loadFileTree();
})();

