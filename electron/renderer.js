const fileTreeEl = document.getElementById('file-tree');
const fileContentEl = document.getElementById('file-content');
const settingsPageEl = document.getElementById('settings-page');
const settingsBtn = document.getElementById('settings-btn');
const darkModeToggle = document.getElementById('dark-mode-toggle');

// 渲染SVG图标
function renderIcons() {
  document.getElementById('file-icon').innerHTML = icons.file;
  document.getElementById('settings-icon').innerHTML = icons.settings;
  document.getElementById('folder-icon').innerHTML = icons.folder;
  document.getElementById('new-file-icon').innerHTML = icons.newFile;
  document.getElementById('refresh-icon').innerHTML = icons.refresh;
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

// 渲染文件树（递归）
function renderTree(node, container) {
  const div = document.createElement('div');
  div.textContent = node.name;
  div.className = 'file-item';

  if (node.children) {
    div.style.fontWeight = 'bold';
    container.appendChild(div);
    const childContainer = document.createElement('div');
    childContainer.style.paddingLeft = '15px';
    node.children.forEach(child => renderTree(child, childContainer));
    container.appendChild(childContainer);
  } else {
    div.addEventListener('click', async () => {
      const content = await window.fsAPI.readFile(node.path);
      fileContentEl.textContent = content;
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
    if (width < 200) {
      resourceTitle.textContent = '资源...';
    } else {
      resourceTitle.textContent = '资源管理器';
    }
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
    // 限制最小和最大宽度
    if (newWidth >= 150 && newWidth <= 500) {
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
  
  // 初始化拖拽调整功能
  initResizer();
  
  // 获取文件树
  const tree = await window.fsAPI.getFileTree();
  fileTreeEl.innerHTML = '';
  renderTree(tree, fileTreeEl);
  
  // 默认显示文件页面
  showFilePage();
})();

