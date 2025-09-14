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
    this.checkInterval = null;
    this.minDisplayTime = 2000; // 最小显示时间2秒
    this.startTime = Date.now();
    
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

    // 开始检查后端状态
    this.startBackendCheck();
    
    // 监听深色模式切换
    this.setupThemeListener();
  }

  /**
   * 开始检查后端准备状态
   */
  startBackendCheck() {
    this.updateLoadingText('正在启动服务...');
    
    // 立即检查一次
    this.checkBackendStatus();
    
    // 设置定期检查 - 降低轮询频率减少服务器负载
    this.checkInterval = setInterval(() => {
      this.checkBackendStatus();
    }, 2000);
  }

  /**
   * 检查后端状态
   */
  async checkBackendStatus() {
    try {
      const response = await fetch('http://localhost:8000/api/health/ready', {
        method: 'GET',
        timeout: 1000
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.ready) {
          this.onBackendReady();
        } else {
          this.updateLoadingText(data.message || '正在初始化系统...');
        }
      }
    } catch (error) {
      // 后端还未启动，继续等待
      console.log('等待后端启动...', error.message);
    }
  }

  /**
   * 后端准备就绪时的处理
   */
  onBackendReady() {
    if (this.isReady) return;
    
    this.isReady = true;
    this.updateLoadingText('系统初始化完成');
    
    // 清除检查定时器
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // 确保最小显示时间
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
    if (!this.splashElement || !this.appElement) return;
    
    // 添加淡出动画
    this.splashElement.classList.add('fade-out');
    
    // 预先设置主应用样式为淡入准备状态
    this.appElement.style.display = 'flex';
    this.appElement.style.opacity = '0';
    this.appElement.style.transform = 'translateY(20px)';
    this.appElement.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    
    // 启动页面淡出完成后开始主应用淡入
    setTimeout(() => {
      this.splashElement.style.display = 'none';
      
      // 触发主应用淡入动画
      requestAnimationFrame(() => {
        this.appElement.style.opacity = '1';
        this.appElement.style.transform = 'translateY(0)';
      });
      
      // 动画完成后清理样式并触发应用初始化事件
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
   * 设置主题监听器
   */
  setupThemeListener() {
    // 监听深色模式切换
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // 主题已切换，无需特殊处理，CSS变量会自动应用
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
    // 派发自定义事件，通知其他模块应用已准备就绪
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
      isVisible: this.splashElement && this.splashElement.style.display !== 'none'
    };
  }

  /**
   * 销毁启动页面实例
   */
  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

// 导出启动页面类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SplashScreen;
} else {
  window.SplashScreen = SplashScreen;
}