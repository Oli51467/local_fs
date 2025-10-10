const fileTreeEl = document.getElementById('file-tree');
const fileTreeContainer = document.getElementById('file-tree-container');
const fileContentEl = document.getElementById('file-content');
// 设置相关元素已移至设置模块管理

// 初始化文件查看器
let fileViewer = null;
let imageViewer = null;

const loadingOverlayModule = window.RendererModules && window.RendererModules.loadingOverlay;
if (!loadingOverlayModule) {
  throw new Error('loadingOverlay module failed to load');
}

const {
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingOverlayProgress,
  setLoadingOverlayIndeterminate,
  startLoadingOverlayProgressLoop,
  updateLoadingOverlayProgressLoop,
  stopLoadingOverlayProgressLoop
} = loadingOverlayModule;

const uploadStatusModule = window.RendererModules && window.RendererModules.uploadStatus;
if (!uploadStatusModule) {
  throw new Error('uploadStatus module failed to load');
}

const {
  setFileTreeRoot: setUploadStatusFileTreeRoot,
  setExpandedFoldersAccessor: setUploadStatusExpandedFoldersAccessor,
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
} = uploadStatusModule;

setUploadStatusFileTreeRoot(fileTreeEl);

const searchModule = window.RendererModules && window.RendererModules.search;
if (!searchModule) {
  throw new Error('search module failed to load');
}

const {
  configure: configureSearchModule,
  SEARCH_MODES,
  searchState,
  loadSearchHistory,
  saveSearchHistory,
  recordSearchHistory,
  renderSearchHistory,
  initializeSearchUI,
  showSearchResultsPane,
  hideSearchResultsPane,
  renderSearchResults,
  updateSearchModeUI,
  setSearchMode,
  performSearch
} = searchModule;

loadSearchHistory();

const modalModule = window.RendererModules && window.RendererModules.modalNotifications;
if (!modalModule) {
  throw new Error('modalNotifications module failed to load');
}

const {
  showModal,
  closeAllModals,
  showAlert,
  showSuccessModal
} = modalModule;

window.showModal = showModal;
window.closeAllModals = closeAllModals;
window.showAlert = showAlert;
window.showSuccessModal = showSuccessModal;

const fileTreeModule = window.RendererModules && window.RendererModules.fileTree;
if (!fileTreeModule) {
  throw new Error('fileTree module failed to load');
}

const {
  configure: configureFileTreeModule,
  init: initFileTreeModule,
  loadFileTree,
  getSelectedItemPath,
  setSelectedItemPath,
  getExpandedFolders
} = fileTreeModule;

const viewStateModule = window.RendererModules && window.RendererModules.viewState;
if (!viewStateModule) {
  throw new Error('viewState module failed to load');
}

const {
  configure: configureViewStateModule,
  init: initViewStateModule,
  switchToSearchMode,
  switchToFileMode,
  isSearchMode: viewStateIsSearchMode
} = viewStateModule;

function renderIcons() {
  if (!window.icons) {
    console.warn('图标资源未加载');
    return;
  }

  const elements = [
    { id: 'file-icon', icon: icons.file },
    { id: 'search-icon', icon: icons.search },
    { id: 'chat-icon', icon: icons.chat },
    { id: 'model-icon', icon: icons.model },
    { id: 'settings-icon', icon: icons.settings },
    { id: 'database-icon', icon: icons.database }
  ];

  elements.forEach(({ id, icon }) => {
    const target = document.getElementById(id);
    if (target && typeof icon === 'string') {
      target.innerHTML = icon;
    }
  });
}

function ensureGlobalImageViewer() {
  if (window.__globalImageViewer) {
    imageViewer = window.__globalImageViewer;
    return imageViewer;
  }

  if (window.ImageViewer) {
    try {
      imageViewer = new window.ImageViewer();
      window.__globalImageViewer = imageViewer;
    } catch (error) {
      console.error('初始化 ImageViewer 失败:', error);
      imageViewer = null;
    }
  }

  return imageViewer;
}

let settingsModule;
let explorerModule;
let databaseModule;
let chatModule;
let modelModule;
let splashScreen;

configureViewStateModule({
  getSettingsModule: () => settingsModule,
  getModelModule: () => modelModule,
  getDatabaseModule: () => databaseModule,
  getFileTreeEl: () => fileTreeEl,
  getFileTreeContainer: () => fileTreeContainer,
  getResizerEl: () => document.getElementById('file-tree-resizer'),
  getSearchAreaEl: () => document.getElementById('search-area'),
  getResourceTitleEl: () => document.getElementById('resource-title'),
  getDatabasePageEl: () => document.getElementById('database-page'),
  getModelPageEl: () => document.getElementById('model-page'),
  getHeaderButtons: () => document.querySelectorAll('#file-tree-header > div > button'),
  getSearchButton: () => document.getElementById('search-btn'),
  getSearchInput: () => document.getElementById('search-input'),
  getDatabaseButton: () => document.getElementById('database-btn'),
  getModelButton: () => document.getElementById('model-btn'),
  getToggleTreeButton: () => document.getElementById('toggle-tree'),
  getChatButton: () => document.getElementById('chat-btn'),
  getChatHistoryContainer: () => document.getElementById('chat-history-container'),
  getChatPageEl: () => document.getElementById('chat-page'),
  getChatModule: () => chatModule,
  getFileContentEl: () => fileContentEl,
  getSearchState: () => searchState,
  initializeSearchUI,
  showSearchResultsPane,
  hideSearchResultsPane,
  renderSearchResults,
  renderSearchHistory,
  updateSearchModeUI,
  performSearch
});

configureFileTreeModule({
  getFileTreeEl: () => fileTreeEl,
  getFileTreeContainer: () => fileTreeContainer,
  getExplorerModule: () => explorerModule,
  getFileViewer: () => fileViewer,
  setFileViewer: (viewer) => {
    fileViewer = viewer;
  },
  showModal,
  closeAllModals,
  showAlert,
  showSuccessModal,
  showLoadingOverlay,
  hideLoadingOverlay,
  setLoadingOverlayProgress,
  setLoadingOverlayIndeterminate,
  startLoadingOverlayProgressLoop,
  updateLoadingOverlayProgressLoop,
  stopLoadingOverlayProgressLoop,
  updateFolderUploadStatus,
  refreshFolderUploadIndicators,
  resolveNodeRelativePath
});

setUploadStatusExpandedFoldersAccessor(() => getExpandedFolders());

configureSearchModule({
  getFileContentEl: () => fileContentEl,
  isSearchMode: () => viewStateIsSearchMode(),
  switchToSearchMode,
  switchToFileMode,
  getExplorerModule: () => explorerModule,
  getFileViewer: () => fileViewer,
  setFileViewer: (viewer) => {
    fileViewer = viewer;
  },
  getSelectedItemPath,
  setSelectedItemPath,
  showAlert
});

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

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化启动页面
  splashScreen = new SplashScreen();
  
  // 监听应用准备就绪事件
  document.addEventListener('appReady', async () => {
    // 渲染侧边栏图标
    renderIcons();
    
    settingsModule = new SettingsModule();
    await settingsModule.init();
    window.settingsModule = settingsModule;
    
    databaseModule = new DatabaseModule();
    
    modelModule = new ModelModule({
      getSettingsModule: () => settingsModule
    });
    modelModule.init();
    window.modelModule = modelModule;
    
    // 默认显示文件页面
    settingsModule.showFilePage();
    
    explorerModule = new ExplorerModule();
    
    chatModule = new ChatModule();
    await chatModule.init();
    window.chatModule = chatModule;
    
    // 获取ExplorerModule中的fileViewer实例
    fileViewer = explorerModule.getFileViewer();
    console.log('FileViewer初始化状态:', fileViewer ? '成功' : '失败');

    ensureGlobalImageViewer();

    initializeSearchUI();
    

    if (typeof refreshVisibleFolderUploadStatus === 'function') {
      try {
        await refreshVisibleFolderUploadStatus();
      } catch (error) {
        console.error('初始化根目录上传状态失败:', error);
      }
    }
    
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




// 创建内联编辑输入框
// createInlineInput 函数已移至 ExplorerModule

// createFolder 和 createFile 函数已移至 ExplorerModule

// startRename 函数已移至 ExplorerModule

// 创建重命名输入框
// 连接Python后端API
async function testPythonBackend() {
  try {
    const response = await fetch('http://127.0.0.1:8000/api/health/ready');
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

(async () => {
  initViewStateModule();
  initFileTreeModule();
  await loadFileTree();
})();
