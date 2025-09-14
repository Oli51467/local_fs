const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.settingsPath = path.join(__dirname, '..', '..', 'settings.json');
    this.config = {};
    this.watcher = null;
    this.isProduction = process.env.NODE_ENV === 'production';
    this.ignoreSettings = process.env.DEV_IGNORE_SETTINGS === 'true';
    
    this.loadConfig();
    this.setupWatcher();
  }

  /**
   * 加载配置文件
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const configData = fs.readFileSync(this.settingsPath, 'utf-8');
        this.config = JSON.parse(configData);
        //console.log('配置已加载:', this.config);
      } else {
        // 创建默认配置
        this.config = {
          darkMode: false
        };
        this.saveConfig();
      }
    } catch (error) {
      console.error('加载配置失败:', error);
      this.config = {
        darkMode: false
      };
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