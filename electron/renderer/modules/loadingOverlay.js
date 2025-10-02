(function initLoadingOverlayModule(global) {
  const modules = global.RendererModules = global.RendererModules || {};

  let globalLoadingOverlay = null;
  let globalLoadingSpinner = null;
  let globalLoadingProgress = null;
  let globalLoadingProgressFill = null;
  let globalLoadingStage = null;
  let loadingProgressTimer = null;
  let loadingProgressState = null;

  function resetProgressVisual() {
    if (globalLoadingProgress) {
      globalLoadingProgress.classList.remove('indeterminate');
    }
    if (globalLoadingProgressFill) {
      globalLoadingProgressFill.classList.remove('indeterminate');
      globalLoadingProgressFill.style.transition = 'width 0.2s ease';
    }
  }

  function ensureLoadingOverlayStyles() {
    if (document.getElementById('global-loading-overlay-style')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'global-loading-overlay-style';
    style.textContent = `
      .global-loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.35);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2500;
      }
      .global-loading-dialog {
        background: var(--bg-color, #ffffff);
        color: var(--text-color, #1e293b);
        padding: 22px 28px;
        border-radius: 16px;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25);
        border: 1px solid rgba(148, 163, 184, 0.22);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        min-width: 240px;
      }
      .global-loading-spinner {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 3px solid rgba(37, 99, 235, 0.15);
        border-top-color: rgba(37, 99, 235, 0.85);
        animation: global-loading-spin 0.8s linear infinite;
      }
      .global-loading-progress {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.3);
        overflow: hidden;
        display: none;
      }
      .global-loading-progress-bar {
        width: 0%;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(37, 99, 235, 0.95), rgba(59, 130, 246, 0.95));
        transition: width 0.2s ease;
      }
      .global-loading-progress.indeterminate {
        display: block;
      }
      .global-loading-progress-bar.indeterminate {
        width: 100%;
        background: linear-gradient(90deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.55), rgba(59, 130, 246, 0.2));
        background-size: 200% 100%;
        animation: global-loading-indeterminate 1.4s ease-in-out infinite;
      }
      .global-loading-message {
        font-size: 14px;
        color: var(--text-muted, rgba(75, 85, 99, 0.85));
        letter-spacing: 0.01em;
      }
      .global-loading-stage {
        font-size: 12px;
        color: rgba(100, 116, 139, 0.95);
        letter-spacing: 0.01em;
        display: none;
      }
      @keyframes global-loading-spin {
        to { transform: rotate(360deg); }
      }
      @keyframes global-loading-indeterminate {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function showLoadingOverlay(message = '处理中，请稍候…') {
    ensureLoadingOverlayStyles();
    if (!globalLoadingOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'global-loading-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'global-loading-dialog';

      const spinner = document.createElement('div');
      spinner.className = 'global-loading-spinner';

      const text = document.createElement('div');
      text.className = 'global-loading-message';
      text.textContent = message;

      const progress = document.createElement('div');
      progress.className = 'global-loading-progress';
      progress.style.display = 'none';

      const progressBar = document.createElement('div');
      progressBar.className = 'global-loading-progress-bar';
      progress.appendChild(progressBar);

      const stage = document.createElement('div');
      stage.className = 'global-loading-stage';

      dialog.appendChild(spinner);
      dialog.appendChild(progress);
      dialog.appendChild(text);
      dialog.appendChild(stage);

      overlay.appendChild(dialog);

      globalLoadingOverlay = overlay;
      globalLoadingSpinner = spinner;
      globalLoadingProgress = progress;
      globalLoadingProgressFill = progressBar;
      globalLoadingStage = stage;
    } else {
      const text = globalLoadingOverlay.querySelector('.global-loading-message');
      if (text) {
        text.textContent = message;
      }
    }

    if (globalLoadingSpinner) {
      globalLoadingSpinner.style.display = 'block';
    }
    if (globalLoadingProgress) {
      globalLoadingProgress.style.display = 'none';
      resetProgressVisual();
    }
    if (globalLoadingProgressFill) {
      globalLoadingProgressFill.style.width = '0%';
    }
    if (globalLoadingStage) {
      globalLoadingStage.style.display = 'none';
      globalLoadingStage.textContent = '';
    }

    if (!document.body.contains(globalLoadingOverlay)) {
      document.body.appendChild(globalLoadingOverlay);
    }
  }

  function hideLoadingOverlay() {
    stopLoadingOverlayProgressLoop();
    if (globalLoadingOverlay && globalLoadingOverlay.parentNode) {
      globalLoadingOverlay.parentNode.removeChild(globalLoadingOverlay);
    }
    if (globalLoadingSpinner) {
      globalLoadingSpinner.style.display = 'block';
    }
    if (globalLoadingProgress) {
      globalLoadingProgress.style.display = 'none';
      resetProgressVisual();
    }
    if (globalLoadingProgressFill) {
      globalLoadingProgressFill.style.width = '0%';
    }
    if (globalLoadingStage) {
      globalLoadingStage.style.display = 'none';
      globalLoadingStage.textContent = '';
    }
  }

  function setLoadingOverlayProgress(progress = 0, options = {}) {
    ensureLoadingOverlayStyles();
    const {
      message,
      stage,
      spinner = false,
      showProgressBar = true
    } = options;

    if (!globalLoadingOverlay || !document.body.contains(globalLoadingOverlay)) {
      showLoadingOverlay(message || '处理中，请稍候…');
    }

    const clamped = Math.min(1, Math.max(0, progress));

    resetProgressVisual();

    if (typeof message === 'string') {
      const text = globalLoadingOverlay.querySelector('.global-loading-message');
      if (text) {
        text.textContent = message;
      }
    }

    if (globalLoadingSpinner) {
      globalLoadingSpinner.style.display = spinner ? 'block' : 'none';
    }
    if (globalLoadingProgress) {
      globalLoadingProgress.style.display = showProgressBar ? 'block' : 'none';
    }
    if (globalLoadingProgressFill) {
      globalLoadingProgressFill.style.width = `${(clamped * 100).toFixed(1)}%`;
    }

    if (globalLoadingStage) {
      const percentLabel = `${Math.round(clamped * 100)}%`;
      if (stage) {
        globalLoadingStage.textContent = `${stage} · ${percentLabel}`;
        globalLoadingStage.style.display = 'block';
      } else if (showProgressBar) {
        globalLoadingStage.textContent = percentLabel;
        globalLoadingStage.style.display = 'block';
      } else {
        globalLoadingStage.style.display = 'none';
        globalLoadingStage.textContent = '';
      }
    }
  }

  function setLoadingOverlayIndeterminate(options = {}) {
    const {
      message = '处理中，请稍候…',
      stage
    } = options;

    ensureLoadingOverlayStyles();
    showLoadingOverlay(message);

    if (globalLoadingSpinner) {
      globalLoadingSpinner.style.display = 'none';
    }
    if (globalLoadingProgress) {
      globalLoadingProgress.style.display = 'block';
      globalLoadingProgress.classList.add('indeterminate');
    }
    if (globalLoadingProgressFill) {
      globalLoadingProgressFill.style.width = '100%';
      globalLoadingProgressFill.classList.add('indeterminate');
    }

    if (globalLoadingStage) {
      if (stage) {
        globalLoadingStage.textContent = stage;
        globalLoadingStage.style.display = 'block';
      } else {
        globalLoadingStage.style.display = 'none';
        globalLoadingStage.textContent = '';
      }
    }

    const text = globalLoadingOverlay && globalLoadingOverlay.querySelector('.global-loading-message');
    if (text) {
      text.textContent = message;
    }
  }

  function startLoadingOverlayProgressLoop(optionsOrMessage = '处理中，请稍候…', initialStage = '') {
    stopLoadingOverlayProgressLoop();

    const options = typeof optionsOrMessage === 'string'
      ? { message: optionsOrMessage, stage: initialStage }
      : { ...optionsOrMessage };

    const {
      message = '处理中，请稍候…',
      stage = '准备解析',
      sizeBytes = null
    } = options;

    const sizeMB = Math.max(0.5, sizeBytes ? sizeBytes / (1024 * 1024) : 0.5);
    const estimatedDuration = 2600 + Math.min(15000, Math.pow(sizeMB, 0.6) * 2200);
    const stagePlan = {
      '准备解析': { target: 0.28, duration: estimatedDuration * 0.25 },
      '解析中': { target: 0.75, duration: estimatedDuration * 0.5 },
      '整理结果中': { target: 0.95, duration: estimatedDuration * 0.25 },
      default: { target: 0.9, duration: estimatedDuration * 0.3 }
    };

    const initialTarget = stagePlan[stage]?.target ?? stagePlan.default.target;

    loadingProgressState = {
      message,
      stage,
      progress: 0.02,
      startProgress: 0.02,
      targetProgress: initialTarget,
      stageStart: performance.now(),
      stageDuration: stagePlan[stage]?.duration ?? stagePlan.default.duration,
      stagePlan,
      sizeBytes,
      timerResolution: 60
    };

    setLoadingOverlayProgress(loadingProgressState.progress, loadingProgressState);

    loadingProgressTimer = setInterval(() => {
      if (!loadingProgressState) {
        return;
      }

      const now = performance.now();
      const elapsed = now - loadingProgressState.stageStart;
      const duration = Math.max(400, loadingProgressState.stageDuration || 1000);
      const ratio = Math.min(1, elapsed / duration);

      const nextProgress = loadingProgressState.startProgress +
        (loadingProgressState.targetProgress - loadingProgressState.startProgress) * ratio;

      if (nextProgress > loadingProgressState.progress) {
        loadingProgressState.progress = nextProgress;
        setLoadingOverlayProgress(loadingProgressState.progress, loadingProgressState);
      }

      if (ratio >= 1 && loadingProgressState.progress < loadingProgressState.targetProgress) {
        loadingProgressState.progress = loadingProgressState.targetProgress;
        setLoadingOverlayProgress(loadingProgressState.progress, loadingProgressState);
      }
    }, loadingProgressState.timerResolution);
  }

  function updateLoadingOverlayProgressLoop({ message, stage } = {}) {
    if (!loadingProgressState) {
      return;
    }

    if (typeof message === 'string') {
      loadingProgressState.message = message;
    }

    if (typeof stage === 'string' && stage) {
      const stageInfo = loadingProgressState.stagePlan[stage] || loadingProgressState.stagePlan.default;
      loadingProgressState.stage = stage;
      loadingProgressState.startProgress = loadingProgressState.progress;
      loadingProgressState.targetProgress = Math.max(
        loadingProgressState.progress + 0.05,
        stageInfo.target
      );
      loadingProgressState.stageDuration = stageInfo.duration;
      loadingProgressState.stageStart = performance.now();
    }

    setLoadingOverlayProgress(loadingProgressState.progress, loadingProgressState);
  }

  function stopLoadingOverlayProgressLoop(finalState) {
    if (loadingProgressTimer) {
      clearInterval(loadingProgressTimer);
      loadingProgressTimer = null;
    }

    const output = {
      message: (finalState && finalState.message) || (loadingProgressState && loadingProgressState.message) || '处理中，请稍候…',
      stage: (finalState && finalState.stage) || (loadingProgressState && loadingProgressState.stage) || ''
    };
    const finalProgress = finalState && typeof finalState.progress === 'number' ? finalState.progress : 1;
    setLoadingOverlayProgress(finalProgress, output);

    loadingProgressState = null;
  }

  modules.loadingOverlay = {
    ensureLoadingOverlayStyles,
    showLoadingOverlay,
    hideLoadingOverlay,
    setLoadingOverlayProgress,
    setLoadingOverlayIndeterminate,
    startLoadingOverlayProgressLoop,
    updateLoadingOverlayProgressLoop,
    stopLoadingOverlayProgressLoop
  };
})(window);
