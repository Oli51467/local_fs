const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

class SettingsBackendModule {
  constructor() {
    this.settingsPath = path.join(__dirname, '..', '..', 'settings.json');
    this.defaultSettings = {
      darkMode: false
    };
    
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
      fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
      return { success: true };
    } catch (error) {
      console.error('保存设置失败:', error);
      return { success: false, error: error.message };
    }
  }

  getSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        return settings;
      }
      return this.defaultSettings;
    } catch (error) {
      console.error('获取设置失败:', error);
      return this.defaultSettings;
    }
  }
}

module.exports = SettingsBackendModule;