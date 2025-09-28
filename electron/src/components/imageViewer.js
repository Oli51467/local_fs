class ImageViewer {
  constructor() {
    this.overlay = null;
    this.imageEl = null;
    this.captionEl = null;
    this.closeBtn = null;
    this._ensureStyles();
    this._createOverlay();
  }

  _ensureStyles() {
    if (document.getElementById('image-viewer-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'image-viewer-styles';
    style.textContent = `
      .image-viewer-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.72);
        backdrop-filter: blur(6px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        padding: 32px;
        box-sizing: border-box;
      }
      .image-viewer-overlay.active {
        display: flex;
      }
      .image-viewer-dialog {
        position: relative;
        background: rgba(12, 18, 28, 0.95);
        border-radius: 14px;
        padding: 18px 18px 24px;
        max-width: min(90vw, 960px);
        max-height: min(90vh, 640px);
        box-shadow: 0 28px 60px rgba(0, 0, 0, 0.45);
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .image-viewer-image {
        max-width: calc(90vw - 120px);
        max-height: calc(90vh - 160px);
        border-radius: 10px;
        object-fit: contain;
        background: #0f172a;
      }
      .image-viewer-caption {
        color: rgba(226, 232, 240, 0.85);
        font-size: 13px;
        word-break: break-word;
      }
      .image-viewer-close {
        position: absolute;
        top: 10px;
        right: 10px;
        border: none;
        background: rgba(15, 23, 42, 0.65);
        color: rgba(226, 232, 240, 0.9);
        border-radius: 999px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
      }
      .image-viewer-close:hover {
        background: rgba(37, 99, 235, 0.8);
      }
    `;
    document.head.appendChild(style);
  }

  _createOverlay() {
    if (this.overlay) {
      return;
    }
    this.overlay = document.createElement('div');
    this.overlay.className = 'image-viewer-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'image-viewer-dialog';

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'image-viewer-close';
    this.closeBtn.setAttribute('aria-label', '关闭图片预览');
    this.closeBtn.textContent = '×';
    this.closeBtn.addEventListener('click', () => this.hide());

    this.imageEl = document.createElement('img');
    this.imageEl.className = 'image-viewer-image';
    this.imageEl.alt = '';

    this.captionEl = document.createElement('div');
    this.captionEl.className = 'image-viewer-caption';

    dialog.appendChild(this.closeBtn);
    dialog.appendChild(this.imageEl);
    dialog.appendChild(this.captionEl);
    this.overlay.appendChild(dialog);
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });

    document.body.appendChild(this.overlay);

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.overlay.classList.contains('active')) {
        this.hide();
      }
    });
  }

  show(src, title = '') {
    if (!this.overlay || !this.imageEl) {
      return;
    }
    if (!src) {
      return;
    }
    this.imageEl.src = src;
    this.imageEl.alt = title || '';
    if (this.captionEl) {
      this.captionEl.textContent = title || src;
    }
    this.overlay.classList.add('active');
  }

  hide() {
    if (!this.overlay) {
      return;
    }
    this.overlay.classList.remove('active');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageViewer;
} else {
  window.ImageViewer = ImageViewer;
}
