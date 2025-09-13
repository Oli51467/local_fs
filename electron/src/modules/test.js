/**
 * 测试模块 - 用于API接口测试
 */
class TestModule {
  constructor() {
    // 获取DOM元素
    this.testBtn = document.getElementById('test-btn');
    this.testPage = document.getElementById('test-page');
    this.settingsPage = document.getElementById('settings-page');
    this.fileContent = document.getElementById('file-content');
    this.fileTreeContainer = document.getElementById('file-tree-container');
    
    // 测试表单元素
    this.apiEndpoint = document.getElementById('api-endpoint');
    this.requestMethod = document.getElementById('request-method');
    this.requestHeaders = document.getElementById('request-headers');
    this.requestBody = document.getElementById('request-body');
    this.queryParams = document.getElementById('query-params');
    this.sendButton = document.getElementById('send-request');
    
    // 响应显示元素
    this.responseStatus = document.getElementById('response-status');
    this.responseContent = document.getElementById('response-content');
    
    // 默认值设置
    this.initDefaultValues();
  }

  /**
   * 初始化模块
   */
  async init() {
    this.bindEvents();
  }

  /**
   * 初始化默认值
   */
  initDefaultValues() {
    // 设置默认headers
    this.requestHeaders.value = JSON.stringify({
      "Content-Type": "application/json"
    }, null, 2);
    
    // 设置默认body（空对象）
    this.requestBody.value = JSON.stringify({}, null, 2);
    
    // 设置默认query参数（空对象）
    this.queryParams.value = JSON.stringify({}, null, 2);
  }

  /**
   * 绑定事件监听器
   */
  bindEvents() {
    // 测试按钮点击事件
    this.testBtn.addEventListener('click', () => {
      this.showTestPage();
    });

    // 发送请求按钮事件
    this.sendButton.addEventListener('click', () => {
      this.sendRequest();
    });
    
    // 请求方法改变事件
    this.requestMethod.addEventListener('change', () => {
      this.toggleBodyField();
    });
    
    // 初始化时设置body字段显示状态
    this.toggleBodyField();
  }

  /**
   * 切换Body字段的显示状态
   */
  toggleBodyField() {
    const method = this.requestMethod.value;
    const bodyGroup = this.requestBody.closest('.form-group');
    
    if (method === 'GET') {
      bodyGroup.style.display = 'none';
    } else {
      bodyGroup.style.display = 'block';
    }
  }

  /**
   * 显示测试页面
   */
  showTestPage() {
    // 隐藏其他页面
    this.settingsPage.style.display = 'none';
    this.fileContent.style.display = 'none';
    this.fileTreeContainer.style.display = 'none';
    
    // 显示测试页面
    this.testPage.style.display = 'block';
    
    console.log('切换到测试模式');
  }

  /**
   * 隐藏测试页面
   */
  hideTestPage() {
    this.testPage.style.display = 'none';
  }

  /**
   * 发送API请求
   */
  async sendRequest() {
    try {
      // 获取表单数据
      const endpoint = this.apiEndpoint.value;
      const method = this.requestMethod.value;
      
      // 解析JSON数据
      let headers = {};
      let body = null;
      let queryParams = {};
      
      try {
        headers = JSON.parse(this.requestHeaders.value || '{}');
      } catch (e) {
        this.showError('Headers格式错误: ' + e.message);
        return;
      }
      
      try {
        queryParams = JSON.parse(this.queryParams.value || '{}');
      } catch (e) {
        this.showError('Query参数格式错误: ' + e.message);
        return;
      }
      
      if (method === 'POST') {
        try {
          const bodyText = this.requestBody.value.trim();
          if (bodyText) {
            body = JSON.parse(bodyText);
          }
        } catch (e) {
          this.showError('Body格式错误: ' + e.message);
          return;
        }
      }
      
      // 构建URL
      let url = `http://127.0.0.1:8000${endpoint}`;
      
      // 添加query参数
      const queryString = new URLSearchParams();
      Object.keys(queryParams).forEach(key => {
        if (queryParams[key] !== null && queryParams[key] !== undefined && queryParams[key] !== '') {
          queryString.append(key, queryParams[key]);
        }
      });
      
      if (queryString.toString()) {
        url += '?' + queryString.toString();
      }
      
      // 构建请求选项
      const options = {
        method: method,
        headers: headers
      };
      
      if (method === 'POST' && body !== null) {
        options.body = JSON.stringify(body);
      }
      
      // 显示请求开始状态
      this.showLoading();
      
      // 发送请求
      const response = await fetch(url, options);
      
      // 获取响应文本
      const responseText = await response.text();
      
      // 尝试解析为JSON
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        responseData = responseText;
      }
      
      // 显示响应结果
      this.showResponse(response.status, response.statusText, responseData);
      
    } catch (error) {
      this.showError('请求失败: ' + error.message);
    }
  }

  /**
   * 显示加载状态
   */
  showLoading() {
    this.responseStatus.className = 'response-status';
    this.responseStatus.textContent = '发送中...';
    this.responseContent.textContent = '';
    this.sendButton.disabled = true;
    this.sendButton.textContent = '发送中...';
  }

  /**
   * 显示响应结果
   */
  showResponse(status, statusText, data) {
    // 恢复按钮状态
    this.sendButton.disabled = false;
    this.sendButton.textContent = '发送请求';
    
    // 显示状态
    this.responseStatus.className = status >= 200 && status < 300 ? 'response-status success' : 'response-status error';
    this.responseStatus.textContent = `${status} ${statusText}`;
    
    // 显示响应内容
    if (typeof data === 'object') {
      this.responseContent.textContent = JSON.stringify(data, null, 2);
    } else {
      this.responseContent.textContent = data;
    }
  }

  /**
   * 显示错误信息
   */
  showError(message) {
    // 恢复按钮状态
    this.sendButton.disabled = false;
    this.sendButton.textContent = '发送请求';
    
    // 显示错误
    this.responseStatus.className = 'response-status error';
    this.responseStatus.textContent = '错误';
    this.responseContent.textContent = message;
  }
}

// 导出到全局
window.TestModule = TestModule;