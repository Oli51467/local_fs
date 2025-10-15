/**
 * 代码查看器组件 - 基于 Ace Editor
 * 支持多种编程语言的语法高亮和代码编辑
 */

class CodeViewer {
  constructor(contentContainer, tabManager) {
    this.editor = null;
    this.currentFilePath = null;
    this.isReadOnly = false;
    this.contentContainer = contentContainer; // 接收传入的contentContainer
    this.tabManager = tabManager; // 接收传入的tabManager
    this.supportedExtensions = new Set([
      'js', 'jsx', 'ts', 'tsx', 'json', 'py', 'java', 'cpp', 'c', 'h', 'hpp',
      'css', 'scss', 'sass', 'less', 'html', 'xml', 'php', 'rb', 'go', 'rs',
      'sh', 'bash', 'sql', 'md', 'yaml', 'yml', 'toml', 'ini', 'conf'
    ]);
    
    // 监听主题变化
    this.setupThemeListener();
  }

  /**
   * 初始化代码查看器
   */
  async init() {
    try {
      console.log('开始初始化代码查看器...');
      
      // 加载Ace Editor
      await this.loadAceEditor();
      console.log('Ace Editor加载完成');
      
      // 简化初始化流程
      console.log('代码查看器初始化完成');
      return true;
    } catch (error) {
      console.error('代码查看器初始化失败:', error);
      throw new Error('代码编辑器初始化失败');
    }
  }

  /**
   * 加载Ace Editor
   */
  async loadAceEditor() {
    if (window.ace) {
      console.log('Ace Editor已经加载');
      return;
    }

    const possiblePaths = [
      'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/ace.min.js',
      '../../static/libs/ace/ace.js',
      './node_modules/ace-builds/src-noconflict/ace.js',
      '../node_modules/ace-builds/src-noconflict/ace.js'
    ];

    for (const path of possiblePaths) {
      try {
        console.log(`尝试从路径加载Ace Editor: ${path}`);
        
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = path;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });

        if (window.ace) {
          console.log(`Ace Editor加载成功: ${path}`);
          
          // 配置Ace Editor路径（采用ace_test.html的方式）
          const basePath = path.replace('/ace.js', '').replace('/ace.min.js', '');
          if (basePath.startsWith('http')) {
            const cdnBase = 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6';
            window.ace.config.set('basePath', cdnBase);
            window.ace.config.set('modePath', cdnBase);
            window.ace.config.set('themePath', cdnBase);
            window.ace.config.set('workerPath', cdnBase);
            console.log('使用CDN路径配置');
          } else {
            const normalizedPath = basePath.endsWith('/') ? basePath : basePath + '/';
            window.ace.config.set('basePath', normalizedPath);
            window.ace.config.set('modePath', normalizedPath);
            window.ace.config.set('themePath', normalizedPath);
            window.ace.config.set('workerPath', normalizedPath);
            console.log('使用本地路径配置');
          }

          window.ace.config.set('loadWorkerFromBlob', false);

          console.log('配置完成: ' + JSON.stringify({
            basePath: window.ace.config.get('basePath'),
            modePath: window.ace.config.get('modePath'),
            themePath: window.ace.config.get('themePath'),
            workerPath: window.ace.config.get('workerPath')
          }));

          return;
        }
      } catch (error) {
        console.warn(`从 ${path} 加载失败:`, error);
        continue;
      }
    }

    throw new Error('所有Ace Editor加载路径都失败了');
  }

  /**
   * 加载语言工具扩展
   */
  async loadLanguageTools() {
    try {
      if (window.ace && window.ace.require) {
        try {
          window.ace.require("ace/ext/language_tools");
          console.log('Language tools已存在');
          return;
        } catch (e) {
          // 需要加载
        }
      }

      const languageToolsPaths = [
        'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/ext-language_tools.min.js',
        './static/libs/ace/ext-language_tools.js',
        './node_modules/ace-builds/src-noconflict/ext-language_tools.js',
        '../node_modules/ace-builds/src-noconflict/ext-language_tools.js'
      ];

      for (const path of languageToolsPaths) {
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
          console.log(`Language tools加载成功: ${path}`);
          return;
        } catch (error) {
          console.warn(`Language tools加载失败: ${path}`);
          continue;
        }
      }
      
      console.warn('所有Language tools路径都失败了');
    } catch (error) {
      console.warn('加载Language tools时出错:', error);
    }
  }

  /**
   * 加载语言模式
   */
  async loadLanguageModes() {
    const coreModes = ['javascript', 'json', 'python'];
    const commonModes = [
      'typescript', 'java', 'c_cpp', 'html', 'css', 'xml', 
      'markdown', 'yaml', 'sql', 'php', 'ruby', 'golang', 
      'rust', 'sh', 'batchfile', 'powershell'
    ];
    
    const basePath = window.ace.config.get('basePath') || window.ace.config.get('modePath');
    console.log(`开始加载语言模式，基础路径: ${basePath}`);
    
    const loadMode = async (mode) => {
      try {
        if (window.ace && window.ace.require) {
          try {
            window.ace.require(`ace/mode/${mode}`);
            console.log(`模式已存在: ${mode}`);
            return true;
          } catch (e) {
            // 模式不存在，需要加载
          }
        }
        
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `${basePath}mode-${mode}.js`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        
        console.log(`语言模式加载成功: ${mode}`);
        return true;
      } catch (error) {
        console.warn(`语言模式加载失败: ${mode}`, error);
        return false;
      }
    };
    
    // 先加载核心模式
    for (const mode of coreModes) {
      await loadMode(mode);
    }
    
    // 并行加载其他常用模式
    const loadPromises = commonModes.map(mode => loadMode(mode));
    await Promise.allSettled(loadPromises);
    console.log('所有语言模式加载完成');
  }

  /**
   * 加载常用主题
   */
  async loadCommonThemes() {
    const commonThemes = [
      'one_dark', 'dracula', 'monokai', 'github', 'tomorrow_night_blue',
      'twilight', 'chrome', 'textmate', 'nord_dark', 'gruvbox'
    ];
    
    const basePath = window.ace.config.get('basePath') || window.ace.config.get('themePath');
    console.log(`开始加载主题，基础路径: ${basePath}`);
    
    const loadTheme = async (theme) => {
      try {
        if (window.ace && window.ace.require) {
          try {
            window.ace.require(`ace/theme/${theme}`);
            console.log(`主题已存在: ${theme}`);
            return true;
          } catch (e) {
            // 主题不存在，需要加载
          }
        }
        
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = `${basePath}theme-${theme}.js`;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        
        console.log(`主题加载成功: ${theme}`);
        return true;
      } catch (error) {
        console.warn(`主题加载失败: ${theme}`, error);
        return false;
      }
    };
    
    // 并行加载所有主题
    const loadPromises = commonThemes.map(theme => loadTheme(theme));
    await Promise.allSettled(loadPromises);
    console.log('所有主题加载完成');
  }

  /**
   * 创建编辑器容器
   */
  createContainer() {
    const container = document.createElement('div');
    container.className = 'code-viewer-container code-content'; // 添加code-content类
    container.innerHTML = `
      <div class="code-editor" id="code-editor"></div>
    `;
    return container;
  }

  /**
   * 渲染代码文件
   */
  async render(filePath, content) {
    const container = this.createContainer();
    
    // 初始化编辑器
    if (!window.ace) {
      const initSuccess = await this.init();
      if (!initSuccess) {
        container.innerHTML = '<div class="error">代码编辑器初始化失败</div>';
        return container;
      }
    }

    // 创建编辑器实例
    setTimeout(async () => {
      this.editor = window.ace.edit('code-editor');
      await this.setupEditor(filePath, content);
      this.bindEvents(container);
    }, 100);

    this.currentFilePath = filePath;
    return container;
  }

  /**
   * 打开代码文件 - 供FileViewer调用的接口
   */
  async openCodeFile(filePath, tabId, fileName) {
    try {
      // 检查是否支持该文件类型
      if (!this.isSupported(filePath)) {
        throw new Error(`不支持的文件类型: ${filePath}`);
      }

      // 读取文件内容
      const content = await window.fsAPI.readFile(filePath);
      
      // 初始化编辑器（如果还未初始化）
      if (!window.ace) {
        const initSuccess = await this.init();
        if (!initSuccess) {
          throw new Error('代码编辑器初始化失败');
        }
      }
      
      // 创建代码查看器容器
      const container = this.createContainer();
      
      // 将容器添加到标签页内容区域
      // FileViewer创建的内容容器使用file-content类和data-tab-id属性
      const tabContent = document.querySelector(`[data-tab-id="${tabId}"].file-content`);
      if (tabContent) {
        tabContent.innerHTML = '';
        tabContent.appendChild(container);
      } else {
        console.error('找不到标签页内容容器:', tabId);
      }
      
      // 设置当前标签页ID（移除重复设置）
      // this.currentTabId = tabId; // 已移动到setTimeout内部
      
      // 延迟创建编辑器实例，确保DOM已渲染
      setTimeout(async () => {
        try {
          const editorElement = container.querySelector('#code-editor');
          if (editorElement) {
            this.editor = window.ace.edit(editorElement);
            this.currentFilePath = filePath;
            // 确保在setupEditor之前设置currentTabId，这样bindEditorEvents就能正确访问它
            this.currentTabId = tabId;
            await this.setupEditor(filePath, content);
            this.addThemeSelector(tabId);
            this.addConfigButton(tabId);
            this.bindEvents(container);
          }
        } catch (error) {
          console.error('创建编辑器实例失败:', error);
        }
      }, 100);
      
      return {
        displayMode: 'code',
        isEditable: true
      };
    } catch (error) {
      console.error('打开代码文件失败:', error);
      throw error;
    }
  }

  /**
   * 设置编辑器
   */
  async setupEditor(filePath, content) {
    if (!this.editor) {
      console.error('编辑器未初始化');
      return;
    }

    try {
      // 获取文件扩展名并设置语言模式
      const ext = this.getFileExtension(filePath);
      const mode = this.getAceMode(ext);
      
      console.log(`设置编辑器模式: ${mode} (文件: ${filePath})`);
      
      // 根据当前应用主题设置编辑器主题
      const currentTheme = this.getCurrentTheme();
      this.editor.setTheme(`ace/theme/${currentTheme}`);
      this.editor.session.setMode(`ace/mode/${mode}`);
      this.editor.setValue(content || '', -1);
      
      // 设置编辑器选项（删除右侧分割线）
      this.editor.setOptions({
        fontSize: 14,
        showLineNumbers: true,
        highlightActiveLine: true,
        highlightSelectedWord: true,
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        enableSnippets: true,
        showPrintMargin: false  // 删除右侧分割线
      });

      // 强制启用语法高亮相关设置（关键配置）
      this.editor.session.setUseWorker(true);
      this.editor.session.setUseWrapMode(false);
      
      // 绑定编辑器事件
      this.bindEditorEvents();
      
      // 更新文件信息
      this.updateFileInfo(filePath, content);
      
      console.log('编辑器设置完成');
      
    } catch (error) {
      console.error('设置编辑器失败:', error);
    }
  }

  /**
   * 设置编辑器语言模式（带重试机制）
   */
  setEditorMode(mode) {
    if (!this.editor || !mode) return;
    
    try {
      // 直接设置语言模式，类似于用户提供的setLanguageByFileName函数
      this.editor.session.setMode(`ace/mode/${mode}`);
      
      // 强制启用语法高亮
      this.editor.session.setUseWorker(true);
      this.editor.setHighlightActiveLine(true);
      this.editor.setHighlightSelectedWord(true);
      
      // 简单验证模式是否设置成功
      setTimeout(() => {
        const currentMode = this.editor.session.getMode().$id;
        if (currentMode.includes(mode)) {
          console.log(`语言模式设置成功: ${mode}`);
          // 强制刷新语法高亮
          this.editor.session.bgTokenizer.start(0);
          this.editor.renderer.updateFull();
        } else {
          console.warn(`语言模式设置失败，尝试重新加载: ${mode}`);
          this.loadMissingMode(mode);
        }
      }, 100);
    } catch (error) {
      console.error(`设置语言模式失败: ${mode}`, error);
    }
  }

  /**
   * 加载缺失的语言模式
   */
  async loadMissingMode(mode) {
    try {
      const basePath = window.ace.config.get('basePath') || window.ace.config.get('modePath');
      const script = document.createElement('script');
      script.src = `${basePath}mode-${mode}.js`;
      
      script.onload = () => {
        console.log(`缺失的语言模式加载成功: ${mode}`);
        // 重新设置模式
        if (this.editor) {
          this.editor.session.setMode(`ace/mode/${mode}`);
        }
      };
      
      script.onerror = () => {
        console.warn(`缺失的语言模式加载失败: ${mode}`);
      };
      
      document.head.appendChild(script);
    } catch (error) {
      console.error(`加载缺失语言模式时出错: ${mode}`, error);
    }
  }

  // 绑定编辑器事件
  bindEditorEvents() {
    if (!this.editor) {
      console.warn('bindEditorEvents: 编辑器未初始化');
      return;
    }

    // 监听编辑器内容变化，标记标签页为已修改
    this.editor.on('change', () => {
      if (this.currentTabId && this.tabManager && typeof this.tabManager.markTabAsDirty === 'function') {
        this.tabManager.markTabAsDirty(this.currentTabId);
      } else {
        console.warn('无法标记标签页为已修改 - tabManager或currentTabId不可用', {
          currentTabId: this.currentTabId,
          hasTabManager: !!this.tabManager,
          hasMarkTabAsDirty: this.tabManager && typeof this.tabManager.markTabAsDirty === 'function'
        });
      }
    });

    // 绑定Ctrl+S保存快捷键
    this.editor.commands.addCommand({
      name: 'save',
      bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
      exec: () => {
        this.saveFile();
        return true; // 阻止事件继续传播
      }
    });
  }

  // 切换主题
  switchTheme(themeName) {
    if (this.editor) {
      this.editor.setTheme(`ace/theme/${themeName}`);
      // 保存主题设置到本地存储
      localStorage.setItem('ace-editor-theme', themeName);
    }
  }

  // 获取当前主题
  getCurrentTheme() {
    // 检查应用是否处于深色模式
    const isDarkMode = document.body.classList.contains('dark-mode');
    
    // 根据应用主题自动选择编辑器主题
    // 深色模式使用 monokai，浅色模式使用 textmate
    return isDarkMode ? 'monokai' : 'textmate';
  }

  // 设置编辑器配置
  setEditorOptions(options) {
    if (this.editor) {
      this.editor.setOptions(options);
      // 保存配置到本地存储
      localStorage.setItem('ace-editor-options', JSON.stringify(options));
    }
  }

  // 获取编辑器配置
  getEditorOptions() {
    const defaultOptions = {
      fontSize: 14,
      tabSize: 2,
      useSoftTabs: true,
      showPrintMargin: false,
      wrap: true,
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
      enableSnippets: true
    };
    
    const savedOptions = localStorage.getItem('ace-editor-options');
    return savedOptions ? { ...defaultOptions, ...JSON.parse(savedOptions) } : defaultOptions;
  }

  // 获取文件扩展名对应的Ace Editor模式
  getAceMode(fileExt) {
    const modeMap = {
      // 核心语言优先映射 - 确保最常用的文件类型有准确的映射
      'py': 'python',
      'json': 'json',
      'js': 'javascript',
      
      // JavaScript 系列
      'jsx': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      
      // TypeScript 系列
      'ts': 'typescript',
      'tsx': 'typescript',
      
      // Web 前端
      'html': 'html',
      'htm': 'html',
      'xhtml': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'vue': 'html',
      'svelte': 'html',
      
      // 数据格式
      'jsonc': 'json',
      'json5': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'cfg': 'ini',
      'conf': 'ini',
      
      // Python 系列
      'pyw': 'python',
      'pyi': 'python',
      'ipynb': 'json', // Jupyter notebooks
      
      // Java 系列
      'java': 'java',
      'class': 'java',
      'jar': 'java',
      'kt': 'kotlin',
      'kts': 'kotlin',
      'scala': 'scala',
      'groovy': 'groovy',
      
      // C/C++ 系列
      'c': 'c_cpp',
      'cpp': 'c_cpp',
      'cxx': 'c_cpp',
      'cc': 'c_cpp',
      'h': 'c_cpp',
      'hpp': 'c_cpp',
      'hxx': 'c_cpp',
      'hh': 'c_cpp',
      
      // C# 系列
      'cs': 'csharp',
      'csx': 'csharp',
      
      // 其他编程语言
      'php': 'php',
      'rb': 'ruby',
      'go': 'golang',
      'rs': 'rust',
      'swift': 'swift',
      'dart': 'dart',
      'lua': 'lua',
      'perl': 'perl',
      'pl': 'perl',
      'r': 'r',
      
      // Shell 脚本
      'sh': 'sh',
      'bash': 'sh',
      'zsh': 'sh',
      'fish': 'sh',
      'bat': 'batchfile',
      'cmd': 'batchfile',
      'ps1': 'powershell',
      'psm1': 'powershell',
      
      // 数据库
      'sql': 'sql',
      'mysql': 'mysql',
      'pgsql': 'pgsql',
      'sqlite': 'sql',
      
      // 标记语言
      'md': 'markdown',
      'markdown': 'markdown',
      'mdown': 'markdown',
      'mkd': 'markdown',
      'tex': 'latex',
      'latex': 'latex',
      
      // 配置文件
      'dockerfile': 'dockerfile',
      'dockerignore': 'gitignore',
      'gitignore': 'gitignore',
      'gitattributes': 'gitignore',
      'editorconfig': 'ini',
      'env': 'sh',
      
      // 其他
      'txt': 'text',
      'log': 'text',
      'csv': 'text',
      'tsv': 'text'
    };
    
    // 如果没有扩展名，尝试根据文件名判断
    if (!fileExt) {
      return 'text';
    }
    
    const mode = modeMap[fileExt.toLowerCase()];
    if (mode) {
      return mode;
    }
    
    return 'text';
  }

  /**
   * 根据文件内容智能检测语言类型
   */
  detectLanguageFromContent(content, filePath) {
    if (!content || content.trim().length === 0) {
      return this.getAceMode(this.getFileExtension(filePath));
    }
    
    const firstLine = content.split('\n')[0].trim();
    
    // 检查 shebang
    if (firstLine.startsWith('#!')) {
      if (firstLine.includes('python')) return 'python';
      if (firstLine.includes('node') || firstLine.includes('nodejs')) return 'javascript';
      if (firstLine.includes('bash') || firstLine.includes('sh')) return 'sh';
      if (firstLine.includes('ruby')) return 'ruby';
      if (firstLine.includes('perl')) return 'perl';
      if (firstLine.includes('php')) return 'php';
    }
    
    // 检查 XML 声明
    if (firstLine.startsWith('<?xml')) return 'xml';
    
    // 检查 HTML DOCTYPE
    if (firstLine.toLowerCase().includes('<!doctype html')) return 'html';
    
    // 检查 JSON 格式
    if ((content.trim().startsWith('{') && content.trim().endsWith('}')) ||
        (content.trim().startsWith('[') && content.trim().endsWith(']'))) {
      try {
        JSON.parse(content);
        return 'json';
      } catch (e) {
        // 不是有效的 JSON
      }
    }
    
    // 回退到扩展名检测
    return this.getAceMode(this.getFileExtension(filePath));
  }

  /**
   * 获取文件扩展名
   */
  getFileExtension(filePath) {
    if (!filePath) return '';
    
    const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
    
    // 处理特殊文件名
    const specialFiles = {
      'dockerfile': 'dockerfile',
      '.gitignore': 'gitignore',
      '.gitattributes': 'gitignore',
      '.dockerignore': 'gitignore',
      '.editorconfig': 'editorconfig',
      '.env': 'env',
      'makefile': 'makefile',
      'rakefile': 'ruby',
      'gemfile': 'ruby'
    };
    
    const lowerFileName = fileName.toLowerCase();
    if (specialFiles[lowerFileName]) {
      return specialFiles[lowerFileName];
    }
    
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex === -1) return '';
    
    return fileName.substring(lastDotIndex + 1);
  }

  // 添加主题选择器
  addThemeSelector(tabId) {
    // 检查contentContainer是否存在
    if (!this.contentContainer) {
      console.warn('contentContainer未初始化，跳过添加主题选择器');
      return;
    }
    
    const header = this.contentContainer.querySelector(`[data-tab-id="${tabId}"] .code-viewer-header`);
    if (!header) {
      console.warn('未找到代码查看器头部，跳过添加主题选择器');
      return;
    }

    const themeSelector = document.createElement('select');
    themeSelector.className = 'theme-selector';
    themeSelector.innerHTML = `
      <optgroup label="暗色主题">
        <option value="one_dark">One Dark (VSCode风格)</option>
        <option value="dracula">Dracula</option>
        <option value="monokai">Monokai</option>
        <option value="twilight">Twilight</option>
        <option value="tomorrow_night">Tomorrow Night</option>
        <option value="tomorrow_night_blue">Tomorrow Night Blue</option>
        <option value="solarized_dark">Solarized Dark</option>
      </optgroup>
      <optgroup label="亮色主题">
        <option value="github">GitHub</option>
        <option value="chrome">Chrome</option>
        <option value="tomorrow">Tomorrow</option>
        <option value="solarized_light">Solarized Light</option>
      </optgroup>
    `;
    
    themeSelector.value = this.getCurrentTheme();
    themeSelector.addEventListener('change', (e) => {
      this.switchTheme(e.target.value);
    });

    header.appendChild(themeSelector);
  }

  // 添加配置按钮
  addConfigButton(tabId) {
    // 检查contentContainer是否存在
    if (!this.contentContainer) {
      console.warn('contentContainer未初始化，跳过添加配置按钮');
      return;
    }
    
    const header = this.contentContainer.querySelector(`[data-tab-id="${tabId}"] .code-viewer-header`);
    if (!header) {
      console.warn('未找到代码查看器头部，跳过添加配置按钮');
      return;
    }

    const configButton = document.createElement('button');
    configButton.className = 'config-button';
    configButton.innerHTML = '⚙️';
    configButton.title = '编辑器设置';
    
    configButton.addEventListener('click', () => {
      this.showConfigDialog();
    });

    header.appendChild(configButton);
  }

  // 显示配置对话框
  showConfigDialog() {
    const currentOptions = this.getEditorOptions();
    
    const dialog = document.createElement('div');
    dialog.className = 'config-dialog';
    dialog.innerHTML = `
      <div class="config-dialog-content">
        <h3>编辑器设置</h3>
        <div class="config-item">
          <label>字体大小:</label>
          <input type="number" id="fontSize" value="${currentOptions.fontSize}" min="8" max="24">
        </div>
        <div class="config-item">
          <label>Tab大小:</label>
          <input type="number" id="tabSize" value="${currentOptions.tabSize}" min="1" max="8">
        </div>
        <div class="config-item">
          <label>
            <input type="checkbox" id="useSoftTabs" ${currentOptions.useSoftTabs ? 'checked' : ''}>
            使用软Tab
          </label>
        </div>
        <div class="config-item">
          <label>
            <input type="checkbox" id="wrap" ${currentOptions.wrap ? 'checked' : ''}>
            自动换行
          </label>
        </div>
        <div class="config-buttons">
          <button id="saveConfig">保存</button>
          <button id="cancelConfig">取消</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    // 绑定事件
    dialog.querySelector('#saveConfig').addEventListener('click', () => {
      const newOptions = {
        ...currentOptions,
        fontSize: parseInt(dialog.querySelector('#fontSize').value),
        tabSize: parseInt(dialog.querySelector('#tabSize').value),
        useSoftTabs: dialog.querySelector('#useSoftTabs').checked,
        wrap: dialog.querySelector('#wrap').checked
      };
      
      this.setEditorOptions(newOptions);
      document.body.removeChild(dialog);
    });

    dialog.querySelector('#cancelConfig').addEventListener('click', () => {
      document.body.removeChild(dialog);
    });

    // 点击外部关闭
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        document.body.removeChild(dialog);
      }
    });
  }

  /**
   * 更新文件信息
   */
  updateFileInfo(filePath, content) {
    const fileName = filePath.split('/').pop();
    const fileSize = this.formatFileSize(new Blob([content]).size);
    const ext = filePath.split('.').pop().toLowerCase();
    const languageName = this.getLanguageName(ext);

    const container = document.querySelector('.code-viewer-container');
    if (container) {
      container.querySelector('.file-name').textContent = fileName;
      container.querySelector('.file-size').textContent = fileSize;
      container.querySelector('.language-mode').textContent = languageName;
    }
  }

  /**
   * 获取语言名称
   */
  getLanguageName(ext) {
    const nameMap = {
      'js': 'JavaScript',
      'jsx': 'React JSX',
      'ts': 'TypeScript',
      'tsx': 'React TSX',
      'json': 'JSON',
      'py': 'Python',
      'java': 'Java',
      'cpp': 'C++',
      'c': 'C',
      'h': 'C Header',
      'hpp': 'C++ Header',
      'css': 'CSS',
      'scss': 'SCSS',
      'sass': 'Sass',
      'less': 'Less',
      'html': 'HTML',
      'xml': 'XML',
      'php': 'PHP',
      'rb': 'Ruby',
      'go': 'Go',
      'rs': 'Rust',
      'sh': 'Shell',
      'bash': 'Bash',
      'sql': 'SQL',
      'md': 'Markdown',
      'yaml': 'YAML',
      'yml': 'YAML',
      'toml': 'TOML',
      'ini': 'INI',
      'conf': 'Config'
    };

    return nameMap[ext] || 'Text';
  }

  /**
   * 格式化文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 绑定事件
   */
  bindEvents(container) {
    // 由于已移除顶部按钮，这里不再需要绑定按钮事件
    // 所有必要的事件绑定已在bindEditorEvents方法中处理
    console.log('代码编辑器事件绑定完成');
  }

  /**
   * 保存文件
   */
  async saveFile() {
    if (!this.editor || !this.currentFilePath) {
      console.warn('无法保存文件：编辑器或文件路径不存在');
      return;
    }

    try {
      const content = this.editor.getValue();
      
      const result = await window.fsAPI.saveFile({ 
        filePath: this.currentFilePath, 
        content: content 
      });
      
      if (result.success) {
        this.showNotification(`文件已保存`, 'success');
        
        // 标记标签页为已保存（清除*号）
        if (this.currentTabId && this.tabManager && typeof this.tabManager.markTabAsClean === 'function') {
          this.tabManager.markTabAsClean(this.currentTabId);
        }
      } else if (result.canceled) {
        this.showNotification('保存操作已取消', 'info');
      } else {
        this.showNotification('保存失败: ' + result.error, 'error');
        console.error('保存失败:', result.error);
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      this.showNotification('保存文件失败', 'error');
    }
  }

  /**
   * 另存为文件
   */
  async saveAsFile() {
    if (!this.editor) return;

    try {
      const content = this.editor.getValue();
      const result = await window.fsAPI.saveFile({ 
        filePath: null, // 不提供路径，触发另存为对话框
        content: content 
      });
      
      if (result.success && result.filePath) {
        // 更新当前文件路径
        this.currentFilePath = result.filePath;
        
        // 显示保存成功提示
        this.showNotification(`文件已另存为: ${result.filePath}`, 'success');
        
        // 标记标签页为已保存（清除*号）
        if (this.currentTabId && this.tabManager) {
          if (typeof this.tabManager.markTabAsClean === 'function') {
            this.tabManager.markTabAsClean(this.currentTabId);
          }
          // 更新标签页标题
          const fileName = result.filePath.split('/').pop() || result.filePath.split('\\').pop();
          if (typeof this.tabManager.updateTabTitle === 'function') {
            this.tabManager.updateTabTitle(this.currentTabId, fileName);
          }
        }
      } else if (result.canceled) {
        // 用户取消了另存为操作
        this.showNotification('另存为操作已取消', 'info');
      } else {
        this.showNotification('另存为失败: ' + result.error, 'error');
      }
    } catch (error) {
      console.error('另存为失败:', error);
      this.showNotification('另存为失败', 'error');
    }
  }

  /**
   * 显示通知
   */
  showNotification(message, type = 'info') {
    // 这里可以集成现有的通知系统
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  /**
   * 检查是否支持的代码文件
   */
  isSupported(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();
    return this.supportedExtensions.has(ext);
  }

  /**
   * 设置主题监听器
   */
  setupThemeListener() {
    // 监听应用主题变化
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          // 当body的class发生变化时，检查是否是主题变化
          if (this.editor) {
            const newTheme = this.getCurrentTheme();
            this.editor.setTheme(`ace/theme/${newTheme}`);
          }
        }
      });
    });
    
    // 观察body元素的class变化
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
    
    this.themeObserver = observer;
  }

  /**
   * 销毁编辑器
   */
  destroy() {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
    
    // 清理主题监听器
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    
    this.currentFilePath = null;
  }

  /**
   * 加载Web Worker支持
   */
  async loadWorkerSupport() {
    if (!window.ace) {
      console.warn('Ace Editor未加载，无法加载Worker支持');
      return;
    }

    // 不再预加载所有Worker，改为按需加载
    console.log('Worker支持已启用，将按需加载');
  }

  /**
   * 为特定语言模式加载对应的Worker
   */
  async loadWorkerForMode(mode) {
    if (!window.ace || !mode) return;

    const workerMap = {
      'python': 'python',
      'javascript': 'javascript',
      'json': 'json',
      'html': 'html',
      'css': 'css',
      'xml': 'xml',
      'yaml': 'yaml',
      'php': 'php',
      'java': 'java',
      'c_cpp': 'c_cpp',
      'typescript': 'javascript', // TypeScript使用JavaScript Worker
      'jsx': 'javascript',
      'tsx': 'javascript'
    };

    const workerName = workerMap[mode];
    if (!workerName) return;

    try {
      // 检查Worker是否已经存在
      const workerModuleName = `ace/mode/${workerName}_worker`;
      if (window.ace.require && window.ace.require.modules[workerModuleName]) {
        console.log(`Worker ${workerName} 已存在，跳过加载`);
        return;
      }

      // 尝试通过Ace的配置设置Worker路径
      if (window.ace.config) {
        const basePath = this.basePath || this.modePath || '/node_modules/ace-builds/src-noconflict/';
        window.ace.config.setModuleUrl(workerModuleName, `${basePath}worker-${workerName}.js`);
        console.log(`为模式 ${mode} 设置Worker路径: ${basePath}worker-${workerName}.js`);
      } else {
        console.warn(`Ace配置不可用，无法为模式 ${mode} 设置Worker`);
      }
    } catch (error) {
      console.warn(`为模式 ${mode} 配置Worker时出错:`, error);
    }
  }
}

// 不再创建全局实例，由FileViewer负责创建
// window.codeViewer = new CodeViewer();