(function initSearchModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  const dependencies = {
    getFileContentEl: () => document.getElementById('file-content'),
    isSearchMode: () => Boolean(global.isSearchMode),
    switchToSearchMode: () => {
      if (typeof global.switchToSearchMode === 'function') {
        global.switchToSearchMode();
      }
    },
    switchToFileMode: () => {
      if (typeof global.switchToFileMode === 'function') {
        global.switchToFileMode();
      }
    },
    getExplorerModule: () => global.explorerModule,
    getFileViewer: () => global.fileViewer,
    setFileViewer: (viewer) => {
      global.fileViewer = viewer;
    },
    getSelectedItemPath: () => global.selectedItemPath,
    setSelectedItemPath: (value) => {
      global.selectedItemPath = value;
    },
    showAlert: (message, type) => {
      if (typeof global.showAlert === 'function') {
        global.showAlert(message, type);
      } else if (type === 'error') {
        console.error(message);
      } else {
        console.log(message);
      }
    }
  };

  function configure(overrides = {}) {
    Object.keys(overrides).forEach((key) => {
      const value = overrides[key];
      if (Object.prototype.hasOwnProperty.call(dependencies, key) && typeof value === 'function') {
        dependencies[key] = value;
      }
    });
  }

  function getFileContentElement() {
    const elementGetter = dependencies.getFileContentEl;
    try {
      const element = elementGetter && elementGetter();
      if (element && element instanceof HTMLElement) {
        return element;
      }
    } catch (error) {
      console.warn('获取文件内容容器失败:', error);
    }
    return document.getElementById('file-content');
  }

  function getExplorerModule() {
    try {
      return dependencies.getExplorerModule ? dependencies.getExplorerModule() : global.explorerModule;
    } catch (error) {
      console.warn('获取资源管理器模块失败:', error);
      return global.explorerModule;
    }
  }

  function getFileViewer() {
    try {
      return dependencies.getFileViewer ? dependencies.getFileViewer() : global.fileViewer;
    } catch (error) {
      console.warn('获取文件查看器失败:', error);
      return global.fileViewer;
    }
  }

  function setFileViewer(viewer) {
    if (typeof dependencies.setFileViewer === 'function') {
      dependencies.setFileViewer(viewer);
      return;
    }
    global.fileViewer = viewer;
  }

  function setSelectedItemPath(path) {
    if (typeof dependencies.setSelectedItemPath === 'function') {
      dependencies.setSelectedItemPath(path);
      return;
    }
    global.selectedItemPath = path;
  }

  function ensureSearchModeActive() {
    if (!dependencies.isSearchMode || !dependencies.isSearchMode()) {
      if (typeof dependencies.switchToSearchMode === 'function') {
        dependencies.switchToSearchMode();
      }
    }
  }

  function leaveSearchMode() {
    if (typeof dependencies.switchToFileMode === 'function') {
      dependencies.switchToFileMode();
    }
  }

  function notifyAlert(message, type) {
    if (typeof dependencies.showAlert === 'function') {
      dependencies.showAlert(message, type);
    }
  }

  const SEARCH_MODES = {
    TEXT: 'text',
    IMAGE: 'image'
  };

  const DEFAULT_IMAGE_CONFIDENCE = 0.35;
  const SEARCH_HISTORY_MAX_LABEL = 60;

  const searchState = {
    query: '',
    loading: false,
    error: null,
    mode: SEARCH_MODES.TEXT,
    exact: [],
    semantic: [],
    combined: [],
    images: [],
    meta: {
      exactTotal: 0,
      semanticTotal: 0,
      combinedTotal: 0,
      bm25sPerformed: false,
      rerankPerformed: false
    },
    imageMeta: {
      total: 0,
      threshold: 0.6
    }
  };

  let searchResultsContainer = null;
  let searchUIInitialized = false;
  let searchModeToggle = null;
  let searchModeButtons = [];

  const SEARCH_HISTORY_STORAGE_KEY = 'fs_search_history';
  const SEARCH_HISTORY_LIMIT = 5;
  let searchHistory = [];
  let searchHistoryContainer = null;

  function loadSearchHistory() {
    try {
      const stored = window.localStorage ? window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) : null;
      if (!stored) {
        searchHistory = [];
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        searchHistory = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item)
          .slice(0, SEARCH_HISTORY_LIMIT);
      } else {
        searchHistory = [];
      }
    } catch (error) {
      console.warn('加载搜索历史失败:', error);
      searchHistory = [];
    }
  }

  function saveSearchHistory() {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(searchHistory));
      }
    } catch (error) {
      console.warn('保存搜索历史失败:', error);
    }
  }

  function recordSearchHistory(query) {
    const normalized = (query || '').trim();
    if (!normalized) {
      return;
    }

    searchHistory = searchHistory.filter((item) => item !== normalized);
    searchHistory.unshift(normalized);
    if (searchHistory.length > SEARCH_HISTORY_LIMIT) {
      searchHistory = searchHistory.slice(0, SEARCH_HISTORY_LIMIT);
    }

    saveSearchHistory();
    renderSearchHistory();
  }

  function renderSearchHistory() {
    if (!searchHistoryContainer) {
      searchHistoryContainer = document.getElementById('search-history');
    }

    if (!searchHistoryContainer) {
      return;
    }

    searchHistoryContainer.innerHTML = '';

    if (!searchHistory.length) {
      searchHistoryContainer.style.display = 'none';
      return;
    }

    searchHistoryContainer.style.display = 'block';

    const title = document.createElement('div');
    title.className = 'search-history-title';
    title.textContent = '历史搜索';
    searchHistoryContainer.appendChild(title);

    const list = document.createElement('div');
    list.className = 'search-history-list';
    searchHistory.forEach((term) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'search-history-item';
      const display = term.length > SEARCH_HISTORY_MAX_LABEL
        ? `${term.slice(0, SEARCH_HISTORY_MAX_LABEL)}…`
        : term;
      item.textContent = display;
      item.title = term;
      item.addEventListener('click', () => {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.value = term;
        }
        searchState.query = term;
        performSearch(term);
      });
      list.appendChild(item);
    });
    searchHistoryContainer.appendChild(list);
  }

  function initializeSearchUI() {
    if (searchUIInitialized) {
      return;
    }

    const fileContentEl = getFileContentElement();

    if (!fileContentEl) {
      console.warn('搜索界面初始化失败: 未找到文件内容容器');
      return;
    }

    if (!document.getElementById('search-results-styles')) {
      const style = document.createElement('style');
      style.id = 'search-results-styles';
      style.textContent = `
        #search-results-container {
          display: none;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          width: 100%;
          background: var(--bg-color);
          color: var(--text-color);
          box-sizing: border-box;
        }

        #search-results-container .search-summary {
          font-size: 13px;
          color: var(--text-muted);
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }

        #search-results-container .search-summary strong {
          color: var(--text-color);
          font-weight: 600;
        }

        .search-result-status {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          color: var(--text-muted);
          text-align: center;
          gap: 12px;
        }

        .search-result-status .spinner {
          width: 32px;
          height: 32px;
          border: 4px solid rgba(59, 130, 246, 0.15);
          border-top-color: var(--accent-color);
          border-radius: 50%;
          animation: search-spin 0.8s linear infinite;
        }

        @keyframes search-spin {
          to {
            transform: rotate(360deg);
          }
        }

        .search-result-card {
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 12px;
          padding: 18px;
          background: var(--bg-color);
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
          transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .dark-mode .search-result-card {
          background: rgba(36, 36, 36, 0.92);
          border-color: rgba(75, 85, 99, 0.4);
        }

        .search-result-card:hover {
          transform: translateY(-2px);
          border-color: rgba(59, 130, 246, 0.35);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.12);
        }

        .search-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .search-card-title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          color: var(--text-color);
        }

        .search-card-path {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .search-card-snippet {
          font-size: 13px;
          line-height: 1.6;
          color: var(--text-color);
          white-space: pre-wrap;
        }

        .search-card-snippet mark {
          background: rgba(59, 130, 246, 0.22);
          color: inherit;
          padding: 0 2px;
          border-radius: 3px;
        }

        .search-card-image-preview {
          position: relative;
          border-radius: 8px;
          overflow: hidden;
          background: rgba(148, 163, 184, 0.15);
          border: 1px solid rgba(148, 163, 184, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 170px;
          height: 120px;
        }

        .search-card-image-preview img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }

        .search-card-image-layout {
          display: flex;
          gap: 16px;
          align-items: stretch;
        }

        .search-card-image-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .search-card-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          line-height: 1;
          padding: 4px 12px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.18);
          color: var(--text-muted, #475569);
          border: 1px solid rgba(148, 163, 184, 0.28);
        }

        .search-card-chip[data-variant="exact"] {
          background: rgba(147, 197, 253, 0.28);
          border-color: rgba(59, 130, 246, 0.35);
          color: rgba(30, 64, 175, 0.95);
        }

        .search-card-chip[data-variant="semantic"] {
          background: rgba(125, 211, 252, 0.26);
          border-color: rgba(14, 165, 233, 0.35);
          color: rgba(12, 74, 110, 0.95);
        }

        .search-card-chip[data-variant="image"] {
          background: rgba(148, 163, 184, 0.18);
          border-color: rgba(148, 163, 184, 0.28);
          color: var(--text-muted, #475569);
        }

        .search-card-chip[data-variant="source"] {
          background: rgba(148, 163, 184, 0.18);
          border-color: rgba(148, 163, 184, 0.28);
          color: var(--text-muted, #475569);
        }

        .dark-mode .search-card-chip {
          background: rgba(63, 63, 70, 0.45);
          border-color: rgba(99, 102, 241, 0.18);
          color: rgba(226, 232, 240, 0.85);
        }

        .dark-mode .search-card-chip[data-variant="exact"] {
          background: rgba(59, 130, 246, 0.25);
          border-color: rgba(37, 99, 235, 0.45);
          color: rgba(226, 232, 240, 0.92);
        }

        .dark-mode .search-card-chip[data-variant="semantic"] {
          background: rgba(14, 165, 233, 0.22);
          border-color: rgba(56, 189, 248, 0.38);
          color: rgba(224, 242, 254, 0.92);
        }

        .search-card-metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
        }
      `;
      document.head.appendChild(style);
    }

    searchResultsContainer = document.getElementById('search-results-container');
    if (!searchResultsContainer && fileContentEl) {
      searchResultsContainer = document.createElement('div');
      searchResultsContainer.id = 'search-results-container';
      searchResultsContainer.style.display = 'none';
      fileContentEl.appendChild(searchResultsContainer);
    }

    searchModeToggle = document.getElementById('search-mode-toggle');
    if (searchModeToggle) {
      searchModeButtons = Array.from(searchModeToggle.querySelectorAll('[data-mode]'));
      searchModeButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const mode = button.dataset.mode === 'image' ? SEARCH_MODES.IMAGE : SEARCH_MODES.TEXT;
          setSearchMode(mode, { triggerSearch: Boolean(searchState.query) });
        });
      });
      updateSearchModeUI();
    }

    searchUIInitialized = true;
  }

  function showSearchResultsPane() {
    if (!searchResultsContainer) {
      return;
    }

    const fileContentEl = getFileContentElement();
    const viewer = fileContentEl ? fileContentEl.querySelector('.file-viewer') : null;
    if (viewer) {
      if (viewer.dataset.previousDisplay === undefined) {
        viewer.dataset.previousDisplay = viewer.style.display || '';
      }
      viewer.style.display = 'none';
    }

    searchResultsContainer.style.display = 'flex';
  }

  function hideSearchResultsPane() {
    if (!searchResultsContainer) {
      return;
    }

    const fileContentEl = getFileContentElement();
    const viewer = fileContentEl ? fileContentEl.querySelector('.file-viewer') : null;
    if (viewer) {
      const previous = viewer.dataset.previousDisplay;
      viewer.style.display = previous !== undefined ? previous : '';
      delete viewer.dataset.previousDisplay;
    }

    searchResultsContainer.style.display = 'none';
  }

  function renderSearchResults() {
    if (!searchUIInitialized || !searchResultsContainer) {
      return;
    }

    searchResultsContainer.innerHTML = '';

    if (!dependencies.isSearchMode || !dependencies.isSearchMode()) {
      searchResultsContainer.style.display = 'none';
      return;
    }

    searchResultsContainer.style.display = 'flex';

    if (searchState.loading) {
      const status = document.createElement('div');
      status.className = 'search-result-status';
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      const text = document.createElement('span');
      text.textContent = `正在搜索 “${searchState.query}”…`;
      status.appendChild(spinner);
      status.appendChild(text);
      searchResultsContainer.appendChild(status);
      return;
    }

    if (searchState.error) {
      const status = document.createElement('div');
      status.className = 'search-result-status';
      const title = document.createElement('strong');
      title.textContent = '搜索失败';
      const message = document.createElement('span');
      message.textContent = searchState.error;
      status.appendChild(title);
      status.appendChild(message);
      searchResultsContainer.appendChild(status);
      return;
    }

    if (!searchState.query) {
      const status = document.createElement('div');
      status.className = 'search-result-status';
      const title = document.createElement('strong');
      title.textContent = '智能检索';
      const message = document.createElement('span');
      message.textContent = '输入关键词并按 Enter，即可检索文件内容。';
      status.appendChild(title);
      status.appendChild(message);
      searchResultsContainer.appendChild(status);
      return;
    }

    const combinedResults = Array.isArray(searchState.combined) && searchState.combined.length
      ? searchState.combined
      : [...(searchState.exact || []), ...(searchState.semantic || [])];

    if (!combinedResults.length) {
      const status = document.createElement('div');
      status.className = 'search-result-status';
      const title = document.createElement('strong');
      if (searchState.mode === SEARCH_MODES.IMAGE) {
        title.textContent = `未检索到与 “${searchState.query}” 相关的图片`;
      } else {
        title.textContent = `未找到与 “${searchState.query}” 匹配的内容`;
      }
      const message = document.createElement('span');
      if (searchState.mode === SEARCH_MODES.IMAGE) {
        message.textContent = '尝试描述图片的场景、主体或特征，或换一个关键词。';
      } else {
        message.textContent = '尝试调整关键词或缩短查询内容。';
      }
      status.appendChild(title);
      status.appendChild(message);
      searchResultsContainer.appendChild(status);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'search-summary';

    const queryText = document.createElement('strong');
    queryText.textContent = `“${searchState.query}”`;
    summary.appendChild(queryText);

    const totals = document.createElement('span');
    totals.textContent = `匹配 ${searchState.meta.combinedTotal || combinedResults.length} 条记录`;
    summary.appendChild(totals);

    if (searchState.mode === SEARCH_MODES.IMAGE) {
      const detail = document.createElement('span');
      const totalImages = searchState.imageMeta.total || combinedResults.length;
      detail.textContent = `图片 ${totalImages}`;
      summary.appendChild(detail);
    } else {
      const detail = document.createElement('span');
      detail.textContent = `字符 ${searchState.meta.exactTotal || searchState.exact.length} · 语义 ${searchState.meta.semanticTotal || searchState.semantic.length}`;
      summary.appendChild(detail);

      if (searchState.imageMeta.total) {
        const imageDetail = document.createElement('span');
        imageDetail.textContent = `图片 ${searchState.imageMeta.total}`;
        summary.appendChild(imageDetail);
      }
    }

    searchResultsContainer.appendChild(summary);

    combinedResults.forEach((result, index) => {
      const variant = getPrimaryVariant(result);
      const card = buildSearchCard(result, variant, index);
      searchResultsContainer.appendChild(card);
    });

    searchResultsContainer.scrollTop = 0;
  }

  function updateSearchModeUI() {
    if (!Array.isArray(searchModeButtons) || !searchModeButtons.length) {
      return;
    }
    searchModeButtons.forEach((button) => {
      const mode = button.dataset.mode === 'image' ? SEARCH_MODES.IMAGE : SEARCH_MODES.TEXT;
      button.classList.toggle('active', searchState.mode === mode);
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.placeholder = searchState.mode === SEARCH_MODES.IMAGE
        ? '输入图片描述或场景，检索相关图片'
        : '搜索文件内容';
    }
  }

  function resetSearchResultsState() {
    searchState.loading = false;
    searchState.error = null;
    searchState.exact = [];
    searchState.semantic = [];
    searchState.combined = [];
    searchState.images = [];
    searchState.meta = {
      exactTotal: 0,
      semanticTotal: 0,
      combinedTotal: 0,
      bm25sPerformed: false,
      rerankPerformed: false
    };
    searchState.imageMeta = {
      total: 0,
      threshold: DEFAULT_IMAGE_CONFIDENCE
    };
  }

  function setSearchMode(mode, options = {}) {
    const normalizedMode = mode === SEARCH_MODES.IMAGE ? SEARCH_MODES.IMAGE : SEARCH_MODES.TEXT;
    const triggerSearch = Boolean(options.triggerSearch);
    const forceRender = Boolean(options.forceRender);

    if (searchState.mode === normalizedMode && !forceRender) {
      updateSearchModeUI();
      if (forceRender) {
        renderSearchResults();
      }
      return;
    }

    searchState.mode = normalizedMode;
    resetSearchResultsState();
    updateSearchModeUI();
    renderSearchResults();

    if (triggerSearch && searchState.query) {
      performSearch(searchState.query);
    }
  }

  async function performSearch(rawQuery) {
    ensureSearchModeActive();

    initializeSearchUI();
    showSearchResultsPane();

    const normalizedQuery = (rawQuery || '').trim();
    searchState.query = normalizedQuery;

    if (!normalizedQuery) {
      resetSearchResultsState();
      searchState.query = '';
      renderSearchResults();
      return;
    }

    recordSearchHistory(normalizedQuery);

    searchState.loading = true;
    searchState.error = null;
    searchState.exact = [];
    searchState.semantic = [];
    searchState.combined = [];
    searchState.images = [];
    searchState.meta = {
      exactTotal: 0,
      semanticTotal: 0,
      combinedTotal: 0,
      bm25sPerformed: false,
      rerankPerformed: false
    };
    searchState.imageMeta = {
      total: 0,
      threshold: DEFAULT_IMAGE_CONFIDENCE
    };
    renderSearchResults();

    try {
      const isImageMode = searchState.mode === SEARCH_MODES.IMAGE;
      const endpoint = isImageMode
        ? 'http://localhost:8000/api/faiss/search-images'
        : 'http://localhost:8000/api/faiss/search';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: normalizedQuery,
          top_k: 10
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const message = errorBody.detail || errorBody.message || `搜索失败 (${response.status})`;
        throw new Error(message);
      }

      const data = await response.json();

      if (isImageMode) {
        const imageResults = Array.isArray(data?.image_match?.results)
          ? data.image_match.results
          : Array.isArray(data?.results)
            ? data.results
            : [];

        searchState.exact = [];
        searchState.semantic = [];
        searchState.combined = imageResults;
        searchState.images = imageResults;
        searchState.meta = {
          exactTotal: 0,
          semanticTotal: 0,
          combinedTotal: data?.total ?? imageResults.length,
          bm25sPerformed: false,
          rerankPerformed: false
        };
        searchState.imageMeta = {
          total: data?.image_match?.total ?? imageResults.length,
          threshold: data?.image_match?.confidence_threshold ?? DEFAULT_IMAGE_CONFIDENCE
        };
      } else {
        const exactResults = Array.isArray(data?.exact_match?.results) ? data.exact_match.results : [];
        const semanticResults = Array.isArray(data?.semantic_match?.results) ? data.semantic_match.results : [];
        const combinedResults = Array.isArray(data?.combined?.results) ? data.combined.results : [...exactResults, ...semanticResults];
        const imageResults = Array.isArray(data?.image_match?.results) ? data.image_match.results : [];

        searchState.exact = exactResults;
        searchState.semantic = semanticResults;
        searchState.combined = combinedResults;
        searchState.images = imageResults;
        searchState.meta = {
          exactTotal: data?.exact_match?.total ?? exactResults.length,
          semanticTotal: data?.semantic_match?.total ?? semanticResults.length,
          combinedTotal: data?.combined?.total ?? combinedResults.length,
          bm25sPerformed: Boolean(data?.bm25s_performed ?? data?.semantic_match?.bm25s_performed),
          rerankPerformed: Boolean(data?.rerank_performed ?? data?.semantic_match?.rerank_performed)
        };
        searchState.imageMeta = {
          total: data?.image_match?.total ?? imageResults.length,
          threshold: data?.image_match?.confidence_threshold ?? DEFAULT_IMAGE_CONFIDENCE
        };
      }
    } catch (error) {
      console.error('搜索失败:', error);
      searchState.error = error.message || '搜索过程中发生错误';
    } finally {
      searchState.loading = false;
      renderSearchResults();
    }
  }

  function getPrimaryVariant(result) {
    if (!result) {
      return 'semantic';
    }
    if (Array.isArray(result.sources)) {
      if (result.sources.includes('exact')) {
        return 'exact';
      }
      if (result.sources.includes('image')) {
        return 'image';
      }
      return 'semantic';
    }
    const source = result.source || '';
    if (source.includes('exact')) {
      return 'exact';
    }
    if (source.includes('image')) {
      return 'image';
    }
    return 'semantic';
  }

  function buildSearchCard(result, variant, index) {
    const card = document.createElement('div');
    card.className = 'search-result-card';
    card.dataset.variant = variant;
    if (result?.result_type) {
      card.dataset.resultType = result.result_type;
    }

    const isImageResult = (result?.result_type === 'image') || (Array.isArray(result?.sources) && result.sources.includes('image'));

    const header = document.createElement('div');
    header.className = 'search-card-header';

    const title = document.createElement('h4');
    title.className = 'search-card-title';
    if (isImageResult) {
      title.textContent = result.image_name || result.filename || `图片结果 ${index + 1}`;
    } else {
      title.textContent = result.filename || result.file_name || `结果 ${index + 1}`;
    }
    header.appendChild(title);

    const sourceChip = document.createElement('span');
    sourceChip.className = 'search-card-chip';
    sourceChip.dataset.variant = 'source';
    const sourcesLabel = Array.isArray(result.sources) ? result.sources.join(' + ') : (result.source || variant);
    sourceChip.textContent = sourcesLabel === 'exact' ? '字符匹配' : sourcesLabel === 'semantic' ? '语义检索' : sourcesLabel.replace('exact', '字符').replace('semantic', '语义');
    header.appendChild(sourceChip);

    card.appendChild(header);

    const metrics = buildMetricsChips(result);

    if (isImageResult) {
      card.classList.add('search-result-card-image');

      const layout = document.createElement('div');
      layout.className = 'search-card-image-layout';

      const preview = document.createElement('div');
      preview.className = 'search-card-image-preview';
      const img = document.createElement('img');
      const imgSrc = buildImagePreviewSrc(result);
      if (imgSrc) {
        img.src = imgSrc;
        preview.title = '点击预览图片';
        preview.addEventListener('click', (event) => {
          event.stopPropagation();
          openImagePreview(result, imgSrc);
        });
      } else {
        img.alt = '预览不可用';
      }
      img.loading = 'lazy';
      preview.appendChild(img);
      layout.appendChild(preview);

      const details = document.createElement('div');
      details.className = 'search-card-image-details';

      const path = document.createElement('div');
      path.className = 'search-card-path';
      path.textContent = result.file_path || result.storage_path || result.path || '(未知路径)';
      details.appendChild(path);

      const imageMeta = buildImageMetadataSection(result);
      if (imageMeta) {
        details.appendChild(imageMeta);
      }

      if (metrics) {
        details.appendChild(metrics);
      }

      layout.appendChild(details);
      card.appendChild(layout);
    } else {
      const path = document.createElement('div');
      path.className = 'search-card-path';
      path.textContent = result.file_path || result.path || '(未知路径)';
      card.appendChild(path);

      const snippet = document.createElement('div');
      snippet.className = 'search-card-snippet';
      const snippetContent = getResultSnippet(result);
      if (snippetContent && snippetContent.html) {
        snippet.innerHTML = snippetContent.html;
      } else {
        snippet.textContent = (snippetContent && snippetContent.text) || '（暂无内容预览）';
      }
      card.appendChild(snippet);

      if (metrics) {
        card.appendChild(metrics);
      }
    }

    card.addEventListener('click', () => {
      openSearchResult(result);
    });

    return card;
  }

  function buildImagePreviewSrc(result) {
    const absolute = result?.absolute_storage_path || result?.absolute_path;
    if (!absolute) {
      return null;
    }
    const normalized = String(absolute).replace(/\\/g, '/');
    const encoded = encodeURI(normalized);
    if (encoded.startsWith('file://')) {
      return encoded;
    }
    if (encoded.startsWith('/')) {
      return `file://${encoded}`;
    }
    return `file:///${encoded}`;
  }

  function ensureGlobalImageViewer() {
    if (global.__globalImageViewer && global.__globalImageViewer !== dependencies.getFileViewer?.()) {
      const viewer = global.__globalImageViewer;
      setFileViewer(viewer);
      return viewer;
    }

    let viewer = getFileViewer();

    if (!viewer && global.ImageViewer) {
      try {
        viewer = new global.ImageViewer();
        global.__globalImageViewer = viewer;
        setFileViewer(viewer);
      } catch (viewerError) {
        console.error('ImageViewer 初始化失败:', viewerError);
        viewer = null;
      }
    }

    return viewer;
  }

  function openImagePreview(result, src) {
    if (!src) {
      return;
    }

    const viewer = ensureGlobalImageViewer();
    if (viewer && typeof viewer.show === 'function') {
      const title = result?.image_name || result?.display_name || result?.filename || '';
      viewer.show(src, title || src);
      return;
    }

    try {
      window.open(src, '_blank');
    } catch (error) {
      console.warn('无法预览图片:', error);
    }
  }

  function buildImageMetadataSection(result) {
    const container = document.createElement('div');
    container.className = 'search-card-image-meta';

    const stats = [];
    const formatBytesValue = (value) => {
      if (!value) {
        return null;
      }
      return formatBytes(value);
    };

    if (result.image_size_bytes || result.image_size) {
      const bytes = result.image_size_bytes || result.image_size;
      const formatted = formatBytesValue(bytes);
      if (formatted) {
        stats.push(`大小 ${formatted}`);
      }
    }

    if (result.image_resolution || (result.width && result.height)) {
      const resolution = result.image_resolution
        || `${result.width || result.image_width || '?'} × ${result.height || result.image_height || '?'}`;
      stats.push(`分辨率 ${resolution}`);
    }

    if (result.confidence !== undefined) {
      const confidence = Number(result.confidence);
      if (Number.isFinite(confidence)) {
        const formatted = formatPercentage(confidence);
        if (formatted) {
          stats.push(`相关度 ${formatted}`);
        }
      }
    }

    if (result.timestamp || result.captured_at || result.modified_at) {
      const dateStr = result.timestamp || result.captured_at || result.modified_at;
      const date = new Date(dateStr);
      if (!Number.isNaN(date.getTime())) {
        stats.push(`时间 ${date.toLocaleString()}`);
      }
    }

    if (!stats.length) {
      return null;
    }

    const list = document.createElement('ul');
    list.className = 'search-card-image-meta-list';
    stats.forEach((stat) => {
      const li = document.createElement('li');
      li.textContent = stat;
      list.appendChild(li);
    });
    container.appendChild(list);
    return container;
  }

  function buildMetricsChips(result) {
    if (!result) {
      return null;
    }

    const metricsContainer = document.createElement('div');
    metricsContainer.className = 'search-card-metrics';

    const sources = ['exact', 'semantic'];
    if (searchState.mode === SEARCH_MODES.IMAGE) {
      sources.push('image');
    }

    sources.forEach((sourceKey) => {
      const metric = getMetricsForSource(result, sourceKey);
      if (!metric) {
        return;
      }

      const parts = [];

      if (metric.rank !== undefined && metric.rank !== null) {
        parts.push(`Rank #${metric.rank}`);
      }

      const formatScore = (value, digits = 3) => {
        if (value === undefined || value === null) {
          return null;
        }
        const numberValue = Number(value);
        if (Number.isNaN(numberValue)) {
          return null;
        }
        return numberValue.toFixed(digits);
      };

      if (metric.match_score !== undefined && metric.match_score !== null) {
        const formatted = formatScore(metric.match_score);
        if (formatted !== null) {
          parts.push(`匹配 ${formatted}`);
        }
      }

      if (metric.confidence !== undefined && metric.confidence !== null) {
        const formatted = formatPercentage(metric.confidence);
        if (formatted) {
          parts.push(`可信度 ${formatted}`);
        }
      }

      if (metric.mixed_score !== undefined && metric.mixed_score !== null) {
        const formatted = formatScore(metric.mixed_score);
        if (formatted !== null) {
          parts.push(`混合 ${formatted}`);
        }
      }
      if (metric.rerank_score !== undefined && metric.rerank_score !== null) {
        const formatted = formatScore(metric.rerank_score);
        if (formatted !== null) {
          parts.push(`Rerank ${formatted}`);
        }
      }
      if (metric.bm25s_score !== undefined && metric.bm25s_score !== null) {
        const formatted = formatScore(metric.bm25s_score);
        if (formatted !== null) {
          parts.push(`BM25S ${formatted}`);
        }
      }

      if (!parts.length) {
        return;
      }

      const chip = document.createElement('span');
      chip.className = 'search-card-chip';
      chip.dataset.variant = sourceKey === 'exact' ? 'exact' : sourceKey === 'image' ? 'image' : 'semantic';
      const label = sourceKey === 'exact' ? '字符' : sourceKey === 'image' ? '图片' : '语义';
      chip.textContent = `${label} · ${parts.join(' | ')}`;
      metricsContainer.appendChild(chip);
    });

    return metricsContainer.children.length ? metricsContainer : null;
  }

  function getMetricsForSource(result, sourceKey) {
    if (result.metrics && result.metrics[sourceKey]) {
      return result.metrics[sourceKey];
    }

    const fallback = {};
    if (sourceKey === 'exact') {
      fallback.rank = result.rank;
      fallback.match_position = result.match_position;
      fallback.match_field = result.match_field;
      fallback.match_length = result.match_length;
      fallback.match_score = result.match_score;
    } else if (sourceKey === 'image') {
      fallback.rank = result.rank ?? result.combined_rank;
      fallback.confidence = result.confidence ?? result.final_score ?? result.image_score;
    } else {
      fallback.rank = result.rank;
      fallback.mixed_score = result.mixed_score;
      fallback.rerank_score = result.rerank_score;
      fallback.bm25s_score = result.bm25s_score;
    }
    return fallback;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getResultSnippet(result) {
    const previewRaw = typeof result.match_preview === 'string' ? result.match_preview : '';
    const preview = previewRaw.trim();
    const baseRaw = result.chunk_text || result.text || '';
    const primaryRaw = preview || baseRaw;

    if (!primaryRaw) {
      return { text: '（暂无内容预览）' };
    }

    const isExact = (Array.isArray(result.sources) && result.sources.includes('exact'))
      || (typeof result.source === 'string' && result.source.includes('exact'));

    const MAX_LENGTH = 260;
    const sources = [];
    if (preview) {
      sources.push(preview);
    }
    if (baseRaw && (!preview || baseRaw !== preview)) {
      sources.push(baseRaw);
    }

    const truncate = (text) => {
      const singleLine = text.replace(/\s+/g, ' ').trim();
      return singleLine.length <= MAX_LENGTH ? singleLine : `${singleLine.slice(0, MAX_LENGTH)}…`;
    };

    const query = (searchState.query || '').trim();
    if (!isExact || !query) {
      return { text: truncate(primaryRaw) };
    }

    const qLower = query.toLowerCase();
    const CONTEXT = 80;

    for (const source of sources) {
      const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lower = normalized.toLowerCase();
      const index = lower.indexOf(qLower);
      if (index === -1) {
        continue;
      }

      const start = Math.max(0, index - CONTEXT);
      const end = Math.min(normalized.length, index + query.length + CONTEXT);
      const snippetSection = normalized.slice(start, end);
      const regex = new RegExp(escapeRegExp(query), 'gi');
      const highlighted = escapeHtml(snippetSection).replace(regex, (match) => `<mark>${match}</mark>`);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < normalized.length ? '…' : '';

      return {
        html: `${prefix}${highlighted}${suffix}`
      };
    }

    return { text: truncate(primaryRaw) };
  }

  function formatScore(value, digits = 3) {
    if (value === undefined || value === null) {
      return null;
    }
    const numberValue = Number(value);
    if (Number.isNaN(numberValue)) {
      return null;
    }
    return numberValue.toFixed(digits);
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const normalized = bytes / Math.pow(1024, exponent);
    const decimals = exponent === 0 ? 0 : normalized >= 100 ? 0 : normalized >= 10 ? 1 : 2;
    return `${normalized.toFixed(decimals)} ${units[exponent]}`;
  }

  function formatPercentage(value, digits = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    const clamped = Math.max(0, Math.min(1, num));
    return `${(clamped * 100).toFixed(digits)}%`;
  }

  async function highlightSearchMatch(filePath, result) {
    const tabSelector = `[data-tab-id="${cssEscape(filePath)}"]`;
    const container = await waitForElement(tabSelector, 5000);
    if (!container) {
      console.warn('未能获取文件内容容器，无法高亮', filePath);
      return false;
    }

    const matchField = (result?.match_field || '').toLowerCase();
    const textLikeFields = ['chunk_text', 'text', 'content'];
    const hasTextMatch = !matchField || textLikeFields.includes(matchField);

    const snippetSource = (result?.chunk_text || result?.text || '').trim();
    const fallbackSnippet = (result?.match_preview || '').trim();
    const snippet = snippetSource || fallbackSnippet;
    const query = (searchState.query || '').trim();
    const lineHints = [result?.line_number, result?.line, result?.lineNumber, result?.lineIndex, result?.line_no];
    const targetLine = lineHints
      .map((hint) => {
        const num = Number(hint);
        return Number.isFinite(num) ? num : null;
      })
      .find((num) => num && num > 0);
    if (!snippet && !query && !targetLine) {
      return false;
    }

    if (!hasTextMatch && !targetLine) {
      return false;
    }

    const displayMode = (container.dataset.displayMode || '').toLowerCase();

    if (container.classList.contains('txt-content') || displayMode === 'text') {
      const textarea = await waitForElement(`${tabSelector} .txt-editor`, 4000);
      if (!textarea) {
        return false;
      }
      return highlightTextareaMatch(textarea, snippetSource || snippet, query, result);
    }

    if (container.classList.contains('markdown-content') || displayMode === 'markdown') {
      const textarea = await waitForElement(`${tabSelector} .markdown-editor-textarea`, 4000);
      if (!textarea) {
        return false;
      }
      return highlightTextareaMatch(textarea, snippetSource || snippet, query, result);
    }

    return false;
  }

  function highlightTextareaMatch(textarea, snippet, query, result) {
    if (!textarea) {
      return false;
    }

    const value = textarea.value || '';
    let match = findMatchPositionInText(value, snippet, query, result);

    if (!match) {
      const lineHints = [
        result?.line_number,
        result?.line,
        result?.lineIndex,
        result?.line_no,
        result?.lineNumber
      ];
      const targetLine = lineHints
        .map((hint) => {
          const num = Number(hint);
          return Number.isFinite(num) ? num : null;
        })
        .find((num) => num && num > 0);

      if (targetLine) {
        match = findLineRangeByNumber(value, targetLine);
      }
    }

    if (!match) {
      return false;
    }

    const overlay = ensureTextareaHighlightOverlay(textarea);
    clearTextareaHighlight(textarea);

    try {
      textarea.focus({ preventScroll: true });
    } catch (err) {
      try {
        textarea.focus();
      } catch (focusError) {
        console.warn('文本域聚焦失败:', focusError);
      }
    }

    try {
      textarea.setSelectionRange(match.start, match.end);
      scrollTextareaToLine(textarea, match.start);
      applyTextareaHighlight(textarea, overlay, match.start, match.end);
      flashTextareaForSearch(textarea);
      textarea.dataset.searchHighlightText = match.matchedText || '';
      return true;
    } catch (error) {
      console.warn('定位检索结果失败:', error);
    }

    return false;
  }

  function findMatchPositionInText(text, snippet, query, result) {
    const normalizedText = text.replace(/\r\n/g, '\n');
    const normalizedQuery = (query || '').trim();
    const candidates = collectSearchCandidates(snippet, normalizedQuery, result);

    for (const candidate of candidates) {
      const candidateNormalized = candidate.replace(/\r\n/g, '\n');
      const index = normalizedText.toLowerCase().indexOf(candidateNormalized.toLowerCase());
      if (index !== -1) {
        return {
          start: index,
          end: index + candidateNormalized.length,
          matchedText: candidate
        };
      }
    }

    if (normalizedQuery) {
      const index = normalizedText.toLowerCase().indexOf(normalizedQuery.toLowerCase());
      if (index !== -1) {
        return {
          start: index,
          end: index + normalizedQuery.length,
          matchedText: normalizedQuery
        };
      }
    }

    return null;
  }

  function findLineRangeByNumber(text, targetLine) {
    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    if (targetLine < 1 || targetLine > lines.length) {
      return null;
    }

    let index = 0;
    let currentLine = 1;

    while (currentLine < targetLine && index < normalized.length) {
      const nextBreak = normalized.indexOf('\n', index);
      if (nextBreak === -1) {
        index = normalized.length;
        break;
      }
      index = nextBreak + 1;
      currentLine += 1;
    }

    if (currentLine !== targetLine) {
      return null;
    }

    const start = index;
    let end = text.indexOf('\n', start);
    if (end === -1) {
      end = text.length;
    }

    if (end > start && text[end - 1] === '\r') {
      end -= 1;
    }

    const matchedText = text.slice(start, Math.max(start, end));
    return {
      start,
      end: Math.max(start, end),
      matchedText
    };
  }

  function generateCandidateVariants(rawValue) {
    const results = [];
    const seen = new Set();

    const pushVariant = (text) => {
      if (!text) {
        return;
      }
      const unified = String(text).replace(/\u2026/g, '...');
      const trimmed = unified.trim();
      const normalized = trimmed.replace(/\s+/g, ' ').trim();
      const candidate = normalized || trimmed;
      if (!candidate || candidate.length < 2) {
        return;
      }
      const key = candidate.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      results.push(candidate);
    };

    const base = String(rawValue || '');
    if (!base) {
      return results;
    }

    const unifiedBase = base.replace(/\u2026/g, '...');
    const trimmed = unifiedBase.trim();
    const leadingStripped = trimmed.replace(/^\.{3,}/, '').trim();
    const trailingStripped = leadingStripped.replace(/\.{3,}$/, '').trim();
    const withoutEllipsis = trailingStripped.replace(/\.{3,}/g, ' ').trim();
    const collapsedWhitespace = withoutEllipsis.replace(/\s+/g, ' ').trim();
    const punctuationSimplified = collapsedWhitespace.replace(/[^0-9A-Za-z\u4e00-\u9fa5\s]/g, ' ').replace(/\s+/g, ' ').trim();

    pushVariant(unifiedBase);
    pushVariant(trimmed);
    pushVariant(leadingStripped);
    pushVariant(trailingStripped);
    pushVariant(withoutEllipsis);
    pushVariant(collapsedWhitespace);
    pushVariant(punctuationSimplified);

    if (trimmed.length > 16) {
      pushVariant(trimmed.slice(0, 160));
      pushVariant(trimmed.slice(-160));
    }

    return results;
  }

  function collectSearchCandidates(snippet, query, result) {
    const seen = new Set();
    const candidates = [];

    const addCandidate = (value, options = {}) => {
      if (!value) {
        return;
      }

      const variants = generateCandidateVariants(value);
      if (!variants.length) {
        return;
      }

      if (options.priority) {
        for (let i = variants.length - 1; i >= 0; i -= 1) {
          const variant = variants[i];
          const key = variant.toLowerCase();
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          candidates.unshift(variant);
        }
        return;
      }

      variants.forEach((variant) => {
        const key = variant.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        candidates.push(variant);
      });
    };

    if (snippet) {
      addCandidate(snippet, { priority: true });

      const unified = snippet
        .replace(/\u2026/g, '...')
        .replace(/^\.{3,}/, '')
        .replace(/\.{3,}$/, '');

      unified
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 3)
        .forEach((line, idx) => {
          const isPriority = idx <= 1;
          addCandidate(line, isPriority ? { priority: true } : {});
        });

      if (result.match_preview) {
        addCandidate(result.match_preview, { priority: true });
      }
    }

    if (!candidates.length && snippet) {
      addCandidate(snippet);
    }

    if (query) {
      addCandidate(query, { priority: true });
    }

    return candidates;
  }

  function ensureTextareaHighlightOverlay(textarea) {
    const wrapper = textarea.parentElement;
    if (!wrapper) {
      return null;
    }

    const computed = window.getComputedStyle(wrapper);
    if (computed.position === 'static') {
      wrapper.style.position = 'relative';
    }

    let overlay = wrapper.querySelector('.txt-highlight-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'txt-highlight-overlay';
      wrapper.insertBefore(overlay, textarea);
    }
    return overlay;
  }

  function applyTextareaHighlight(textarea, overlay, startIndex, endIndex) {
    if (!textarea || !overlay) {
      return;
    }

    textarea.dataset.searchHighlight = JSON.stringify({ startIndex, endIndex });
    positionTextareaHighlightOverlay(textarea, overlay);
    overlay.style.opacity = '1';
    requestAnimationFrame(() => positionTextareaHighlightOverlay(textarea, overlay));

    if (!textarea.dataset.searchHighlightScrollHandlerAttached) {
      const handler = () => positionTextareaHighlightOverlay(textarea, overlay);
      textarea.dataset.searchHighlightScrollHandlerAttached = 'true';
      textarea._searchHighlightScrollHandler = handler;
      textarea.addEventListener('scroll', handler);
    }
  }

  function clearTextareaHighlight(textarea) {
    if (!textarea) {
      return;
    }

    if (textarea.dataset.searchHighlight) {
      delete textarea.dataset.searchHighlight;
      const overlay = ensureTextareaHighlightOverlay(textarea);
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.top = '0';
        overlay.style.height = '0';
      }
    }

    if (textarea.dataset.searchHighlightText) {
      delete textarea.dataset.searchHighlightText;
    }

    if (textarea._searchHighlightScrollHandler) {
      textarea.removeEventListener('scroll', textarea._searchHighlightScrollHandler);
      delete textarea._searchHighlightScrollHandler;
      delete textarea.dataset.searchHighlightScrollHandlerAttached;
    }
  }

  function positionTextareaHighlightOverlay(textarea, overlay) {
    if (!overlay || !textarea.dataset.searchHighlight) {
      return;
    }

    let info;
    try {
      info = JSON.parse(textarea.dataset.searchHighlight);
    } catch (error) {
      return;
    }
    if (!info) {
      return;
    }

    const { startIndex, endIndex } = info;
    const lineHeight = textareaLineHeight(textarea);
    const paddingTop = parseFloat(window.getComputedStyle(textarea).paddingTop) || 0;

    const textBefore = textarea.value.slice(0, startIndex);
    const startLine = textBefore ? textBefore.split(/\r\n|\r|\n/).length - 1 : 0;
    const selectionText = textarea.value.slice(startIndex, endIndex);
    const selectionLines = selectionText ? selectionText.split(/\r\n|\r|\n/).length - 1 : 0;

    const top = paddingTop + startLine * lineHeight - textarea.scrollTop;
    const height = Math.max(lineHeight * (selectionLines + 1), lineHeight);

    overlay.style.top = `${top}px`;
    overlay.style.height = `${height}px`;
  }

  function textareaLineHeight(textarea) {
    const computed = window.getComputedStyle(textarea);
    let lineHeight = parseFloat(computed.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      const fontSize = parseFloat(computed.fontSize);
      lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.5 : 20;
    }
    return lineHeight;
  }

  function scrollTextareaToLine(textarea, index) {
    const lineHeight = textareaLineHeight(textarea);
    const beforeText = textarea.value.slice(0, index);
    const lineCount = beforeText ? beforeText.split(/\r\n|\r|\n/).length - 1 : 0;
    const targetTop = Math.max(0, lineCount * lineHeight - textarea.clientHeight / 2);
    textarea.scrollTop = targetTop;
    if (typeof textarea.scrollTo === 'function') {
      requestAnimationFrame(() => {
        textarea.scrollTo({ top: targetTop, behavior: 'smooth' });
      });
    }
  }

  function flashTextareaForSearch(textarea) {
    textarea.classList.remove('search-highlight-flash');
    void textarea.offsetWidth;
    textarea.classList.add('search-highlight-flash');
    setTimeout(() => {
      textarea.classList.remove('search-highlight-flash');
    }, 900);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) {
      return CSS.escape(value);
    }
    return value.replace(/['"\\]/g, '\\$&');
  }

  async function openSearchResult(result) {
    if (!result) {
      return;
    }

    const isImageResult = (result.result_type === 'image') || (Array.isArray(result.sources) && result.sources.includes('image'));

    const wasSearchMode = dependencies.isSearchMode ? dependencies.isSearchMode() : false;
    if (wasSearchMode) {
      leaveSearchMode();
    }

    const normalizeForCompare = (path) => {
      if (!path) {
        return '';
      }
      return String(path)
        .trim()
        .replace(/^file:\/*/i, '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/');
    };

    const pickFirst = (candidates = []) => {
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed) {
            return trimmed;
          }
        }
      }
      return null;
    };

    const storagePath = pickFirst([
      result.absolute_storage_path,
      result.storage_path,
      result.preview_path,
      result.image_path
    ]);

    const documentPath = pickFirst([
      result.absolute_path,
      result.file_path,
      result.document_path,
      result.path,
      result.source_path,
      result.original_path
    ]);

    const hasDistinctDocument = documentPath && (!storagePath || normalizeForCompare(documentPath) !== normalizeForCompare(storagePath));

    let targetPath;
    let openedDocumentForImage = false;

    if (isImageResult) {
      if (hasDistinctDocument) {
        targetPath = documentPath;
        openedDocumentForImage = true;
      } else {
        targetPath = documentPath || storagePath;
      }
    } else {
      targetPath = documentPath || storagePath;
    }

    if (!targetPath) {
      targetPath = pickFirst([
        result.absolute_path,
        result.file_path,
        result.path,
        result.absolute_storage_path,
        result.storage_path
      ]);
    }
    if (!targetPath) {
      notifyAlert('无法定位检索结果对应的文件', 'error');
      return;
    }

    if (!targetPath.startsWith('/')) {
      const rootPath = global.fileTreeData && global.fileTreeData.path;
      if (rootPath) {
        const normalizedRoot = String(rootPath).replace(/\\/g, '/').replace(/\/+$/, '');
        const normalizedTarget = String(targetPath).replace(/\\/g, '/').replace(/^\/+/, '');
        targetPath = `${normalizedRoot}/${normalizedTarget}`;
      }
    }

    let viewer = getFileViewer();
    const explorerModule = getExplorerModule();

    if (!viewer && explorerModule && typeof explorerModule.getFileViewer === 'function') {
      viewer = explorerModule.getFileViewer();
      if (viewer) {
        setFileViewer(viewer);
      }
    }

    if (!viewer || typeof viewer.openFile !== 'function') {
      notifyAlert('文件查看器未初始化', 'error');
      return;
    }

    setSelectedItemPath(targetPath);
    if (explorerModule && typeof explorerModule.setSelectedItemPath === 'function') {
      explorerModule.setSelectedItemPath(targetPath);
    }

    try {
      await viewer.openFile(targetPath);
      await waitForElement(`[data-tab-id="${cssEscape(targetPath)}"]`, 5000);
      const shouldHighlight = !isImageResult || openedDocumentForImage;
      if (shouldHighlight) {
        const highlighted = await highlightSearchMatchWithRetry(targetPath, result);
        if (!highlighted) {
          console.warn('未能在文件中定位到检索文本', result);
        }
      }

      const treeSelector = `[data-path="${cssEscape(targetPath)}"]`;
      const treeElement = document.querySelector(treeSelector);
      if (treeElement) {
        document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
        treeElement.classList.add('selected');
        treeElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    } catch (error) {
      console.error('打开检索结果失败:', error);
      notifyAlert(`打开文件失败: ${error.message || error}`, 'error');
    }
  }

  function waitForElement(selector, timeout = 3000) {
    const start = performance.now();
    return new Promise((resolve) => {
      function check() {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
        if (performance.now() - start >= timeout) {
          resolve(null);
          return;
        }
        requestAnimationFrame(check);
      }
      check();
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function highlightSearchMatchWithRetry(filePath, result, attempt = 0) {
    const MAX_ATTEMPTS = 6;
    const DELAY_STEP = 180;

    const success = await highlightSearchMatch(filePath, result);
    if (success) {
      return true;
    }

    if (attempt >= MAX_ATTEMPTS - 1) {
      return false;
    }

    await delay(DELAY_STEP * (attempt + 1));
    return highlightSearchMatchWithRetry(filePath, result, attempt + 1);
  }

  modules.search = {
    configure,
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
    performSearch,
    highlightSearchMatchWithRetry
  };
})(window);
