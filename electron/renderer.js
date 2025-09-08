const fileTreeEl = document.getElementById('file-tree');
const fileContentEl = document.getElementById('file-content');
const settingsPageEl = document.getElementById('settings-page');
const settingsBtn = document.getElementById('settings-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// 初始化文件查看器
let fileViewer = null;

// 等待DOM加载完成后初始化文件查看器
function initFileViewer() {
  if (fileContentEl && typeof FileViewer !== 'undefined') {
    fileViewer = new FileViewer(fileContentEl);
  }
}

// 渲染SVG图标
function renderIcons() {
  document.getElementById('file-icon').innerHTML = icons.file;
  document.getElementById('settings-icon').innerHTML = icons.settings;
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

// 主题设置
let isDarkMode = false;

// 初始化主题
function applyTheme() {
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    darkModeToggle.checked = true;
  } else {
    document.body.classList.remove('dark-mode');
    darkModeToggle.checked = false;
  }
}

// 加载设置
async function loadSettings() {
  try {
    const settings = await window.fsAPI.getSettings();
    isDarkMode = settings.darkMode || false;
    applyTheme();
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

// 切换页面显示
function showFilePage() {
  fileContentEl.style.display = 'block';
  settingsPageEl.style.display = 'none';
}

function showSettingsPage() {
  fileContentEl.style.display = 'none';
  settingsPageEl.style.display = 'block';
}

// 设置按钮点击事件
settingsBtn.addEventListener('click', () => {
  showSettingsPage();
});

// 深色模式切换事件
darkModeToggle.addEventListener('change', async (e) => {
  isDarkMode = e.target.checked;
  applyTheme();
  
  // 保存设置到主进程
  try {
    await window.fsAPI.saveSettings({ darkMode: isDarkMode });
  } catch (error) {
    console.error('保存设置失败:', error);
  }
});

// 文件按钮点击事件
document.getElementById('toggle-tree').addEventListener('click', () => {
  showFilePage();
});

// 加载设置并应用主题
loadSettings();

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
      return '<img src="./dist/assets/txt.png" style="width: 12px; height: 12px;" />';
    case 'html':
    case 'htm':
      return '<img src="./dist/assets/html.png" style="width: 12px; height: 12px;" />';
    case 'md':
    case 'markdown':
      return '<img src="./dist/assets/markdown.png" style="width: 12px; height: 12px;" />';
    case 'pdf':
      return '<img src="./dist/assets/pdf.png" style="width: 12px; height: 12px;" />';
    case 'docx':
    case 'doc':
      return '<img src="./dist/assets/docx.png" style="width: 12px; height: 12px;" />';
    case 'json':
      return '<img src="./dist/assets/json.png" style="width: 12px; height: 12px;" />';
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
function createInlineInput(container, parentPath, isFolder = false) {
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
  contentDiv.style.gap = '3px';
  
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
  
  // 如果是文件且有扩展名，显示扩展名
  if (!isFolder && fileExtension) {
    const extensionSpan = document.createElement('span');
    extensionSpan.textContent = fileExtension;
    extensionSpan.style.cssText = `
      color: ${textColor};
      font-size: 11px;
      opacity: 0.7;
      margin-left: 2px;
    `;
    contentDiv.appendChild(extensionSpan);
  }
  
  inputContainer.appendChild(contentDiv);
  
  // 插入到容器中
  container.appendChild(inputContainer);
  
  // 自动聚焦
  input.focus();
  
  // 处理输入完成
  const handleComplete = async () => {
    const name = input.value.trim();
    if (name) {
      try {
        if (isFolder) {
          await window.fsAPI.createFolder(parentPath, name);
        } else {
          await window.fsAPI.createFile(parentPath, name);
        }
        await loadFileTree();
      } catch (error) {
        console.error('创建失败:', error);
        alert(`创建失败: ${error.message}`);
      }
    }
    inputContainer.remove();
  };
  
  // 回车确认
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleComplete();
    } else if (e.key === 'Escape') {
      inputContainer.remove();
    }
  });
  
  // 失去焦点确认
  input.addEventListener('blur', handleComplete);
}

// 新建文件夹功能
function createFolder() {
  let targetPath = selectedItemPath;
  let targetContainer;
  
  if (selectedItemPath) {
    // 在选中的文件夹下创建
    const selectedElement = document.querySelector(`[data-path="${selectedItemPath}"]`);
    if (selectedElement && selectedElement.classList.contains('folder-item')) {
      // 确保文件夹的子容器存在
      let childContainer = selectedElement.nextElementSibling;
      if (!childContainer || !childContainer.dataset.parent) {
        childContainer = document.createElement('div');
        childContainer.dataset.parent = selectedItemPath;
        childContainer.style.display = 'block';
        selectedElement.parentElement.insertBefore(childContainer, selectedElement.nextSibling);
      } else {
        // 如果子容器存在但被收起，则展开它
        expandedFolders.add(selectedItemPath);
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
      targetPath = parentContainer.dataset.parent || selectedItemPath;
    }
  } else {
    // 在data目录下创建（资源管理器最下方）
    targetContainer = fileTreeEl;
    // 获取data目录路径
    window.fsAPI.getFileTree().then(tree => {
      targetPath = tree.path;
      // 确保容器存在且可见
      if (!targetContainer.parentElement) {
        document.body.appendChild(targetContainer);
      }
      createInlineInput(targetContainer, targetPath, true);
    });
    return;
  }
  
  createInlineInput(targetContainer, targetPath, true);
}

// 新建文件功能
function createFile() {
  let targetPath = selectedItemPath;
  let targetContainer;
  
  if (selectedItemPath) {
    // 在选中的文件夹下创建
    const selectedElement = document.querySelector(`[data-path="${selectedItemPath}"]`);
    if (selectedElement && selectedElement.classList.contains('folder-item')) {
      // 确保文件夹的子容器存在
      let childContainer = selectedElement.nextElementSibling;
      if (!childContainer || !childContainer.dataset.parent) {
        childContainer = document.createElement('div');
        childContainer.dataset.parent = selectedItemPath;
        childContainer.style.display = 'block';
        selectedElement.parentElement.insertBefore(childContainer, selectedElement.nextSibling);
      } else {
        // 如果子容器存在但被收起，则展开它
        expandedFolders.add(selectedItemPath);
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
      targetPath = parentContainer.dataset.parent || selectedItemPath;
    }
  } else {
    // 在data目录下创建（资源管理器最下方）
    targetContainer = fileTreeEl;
    // 获取data目录路径
    window.fsAPI.getFileTree().then(tree => {
      targetPath = tree.path;
      // 确保容器存在且可见
      if (!targetContainer.parentElement) {
        document.body.appendChild(targetContainer);
      }
      createInlineInput(targetContainer, targetPath, false);
    });
    return;
  }
  
  createInlineInput(targetContainer, targetPath, false);
}

// 开始重命名功能
function startRename(itemPath) {
  const selectedElement = document.querySelector(`[data-path="${itemPath}"]`);
  if (!selectedElement) return;
  
  const isFolder = selectedElement.classList.contains('folder-item');
  // 从路径中提取纯文件名，避免包含箭头等UI元素
  const currentName = itemPath.split('/').pop() || itemPath.split('\\').pop();
  
  // 创建重命名输入框
  createRenameInput(selectedElement, itemPath, currentName, isFolder);
}

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

// 刷新文件树
async function refreshFileTree() {
  await loadFileTree();
}

// 判断选中的项目是否为文件夹
function isSelectedItemFolder(itemPath) {
  // 通过文件树数据递归查找
  function findInTree(nodes, targetPath) {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return node.children !== undefined; // 有children属性说明是文件夹
      }
      if (node.children) {
        const result = findInTree(node.children, targetPath);
        if (result !== null) return result;
      }
    }
    return null;
  }
  
  // 如果有全局文件树数据，使用它来判断
  if (window.fileTreeData && window.fileTreeData.children) {
    const result = findInTree(window.fileTreeData.children, itemPath);
    if (result !== null) return result;
  }
  
  // 备用方案：通过路径特征判断（不够准确但可用）
  const fileName = itemPath.split('/').pop() || itemPath.split('\\').pop();
  return !fileName.includes('.'); // 简单判断：没有扩展名的可能是文件夹
}

// 导入文件功能
async function importFiles() {
  // 检查是否选中了文件夹
  if (!selectedItemPath) {
    alert('请先选择一个文件夹作为导入目标');
    return;
  }
  
  // 检查选中的是否为文件夹
  const isFolder = isSelectedItemFolder(selectedItemPath);
  if (!isFolder) {
    alert('请选择一个文件夹作为导入目标，不能导入到文件中');
    return;
  }
  
  try {
    // 打开文件选择器
    const selectResult = await window.fsAPI.selectFiles();
    
    if (!selectResult.success) {
      if (!selectResult.canceled) {
        alert('文件选择失败: ' + (selectResult.error || '未知错误'));
      }
      return;
    }
    
    if (!selectResult.filePaths || selectResult.filePaths.length === 0) {
      return;
    }
    
    // 显示导入进度提示
    const progressMsg = `正在导入 ${selectResult.filePaths.length} 个项目...`;
    console.log(progressMsg);
    
    // 执行导入操作
    const importResult = await window.fsAPI.importFiles(selectedItemPath, selectResult.filePaths);
    
    if (!importResult.success) {
      alert('导入失败: ' + (importResult.error || '未知错误'));
      return;
    }
    
    // 处理导入结果
    const results = importResult.results;
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    let message = `导入完成！成功: ${successCount} 个`;
    if (failCount > 0) {
      message += `，失败: ${failCount} 个`;
      const failedItems = results.filter(r => !r.success);
      const failedNames = failedItems.map(item => {
        const name = item.sourcePath.split('/').pop() || item.sourcePath.split('\\').pop();
        return `${name}: ${item.error}`;
      }).join('\n');
      message += `\n\n失败详情:\n${failedNames}`;
    }
    
    alert(message);
    
    // 刷新文件树
    await loadFileTree();
    
  } catch (error) {
    console.error('导入文件时发生错误:', error);
    alert('导入文件时发生错误: ' + error.message);
  }
}

// 创建删除确认弹窗
function createDeleteModal(itemPath, isFolder) {
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
    background-color: var(--bg-color);
    color: var(--text-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  
  // 确定按钮（红色背景）
  const confirmButton = document.createElement('button');
  confirmButton.textContent = '确定';
  confirmButton.style.cssText = `
    padding: 8px 16px;
    border: none;
    background-color: #dc3545;
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;
  
  // 按钮悬浮效果
  cancelButton.addEventListener('mouseenter', () => {
    cancelButton.style.backgroundColor = 'var(--tree-hover)';
  });
  cancelButton.addEventListener('mouseleave', () => {
    cancelButton.style.backgroundColor = 'var(--bg-color)';
  });
  
  confirmButton.addEventListener('mouseenter', () => {
    confirmButton.style.backgroundColor = '#c82333';
  });
  confirmButton.addEventListener('mouseleave', () => {
    confirmButton.style.backgroundColor = '#dc3545';
  });
  
  // 事件处理
  const closeModal = () => {
    document.body.removeChild(overlay);
  };
  
  cancelButton.addEventListener('click', closeModal);
  
  confirmButton.addEventListener('click', async () => {
    try {
      const result = await window.fsAPI.deleteItem(itemPath);
      if (result.success) {
        await loadFileTree(); // 刷新文件树
        selectedItemPath = null; // 清除选中状态
        
        // 检查删除的文件是否在FileViewer中打开
        if (fileViewer && fileViewer.tabs.has(itemPath)) {
          fileViewer.closeTab(itemPath);
        }
        
        // 如果没有打开的标签页，显示欢迎消息
        if (fileViewer && fileViewer.tabs.size === 0) {
          const welcomeMessage = fileViewer.contentContainer.querySelector('.welcome-message');
          if (welcomeMessage) {
            welcomeMessage.style.display = 'flex';
          }
        }
      } else {
        alert(`删除失败: ${result.error}`);
      }
    } catch (error) {
      console.error('删除操作失败:', error);
      alert(`删除失败: ${error.message}`);
    }
    closeModal();
  });
  
  // 点击遮罩层关闭弹窗
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  });
  
  // ESC键关闭弹窗
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', handleKeyDown);
    }
  };
  document.addEventListener('keydown', handleKeyDown);
  
  // 组装弹窗
  buttonContainer.appendChild(cancelButton);
  buttonContainer.appendChild(confirmButton);
  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(buttonContainer);
  overlay.appendChild(modal);
  
  // 显示弹窗
  document.body.appendChild(overlay);
  
  // 聚焦到确定按钮
  setTimeout(() => confirmButton.focus(), 100);
}

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
  setTimeout(async () => {
    await testPythonBackend();
  }, 2000);
  
  // 渲染图标
  renderIcons();
  
  // 初始化文件查看器
  initFileViewer();
  
  // 添加键盘事件监听器
  document.addEventListener('keydown', (e) => {
    // 当按下回车键且有选中的文件/文件夹时触发重命名
    if (e.key === 'Enter' && selectedItemPath && !document.querySelector('.inline-input')) {
      e.preventDefault();
      startRename(selectedItemPath);
    }
  });
  
  // 绑定新建文件夹和新建文件按钮事件
  document.getElementById('new-folder').addEventListener('click', createFolder);
  document.getElementById('new-file').addEventListener('click', createFile);
  document.getElementById('refresh-tree').addEventListener('click', refreshFileTree);
  document.getElementById('import-files').addEventListener('click', importFiles);
  
  // 绑定删除按钮事件
  document.getElementById('delete-item').addEventListener('click', () => {
    if (!selectedItemPath) {
      alert('请先选择要删除的文件或文件夹');
      return;
    }
    
    // 通过文件树数据判断是文件还是文件夹
    const isFolder = isSelectedItemFolder(selectedItemPath);
    createDeleteModal(selectedItemPath, isFolder);
  });
  
  // 初始化拖拽调整功能
  initResizer();
  
  // 获取并显示文件树
  await loadFileTree();
  
  // 默认显示文件页面
  showFilePage();
})();

