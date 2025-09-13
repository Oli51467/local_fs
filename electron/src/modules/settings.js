/**
 * 设置模块
 * 负责应用设置的管理，包括深色模式切换、设置保存和加载等功能
 */

class SettingsModule {
  constructor() {
    this.isDarkMode = false;
    this.settingsPageEl = document.getElementById('settings-page');
    this.fileContentEl = document.getElementById('file-content');
    this.settingsBtn = document.getElementById('settings-btn');
    this.darkModeToggle = document.getElementById('dark-mode-toggle');
    this.toggleTreeBtn = document.getElementById('toggle-tree');
    
    this.init();
  }

  /**
   * 初始化设置模块
   */
  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.setupConfigListener();
  }

  /**
   * 设置配置更新监听器
   */
  setupConfigListener() {
    // 监听来自主进程的配置更新事件
    if (window.fsAPI && window.fsAPI.onSettingsUpdated) {
      window.fsAPI.onSettingsUpdated((newConfig) => {
        console.log('收到配置更新:', newConfig);
        this.isDarkMode = newConfig.darkMode || false;
        this.applyTheme();
        // 不需要保存，因为配置已经在主进程中更新了
      });
    }
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 设置按钮点击事件
    this.settingsBtn.addEventListener('click', () => {
      this.showSettingsPage();
    });

    // 深色模式切换事件
    this.darkModeToggle.addEventListener('change', async (e) => {
      this.isDarkMode = e.target.checked;
      this.applyTheme();
      await this.saveSettings();
    });

    // 文件按钮点击事件
    this.toggleTreeBtn.addEventListener('click', () => {
      this.showFilePage();
    });
    
    // 搜索按钮点击事件已在renderer.js中处理，这里不需要重复绑定
  }

  /**
   * 应用主题
   */
  applyTheme() {
    if (this.isDarkMode) {
      document.body.classList.add('dark-mode');
      this.darkModeToggle.checked = true;
    } else {
      document.body.classList.remove('dark-mode');
      this.darkModeToggle.checked = false;
    }
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const settings = await window.fsAPI.getSettings();
      this.isDarkMode = settings.darkMode || false;
      this.applyTheme();
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    try {
      await window.fsAPI.saveSettings({ darkMode: this.isDarkMode });
    } catch (error) {
      console.error('保存设置失败:', error);
    }
  }

  /**
   * 显示文件页面
   */
  showFilePage() {
    this.fileContentEl.style.display = 'block';
    this.settingsPageEl.style.display = 'none';
    
    // 显示文件树容器
    const fileTreeContainer = document.getElementById('file-tree-container');
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'block';
    }
  }

  /**
   * 显示设置页面
   */
  showSettingsPage() {
    this.fileContentEl.style.display = 'none';
    this.settingsPageEl.style.display = 'block';
    
    // 折叠操作栏，隐藏左侧的文件树容器
    const fileTreeContainer = document.getElementById('file-tree-container');
    if (fileTreeContainer) {
      fileTreeContainer.style.display = 'none';
    }
  }

  /**
   * 获取当前主题模式
   */
  getDarkMode() {
    return this.isDarkMode;
  }

  /**
   * 设置主题模式
   */
  async setDarkMode(darkMode) {
    this.isDarkMode = darkMode;
    this.applyTheme();
    await this.saveSettings();
  }
}

// 导出设置模块
window.SettingsModule = SettingsModule;