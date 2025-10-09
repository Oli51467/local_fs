const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const ConfigManager = require('./config-manager');

class SettingsBackendModule {
  constructor() {
    this.settingsPath = path.join(__dirname, '..', '..', 'settings.json');
    this.defaultSettings = {
      darkMode: false,
      openaiApiKey: '',
      modelscopeApiKey: '',
      qwenApiKey: '',
      kimiApiKey: '',
      claudeApiKey: '',
      siliconflwApiKey: '',
      customModels: []
    };
    
    // 初始化配置管理器
    this.configManager = new ConfigManager();
    
    // 监听配置变化
    this.configManager.on('configChanged', (newConfig, oldConfig) => {
      console.log('配置已更新，通知渲染进程...');
      // 通知所有渲染进程配置已更新
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('settings-updated', newConfig);
      });
    });
    
    this.registerIpcHandlers();
  }

  registerIpcHandlers() {
    // 保存设置
    ipcMain.handle('save-settings', (event, settings) => {
      return this.saveSettings(settings);
    });

    // 获取设置
    ipcMain.handle('get-settings', () => {
      return this.getSettings();
    });
  }

  saveSettings(settings) {
    try {
      this.configManager.update(settings);
      return { success: true };
    } catch (error) {
      console.error('保存设置失败:', error);
      return { success: false, error: error.message };
    }
  }

  getSettings() {
    try {
      return this.configManager.getAll();
    } catch (error) {
      console.error('获取设置失败:', error);
      return this.defaultSettings;
    }
  }

  // 销毁方法
  destroy() {
    if (this.configManager) {
      this.configManager.destroy();
    }
  }
}

module.exports = SettingsBackendModule;
