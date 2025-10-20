const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { app } = require('electron');

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.isProduction = process.env.NODE_ENV === 'production';
    this.ignoreSettings = process.env.DEV_IGNORE_SETTINGS === 'true';

    this.settingsDir = this.resolveSettingsDir();
    this.settingsPath = path.join(this.settingsDir, 'settings.json');
    this.legacySettingsPath = path.join(__dirname, '..', '..', 'settings.json');
    this.defaultConfig = {
      darkMode: false,
      openaiApiKey: '',
      modelscopeApiKey: '',
      qwenApiKey: '',
      kimiApiKey: '',
      claudeApiKey: '',
      siliconflwApiKey: '',
      customModels: [],
      enableModelSummary: false,
      modelSummarySelection: null
    };

    this.ensureSettingsDirExists();
    this.migrateLegacySettingsIfNeeded();

    this.config = {};
    this.watcher = null;
    
    this.loadConfig();
    this.setupWatcher();
  }

  resolveSettingsDir() {
    try {
      const userDataPath = app.getPath('userData');
      return path.join(userDataPath, 'config');
    } catch (error) {
      console.error('无法获取用户配置目录，使用备用路径:', error);
      return path.join(os.homedir(), '.lofs-config');
    }
  }

  ensureSettingsDirExists() {
    try {
      fs.mkdirSync(this.settingsDir, { recursive: true });
    } catch (error) {
      console.error('创建配置目录失败:', error);
    }
  }

  migrateLegacySettingsIfNeeded() {
    try {
      if (!fs.existsSync(this.settingsPath) && fs.existsSync(this.legacySettingsPath)) {
        fs.copyFileSync(this.legacySettingsPath, this.settingsPath);
        console.log('已从旧版设置文件迁移到用户配置目录');
      }
    } catch (error) {
      console.error('迁移旧版设置文件失败:', error);
    }
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const configData = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = JSON.parse(configData);
        this.config = { ...this.defaultConfig, ...parsed };
        //console.log('配置已加载:', this.config);
      } else {
        // 创建默认配置
        this.config = { ...this.defaultConfig };
        this.saveConfig();
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      this.config = { ...this.defaultConfig };
    }
  }

  /**
   * 保存配置文件
   */
  saveConfig() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.config, null, 2));
      console.log('配置已保存:', this.config);
    } catch (error) {
      console.error('保存配置失败:', error);
    }
  }

  /**
   * 设置文件监听器
   */
  setupWatcher() {
    // 在生产模式下或者设置了忽略标志时，不启用文件监听
    if (this.isProduction || this.ignoreSettings) {
      console.log('配置文件监听已禁用 (生产模式或忽略设置)');
      return;
    }

    try {
      this.watcher = fs.watch(this.settingsPath, (eventType, filename) => {
        if (eventType === 'change') {
          console.log('检测到配置文件变化，重新加载配置...');
          setTimeout(() => {
            this.reloadConfig();
          }, 100); // 延迟一点时间确保文件写入完成
        }
      });
      console.log('配置文件监听已启用');
    } catch (error) {
      console.error('设置文件监听失败:', error);
    }
  }

  /**
   * 重新加载配置
   */
  reloadConfig() {
    const oldConfig = { ...this.config };
    this.loadConfig();
    
    // 检查配置是否有变化
    if (JSON.stringify(oldConfig) !== JSON.stringify(this.config)) {
      console.log('配置已更新:', this.config);
      this.emit('configChanged', this.config, oldConfig);
    }
  }

  /**
   * 获取配置值
   */
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * 设置配置值
   */
  set(key, value) {
    this.config[key] = value;
    this.saveConfig();
    this.emit('configChanged', this.config);
  }

  /**
   * 获取所有配置
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * 更新多个配置
   */
  update(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
    this.emit('configChanged', this.config, oldConfig);
  }

  /**
   * 销毁监听器
   */
  destroy() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('配置文件监听已关闭');
    }
  }
}

module.exports = ConfigManager;
