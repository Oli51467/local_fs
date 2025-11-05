const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const ConfigManager = require('./config-manager');

const fetchFn = (...args) => fetch(...args);

class SettingsBackendModule {
  constructor() {
    this.settingsPath = path.join(__dirname, '..', '..', 'settings.json');
    this.defaultSettings = {
      darkMode: false,
      openaiApiKey: '',
      modelscopeApiKey: '',
      qwenApiKey: '',
      siliconflwApiKey: '',
      kimiApiKey: '',
      mem0ApiKey: '',
      customModels: [],
      chatModelSelection: null,
      enableModelSummary: false,
      modelSummarySelection: null,
      enableSummarySearch: false,
      enableMemoryManagement: false
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

    // 测试 ModelScope 连通性
    ipcMain.handle('test-modelscope-connection', async (event, payload) => {
      return this.testModelScopeConnection(payload);
    });

    // 测试通义千问（DashScope）连通性
    ipcMain.handle('test-dashscope-connection', async (event, payload) => {
      return this.testDashScopeConnection(payload);
    });

    ipcMain.handle('validate-memory-settings', async (event, payload) => {
      return this.validateMemorySettings(payload);
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

  async testModelScopeConnection(payload = {}) {
    const apiKey = (payload?.apiKey || '').trim();
    const model = (payload?.model || '').trim() || 'Qwen/Qwen3-32B';

    if (!apiKey) {
      return { success: false, error: '缺少 ModelScope API Key。' };
    }

    const host = process.env.FS_APP_API_HOST || '127.0.0.1';
    const port = process.env.FS_APP_API_PORT || '8000';
    const url = `http://${host}:${port}/api/models/test-modelscope`;

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: apiKey,
          model,
          prompt: '你好，如果你能够正常工作，请回复我“你好”。'
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        const message = data?.detail || data?.error || `HTTP ${response.status}`;
        return {
          success: false,
          status: response.status,
          error: message
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        error: error?.message || '请求 ModelScope 测试接口失败'
      };
    }
  }

  async testDashScopeConnection(payload = {}) {
    const apiKey = (payload?.apiKey || '').trim();
    const model = (payload?.model || '').trim() || 'qwen3-max';

    if (!apiKey) {
      return { success: false, error: '缺少通义千问 API Key。' };
    }

    const host = process.env.FS_APP_API_HOST || '127.0.0.1';
    const port = process.env.FS_APP_API_PORT || '8000';
    const url = `http://${host}:${port}/api/models/test-dashscope`;

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: apiKey,
          model,
          prompt: '你好，如果你能够正常工作，请回复我“你好”。'
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        const message = data?.detail || data?.error || `HTTP ${response.status}`;
        return {
          success: false,
          status: response.status,
          error: message
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        error: error?.message || '请求通义千问测试接口失败'
      };
    }
  }

  async validateMemorySettings(payload = {}) {
    const mem0 = (payload?.mem0ApiKey || payload?.mem0_api_key || '').trim();
    const openai = (payload?.openaiApiKey || payload?.openai_api_key || '').trim();

    if (!mem0 && !openai) {
      return { success: false, detail: '请至少提供 Mem0 或 OpenAI API Key。' };
    }

    const host = process.env.FS_APP_API_HOST || '127.0.0.1';
    const port = process.env.FS_APP_API_PORT || '8000';
    const url = `http://${host}:${port}/api/memory/validate`;

    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mem0_api_key: mem0 || undefined,
          openai_api_key: openai || undefined
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data?.detail || `HTTP ${response.status}`;
        return {
          success: false,
          status: response.status,
          detail: message
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        detail: error?.message || '请求记忆校验接口失败'
      };
    }
  }
}

module.exports = SettingsBackendModule;
