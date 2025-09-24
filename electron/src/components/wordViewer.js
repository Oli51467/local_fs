/**
 * WordViewer - 独立的Word文件查看器模块
 * 从FileViewer中解耦出来，专门处理Word文件的查看和编辑功能
 */
class WordViewer {
  constructor() {
    this.tabStates = new Map();
    this.autoSaveTimers = new Map();
    this.addStyles();
  }

  /**
   * 添加Word查看器相关样式
   */
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .word-viewer {
        width: 100%;
        height: 100%;
        overflow: auto;
        padding: 0;
        margin: 0;
        background: var(--bg-color);
        color: var(--text-color);
        font-family: 'Times New Roman', serif;
        line-height: 1.6;
      }
      
      /* 确保docx内容适配深色模式 */
      .word-viewer * {
        background-color: transparent !important;
        color: var(--text-color) !important;
      }
      
      .word-viewer p, .word-viewer div, .word-viewer span {
        color: var(--text-color) !important;
      }
      
      .word-viewer h1, .word-viewer h2, .word-viewer h3, .word-viewer h4, .word-viewer h5, .word-viewer h6 {
        color: var(--text-color) !important;
      }
      
      .word-viewer table {
        border-collapse: collapse;
        border: 1px solid var(--tree-border) !important;
      }
      
      .word-viewer th, .word-viewer td {
        border: 1px solid var(--tree-border) !important;
        padding: 8px 12px;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
      }
      
      /* Word查看器滚动条样式 */
      .word-viewer::-webkit-scrollbar {
        width: 2px;
      }
      
      .word-viewer::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .word-viewer::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .word-viewer::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }
      
      /* Docx编辑器样式 */
      .docx-content {
        padding: 0 !important;
        height: 100% !important;
        width: 100% !important;
        overflow: hidden;
        background: var(--bg-color) !important;
        margin: 0 !important;
        position: relative;
        box-sizing: border-box;
      }

      .docx-preview-full {
        height: 100% !important;
        width: 100% !important;
        overflow: auto;
        background: var(--bg-color) !important;
        margin: 0 !important;
        padding: 0 !important;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        box-sizing: border-box;
      }

      .docx-preview {
        height: 100% !important;
        width: 100% !important;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--bg-color) !important;
        color: var(--text-color) !important;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box;
        word-wrap: break-word;
        max-width: 100%;
      }
      
      /* DOCX预览器滚动条样式 */
      .docx-preview::-webkit-scrollbar,
      .docx-preview-full::-webkit-scrollbar {
        width: 2px;
      }
      
      .docx-preview::-webkit-scrollbar-track,
      .docx-preview-full::-webkit-scrollbar-track {
        background: var(--tree-bg, #2d2d30);
      }
      
      .docx-preview::-webkit-scrollbar-thumb,
      .docx-preview-full::-webkit-scrollbar-thumb {
        background: var(--tree-border, #464647);
        border-radius: 3px;
      }
      
      .docx-preview::-webkit-scrollbar-thumb:hover,
      .docx-preview-full::-webkit-scrollbar-thumb:hover {
        background: var(--accent-color, #007acc);
      }

      /* 强制docx内容占满整个区域 */
      .docx-preview .docx-wrapper,
      .docx-preview-content .docx-wrapper,
      .docx-preview > div,
      .docx-preview-content > div {
        width: 100% !important;
        height: auto !important;
        min-height: 100% !important;
        margin: 0 !important;
        padding: 10px !important;
        background: var(--bg-color) !important;
        box-sizing: border-box !important;
      }

      /* 移除所有可能的灰色背景，适配深色模式 */
      .docx-preview *,
      .docx-preview-content *,
      .docx-content * {
        background-color: var(--bg-color) !important;
        color: var(--text-color) !important;
        max-width: 100% !important;
      }

      /* 确保文档页面样式 */
      .docx-preview section,
      .docx-preview-content section {
        width: 100% !important;
        margin: 0 !important;
        padding: 10px !important;
        background: var(--bg-color) !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 加载Word文件
   * @param {string} filePath - 文件路径
   * @returns {Object} 包含内容、缓冲区和可编辑状态的对象
   */
  async loadWordFile(filePath) {
    try {
      // 读取文件为ArrayBuffer
      const fileBuffer = await window.fsAPI.readFileBuffer(filePath);
      
      // 检查文件是否为空或无效
      if (!fileBuffer || fileBuffer.byteLength === 0) {
        return {
          content: `<div style="padding: 20px; color: #f39c12;">
            <h3>空的Word文档</h3>
            <p>这是一个新创建的.docx文件</p>
            <p>文件路径: ${filePath}</p>
            <div style="margin-top: 15px;">
              <button onclick="wordViewer.createBasicDocx('${filePath}')" 
                      style="background: #3498db; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                创建基本Word文档
              </button>
              <p style="margin-top: 10px; font-size: 12px; color: #7f8c8d;">
                点击上方按钮创建一个包含基本内容的Word文档
              </p>
            </div>
          </div>`,
          rawBuffer: fileBuffer,
          isEditable: false
        };
      }
      
      // 检查docx-preview是否可用
      console.log('检查docx对象:', typeof window.docx, window.docx);
      console.log('检查JSZip对象:', typeof window.JSZip, window.JSZip);
      if (window.JSZip && typeof window.JSZip.loadAsync === 'function') {
        console.log('JSZip.loadAsync方法可用');
      } else {
        console.error('JSZip.loadAsync方法不可用:', window.JSZip);
      }
      if (typeof window.docx !== 'undefined' && window.docx.renderAsync) {
        // 创建一个临时容器来渲染Word文档
        const tempContainer = document.createElement('div');
        tempContainer.style.padding = '20px';
        tempContainer.style.backgroundColor = 'var(--bg-color)';
        tempContainer.style.color = 'var(--text-color)';
        tempContainer.style.fontFamily = 'Times New Roman, serif';
        tempContainer.style.lineHeight = '1.6';
        tempContainer.style.maxWidth = '100%';
        tempContainer.style.wordWrap = 'break-word';
        
        try {
          // 确保fileBuffer是Uint8Array格式
          const uint8Array = new Uint8Array(fileBuffer);
          
          // 检查是否为有效的zip文件（docx文件本质上是zip格式）
          if (uint8Array.length < 4 || 
              !(uint8Array[0] === 0x50 && uint8Array[1] === 0x4B && 
                (uint8Array[2] === 0x03 || uint8Array[2] === 0x05 || uint8Array[2] === 0x07))) {
            throw new Error('文件不是有效的DOCX格式（缺少ZIP文件头）');
          }
          
          // 使用docx-preview渲染
          await window.docx.renderAsync(uint8Array, tempContainer, null, {
            className: 'docx-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: false,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            useMathMLPolyfill: false,
            showChanges: false,
            debug: false
          });
          
          return {
            content: tempContainer.outerHTML,
            rawBuffer: uint8Array,
            isEditable: true
          };
        } catch (renderError) {
          console.error('docx渲染失败:', renderError);
          
          // 检查是否是zip相关错误
          const isZipError = renderError.message.includes('Corrupted zip') || 
                           renderError.message.includes('End of data reached') ||
                           renderError.message.includes('ZIP文件头');
          
          const errorContent = isZipError ? 
            `<div style="padding: 20px; color: #e74c3c;">
              <h3>Word文档格式错误</h3>
              <p>错误信息: ${renderError.message}</p>
              <p>文件路径: ${filePath}</p>
              <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; color: #856404;">
                <p><strong>可能的原因：</strong></p>
                <ul>
                  <li>这是一个新创建的空文件，还没有有效的Word文档内容</li>
                  <li>文件在传输过程中损坏</li>
                  <li>文件不是标准的.docx格式</li>
                </ul>
                <p><strong>解决方案：</strong></p>
                <ul>
                  <li>使用Microsoft Word或其他Word编辑器打开并保存该文件</li>
                  <li>导入一个现有的有效.docx文件</li>
                  <li>删除此文件并重新创建</li>
                </ul>
              </div>
            </div>` :
            `<div style="padding: 20px; color: #e74c3c;">
              <h3>Word文档渲染失败</h3>
              <p>错误信息: ${renderError.message}</p>
              <p>文件路径: ${filePath}</p>
              <p>请确保这是一个有效的.docx文件</p>
            </div>`;
          
          return {
            content: errorContent,
            rawBuffer: null,
            isEditable: false
          };
        }
      } else {
        return {
          content: `<div style="padding: 20px; color: #f39c12;">
            <h3>Word文件查看功能不可用</h3>
            <p>docx-preview库未正确加载</p>
            <p>文件路径: ${filePath}</p>
            <p>请检查库文件是否正确引入</p>
          </div>`,
          rawBuffer: null,
          isEditable: false
        };
      }
    } catch (error) {
      console.error('加载Word文件失败:', error);
      return {
        content: `<div style="padding: 20px; color: #e74c3c;">
          <h3>加载Word文件失败</h3>
          <p>错误信息: ${error.message}</p>
          <p>文件路径: ${filePath}</p>
        </div>`,
        rawBuffer: null,
        isEditable: false
      };
    }
  }

  /**
   * 创建Word查看器
   * @param {string} tabId - 标签页ID
   * @param {string} content - Word文档内容
   * @param {Element} contentElement - 内容容器元素
   */
  createWordViewer(tabId, content, contentElement) {
    if (!contentElement) return;

    // 为DOCX文件添加特殊类名
    contentElement.classList.add('docx-content');

    // 清空容器并移除padding和margin
    contentElement.innerHTML = '';
    contentElement.style.padding = '0';
    contentElement.style.margin = '0';

    const viewer = document.createElement('div');
    viewer.className = 'word-viewer';
    viewer.innerHTML = content;

    contentElement.appendChild(viewer);
  }

  /**
   * 创建Docx编辑器
   * @param {string} tabId - 标签页ID
   * @param {Object} wordData - Word文档数据
   * @param {string} filePath - 文件路径
   * @param {Element} contentElement - 内容容器元素
   */
  createDocxEditor(tabId, wordData, filePath, contentElement) {
    if (!contentElement) return;

    // 为Docx内容添加特殊类名
    contentElement.classList.add('docx-content');

    // 创建简化的预览布局
    contentElement.innerHTML = `
      <div class="docx-preview-full" id="docx-preview-full-${tabId}">
        <div class="docx-preview" id="docx-preview-${tabId}"></div>
      </div>
    `;

    // 获取预览元素
    const preview = document.getElementById(`docx-preview-${tabId}`);

    // 存储数据到tabStates
    this.tabStates.set(tabId, {
      filePath: filePath,
      wordData: wordData,
      isDirty: false,
      isEditMode: false,
      preview: preview,
      originalContent: ''
    });

    // 初始渲染预览
    if (wordData && wordData.content) {
      preview.innerHTML = wordData.content;
    }
  }

  /**
   * 从docx预览中提取文本内容
   * @param {Element} previewElement - 预览元素
   * @returns {string} 提取的文本内容
   */
  extractTextFromDocx(previewElement) {
    const textContent = previewElement.textContent || previewElement.innerText || '';
    return textContent.trim();
  }

  /**
   * 保存Docx文件
   * @param {string} tabId - 标签页ID
   */
  async saveDocxFile(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (!tabState || !tabState.textEditor || !tabState.filePath) return;

    try {
      const textContent = tabState.textEditor.value;
      
      // 注意：这里是简化的保存方式，只保存文本内容
      // 实际的docx文件保存需要更复杂的处理来保持格式
      // 这里我们创建一个简单的文本文件作为备份
      const backupPath = tabState.filePath.replace('.docx', '_backup.txt');
      await window.fsAPI.writeFile(backupPath, textContent);
      
      // 更新状态
      tabState.originalContent = textContent;
      tabState.isDirty = false;
      
      // 禁用保存按钮
      const saveBtn = document.getElementById(`docx-save-btn-${tabId}`);
      if (saveBtn) {
        saveBtn.disabled = true;
      }
      
      // 显示保存成功提示
      const status = document.getElementById(`docx-status-${tabId}`);
      if (status) {
        const originalText = status.textContent;
        status.textContent = '已保存';
        status.style.color = '#28a745';
        setTimeout(() => {
          status.textContent = originalText;
          status.style.color = '';
        }, 2000);
      }
      
      console.log('Docx文件内容已保存为文本备份:', backupPath);
      showAlert(`文档内容已保存为文本备份：${backupPath}\n\n注意：由于docx格式的复杂性，当前版本只能保存文本内容。`, 'info');
    } catch (error) {
      console.error('保存Word文档失败:', error);
      showAlert('保存文件失败: ' + error.message, 'error');
    }
  }

  /**
   * 标记标签页为脏状态
   * @param {string} tabId - 标签页ID
   */
  markTabAsDirty(tabId) {
    const tabState = this.tabStates.get(tabId);
    if (tabState) {
      tabState.isDirty = true;
    }
  }

  /**
   * 重置自动保存定时器
   * @param {string} tabId - 标签页ID
   */
  resetAutoSaveTimer(tabId) {
    // 清除现有定时器
    if (this.autoSaveTimers.has(tabId)) {
      clearTimeout(this.autoSaveTimers.get(tabId));
    }

    // 设置新的定时器（5分钟后自动保存）
    const timer = setTimeout(() => {
      this.saveDocxFile(tabId);
    }, 5 * 60 * 1000);

    this.autoSaveTimers.set(tabId, timer);
  }

  /**
   * 清理标签页状态
   * @param {string} tabId - 标签页ID
   */
  cleanupTab(tabId) {
    // 清理自动保存定时器
    if (this.autoSaveTimers.has(tabId)) {
      clearTimeout(this.autoSaveTimers.get(tabId));
      this.autoSaveTimers.delete(tabId);
    }

    // 清理标签页状态
    this.tabStates.delete(tabId);
  }

  /**
   * 创建基本的Word文档
   * @param {string} filePath - 文件路径
   */
  async createBasicDocx(filePath) {
    try {
      // 通过IPC调用主进程创建docx文档
      if (window.electronAPI && window.electronAPI.createFile) {
        const result = await window.electronAPI.createFile({
          filePath: filePath,
          fileName: path.basename(filePath),
          parentPath: path.dirname(filePath)
        });
        
        if (result.success) {
          // 重新加载文件
          window.location.reload();
        } else {
          console.error('创建基本Word文档失败:', result.error);
          alert('创建基本Word文档失败: ' + result.error);
        }
      } else {
        // 如果API不可用，回退到文本方式
        const basicContent = '';
        
        if (window.electronAPI && window.electronAPI.writeFile) {
          const result = await window.electronAPI.writeFile(filePath, basicContent);
          if (result.success) {
            // 重新加载文件
            window.location.reload();
          } else {
            console.error('创建基本Word文档失败:', result.error);
            showAlert('创建基本Word文档失败: ' + result.error, 'error');
          }
        } else {
          console.error('文件系统API不可用');
          showAlert('文件系统API不可用，无法创建文档', 'warning');
        }
      }
    } catch (error) {
      console.error('创建基本Word文档时出错:', error);
      showAlert('创建基本Word文档时出错: ' + error.message, 'error');
    }
  }

  /**
   * 获取标签页状态
   * @param {string} tabId - 标签页ID
   * @returns {Object|null} 标签页状态对象
   */
  getTabState(tabId) {
    return this.tabStates.get(tabId) || null;
  }

  /**
   * 检查标签页是否为脏状态
   * @param {string} tabId - 标签页ID
   * @returns {boolean} 是否为脏状态
   */
  isTabDirty(tabId) {
    const tabState = this.tabStates.get(tabId);
    return tabState ? tabState.isDirty : false;
  }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WordViewer;
} else {
  window.WordViewer = WordViewer;
}