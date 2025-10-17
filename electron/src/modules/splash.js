/**
 * 启动页面管理模块
 * 负责控制启动页面的显示、隐藏和状态管理
 */
class SplashScreen {
  constructor() {
    this.splashElement = null;
    this.appElement = null;
    this.loadingText = null;
    this.isReady = false;
    this.minDisplayTime = 2000; // 最小显示时间 2 秒
    this.startTime = Date.now();
    this.latestStatus = null;
    this.backendConnected = false;

    this.statusSocket = null;
    this.statusReconnectTimer = null;
    this.shouldReconnect = true;
    this.reconnectDelay = 2000;
    this.baseApiUrl = 'http://localhost:8000';

    this.init();
  }

  /**
   * 初始化启动页面
   */
  init() {
    this.splashElement = document.getElementById('splash-screen');
    this.appElement = document.getElementById('app');
    this.loadingText = document.querySelector('.loading-text');

    if (!this.splashElement || !this.appElement) {
      console.error('启动页面元素未找到');
      return;
    }

    this.updateLoadingText('等待服务启动...');

    this.startBackendStatusStream();
    this.setupThemeListener();
  }

  /**
   * 开始监听后端状态
   */
  startBackendStatusStream() {
    this.shouldReconnect = true;
    this.connectStatusSocket();
  }

  /**
   * 连接后端状态 WebSocket
   */
  connectStatusSocket() {
    if (!this.shouldReconnect) {
      return;
    }

    this.clearReconnectTimer();

    if (this.statusSocket) {
      try {
        this.statusSocket.close();
      } catch (error) {
        console.warn('关闭旧的后端状态连接失败:', error);
      }
      this.statusSocket = null;
    }

    const websocketUrl = this.baseApiUrl.replace(/^http/, 'ws') + '/ws/status';

    try {
      this.statusSocket = new WebSocket(websocketUrl);
    } catch (error) {
      console.error('创建后端状态 WebSocket 失败:', error);
      this.scheduleReconnect();
      return;
    }

    this.statusSocket.addEventListener('open', () => {
      this.backendConnected = true;
      if (!this.isReady) {
        this.updateLoadingText('后端已连接，等待状态更新...');
      }
      console.log('后端状态 WebSocket 已连接');
    });

    this.statusSocket.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handleBackendStatus(payload);
      } catch (error) {
        console.error('解析后端状态数据失败:', error);
      }
    });

    this.statusSocket.addEventListener('close', () => {
      console.log('后端状态 WebSocket 已关闭');
      this.statusSocket = null;
      this.backendConnected = false;
      if (!this.isReady) {
        this.updateLoadingText('等待服务启动...');
        this.scheduleReconnect();
      }
    });

    this.statusSocket.addEventListener('error', (event) => {
      console.error('后端状态 WebSocket 发生错误:', event);
      if (this.statusSocket) {
        try {
          this.statusSocket.close();
        } catch (closeError) {
          console.warn('关闭出错的 WebSocket 失败:', closeError);
        }
        this.statusSocket = null;
      }
    });
  }

  /**
   * 处理后端推送的状态
   */
  handleBackendStatus(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    this.latestStatus = payload;
    document.dispatchEvent(new CustomEvent('backendStatus', { detail: payload }));

    if (payload.message) {
      this.updateLoadingText(payload.message);
    }

    if (payload.ready) {
      this.onBackendReady();
    }
  }

  /**
   * 后端准备就绪时的处理
   */
  onBackendReady() {
    if (this.isReady) {
      return;
    }

    this.isReady = true;
    this.updateLoadingText('系统初始化完成');

    const elapsedTime = Date.now() - this.startTime;
    const remainingTime = Math.max(0, this.minDisplayTime - elapsedTime);

    setTimeout(() => {
      this.hideSplashScreen();
    }, remainingTime);
  }

  /**
   * 隐藏启动页面，显示主应用
   */
  hideSplashScreen() {
    if (!this.splashElement || !this.appElement) {
      return;
    }

    this.splashElement.classList.add('fade-out');

    this.appElement.style.display = 'flex';
    this.appElement.style.opacity = '0';
    this.appElement.style.transform = 'translateY(20px)';
    this.appElement.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';

    setTimeout(() => {
      this.splashElement.style.display = 'none';

      requestAnimationFrame(() => {
        this.appElement.style.opacity = '1';
        this.appElement.style.transform = 'translateY(0)';
      });

      setTimeout(() => {
        this.appElement.style.transition = '';
        this.triggerAppReady();
      }, 600);
    }, 500);
  }

  /**
   * 更新加载文本
   */
  updateLoadingText(text) {
    if (this.loadingText) {
      this.loadingText.textContent = text;
    }
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.statusReconnectTimer || !this.shouldReconnect) {
      return;
    }

    this.statusReconnectTimer = setTimeout(() => {
      this.statusReconnectTimer = null;
      this.connectStatusSocket();
    }, this.reconnectDelay);
  }

  /**
   * 清除重连定时器
   */
  clearReconnectTimer() {
    if (this.statusReconnectTimer) {
      clearTimeout(this.statusReconnectTimer);
      this.statusReconnectTimer = null;
    }
  }

  /**
   * 设置主题监听器
   */
  setupThemeListener() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // 主题变化由 CSS 变量自动处理
        }
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  /**
   * 触发应用准备就绪事件
   */
  triggerAppReady() {
    const event = new CustomEvent('appReady', {
      detail: {
        timestamp: Date.now(),
        loadTime: Date.now() - this.startTime
      }
    });

    document.dispatchEvent(event);
    console.log('应用启动完成，加载时间:', Date.now() - this.startTime, 'ms');
  }

  /**
   * 手动隐藏启动页面（用于调试）
   */
  forceHide() {
    this.onBackendReady();
  }

  /**
   * 获取启动状态
   */
  getStatus() {
    return {
      isReady: this.isReady,
      elapsedTime: Date.now() - this.startTime,
      isVisible: this.splashElement && this.splashElement.style.display !== 'none',
      latestStatus: this.latestStatus
    };
  }

  /**
   * 销毁启动页面实例
   */
  destroy() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.statusSocket) {
      try {
        this.statusSocket.close();
      } catch (error) {
        console.warn('销毁启动页面时关闭 WebSocket 失败:', error);
      }
      this.statusSocket = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SplashScreen;
} else {
  window.SplashScreen = SplashScreen;
}
