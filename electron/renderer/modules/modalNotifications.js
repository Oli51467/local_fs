(function initModalNotificationsModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

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

    const palette = {
      success: {
        defaultTitle: '操作成功',
        accent: '#22c55e',
        accentStrong: '#16a34a',
        accentSoft: '#bbf7d0',
        shadow: 'rgba(34, 197, 94, 0.25)'
      },
      error: {
        defaultTitle: '发生错误',
        accent: '#f87171',
        accentStrong: '#ef4444',
        accentSoft: '#fecaca',
        shadow: 'rgba(248, 113, 113, 0.25)'
      },
      warning: {
        defaultTitle: '温馨提示',
        accent: '#fbbf24',
        accentStrong: '#f59e0b',
        accentSoft: '#fde68a',
        shadow: 'rgba(251, 191, 36, 0.25)'
      },
      info: {
        defaultTitle: '提示',
        accent: '#60a5fa',
        accentStrong: '#3b82f6',
        accentSoft: '#bfdbfe',
        shadow: 'rgba(96, 165, 250, 0.25)'
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
      'background: var(--bg-color)',
      'color: var(--text-color)',
      'min-width: 320px',
      'max-width: 420px',
      'border-radius: 16px',
      'padding: 24px 26px 22px',
      'box-shadow: 0 22px 60px rgba(15, 23, 42, 0.25)',
      'border: 1px solid rgba(148, 163, 184, 0.18)',
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
      'color: var(--text-muted, rgba(75, 85, 99, 0.85))',
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
        'border: 1px solid rgba(148, 163, 184, 0.35)',
        'background: rgba(148, 163, 184, 0.12)',
        'color: var(--text-color)',
        'font-size: 14px',
        'font-weight: 500',
        'cursor: pointer',
        'transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease'
      ].join(';');

      cancelButton.addEventListener('mouseenter', () => {
        cancelButton.style.boxShadow = '0 8px 16px rgba(15, 23, 42, 0.18)';
        cancelButton.style.transform = 'translateY(-1px)';
        cancelButton.style.background = 'rgba(148, 163, 184, 0.18)';
      });

      cancelButton.addEventListener('mouseleave', () => {
        cancelButton.style.boxShadow = 'none';
        cancelButton.style.transform = 'none';
        cancelButton.style.background = 'rgba(148, 163, 184, 0.12)';
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

