const fileTreeEl = document.getElementById('file-tree');
const fileTreeContainer = document.getElementById('file-tree-container');
const fileContentEl = document.getElementById('file-content');
// 设置相关元素已移至设置模块管理

// 初始化文件查看器
let fileViewer = null;

// 搜索结果状态
const searchState = {
  query: '',
  loading: false,
  error: null,
  exact: [],
  semantic: [],
  combined: [],
  meta: {
    exactTotal: 0,
    semanticTotal: 0,
    combinedTotal: 0,
    bm25sPerformed: false,
    rerankPerformed: false
  }
};

let searchResultsContainer = null;
let searchUIInitialized = false;
let globalLoadingOverlay = null;

const SEARCH_HISTORY_STORAGE_KEY = 'fs_search_history';
const SEARCH_HISTORY_LIMIT = 5;
let searchHistory = [];
let searchHistoryContainer = null;

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
    item.textContent = term;
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

loadSearchHistory();

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

function ensureLoadingOverlayStyles() {
  if (document.getElementById('global-loading-overlay-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'global-loading-overlay-style';
  style.textContent = `
    .global-loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.35);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2500;
    }
    .global-loading-dialog {
      background: var(--bg-color, #ffffff);
      color: var(--text-color, #1e293b);
      padding: 22px 28px;
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
      border: 1px solid rgba(148, 163, 184, 0.22);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      min-width: 240px;
    }
    .global-loading-spinner {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 3px solid rgba(37, 99, 235, 0.15);
      border-top-color: rgba(37, 99, 235, 0.85);
      animation: global-loading-spin 0.8s linear infinite;
    }
    .global-loading-message {
      font-size: 14px;
      color: var(--text-muted, rgba(75, 85, 99, 0.85));
      letter-spacing: 0.01em;
    }
    @keyframes global-loading-spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function showLoadingOverlay(message = '处理中，请稍候…') {
  ensureLoadingOverlayStyles();
  if (!globalLoadingOverlay) {
    const overlay = document.createElement('div');
    overlay.className = 'global-loading-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'global-loading-dialog';

    const spinner = document.createElement('div');
    spinner.className = 'global-loading-spinner';

    const text = document.createElement('div');
    text.className = 'global-loading-message';
    text.textContent = message;

    dialog.appendChild(spinner);
    dialog.appendChild(text);
    overlay.appendChild(dialog);
    globalLoadingOverlay = overlay;
  } else {
    const text = globalLoadingOverlay.querySelector('.global-loading-message');
    if (text) {
      text.textContent = message;
    }
  }

  if (!document.body.contains(globalLoadingOverlay)) {
    document.body.appendChild(globalLoadingOverlay);
  }
}

function hideLoadingOverlay() {
  if (globalLoadingOverlay && globalLoadingOverlay.parentNode) {
    globalLoadingOverlay.parentNode.removeChild(globalLoadingOverlay);
  }
}

// 初始化设置模块、资源管理器模块、测试模块、数据库模块和事件绑定
let settingsModule;
let explorerModule;
let testModule;
let databaseModule;
let splashScreen;

const UPLOAD_STATUS_ENDPOINT = 'http://localhost:8000/api/document/upload-status';

function normalizeRelativeFolderPath(relativePath) {
  if (!relativePath) {
    return 'data';
  }
  let cleaned = String(relativePath).trim().replace(/\\/g, '/');
  if (!cleaned || cleaned === '.' || cleaned === './') {
    return 'data';
  }
  cleaned = cleaned.replace(/^\.+\//, '');
  cleaned = cleaned.replace(/^\/+/, '');
  if (!cleaned.startsWith('data')) {
    cleaned = `data/${cleaned}`;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned || 'data';
}

function formatFolderPathForApi(relativePath) {
  const normalized = normalizeRelativeFolderPath(relativePath);
  return `/${normalized}/`;
}

function computeRelativePathFromAbsolute(absolutePath) {
  if (!absolutePath) {
    return 'data';
  }
  const normalizedAbs = absolutePath.replace(/\\/g, '/');
  const rootPath = window.fileTreeData && window.fileTreeData.path
    ? window.fileTreeData.path.replace(/\\/g, '/').replace(/\/+$/, '')
    : null;
  if (rootPath && normalizedAbs.startsWith(rootPath)) {
    const remainder = normalizedAbs.slice(rootPath.length).replace(/^\/+/, '');
    return remainder ? `data/${remainder}` : 'data';
  }
  const markerIndex = normalizedAbs.indexOf('/data/');
  if (markerIndex !== -1) {
    return normalizedAbs.slice(markerIndex + 1).replace(/\/+$/, '');
  }
  if (normalizedAbs.endsWith('/data')) {
    return 'data';
  }
  return 'data';
}

function resolveNodeRelativePath(node) {
  if (!node) {
    return 'data';
  }
  if (node.relativePath) {
    return normalizeRelativeFolderPath(node.relativePath);
  }
  return normalizeRelativeFolderPath(computeRelativePathFromAbsolute(node.path));
}

function getFolderContainerByRelativePath(relativeFolderPath) {
  const normalized = normalizeRelativeFolderPath(relativeFolderPath);
  if (!normalized || normalized === 'data') {
    return fileTreeEl;
  }
  return document.querySelector(`div[data-parent-relative="${normalized}"]`);
}

function ensureUploadIndicatorElement(fileElement) {
  let indicator = fileElement.querySelector('.upload-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'upload-indicator';
    indicator.title = '已上传';
    const contentDiv = fileElement.querySelector('div');
    if (contentDiv) {
      contentDiv.appendChild(indicator);
    } else {
      fileElement.appendChild(indicator);
    }
  }
  indicator.classList.remove('uploading', 'reuploading');
  return indicator;
}

function updateUploadIndicatorForElement(fileElement, isUploaded) {
  if (!fileElement) {
    return;
  }
  const existing = fileElement.querySelector('.upload-indicator');
  if (isUploaded) {
    ensureUploadIndicatorElement(fileElement);
    fileElement.dataset.uploaded = 'true';
  } else if (existing) {
    existing.remove();
    fileElement.dataset.uploaded = 'false';
  } else {
    fileElement.dataset.uploaded = 'false';
  }
}

function applyUploadStatusToFolder(relativeFolderPath, filesStatus) {
  const container = getFolderContainerByRelativePath(relativeFolderPath);
  if (!container) {
    return;
  }
  const directFiles = container.querySelectorAll(':scope > .file-item-file');
  directFiles.forEach((fileElement) => {
    const fileName = fileElement.dataset.fileName || '';
    const uploaded = Boolean(filesStatus && filesStatus[fileName]);
    updateUploadIndicatorForElement(fileElement, uploaded);
  });
}

async function updateFolderUploadStatus(relativeFolderPath) {
  const normalized = normalizeRelativeFolderPath(relativeFolderPath);
  const container = getFolderContainerByRelativePath(normalized);
  if (!container) {
    return;
  }
  try {
    const response = await fetch(UPLOAD_STATUS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: formatFolderPathForApi(normalized) })
    });
    if (!response.ok) {
      throw new Error(`接口返回状态 ${response.status}`);
    }
    const data = await response.json();
    applyUploadStatusToFolder(normalized, data.files || {});
  } catch (error) {
    console.error(`获取文件夹 ${normalized} 上传状态失败:`, error);
  }
}

async function refreshVisibleFolderUploadStatus() {
  const targets = new Set(['data']);
  document.querySelectorAll('div[data-parent-relative]').forEach((container) => {
    const relative = container.dataset.parentRelative;
    if (!relative) {
      return;
    }
    if (container.style.display !== 'none') {
      targets.add(relative);
    }
  });
  for (const relative of targets) {
    await updateFolderUploadStatus(relative);
  }
}

window.updateFolderUploadStatus = updateFolderUploadStatus;
window.refreshVisibleFolderUploadStatus = refreshVisibleFolderUploadStatus;

async function refreshFolderUploadIndicators(folderPath) {
  if (!folderPath) {
    return;
  }

  if (typeof expandedFolders === 'undefined') {
    return;
  }

  try {
    const normalizedAbs = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const targets = new Set();

    const baseRelative = normalizedAbs.startsWith('/')
      ? computeRelativePathFromAbsolute(normalizedAbs)
      : normalizeRelativeFolderPath(folderPath);

    if (baseRelative) {
      targets.add(baseRelative);
    }

    const prefix = normalizedAbs ? `${normalizedAbs}/` : '';

    expandedFolders.forEach((absPath) => {
      if (!absPath) {
        return;
      }
      const candidate = absPath.replace(/\\/g, '/').replace(/\/+$/, '');
      if (candidate === normalizedAbs || (prefix && candidate.startsWith(prefix))) {
        const relative = computeRelativePathFromAbsolute(candidate);
        if (relative) {
          targets.add(relative);
        }
      }
    });

    for (const relative of targets) {
      await updateFolderUploadStatus(relative);
    }
  } catch (error) {
    console.warn('刷新文件夹上传指示器失败:', error);
  }
}

function initializeSearchUI() {
  if (searchUIInitialized) {
    return;
  }

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
        gap: 8px;
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
        border: 1px solid var(--tree-border, #e1e4e8);
        border-radius: 10px;
        padding: 16px;
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
        transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .dark-mode .search-result-card {
        background: rgba(36, 36, 36, 0.9);
        border-color: rgba(75, 85, 99, 0.5);
      }

      .search-result-card:hover {
        transform: translateY(-2px);
        border-color: var(--accent-color);
        box-shadow: 0 16px 35px rgba(37, 99, 235, 0.18);
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
        background: rgba(59, 130, 246, 0.2);
        color: inherit;
        padding: 0 2px;
        border-radius: 4px;
      }

      .search-card-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .search-card-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid var(--tree-border, #d1d5db);
        color: var(--text-color);
        background: rgba(243, 244, 246, 0.7);
        letter-spacing: 0.2px;
      }

      .search-card-chip[data-variant="exact"] {
        background: rgba(248, 250, 252, 0.85);
        border-color: rgba(148, 163, 184, 0.7);
      }

      .search-card-chip[data-variant="semantic"] {
        background: rgba(191, 219, 254, 0.35);
        border-color: rgba(59, 130, 246, 0.5);
      }

      .search-card-chip[data-variant="source"] {
        background: rgba(99, 102, 241, 0.18);
        border-color: rgba(99, 102, 241, 0.35);
      }
    `;
    document.head.appendChild(style);
  }

  searchResultsContainer = document.createElement('div');
  searchResultsContainer.id = 'search-results-container';
  searchResultsContainer.style.display = 'none';
  fileContentEl.appendChild(searchResultsContainer);
  if (!searchHistoryContainer) {
    searchHistoryContainer = document.getElementById('search-history');
  }
  renderSearchHistory();

  searchUIInitialized = true;
  renderSearchResults();
}

function showSearchResultsPane() {
  if (!searchUIInitialized) {
    initializeSearchUI();
  }
  if (!searchResultsContainer) {
    return;
  }

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

  if (!isSearchMode) {
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
    title.textContent = `未找到与 “${searchState.query}” 匹配的内容`;
    const message = document.createElement('span');
    message.textContent = '尝试调整关键词或缩短查询内容。';
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

  const detail = document.createElement('span');
  detail.textContent = `字符 ${searchState.meta.exactTotal || searchState.exact.length} · 语义 ${searchState.meta.semanticTotal || searchState.semantic.length}`;
  summary.appendChild(detail);

  if (searchState.meta.bm25sPerformed) {
    const bm25Chip = document.createElement('span');
    bm25Chip.className = 'search-card-chip';
    bm25Chip.dataset.variant = 'semantic';
    bm25Chip.textContent = 'BM25S 混合检索';
    summary.appendChild(bm25Chip);
  }

  if (searchState.meta.rerankPerformed) {
    const rerankChip = document.createElement('span');
    rerankChip.className = 'search-card-chip';
    rerankChip.dataset.variant = 'semantic';
    rerankChip.textContent = 'Reranker 精排';
    summary.appendChild(rerankChip);
  }

  searchResultsContainer.appendChild(summary);

  combinedResults.forEach((result, index) => {
    const variant = getPrimaryVariant(result);
    const card = buildSearchCard(result, variant, index);
    searchResultsContainer.appendChild(card);
  });

  searchResultsContainer.scrollTop = 0;
}

async function performSearch(rawQuery) {
  if (!isSearchMode) {
    switchToSearchMode();
  }

  initializeSearchUI();
  showSearchResultsPane();

  const normalizedQuery = (rawQuery || '').trim();
  searchState.query = normalizedQuery;

  if (!normalizedQuery) {
    searchState.loading = false;
    searchState.error = null;
    searchState.exact = [];
    searchState.semantic = [];
    searchState.combined = [];
    searchState.meta = {
      exactTotal: 0,
      semanticTotal: 0,
      combinedTotal: 0,
      bm25sPerformed: false,
      rerankPerformed: false
    };
    renderSearchResults();
    return;
  }

  recordSearchHistory(normalizedQuery);

  searchState.loading = true;
  searchState.error = null;
  renderSearchResults();

  try {
    const response = await fetch('http://localhost:8000/api/faiss/search', {
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

    const exactResults = Array.isArray(data?.exact_match?.results) ? data.exact_match.results : [];
    const semanticResults = Array.isArray(data?.semantic_match?.results) ? data.semantic_match.results : [];
    const combinedResults = Array.isArray(data?.combined?.results) ? data.combined.results : [...exactResults, ...semanticResults];

    searchState.exact = exactResults;
    searchState.semantic = semanticResults;
    searchState.combined = combinedResults;
    searchState.meta = {
      exactTotal: data?.exact_match?.total ?? exactResults.length,
      semanticTotal: data?.semantic_match?.total ?? semanticResults.length,
      combinedTotal: data?.combined?.total ?? combinedResults.length,
      bm25sPerformed: Boolean(data?.bm25s_performed ?? data?.semantic_match?.bm25s_performed),
      rerankPerformed: Boolean(data?.rerank_performed ?? data?.semantic_match?.rerank_performed)
    };
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
    return result.sources.includes('exact') ? 'exact' : 'semantic';
  }
  const source = result.source || '';
  if (source.includes('exact')) {
    return 'exact';
  }
  return 'semantic';
}

function buildSearchCard(result, variant, index) {
  const card = document.createElement('div');
  card.className = 'search-result-card';
  card.dataset.variant = variant;

  const header = document.createElement('div');
  header.className = 'search-card-header';

  const title = document.createElement('h4');
  title.className = 'search-card-title';
  title.textContent = result.filename || result.file_name || `结果 ${index + 1}`;
  header.appendChild(title);

  const sourceChip = document.createElement('span');
  sourceChip.className = 'search-card-chip';
  sourceChip.dataset.variant = 'source';
  const sourcesLabel = Array.isArray(result.sources) ? result.sources.join(' + ') : (result.source || variant);
  sourceChip.textContent = sourcesLabel === 'exact' ? '字符匹配' : sourcesLabel === 'semantic' ? '语义检索' : sourcesLabel.replace('exact', '字符').replace('semantic', '语义');
  header.appendChild(sourceChip);

  card.appendChild(header);

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

  const metrics = buildMetricsChips(result);
  if (metrics) {
    card.appendChild(metrics);
  }

  card.addEventListener('click', () => {
    openSearchResult(result);
  });

  return card;
}

function buildMetricsChips(result) {
  const metricsContainer = document.createElement('div');
  metricsContainer.className = 'search-card-metrics';

  const sources = Array.isArray(result.sources) && result.sources.length
    ? result.sources
    : [result.source || getPrimaryVariant(result)];

  sources.forEach((sourceKey) => {
    const metric = getMetricsForSource(result, sourceKey) || {};
    const parts = [];

    if (metric.rank !== undefined && metric.rank !== null) {
      parts.push(`Rank ${metric.rank}`);
    }

    if (sourceKey === 'exact') {
      if (metric.match_position !== undefined && metric.match_position !== null) {
        parts.push(`位置 ${metric.match_position}`);
      }
    } else {
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
    }

    if (!parts.length) {
      return;
    }

    const chip = document.createElement('span');
    chip.className = 'search-card-chip';
    chip.dataset.variant = sourceKey === 'exact' ? 'exact' : 'semantic';
    chip.textContent = `${sourceKey === 'exact' ? '字符' : '语义'} · ${parts.join(' | ')}`;
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
    fallback.match_score = result.match_score;
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
  const raw = result.chunk_text || result.text || '';
  if (!raw) {
    return { text: '（暂无内容预览）' };
  }

  const isExact = (Array.isArray(result.sources) && result.sources.includes('exact'))
    || (typeof result.source === 'string' && result.source.includes('exact'));

  const singleLine = raw.replace(/\s+/g, ' ').trim();
  const MAX_LENGTH = 260;

  if (!isExact) {
    const truncated = singleLine.length <= MAX_LENGTH ? singleLine : `${singleLine.slice(0, MAX_LENGTH)}…`;
    return { text: truncated };
  }

  const query = (searchState.query || '').trim();
  if (!query) {
    const truncated = singleLine.length <= MAX_LENGTH ? singleLine : `${singleLine.slice(0, MAX_LENGTH)}…`;
    return { text: truncated };
  }

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lower = normalized.toLowerCase();
  const qLower = query.toLowerCase();

  let index = lower.indexOf(qLower);
  if (index === -1) {
    const truncated = singleLine.length <= MAX_LENGTH ? singleLine : `${singleLine.slice(0, MAX_LENGTH)}…`;
    return { text: truncated };
  }

  const CONTEXT = 80;
  let start = Math.max(0, index - CONTEXT);
  let end = Math.min(normalized.length, index + query.length + CONTEXT);
  let snippetSection = normalized.slice(start, end);

  const regex = new RegExp(escapeRegExp(query), 'gi');
  const highlighted = escapeHtml(snippetSection).replace(regex, (match) => `<mark>${match}</mark>`);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalized.length ? '…' : '';

  return {
    html: `${prefix}${highlighted}${suffix}`
  };
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

async function highlightSearchMatch(filePath, result) {
  const tabSelector = `[data-tab-id="${cssEscape(filePath)}"]`;
  const container = await waitForElement(tabSelector, 5000);
  if (!container) {
    console.warn('未能获取文件内容容器，无法高亮', filePath);
    return false;
  }

  const snippet = (result?.chunk_text || result?.text || '').trim();
  const query = (searchState.query || '').trim();
  if (!snippet && !query) {
    return false;
  }

  const displayMode = (container.dataset.displayMode || '').toLowerCase();

  if (container.classList.contains('txt-content') || displayMode === 'text') {
    const textarea = await waitForElement(`${tabSelector} .txt-editor`, 4000);
    if (!textarea) {
      return false;
    }
    return highlightTextareaMatch(textarea, snippet, query, result);
  }

  if (container.classList.contains('markdown-content') || displayMode === 'markdown') {
    const textarea = await waitForElement(`${tabSelector} .markdown-editor-textarea`, 4000);
    if (!textarea) {
      return false;
    }
    return highlightTextareaMatch(textarea, snippet, query, result);
  }

  // 其他文件类型暂不支持自动定位
  return false;
}

function highlightTextareaMatch(textarea, snippet, query, result) {
  if (!textarea) {
    return false;
  }

  const value = textarea.value || '';
  const match = findMatchPositionInText(value, snippet, query, result);
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
      console.warn('聚焦文本编辑器失败', focusError);
    }
  }

  const { start, end, matchedText } = match;
  try {
    textarea.setSelectionRange(start, end);
  } catch (error) {
    console.warn('设置文本选区失败', error);
  }

  scrollTextareaToLine(textarea, start);
  applyTextareaHighlight(textarea, overlay, start, end);
  flashTextareaForSearch(textarea);

  if (matchedText && matchedText.length > 0) {
    textarea.dataset.searchHighlightText = matchedText;
  }

  return true;
}

function findMatchPositionInText(text, snippet, query, result) {
  if (!text) {
    return null;
  }

  const candidates = collectSearchCandidates(snippet, query, result);
  if (!candidates.length) {
    return null;
  }

  const lowerText = text.toLowerCase();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    let index = text.indexOf(candidate);
    if (index !== -1) {
      return {
        start: index,
        end: index + candidate.length,
        matchedText: text.slice(index, index + candidate.length)
      };
    }

    const trimmed = candidate.trim();
    if (trimmed && trimmed !== candidate) {
      index = text.indexOf(trimmed);
      if (index !== -1) {
        return {
          start: index,
          end: index + trimmed.length,
          matchedText: text.slice(index, index + trimmed.length)
        };
      }
    }

    const lowerCandidate = candidate.toLowerCase();
    index = lowerText.indexOf(lowerCandidate);
    if (index !== -1) {
      return {
        start: index,
        end: index + candidate.length,
        matchedText: text.slice(index, index + candidate.length)
      };
    }

    if (trimmed && trimmed !== candidate) {
      index = lowerText.indexOf(trimmed.toLowerCase());
      if (index !== -1) {
        return {
          start: index,
          end: index + trimmed.length,
          matchedText: text.slice(index, index + trimmed.length)
        };
      }
    }

    const relaxed = trimmed.replace(/\s+/g, ' ').trim();
    if (relaxed && relaxed.length >= 2) {
      index = lowerText.indexOf(relaxed.toLowerCase());
      if (index !== -1) {
        return {
          start: index,
          end: index + relaxed.length,
          matchedText: text.slice(index, index + relaxed.length)
        };
      }
    }

    try {
      const escaped = candidate.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const whitespaceRelaxed = escaped.replace(/\s+/g, '\\s+');
      const regex = new RegExp(whitespaceRelaxed, 'i');
      const match = regex.exec(text);
      if (match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          matchedText: match[0]
        };
      }
    } catch (regexError) {
      console.warn('正则匹配搜索片段失败', regexError);
    }
  }

  return null;
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
      .sort((a, b) => b.length - a.length)
      .forEach((line) => addCandidate(line));

    if (typeof result?.match_position === 'number') {
      const radius = Math.max(40, ((query || '').length || 0) + 30);
      const start = Math.max(0, result.match_position - radius);
      const end = Math.min(unified.length, result.match_position + radius);
      if (end > start) {
        addCandidate(unified.slice(start, end), { priority: true });
      }
    }

    if (unified.length > 200) {
      addCandidate(unified.slice(0, 160));
      addCandidate(unified.slice(-160));
    }
  }

  if (query) {
    addCandidate(query, { priority: true });
    const trimmedQuery = query.trim();
    trimmedQuery
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
      .forEach((part) => addCandidate(part, { priority: true }));
  }

  if (!candidates.length && snippet) {
    addCandidate(snippet);
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

  const wasSearchMode = isSearchMode;
  if (wasSearchMode) {
    switchToFileMode();
  }

  let targetPath = result.absolute_path || result.file_path || result.path;
  if (!targetPath) {
    showAlert('无法定位检索结果对应的文件', 'error');
    return;
  }

  if (!targetPath.startsWith('/')) {
    const rootPath = window.fileTreeData && window.fileTreeData.path;
    if (rootPath) {
      const normalizedRoot = String(rootPath).replace(/\\/g, '/').replace(/\/+$/, '');
      const normalizedTarget = String(targetPath).replace(/\\/g, '/').replace(/^\/+/, '');
      targetPath = `${normalizedRoot}/${normalizedTarget}`;
    }
  }

  if (!fileViewer && explorerModule && typeof explorerModule.getFileViewer === 'function') {
    fileViewer = explorerModule.getFileViewer();
  }

  if (!fileViewer || typeof fileViewer.openFile !== 'function') {
    showAlert('文件查看器未初始化', 'error');
    return;
  }

  selectedItemPath = targetPath;
  if (explorerModule && typeof explorerModule.setSelectedItemPath === 'function') {
    explorerModule.setSelectedItemPath(targetPath);
  }

  try {
    await fileViewer.openFile(targetPath);
    await waitForElement(`[data-tab-id="${cssEscape(targetPath)}"]`, 5000);
    const highlighted = await highlightSearchMatchWithRetry(targetPath, result);
    if (!highlighted) {
      console.warn('未能在文件中定位到检索文本', result);
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
    showAlert(`打开文件失败: ${error.message || error}`, 'error');
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
    initializeSearchUI();
    
    // 绑定剩余的事件监听器
    bindEventListeners();

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

function getFolderSvg() {
  const fillColor = 'rgba(37, 99, 235, 0.2)';
  const strokeColor = 'rgba(37, 99, 235, 0.7)';
  const topFill = 'rgba(37, 99, 235, 0.3)';
  return `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 7.25C3 6.00736 4.00736 5 5.25 5H9.17774C9.44351 5 9.69843 5.10536 9.89175 5.29289L11.3583 6.70711C11.5516 6.89464 11.8065 7 12.0723 7H18.75C19.9926 7 21 8.00736 21 9.25V16.75C21 17.9926 19.9926 19 18.75 19H5.25C4.00736 19 3 17.9926 3 16.75V7.25Z" fill="${fillColor}" stroke="${strokeColor}" stroke-width="1" />
      <path d="M3 7.25C3 6.00736 4.00736 5 5.25 5H9.17774C9.44351 5 9.69843 5.10536 9.89175 5.29289L11.3583 6.70711C11.5516 6.89464 11.8065 7 12.0723 7H18.75C19.9926 7 21 8.00736 21 9.25" fill="${topFill}" />
    </svg>
  `;
}

function getFileIcon(fileName, isFolder = false, isExpanded = false) {
  if (isFolder) {
    if (isExpanded) {
      return getOpenFolderIcon();
    }
    return window.icons && window.icons.folder ? window.icons.folder : getFolderSvg();
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

function getOpenFolderIcon() {
  if (window.icons && typeof window.icons.folder === 'string') {
    const svg = window.icons.folder
      .replace(/fill="[^"]*"/gi, 'fill="rgba(37, 99, 235, 0.18)"')
      .replace(/stroke="[^"]*"/gi, 'stroke="rgba(37, 99, 235, 0.65)"');
    return svg;
  }
  return getFolderSvg();
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

  // 挂载菜单项（仅对文件显示）
  const mountItem = document.createElement('div');
  mountItem.className = 'context-menu-item';
  mountItem.innerHTML = `<span class="context-menu-icon">${window.icons.import}</span>挂载`;
  
  if (isFolder) {
    mountItem.addEventListener('click', () => {
      hideContextMenu();
      mountFolder(itemPath);
    });
  } else {
    mountItem.addEventListener('click', () => {
      hideContextMenu();
      uploadFile(itemPath);
    });
  }

  const remountItem = document.createElement('div');
  remountItem.className = 'context-menu-item';
  remountItem.innerHTML = `<span class="context-menu-icon">${window.icons.import}</span>重新挂载`;
  
  if (isFolder) {
    remountItem.addEventListener('click', () => {
      hideContextMenu();
      remountFolder(itemPath);
    });
  } else {
    remountItem.addEventListener('click', () => {
      hideContextMenu();
      reuploadFile(itemPath);
    });
  }

  const unmountItem = document.createElement('div');
  unmountItem.className = 'context-menu-item';
  unmountItem.innerHTML = `<span class="context-menu-icon">${window.icons.trash}</span>取消挂载`;
  unmountItem.addEventListener('click', () => {
    hideContextMenu();
    if (isFolder) {
      unmountFolder(itemPath);
    } else {
      unmountDocument(itemPath, isFolder);
    }
  });
  
  menu.appendChild(renameItem);
  menu.appendChild(deleteItem);
  menu.appendChild(mountItem);
  menu.appendChild(remountItem);
  menu.appendChild(unmountItem);
  
  document.body.appendChild(menu);
  
  // 点击其他地方关闭菜单
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
  }, 0);
}

// 取消挂载文档函数
async function unmountDocument(filePath, isFolder) {
  showLoadingOverlay(isFolder ? '正在取消挂载文件夹…' : '正在取消挂载…');
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
    hideLoadingOverlay();
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
  showLoadingOverlay('正在取消挂载…');
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
  } finally {
    hideLoadingOverlay();
  }
}

async function mountFolder(folderPath) {
  showLoadingOverlay('正在挂载文件夹…');
  try {
    const response = await fetch('http://localhost:8000/api/document/mount-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || `挂载失败 (${response.status})`);
    }
    handleFolderOperationResult('挂载完成', data);
  } catch (error) {
    showAlert(`挂载失败: ${error.message || error}`, 'error');
  } finally {
    hideLoadingOverlay();
  }
}

async function remountFolder(folderPath) {
  showLoadingOverlay('正在重新挂载文件夹…');
  try {
    const response = await fetch('http://localhost:8000/api/document/remount-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath, force_reupload: true })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || `重新挂载失败 (${response.status})`);
    }
    handleFolderOperationResult('重新挂载完成', data);
  } catch (error) {
    showAlert(`重新挂载失败: ${error.message || error}`, 'error');
  } finally {
    hideLoadingOverlay();
  }
}

async function unmountFolder(folderPath) {
  showLoadingOverlay('正在取消挂载文件夹…');
  try {
    const response = await fetch('http://localhost:8000/api/document/unmount-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_path: folderPath })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || data.message || `取消挂载失败 (${response.status})`);
    }
    handleFolderOperationResult('取消挂载完成', data);
  } catch (error) {
    showAlert(`取消挂载失败: ${error.message || error}`, 'error');
  } finally {
    hideLoadingOverlay();
  }
}

function handleFolderOperationResult(title, data) {
  const success = data.succeeded || 0;
  const failed = data.failed || 0;
  const statusKey = data.status || (failed > 0 ? 'partial' : 'success');

  if (data.folder) {
    refreshFolderUploadIndicators(data.folder).catch((error) => {
      console.warn('批量操作后刷新上传状态失败:', error);
    });
  }

  let message;
  if (statusKey === 'success') {
    message = '批量操作已完成，全部文件处理成功。';
  } else if (statusKey === 'failed') {
    message = '批量操作失败，请稍后重试。';
  } else {
    message = '批量操作完成，部分文件处理失败。';
  }
  showModal({
    type: failed > 0 ? 'warning' : 'success',
    title,
    message,
    showCancel: false,
    onConfirm: async () => {
      if (window.explorerModule && window.explorerModule.refreshFileTree) {
        await window.explorerModule.refreshFileTree();
      } else {
        await loadFileTree();
      }
    }
  });
}

// 上传文件函数
async function uploadFile(filePath) {
  showLoadingOverlay('正在挂载…');
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
    hideLoadingOverlay();
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
    type = 'info',
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = false,
    onConfirm = null,
    onCancel = null
  } = options;

  const palette = {
    success: {
      defaultTitle: '操作成功',
      accent: '#22c55e',
      accentStrong: '#16a34a',
      accentSoft: '#bbf7d0',
      shadow: 'rgba(34, 197, 94, 0.25)'
    },
    error: {
      defaultTitle: '发生错误',
      accent: '#f87171',
      accentStrong: '#ef4444',
      accentSoft: '#fecaca',
      shadow: 'rgba(248, 113, 113, 0.25)'
    },
    warning: {
      defaultTitle: '温馨提示',
      accent: '#fbbf24',
      accentStrong: '#f59e0b',
      accentSoft: '#fde68a',
      shadow: 'rgba(251, 191, 36, 0.25)'
    },
    info: {
      defaultTitle: '提示',
      accent: '#60a5fa',
      accentStrong: '#3b82f6',
      accentSoft: '#bfdbfe',
      shadow: 'rgba(96, 165, 250, 0.25)'
    }
  };

  const config = palette[type] || palette.info;
  const titleText = title || config.defaultTitle;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.35);
    backdrop-filter: blur(6px);
    z-index: 1600;
    padding: 24px;
    box-sizing: border-box;
  `;

  const modal = document.createElement('div');
  modal.className = 'modal-shell';
  modal.style.cssText = `
    background: var(--bg-color);
    color: var(--text-color);
    min-width: 320px;
    max-width: 420px;
    border-radius: 16px;
    padding: 24px 26px 22px;
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.25);
    border: 1px solid rgba(148, 163, 184, 0.18);
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
  `;

  const accentBar = document.createElement('span');
  accentBar.style.cssText = `
    display: inline-flex;
    width: 46px;
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(135deg, ${config.accentSoft}, ${config.accent});
  `;

  const titleElement = document.createElement('h3');
  titleElement.textContent = titleText;
  titleElement.style.cssText = `
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.01em;
  `;

  const messageElement = document.createElement('p');
  messageElement.textContent = message;
  messageElement.style.cssText = `
    margin: 0;
    line-height: 1.6;
    font-size: 14px;
    color: var(--text-muted, rgba(75, 85, 99, 0.85));
    white-space: pre-line;
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
  `;

  if (showCancel) {
    const cancelButton = document.createElement('button');
    cancelButton.textContent = cancelText;
    cancelButton.style.cssText = `
      padding: 9px 18px;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(148, 163, 184, 0.12);
      color: var(--text-color);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    `;

    cancelButton.addEventListener('mouseenter', () => {
      cancelButton.style.boxShadow = '0 8px 16px rgba(15, 23, 42, 0.18)';
      cancelButton.style.transform = 'translateY(-1px)';
      cancelButton.style.background = 'rgba(148, 163, 184, 0.18)';
    });

    cancelButton.addEventListener('mouseleave', () => {
      cancelButton.style.boxShadow = 'none';
      cancelButton.style.transform = 'none';
      cancelButton.style.background = 'rgba(148, 163, 184, 0.12)';
    });

    cancelButton.addEventListener('click', () => {
      overlay.remove();
      if (onCancel) onCancel();
    });

    buttonContainer.appendChild(cancelButton);
  }

  const confirmButton = document.createElement('button');
  confirmButton.textContent = confirmText;
  const confirmBaseShadow = `0 12px 24px ${config.shadow}`;
  confirmButton.style.cssText = `
    padding: 9px 20px;
    border-radius: 999px;
    border: none;
    background: linear-gradient(135deg, ${config.accentSoft}, ${config.accentStrong});
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: ${confirmBaseShadow};
    transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
  `;

  confirmButton.addEventListener('mouseenter', () => {
    confirmButton.style.boxShadow = `0 16px 30px ${config.shadow}`;
    confirmButton.style.transform = 'translateY(-1px)';
    confirmButton.style.filter = 'brightness(1.03)';
  });

  confirmButton.addEventListener('mouseleave', () => {
    confirmButton.style.boxShadow = confirmBaseShadow;
    confirmButton.style.transform = 'none';
    confirmButton.style.filter = 'none';
  });

  confirmButton.addEventListener('click', () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  });

  buttonContainer.appendChild(confirmButton);

  modal.appendChild(accentBar);
  modal.appendChild(titleElement);
  if (message) {
    modal.appendChild(messageElement);
  }
  modal.appendChild(buttonContainer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (type === 'info' || type === 'success') {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }
}

// 关闭所有模态框
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.remove();
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
  showLoadingOverlay('正在重新挂载…');
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
    hideLoadingOverlay();
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
  const nodeRelativePath = resolveNodeRelativePath(node);
  div.dataset.relativePath = nodeRelativePath;
  
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
    childContainer.dataset.parentRelative = nodeRelativePath;
    // 根据expandedFolders状态决定是否展开
    childContainer.style.display = isExpanded ? 'block' : 'none';
    arrow.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
    node.children.forEach(child => renderTree(child, childContainer, false, depth + 1));
    container.appendChild(childContainer);

    if (isExpanded) {
      updateFolderUploadStatus(nodeRelativePath);
    }
    
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
        updateFolderUploadStatus(nodeRelativePath);
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
    div.dataset.fileName = node.name;
    
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
    fileTreeEl.dataset.parentRelative = 'data';
    fileTreeEl.innerHTML = '';
    // 直接渲染子文件，不显示根目录
    if (tree.children && tree.children.length > 0) {
      tree.children.forEach(child => renderTree(child, fileTreeEl, true, 0));
    }
    await updateFolderUploadStatus('data');

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
  
  initializeSearchUI();
  showSearchResultsPane();
  renderSearchHistory();

  // 聚焦搜索输入框
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    if (searchState.query) {
      searchInput.value = searchState.query;
    }
    searchInput.focus();
  }

  renderSearchResults();
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

  hideSearchResultsPane();
  renderSearchResults();
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

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch(searchInput.value);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        switchToFileMode();
      }
    });

    searchInput.addEventListener('input', (e) => {
      searchState.query = e.target.value;
    });

    searchInput.addEventListener('focus', () => {
      renderSearchHistory();
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
function clearFileTreeSelection() {
  document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
  selectedItemPath = null;
  if (explorerModule) {
    explorerModule.setSelectedItemPath(null);
  }
}

if (fileTreeContainer) {
  fileTreeContainer.addEventListener('click', (e) => {
    if (!e.target.closest('.file-item')) {
      clearFileTreeSelection();
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
