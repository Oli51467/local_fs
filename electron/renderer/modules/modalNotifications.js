(function initModalNotificationsModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  function resolveIsDarkMode() {
    const root = document.documentElement;
    const body = document.body;
    const themeAttr = root?.getAttribute('data-theme');
    if (themeAttr && themeAttr.toLowerCase().includes('dark')) {
      return true;
    }
    if (root?.classList?.contains('dark') || root?.classList?.contains('dark-mode')) {
      return true;
    }
    if (body?.classList?.contains('dark') || body?.classList?.contains('dark-mode')) {
      return true;
    }
    if (window.matchMedia) {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch (error) {
        console.warn('检测暗色模式失败:', error);
      }
    }
    return false;
  }

  function showModal(options) {
    const {
      type = 'info',
      title,
      message,
      confirmText = '确定',
      cancelText = '取消',
      showCancel = false,
      onConfirm = null,
      onCancel = null
    } = options || {};

    const isDarkMode = resolveIsDarkMode();
    const surfaceColors = {
      background: isDarkMode ? '#000000' : '#ffffff',
      text: isDarkMode ? '#e2e8f0' : '#0f172a',
      textMuted: isDarkMode ? 'rgba(226, 232, 240, 0.75)' : 'rgba(71, 85, 105, 0.85)',
      border: isDarkMode ? 'rgba(59, 130, 246, 0.45)' : 'rgba(59, 130, 246, 0.22)'
    };
    const baseBlue = {
      accent: '#3b82f6',
      accentStrong: '#2563eb',
      accentSoft: '#60a5fa',
      shadow: isDarkMode ? 'rgba(37, 99, 235, 0.5)' : 'rgba(59, 130, 246, 0.28)'
    };
    const deepBlue = {
      accent: '#1e40af',
      accentStrong: '#1d4ed8',
      accentSoft: '#3b82f6',
      shadow: isDarkMode ? 'rgba(29, 78, 216, 0.45)' : 'rgba(30, 64, 175, 0.26)'
    };

    const palette = {
      success: {
        defaultTitle: '操作成功',
        ...baseBlue
      },
      error: {
        defaultTitle: '发生错误',
        ...deepBlue
      },
      warning: {
        defaultTitle: '温馨提示',
        ...baseBlue
      },
      info: {
        defaultTitle: '提示',
        ...baseBlue
      }
    };

    const config = palette[type] || palette.info;
    const titleText = title || config.defaultTitle;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'background: rgba(15, 23, 42, 0.35)',
      'backdrop-filter: blur(6px)',
      'z-index: 1600',
      'padding: 24px',
      'box-sizing: border-box'
    ].join(';');

    const modal = document.createElement('div');
    modal.className = 'modal-shell';
    modal.style.cssText = [
      `background: ${surfaceColors.background}`,
      `color: ${surfaceColors.text}`,
      'min-width: 320px',
      'max-width: 420px',
      'border-radius: 16px',
      'padding: 24px 26px 22px',
      'box-shadow: 0 22px 60px rgba(15, 23, 42, 0.25)',
      `border: 1px solid ${surfaceColors.border}`,
      'display: flex',
      'flex-direction: column',
      'gap: 16px',
      'position: relative'
    ].join(';');

    const accentBar = document.createElement('span');
    accentBar.style.cssText = [
      'display: inline-flex',
      'width: 46px',
      'height: 4px',
      'border-radius: 999px',
      `background: linear-gradient(135deg, ${config.accentSoft}, ${config.accent})`
    ].join(';');

    const titleElement = document.createElement('h3');
    titleElement.textContent = titleText;
    titleElement.style.cssText = [
      'margin: 0',
      'font-size: 18px',
      'font-weight: 600',
      'letter-spacing: 0.01em'
    ].join(';');

    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    messageElement.style.cssText = [
      'margin: 0',
      'line-height: 1.6',
      'font-size: 14px',
      `color: ${surfaceColors.textMuted}`,
      'white-space: pre-line'
    ].join(';');

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = [
      'display: flex',
      'justify-content: flex-end',
      'align-items: center',
      'gap: 12px',
      'margin-top: 8px'
    ].join(';');

    if (showCancel) {
      const cancelButton = document.createElement('button');
      cancelButton.textContent = cancelText;
      cancelButton.style.cssText = [
        'padding: 9px 18px',
        'border-radius: 999px',
        `border: 1px solid ${isDarkMode ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.26)'}`,
        `background: ${isDarkMode ? 'rgba(37, 99, 235, 0.18)' : 'rgba(59, 130, 246, 0.12)'}`,
        `color: ${surfaceColors.text}`,
        'font-size: 14px',
        'font-weight: 500',
        'cursor: pointer',
        'transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease'
      ].join(';');

      cancelButton.addEventListener('mouseenter', () => {
        cancelButton.style.boxShadow = '0 8px 16px rgba(37, 99, 235, 0.22)';
        cancelButton.style.transform = 'translateY(-1px)';
        cancelButton.style.background = isDarkMode ? 'rgba(37, 99, 235, 0.24)' : 'rgba(59, 130, 246, 0.18)';
      });

      cancelButton.addEventListener('mouseleave', () => {
        cancelButton.style.boxShadow = 'none';
        cancelButton.style.transform = 'none';
        cancelButton.style.background = isDarkMode ? 'rgba(37, 99, 235, 0.18)' : 'rgba(59, 130, 246, 0.12)';
      });

      cancelButton.addEventListener('click', () => {
        overlay.remove();
        if (onCancel) {
          onCancel();
        }
      });

      buttonContainer.appendChild(cancelButton);
    }

    const confirmButton = document.createElement('button');
    confirmButton.textContent = confirmText;
    const confirmBaseShadow = `0 12px 24px ${config.shadow}`;
    confirmButton.style.cssText = [
      'padding: 9px 20px',
      'border-radius: 999px',
      'border: none',
      `background: linear-gradient(135deg, ${config.accentSoft}, ${config.accentStrong})`,
      'color: #ffffff',
      'font-size: 14px',
      'font-weight: 600',
      'cursor: pointer',
      `box-shadow: ${confirmBaseShadow}`,
      'transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease'
    ].join(';');

    confirmButton.addEventListener('mouseenter', () => {
      confirmButton.style.boxShadow = `0 16px 30px ${config.shadow}`;
      confirmButton.style.transform = 'translateY(-1px)';
      confirmButton.style.filter = 'brightness(1.03)';
    });

    confirmButton.addEventListener('mouseleave', () => {
      confirmButton.style.boxShadow = confirmBaseShadow;
      confirmButton.style.transform = 'none';
      confirmButton.style.filter = 'none';
    });

    confirmButton.addEventListener('click', () => {
      overlay.remove();
      if (onConfirm) {
        onConfirm();
      }
    });

    buttonContainer.appendChild(confirmButton);

    modal.appendChild(accentBar);
    modal.appendChild(titleElement);
    if (message) {
      modal.appendChild(messageElement);
    }
    modal.appendChild(buttonContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    if (type === 'info' || type === 'success') {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
    }
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.remove();
    });
  }

  function showAlert(message, type = 'info') {
    showModal({ type, message });
  }

  function showSuccessModal(message) {
    showModal({ type: 'success', message });
  }

  modules.modalNotifications = {
    showModal,
    closeAllModals,
    showAlert,
    showSuccessModal
  };
})(window);
