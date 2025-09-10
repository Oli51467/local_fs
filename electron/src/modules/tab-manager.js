/**
 * Tab管理模块
 * 负责管理文件标签页的创建、切换、关闭等操作
 */

class TabManager {
  constructor(container) {
    this.container = container;
    this.tabs = new Map(); // 存储打开的文件tab
    this.activeTabId = null;
    this.onTabSwitch = null; // tab切换回调
    this.onTabClose = null; // tab关闭回调
    this.onTabCreate = null; // tab创建回调
    this.init();
  }

  init() {
    // 创建tab容器
    this.container.innerHTML = `
      <div class="tabs-container" id="tabs-container" style="display: none;">
        <div class="tab-list" id="tab-list"></div>
      </div>
    `;

    this.tabsContainer = document.getElementById('tabs-container');
    this.tabList = document.getElementById('tab-list');
    
    // 初始化键盘快捷键
    this.initKeyboardShortcuts();
    
    // 添加样式
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .tabs-container {
        border-bottom: 2px solid var(--tree-border);
        background: var(--tree-bg);
        min-height: 35px;
        margin-top: -9px;
        margin-left: -10px;
        margin-right: -10px;
      }

      .tab-list {
        display: flex;
        overflow-x: auto;
        scrollbar-width: thin;
        padding: 0;
        margin: 0;
      }
      
      /* Tab栏滚动条样式 - 使用更高优先级确保不被全局样式覆盖 */
       .tab-container .tab-list::-webkit-scrollbar {
         height: 1px !important;
         width: auto !important;
       }
      
      .tab-container .tab-list::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30) !important;
      }
      
      .tab-container .tab-list::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647) !important;
        border-radius: 3px !important;
      }
      
      .tab-container .tab-list::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc) !important;
      }

      .tab-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-right: 1px solid var(--tree-border);
        cursor: pointer;
        background: var(--bg-color);
        color: var(--text-color);
        font-size: 13px;
        white-space: nowrap;
        width: auto;
        position: relative;
        border-bottom: 2px solid transparent;
      }

      .tab-item:first-child {
        margin-left: 0;
      }
      
      .tab-item:last-child {
        border-right: none;
      }

      .tab-item:hover {
        background: var(--tree-hover);
      }

      .tab-item.active {
        background: var(--bg-color);
        border-bottom: 2px solid #007acc;
      }

      .tab-title {
        overflow: hidden;
        text-overflow: ellipsis;
        margin-right: 4px;
        white-space: nowrap;
      }

      .tab-close {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        opacity: 1.7;
        margin-left: 0px;
        padding: 0px 0px;
        font-weight: bold;
        color: var(--text-color);
        cursor: pointer;
        transition: all 0.2s;
      }

      .tab-close:hover {
        background: rgba(128, 128, 128, 0.3);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // 创建新标签页
  createTab(tabId, fileName, filePath) {
    // 如果标签页已存在，直接切换
    if (this.tabs.has(tabId)) {
      this.switchTab(tabId);
      return;
    }

    // 显示标签页容器
    if (this.tabsContainer) {
      this.tabsContainer.style.display = 'flex';
    }
    
    const tabElement = document.createElement('div');
    tabElement.className = 'tab-item';
    tabElement.dataset.tabId = tabId;
    
    const tabTitle = document.createElement('span');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = fileName;
    tabTitle.title = fileName;
    
    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });
    
    tabElement.appendChild(tabTitle);
    tabElement.appendChild(closeBtn);

    // 点击tab切换
    tabElement.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTab(tabId);
      }
    });

    this.tabList.appendChild(tabElement);

    // 存储tab信息
    this.tabs.set(tabId, {
      element: tabElement,
      fileName: fileName,
      filePath: filePath,
      isDirty: false
    });

    // 触发创建回调
    if (this.onTabCreate) {
      this.onTabCreate(tabId, fileName, filePath);
    }

    // 自动切换到新创建的标签页
    this.switchTab(tabId);
  }

  // 切换标签页
  switchTab(tabId) {
    // 取消所有tab的激活状态
    this.tabs.forEach((tab) => {
      tab.element.classList.remove('active');
    });

    // 激活指定tab
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.element.classList.add('active');
      this.activeTabId = tabId;
      
      // 触发切换回调
      if (this.onTabSwitch) {
        this.onTabSwitch(tabId, tab);
      }
    }
  }

  // 关闭标签页
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // 触发关闭回调
    if (this.onTabClose) {
      this.onTabClose(tabId, tab);
    }

    // 移除DOM元素
    tab.element.remove();
    
    // 从tabs中删除
    this.tabs.delete(tabId);

    // 如果关闭的是当前激活的tab，切换到其他tab
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        this.activeTabId = null;
        // 隐藏标签页容器
        if (this.tabsContainer) {
          this.tabsContainer.style.display = 'none';
        }
      }
    }
  }

  // 关闭所有标签页
  closeAllTabs() {
    const tabIds = Array.from(this.tabs.keys());
    tabIds.forEach(tabId => {
      this.closeTab(tabId);
    });
  }

  // 标记标签页为已修改
  markTabAsDirty(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    tab.isDirty = true;
    const tabTitle = tab.element.querySelector('.tab-title');
    if (tabTitle && !tabTitle.textContent.endsWith(' *')) {
      tabTitle.textContent += ' *';
    }
  }

  // 标记标签页为已保存
  markTabAsClean(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    
    tab.isDirty = false;
    const tabTitle = tab.element.querySelector('.tab-title');
    if (tabTitle && tabTitle.textContent.endsWith(' *')) {
      tabTitle.textContent = tab.fileName;
    }
  }

  // 更新标签页标题
  updateTabTitle(tabId, newTitle) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.fileName = newTitle;
    const tabTitle = tab.element.querySelector('.tab-title');
    if (tabTitle) {
      const displayTitle = tab.isDirty ? `${newTitle} *` : newTitle;
      tabTitle.textContent = displayTitle;
      tabTitle.title = newTitle;
    }
  }

  // 获取当前激活的标签页
  getActiveTab() {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : null;
  }

  // 获取所有标签页
  getAllTabs() {
    return Array.from(this.tabs.values());
  }

  // 检查标签页是否存在
  hasTab(tabId) {
    return this.tabs.has(tabId);
  }

  // 获取标签页数量
  getTabCount() {
    return this.tabs.size;
  }

  // 设置回调函数
  setCallbacks(callbacks) {
    if (callbacks.onTabSwitch) {
      this.onTabSwitch = callbacks.onTabSwitch;
    }
    if (callbacks.onTabClose) {
      this.onTabClose = callbacks.onTabClose;
    }
    if (callbacks.onTabCreate) {
      this.onTabCreate = callbacks.onTabCreate;
    }
  }

  // 初始化键盘快捷键
  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+W 关闭当前标签
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        if (this.activeTabId) {
          this.closeTab(this.activeTabId);
        }
      }
      
      // Ctrl+Shift+W 关闭所有标签
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        this.closeAllTabs();
      }

      // Ctrl+Tab 切换到下一个标签
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToNextTab();
      }

      // Ctrl+Shift+Tab 切换到上一个标签
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToPrevTab();
      }
    });
  }

  // 切换到下一个标签页
  switchToNextTab() {
    const tabIds = Array.from(this.tabs.keys());
    if (tabIds.length <= 1) return;

    const currentIndex = tabIds.indexOf(this.activeTabId);
    const nextIndex = (currentIndex + 1) % tabIds.length;
    this.switchTab(tabIds[nextIndex]);
  }

  // 切换到上一个标签页
  switchToPrevTab() {
    const tabIds = Array.from(this.tabs.keys());
    if (tabIds.length <= 1) return;

    const currentIndex = tabIds.indexOf(this.activeTabId);
    const prevIndex = currentIndex === 0 ? tabIds.length - 1 : currentIndex - 1;
    this.switchTab(tabIds[prevIndex]);
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TabManager;
} else {
  window.TabManager = TabManager;
}