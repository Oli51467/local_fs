(function initViewStateModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const state = {
    isSearchMode: false,
    eventsBound: false,
    activeMode: 'file',
    searchInputBaseHeight: null,
    searchInputMaxHeight: null
  };

  const dependencies = {
    getSettingsModule: () => global.settingsModule,
    getDatabaseModule: () => global.databaseModule,
    getModelModule: () => global.modelModule,
    getFileTreeEl: () => document.getElementById('file-tree'),
    getFileTreeContainer: () => document.getElementById('file-tree-container'),
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
    getChatModule: () => global.chatModule,
    getFileContentEl: () => document.getElementById('file-content'),
    // 新增：Settings/Github 依赖
    getSettingsPageEl: () => document.getElementById('settings-page'),
    getGithubPageEl: () => document.getElementById('github-page'),
    getGithubButton: () => document.getElementById('github-btn'),
    getSearchState: () => global.searchState,
    initializeSearchUI: () => {},
    showSearchResultsPane: () => {},
    hideSearchResultsPane: () => {},
    renderSearchResults: () => {},
    renderSearchHistory: () => {},
    updateSearchModeUI: () => {},
    performSearch: () => {}
  };

  function configure(overrides = {}) {
    Object.keys(overrides).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(dependencies, key) && typeof overrides[key] === 'function') {
        dependencies[key] = overrides[key];
      }
    });
  }

  function autoResizeSearchInput(input) {
    if (!input) {
      return;
    }
    if (!state.searchInputBaseHeight || !state.searchInputMaxHeight) {
      const computed = window.getComputedStyle(input);
      const minHeight = parseFloat(computed.minHeight) || parseFloat(computed.lineHeight) || 32;
      const maxHeight = parseFloat(computed.maxHeight);
      state.searchInputBaseHeight = minHeight;
      state.searchInputMaxHeight = Number.isNaN(maxHeight) ? Math.max(minHeight, 240) : maxHeight;
    }
    input.style.height = 'auto';
    const nextHeight = Math.min(
      state.searchInputMaxHeight,
      Math.max(state.searchInputBaseHeight, input.scrollHeight)
    );
    input.style.height = `${nextHeight}px`;
  }

  function resetSearchInputHeight(input) {
    if (!input) {
      return;
    }
    input.style.height = '';
    state.searchInputBaseHeight = null;
    state.searchInputMaxHeight = null;
    autoResizeSearchInput(input);
  }

  function hideDatabasePage() {
    const page = dependencies.getDatabasePageEl && dependencies.getDatabasePageEl();
    if (page) {
      page.style.display = 'none';
    }
  }

  function hideModelPage() {
    const moduleInstance = dependencies.getModelModule ? dependencies.getModelModule() : null;
    if (moduleInstance && typeof moduleInstance.hideModelPage === 'function') {
      moduleInstance.hideModelPage();
      return;
    }
    const page = dependencies.getModelPageEl && dependencies.getModelPageEl();
    if (page) {
      page.style.display = 'none';
    }
  }

  // 新增：隐藏Github页面
  function hideGithubPage() {
    const page = dependencies.getGithubPageEl && dependencies.getGithubPageEl();
    if (page) {
      page.style.display = 'none';
    }
  }

  // 新增：隐藏设置页面
  function hideSettingsPage() {
    const settingsPage = dependencies.getSettingsPageEl && dependencies.getSettingsPageEl();
    if (settingsPage) {
      settingsPage.style.display = 'none';
    }
  }

  function updateHeaderButtons(display) {
    const buttons = dependencies.getHeaderButtons ? dependencies.getHeaderButtons() : null;
    if (buttons && typeof buttons.forEach === 'function') {
      buttons.forEach((btn) => {
        btn.style.display = display;
      });
    }
  }

  function hideChatInterface() {
    const chatModule = dependencies.getChatModule ? dependencies.getChatModule() : null;
    if (chatModule && typeof chatModule.hideChatPage === 'function') {
      chatModule.hideChatPage();
    } else {
      const chatHistory = dependencies.getChatHistoryContainer ? dependencies.getChatHistoryContainer() : null;
      if (chatHistory) {
        chatHistory.style.display = 'none';
      }
      const chatPage = dependencies.getChatPageEl ? dependencies.getChatPageEl() : null;
      if (chatPage) {
        chatPage.style.display = 'none';
      }
    }

    if (chatModule && typeof chatModule.leaveChatMode === 'function') {
      chatModule.leaveChatMode();
    }
  }

  function switchToSearchMode() {
    state.isSearchMode = true;
    state.activeMode = 'search';

    hideChatInterface();

    const settings = dependencies.getSettingsModule ? dependencies.getSettingsModule() : null;
    if (settings && typeof settings.showFilePage === 'function') {
      settings.showFilePage();
    }

    hideDatabasePage();
    hideModelPage();
    hideGithubPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'none';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'block';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '搜索';
    }

    updateHeaderButtons('none');

    dependencies.initializeSearchUI();
    dependencies.showSearchResultsPane();
    dependencies.renderSearchHistory();

    const searchInput = dependencies.getSearchInput();
    const searchState = dependencies.getSearchState ? dependencies.getSearchState() : null;
    if (searchInput) {
      if (searchState && searchState.query) {
        searchInput.value = searchState.query;
      }
      autoResizeSearchInput(searchInput);
      try {
        searchInput.focus();
      } catch (error) {
        console.warn('搜索输入框无法聚焦:', error);
      }
    }

    dependencies.renderSearchResults();
    dependencies.updateSearchModeUI();
  }

  function switchToFileMode() {
    state.isSearchMode = false;
    state.activeMode = 'file';

    hideChatInterface();

    hideDatabasePage();
    hideModelPage();
    hideGithubPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'block';
    }

    const fileTreeContainer = dependencies.getFileTreeContainer ? dependencies.getFileTreeContainer() : null;
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'flex';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'none';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '资源管理器';
    }

    updateHeaderButtons('inline-block');

    const searchInput = dependencies.getSearchInput();
    if (searchInput) {
      searchInput.value = '';
      resetSearchInputHeight(searchInput);
    }

    const fileContent = dependencies.getFileContentEl ? dependencies.getFileContentEl() : null;
    if (fileContent) {
      fileContent.style.display = 'block';
    }

    dependencies.hideSearchResultsPane();
    dependencies.renderSearchResults();
  }

  function switchToChatMode() {
    state.isSearchMode = false;
    state.activeMode = 'chat';

    const settings = dependencies.getSettingsModule ? dependencies.getSettingsModule() : null;
    if (settings && typeof settings.showFilePage === 'function') {
      settings.showFilePage();
    }

    hideDatabasePage();
    hideModelPage();
    hideGithubPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'none';
    }

    const fileTreeContainer = dependencies.getFileTreeContainer ? dependencies.getFileTreeContainer() : null;
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'none';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '对话';
    }

    updateHeaderButtons('none');

    const fileContent = dependencies.getFileContentEl ? dependencies.getFileContentEl() : null;
    if (fileContent) {
      fileContent.style.display = 'none';
    }

    const chatHistory = dependencies.getChatHistoryContainer ? dependencies.getChatHistoryContainer() : null;
    if (chatHistory) {
      chatHistory.style.display = 'flex';
    }

    const chatPage = dependencies.getChatPageEl ? dependencies.getChatPageEl() : null;
    if (chatPage) {
      chatPage.style.display = 'flex';
    }

    const chatModule = dependencies.getChatModule ? dependencies.getChatModule() : null;
    if (chatModule && typeof chatModule.showChatPage === 'function') {
      chatModule.showChatPage();
    }

    if (chatModule && typeof chatModule.enterChatMode === 'function') {
      Promise.resolve(chatModule.enterChatMode()).catch((error) => {
        console.error('进入对话模式失败:', error);
      });
    }
  }

  function switchToModelMode() {
    state.isSearchMode = false;
    state.activeMode = 'model';

    hideChatInterface();
    hideDatabasePage();
    hideGithubPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'none';
    }

    const fileTreeContainer = dependencies.getFileTreeContainer ? dependencies.getFileTreeContainer() : null;
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'none';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '模型';
    }

    updateHeaderButtons('none');

    const fileContent = dependencies.getFileContentEl ? dependencies.getFileContentEl() : null;
    if (fileContent) {
      fileContent.style.display = 'none';
    }

    const modelModule = dependencies.getModelModule ? dependencies.getModelModule() : null;
    if (modelModule && typeof modelModule.showModelPage === 'function') {
      modelModule.showModelPage();
    } else {
      const modelPageEl = dependencies.getModelPageEl ? dependencies.getModelPageEl() : null;
      if (modelPageEl) {
        modelPageEl.style.display = 'flex';
      }
    }
  }

  function switchToDatabaseMode() {
    state.isSearchMode = false;
    state.activeMode = 'database';

    hideChatInterface();
    hideModelPage();
    hideGithubPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'none';
    }

    const fileTreeContainer = dependencies.getFileTreeContainer ? dependencies.getFileTreeContainer() : null;
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'none';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '数据库';
    }

    updateHeaderButtons('none');

    const fileContent = dependencies.getFileContentEl ? dependencies.getFileContentEl() : null;
    if (fileContent) {
      fileContent.style.display = 'none';
    }

    dependencies.hideSearchResultsPane();

    const databaseModule = dependencies.getDatabaseModule ? dependencies.getDatabaseModule() : null;
    if (databaseModule && typeof databaseModule.showDatabasePage === 'function') {
      databaseModule.showDatabasePage();
    } else {
      const databasePage = dependencies.getDatabasePageEl ? dependencies.getDatabasePageEl() : null;
      if (databasePage) {
        databasePage.style.display = 'block';
      }
    }
  }

  // 新增：切换到Github页面
  function switchToGithubMode() {
    state.isSearchMode = false;
    state.activeMode = 'github';

    hideChatInterface();
    hideDatabasePage();
    hideModelPage();
    hideSettingsPage();

    const fileTreeEl = dependencies.getFileTreeEl();
    if (fileTreeEl) {
      fileTreeEl.style.display = 'none';
    }

    const fileTreeContainer = dependencies.getFileTreeContainer ? dependencies.getFileTreeContainer() : null;
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }

    const searchArea = dependencies.getSearchAreaEl();
    if (searchArea) {
      searchArea.style.display = 'none';
    }

    const resourceTitle = dependencies.getResourceTitleEl();
    if (resourceTitle) {
      resourceTitle.textContent = '';
    }

    updateHeaderButtons('none');

    const fileContent = dependencies.getFileContentEl ? dependencies.getFileContentEl() : null;
    if (fileContent) {
      fileContent.style.display = 'none';
    }

    dependencies.hideSearchResultsPane();

    // 显示Github页面
    const githubPage = dependencies.getGithubPageEl ? dependencies.getGithubPageEl() : null;
    if (githubPage) {
      // 以 flex 方式显示以撑满主面板宽度
      githubPage.style.display = 'flex';
    }

    // 尝试让外层容器承担滚动：根据内容高度调整 webview 高度
    const webview = dependencies.getGithubWebview ? dependencies.getGithubWebview() : null;
    if (webview) {
      // 进入页面时，确保webview至少占满容器高度
      webview.style.display = 'block';
      webview.style.height = '100%';
      webview.style.minHeight = '';

      const updateHeight = async () => {
        try {
          const h = await webview.executeJavaScript('document.documentElement.scrollHeight');
          // 安全回退：避免设置为0，保证可见
          const page = dependencies.getGithubPageEl ? dependencies.getGithubPageEl() : null;
          const base = page ? (page.clientHeight || 400) : 400;
          const safeHeight = Math.max(Number(h) || 0, base);
          // 使用 minHeight 让外层容器滚动，同时不压缩到0
          webview.style.minHeight = `${safeHeight}px`;
        } catch (e) {
          console.warn('计算GitHub页面高度失败:', e);
          // 回退：至少填充父容器高度
          webview.style.minHeight = '400px';
        }
      };
      if (!webview.__autosizeBound) {
        webview.addEventListener('dom-ready', updateHeight, { once: true });
        webview.addEventListener('did-navigate', updateHeight);
        webview.addEventListener('did-stop-loading', updateHeight);
        webview.__autosizeBound = true;
      }
      // 切换到页面时也主动计算一次
      updateHeight();
    }
  }

  function initResizer() {
    const resizer = dependencies.getResizerEl();
    const fileTreeContainer = dependencies.getFileTreeContainer();
    const resourceTitle = dependencies.getResourceTitleEl();
    if (!resizer || !fileTreeContainer || !resourceTitle) {
      return;
    }

    let startX;
    let startWidth;

    const updateResourceTitle = (width) => {
      resourceTitle.textContent = '资源管理器';
    };

    const startResize = (event) => {
      startX = event.clientX;
      startWidth = parseInt(document.defaultView.getComputedStyle(fileTreeContainer).width, 10);
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    };

    const resize = (event) => {
      const newWidth = startWidth + (event.clientX - startX);
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

    updateResourceTitle(parseInt(document.defaultView.getComputedStyle(fileTreeContainer).width, 10));
    resizer.addEventListener('mousedown', startResize);
  }

  function bindEventListeners() {
    if (state.eventsBound) {
      return;
    }

    const searchBtn = dependencies.getSearchButton();
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        switchToSearchMode();
      });
    }

    const chatBtn = dependencies.getChatButton ? dependencies.getChatButton() : null;
    if (chatBtn) {
      chatBtn.addEventListener('click', () => {
        switchToChatMode();
      });
    }

    const searchInput = dependencies.getSearchInput();
    if (searchInput) {
      searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          if (event.shiftKey) {
            requestAnimationFrame(() => autoResizeSearchInput(searchInput));
          } else {
            event.preventDefault();
            dependencies.performSearch(searchInput.value);
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          switchToFileMode();
        }
      });

      searchInput.addEventListener('input', (event) => {
        const searchState = dependencies.getSearchState ? dependencies.getSearchState() : null;
        if (searchState) {
          searchState.query = event.target.value;
        }
        autoResizeSearchInput(searchInput);
      });

      searchInput.addEventListener('focus', () => {
        autoResizeSearchInput(searchInput);
        dependencies.renderSearchHistory();
      });

      autoResizeSearchInput(searchInput);
    }

    const databaseBtn = dependencies.getDatabaseButton();
    const getDatabaseModule = dependencies.getDatabaseModule;
    if (databaseBtn) {
      databaseBtn.addEventListener('click', () => {
        const databaseModule = getDatabaseModule ? getDatabaseModule() : null;
        if (databaseModule && typeof databaseModule.showDatabasePage === 'function') {
          switchToDatabaseMode();
        }
      });
    }

    const modelBtn = dependencies.getModelButton ? dependencies.getModelButton() : null;
    if (modelBtn) {
      modelBtn.addEventListener('click', () => {
        switchToModelMode();
      });
    }

    // 新增：Github按钮事件绑定
    const githubBtn = dependencies.getGithubButton ? dependencies.getGithubButton() : null;
    if (githubBtn) {
      githubBtn.addEventListener('click', () => {
        switchToGithubMode();
      });
    }

    const toggleTreeBtn = dependencies.getToggleTreeButton();
    if (toggleTreeBtn) {
      toggleTreeBtn.addEventListener('click', () => {
        if (state.isSearchMode || state.activeMode === 'chat' || state.activeMode === 'model' || state.activeMode === 'database' || state.activeMode === 'github') {
          switchToFileMode();
        }
      });
    }

    state.eventsBound = true;
  }

  function init() {
    initResizer();
    bindEventListeners();
  }

  function getIsSearchMode() {
    return state.isSearchMode;
  }

  modules.viewState = {
    configure,
    init,
    bindEventListeners,
    initResizer,
    switchToSearchMode,
    switchToFileMode,
    switchToChatMode,
    switchToDatabaseMode,
    switchToModelMode,
    // 新增：导出Github模式切换
    switchToGithubMode,
    autoResizeSearchInput,
    isSearchMode: getIsSearchMode
  };

  global.switchToSearchMode = switchToSearchMode;
  global.switchToFileMode = switchToFileMode;
  global.switchToChatMode = switchToChatMode;
  global.switchToDatabaseMode = switchToDatabaseMode;
  global.switchToModelMode = switchToModelMode;
  // 新增：全局导出Github切换
  global.switchToGithubMode = switchToGithubMode;
  Object.defineProperty(global, 'isSearchMode', {
    configurable: true,
    get: () => state.isSearchMode
  });
})(window);
