(function initViewStateModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const state = {
    isSearchMode: false,
    eventsBound: false,
    activeMode: 'file'
  };

  const dependencies = {
    getSettingsModule: () => global.settingsModule,
    getDatabaseModule: () => global.databaseModule,
    getFileTreeEl: () => document.getElementById('file-tree'),
    getFileTreeContainer: () => document.getElementById('file-tree-container'),
    getResizerEl: () => document.getElementById('file-tree-resizer'),
    getSearchAreaEl: () => document.getElementById('search-area'),
    getResourceTitleEl: () => document.getElementById('resource-title'),
    getDatabasePageEl: () => document.getElementById('database-page'),
    getHeaderButtons: () => document.querySelectorAll('#file-tree-header > div > button'),
    getSearchButton: () => document.getElementById('search-btn'),
    getSearchInput: () => document.getElementById('search-input'),
    getDatabaseButton: () => document.getElementById('database-btn'),
    getToggleTreeButton: () => document.getElementById('toggle-tree'),
    getChatButton: () => document.getElementById('chat-btn'),
    getChatHistoryContainer: () => document.getElementById('chat-history-container'),
    getChatPageEl: () => document.getElementById('chat-page'),
    getChatModule: () => global.chatModule,
    getFileContentEl: () => document.getElementById('file-content'),
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

  function hideDatabasePage() {
    const page = dependencies.getDatabasePageEl && dependencies.getDatabasePageEl();
    if (page) {
      page.style.display = 'none';
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
      resourceTitle.textContent = '对话历史';
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
          event.preventDefault();
          dependencies.performSearch(searchInput.value);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          switchToFileMode();
        }
      });

      searchInput.addEventListener('input', (event) => {
        const searchState = dependencies.getSearchState ? dependencies.getSearchState() : null;
        if (searchState) {
          searchState.query = event.target.value;
        }
      });

      searchInput.addEventListener('focus', () => {
        dependencies.renderSearchHistory();
      });
    }

    const databaseBtn = dependencies.getDatabaseButton();
    const getDatabaseModule = dependencies.getDatabaseModule;
    if (databaseBtn) {
      databaseBtn.addEventListener('click', () => {
        const databaseModule = getDatabaseModule ? getDatabaseModule() : null;
        if (databaseModule && typeof databaseModule.showDatabasePage === 'function') {
          databaseModule.showDatabasePage();
        }
      });
    }

    const toggleTreeBtn = dependencies.getToggleTreeButton();
    if (toggleTreeBtn) {
      toggleTreeBtn.addEventListener('click', () => {
        if (state.isSearchMode || state.activeMode === 'chat') {
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
    isSearchMode: getIsSearchMode
  };

  global.switchToSearchMode = switchToSearchMode;
  global.switchToFileMode = switchToFileMode;
  global.switchToChatMode = switchToChatMode;
  Object.defineProperty(global, 'isSearchMode', {
    configurable: true,
    get: () => state.isSearchMode
  });
})(window);
