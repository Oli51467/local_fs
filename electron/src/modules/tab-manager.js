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
        <div class="tab-wrapper">
          <div class="tab-list" id="tab-list"></div>
          <div class="tab-extension" id="tab-extension" style="display: none;">
            <button class="tab-extension-btn" id="tab-extension-btn" title="更多标签页">
              <span>⋯</span>
            </button>
            <div class="tab-dropdown" id="tab-dropdown" style="display: none;"></div>
          </div>
        </div>
      </div>
    `;

    this.tabsContainer = document.getElementById('tabs-container');
    this.tabList = document.getElementById('tab-list');
    this.tabExtension = document.getElementById('tab-extension');
    this.tabExtensionBtn = document.getElementById('tab-extension-btn');
    this.tabDropdown = document.getElementById('tab-dropdown');
    
    // 初始化扩展按钮事件
    this.initExtensionButton();
    
    // 初始化键盘快捷键
    this.initKeyboardShortcuts();
    
    // 添加样式
    this.addStyles();
    
    // 存储可见和隐藏的tab
    this.visibleTabs = new Set();
    this.hiddenTabs = new Set();
  }

  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .tabs-container {
        border-bottom: 1px solid var(--tree-border);
        background: var(--bg-color);
        min-height: 35px;
        margin-top: -9px;
        margin-left: -10px;
        margin-right: -10px;
      }

      .tab-wrapper {
        display: flex;
        width: 100%;
        height: 100%;
      }

      .tab-list {
        display: flex;
        flex: 1;
        overflow: hidden;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      
      .tab-extension {
        flex-shrink: 0;
        position: relative;
        display: flex;
        align-items: center;
      }
      
      .tab-extension-btn {
        background: none;
        border: none;
        cursor: pointer;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 4px;
        border-radius: 3px;
        transition: background-color 0.2s;
        color: var(--text-color);
        font-size: 16px;
        font-weight: bold;
      }
      
      .tab-extension-btn:hover {
        background-color: var(--tree-hover);
      }
      
      .tab-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        background: var(--bg-color);
        border: 1px solid var(--tree-border);
        border-radius: 3px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        min-width: 200px;
        max-width: 250px;
        max-height: 300px;
        overflow-y: auto;
        z-index: 1000;
      }
      
      .tab-dropdown-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        cursor: pointer;
        font-size: 13px;
        color: var(--text-color);
        background: var(--bg-color);
        transition: background-color 0.15s ease;
      }
      
      .tab-dropdown-item:hover {
        background: var(--tree-hover);
      }
      
      .tab-dropdown-item.active {
        background: var(--accent-color);
        color: #ffffff;
        font-weight: 500;
      }
      
      .tab-dropdown-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-right: 8px;
        text-decoration: none;
      }
      
      .tab-dropdown-close {
        width: 16px;
        height: 16px;
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        opacity: 0.7;
        transition: all 0.2s;
      }
      
      .tab-dropdown-close:hover {
        background: rgba(255, 255, 255, 0.2);
        opacity: 1;
      }
      
      .tab-dropdown-separator {
        height: 1px;
        background: var(--tree-border);
        margin: 0;
      }
      
      .tab-dropdown-action {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-color);
          border: none;
          background: var(--bg-color);
          width: 100%;
          text-align: left;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: background-color 0.15s ease;
        }
      
      .tab-dropdown-action:hover {
        background: var(--tree-hover);
      }

      .tab-item {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        border-right: 1px solid var(--tree-border);
        cursor: pointer;
        background: var(--tree-bg);
        color: var(--text-muted);
        font-size: 13px;
        white-space: nowrap;
        flex-shrink: 0;
        position: relative;
        border-bottom: 2px solid transparent;
        max-width: calc(80% - 50px);
        transition: all 0.15s ease;
      }

      .tab-item:first-child {
        margin-left: 0;
      }
      
      .tab-item:last-child {
        border-right: none;
      }

      .tab-item:hover {
        background: var(--bg-color);
        color: var(--text-color);
      }

      .tab-item.active {
        background: var(--bg-color);
        color: var(--text-color);
        border-bottom: 2px solid var(--accent-color);
      }

      .tab-title {
        margin-right: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
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
        background: var(--tree-hover);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // 初始化扩展按钮事件
  initExtensionButton() {
    this.tabExtensionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });
    
    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!this.tabExtension.contains(e.target)) {
        this.hideDropdown();
      }
    });
  }
  
  // 切换下拉菜单显示状态
  toggleDropdown() {
    const isVisible = this.tabDropdown.style.display !== 'none';
    if (isVisible) {
      this.hideDropdown();
    } else {
      this.showDropdown();
    }
  }
  
  // 显示下拉菜单
  showDropdown() {
    this.updateDropdownContent();
    this.tabDropdown.style.display = 'block';
  }
  
  // 隐藏下拉菜单
  hideDropdown() {
    this.tabDropdown.style.display = 'none';
  }
  
  // 更新下拉菜单内容
  updateDropdownContent() {
    this.tabDropdown.innerHTML = '';
    
    // 添加隐藏的标签页
    this.hiddenTabs.forEach(tabId => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      
      const dropdownItem = document.createElement('div');
      dropdownItem.className = 'tab-dropdown-item';
      if (this.activeTabId === tabId) {
        dropdownItem.classList.add('active');
      }
      
      const title = document.createElement('span');
      title.className = 'tab-dropdown-title';
      title.textContent = tab.fileName;
      title.title = tab.fileName;
      
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tab-dropdown-close';
      closeBtn.innerHTML = '×';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tabId);
      });
      
      dropdownItem.appendChild(title);
      dropdownItem.appendChild(closeBtn);
      
      dropdownItem.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-dropdown-close')) {
          this.switchTab(tabId);
          this.hideDropdown();
        }
      });
      
      this.tabDropdown.appendChild(dropdownItem);
    });
    
    // 如果有隐藏的标签页，添加分隔线和关闭所有文件按钮
    if (this.hiddenTabs.size > 0 || this.tabs.size > 0) {
      // 添加分隔线
      const separator = document.createElement('div');
      separator.className = 'tab-dropdown-separator';
      this.tabDropdown.appendChild(separator);
      
      // 添加关闭所有文件按钮
       const closeAllBtn = document.createElement('button');
       closeAllBtn.className = 'tab-dropdown-action';
       closeAllBtn.textContent = '全部关闭';
      closeAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeSavedTabs();
        this.hideDropdown();
      });
      
      this.tabDropdown.appendChild(closeAllBtn);
    }
  }
  
  // 检查文本是否需要省略号
  // 检查tab栏是否溢出
  checkTabOverflow() {
    const tabListWidth = this.tabList.clientWidth;
    const extensionWidth = this.tabExtension.clientWidth;
    const availableWidth = this.tabsContainer.clientWidth - extensionWidth - 10; // 留10px边距
    
    let totalTabWidth = 0;
    const visibleTabIds = [];
    const hiddenTabIds = [];
    
    // 计算每个tab的宽度
    this.tabs.forEach((tab, tabId) => {
      const tabWidth = tab.element.offsetWidth || 150; // 默认150px
      if (totalTabWidth + tabWidth <= availableWidth) {
        totalTabWidth += tabWidth;
        visibleTabIds.push(tabId);
      } else {
        hiddenTabIds.push(tabId);
      }
    });
    
    // 更新可见和隐藏的tab集合
    this.visibleTabs = new Set(visibleTabIds);
    this.hiddenTabs = new Set(hiddenTabIds);
    
    // 显示/隐藏tab元素
    this.tabs.forEach((tab, tabId) => {
      if (this.visibleTabs.has(tabId)) {
        tab.element.style.display = 'flex';
      } else {
        tab.element.style.display = 'none';
      }
    });
    
    // 显示/隐藏扩展按钮
    if (this.hiddenTabs.size > 0) {
      this.tabExtension.style.display = 'flex';
      // 更新扩展菜单内容
      this.updateDropdownContent();
    } else {
      this.tabExtension.style.display = 'none';
      this.hideDropdown();
    }
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

    // 检查溢出并更新显示
    setTimeout(() => {
      this.checkTabOverflow();
    }, 0);

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
  
  // 将tab移动到可见区域
  moveTabToVisible(tabId) {
    if (!this.hiddenTabs.has(tabId)) return;
    
    // 简单切换到该tab
    this.switchTab(tabId);
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
    
    // 从可见和隐藏集合中移除
    this.visibleTabs.delete(tabId);
    this.hiddenTabs.delete(tabId);

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
    
    // 重新检查溢出状态
    setTimeout(() => {
      this.checkTabOverflow();
    }, 0);
  }

  // 关闭所有标签页
  closeAllTabs() {
    const tabIds = Array.from(this.tabs.keys());
    tabIds.forEach(tabId => {
      this.closeTab(tabId);
    });
  }
  
  // 关闭所有已保存的文件（保留未保存的文件）
  closeSavedTabs() {
    const tabIds = Array.from(this.tabs.keys());
    tabIds.forEach(tabId => {
      const tab = this.tabs.get(tabId);
      // 只关闭已保存的文件（isDirty为false或undefined）
      if (tab && !tab.isDirty) {
        this.closeTab(tabId);
      }
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

  // 根据文件路径关闭标签页
  closeTabByFilePath(filePath) {
    // 遍历所有tab，找到匹配的文件路径
    for (const [tabId, tab] of this.tabs) {
      if (tab.filePath === filePath) {
        this.closeTab(tabId);
        return true; // 找到并关闭了对应的tab
      }
    }
    return false; // 没有找到对应的tab
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
        return; // 明确返回，避免继续处理
      }
      
      // Ctrl+Shift+W 关闭所有标签
      if (e.ctrlKey && e.shiftKey && e.key === 'W') {
        e.preventDefault();
        this.closeAllTabs();
        return; // 明确返回，避免继续处理
      }

      // Ctrl+Tab 切换到下一个标签
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToNextTab();
        return; // 明确返回，避免继续处理
      }

      // Ctrl+Shift+Tab 切换到上一个标签
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
        e.preventDefault();
        this.switchToPrevTab();
        return; // 明确返回，避免继续处理
      }

      // Arrow navigation without modifiers
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (e.key === 'ArrowRight') {
          const activeElement = document.activeElement;
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
            return;
          }
          if (this.activeTabId) {
            e.preventDefault();
            this.switchToNextTab();
          }
          return;
        }
        if (e.key === 'ArrowLeft') {
          const activeElement = document.activeElement;
          if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
            return;
          }
          if (this.activeTabId) {
            e.preventDefault();
            this.switchToPrevTab();
          }
          return;
        }
      }

      // 对于其他键盘事件，不阻止传播，让其他监听器处理
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
