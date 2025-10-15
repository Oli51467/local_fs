/**
 * 代码查看器组件 - 基于 Ace Editor
 * 支持多种编程语言的语法高亮和代码编辑
 */

class CodeViewer {
  constructor() {
    this.editor = null;
    this.currentFilePath = null;
    this.isReadOnly = false;
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
    return new Promise((resolve, reject) => {
      // 检查是否已经加载
      if (window.ace) {
        resolve();
        return;
      }

      // 尝试多个可能的路径
      const possiblePaths = [
        './node_modules/ace-builds/src-noconflict/ace.js',
        '../node_modules/ace-builds/src-noconflict/ace.js',
        './static/libs/ace/ace.js',
        'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/ace.min.js'
      ];

      let currentPathIndex = 0;

      const tryLoadScript = () => {
        if (currentPathIndex >= possiblePaths.length) {
          reject(new Error('无法从任何路径加载Ace Editor'));
          return;
        }

        const script = document.createElement('script');
        script.src = possiblePaths[currentPathIndex];
        
        script.onload = () => {
          // 设置Ace Editor的基础路径
          if (window.ace) {
            // 根据成功加载的路径设置基础路径
            const basePath = possiblePaths[currentPathIndex].replace('/ace.js', '').replace('/ace.min.js', '');
            if (basePath.startsWith('http')) {
              // CDN路径
              window.ace.config.set('basePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/');
              window.ace.config.set('modePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/');
              window.ace.config.set('themePath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/');
              window.ace.config.set('workerPath', 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/');
            } else {
              // 本地路径
              window.ace.config.set('basePath', basePath + '/');
              window.ace.config.set('modePath', basePath + '/');
              window.ace.config.set('themePath', basePath + '/');
              window.ace.config.set('workerPath', basePath + '/');
            }
            console.log(`Ace Editor从路径加载成功: ${possiblePaths[currentPathIndex]}`);
            
            // 加载language_tools扩展和语言模式
            this.loadLanguageTools().then(() => {
              return this.loadLanguageModes();
            }).then(() => {
              return this.loadCommonThemes();
            }).then(() => {
              return this.loadWorkerSupport();
            }).then(() => {
              resolve();
            }).catch((error) => {
              console.warn('Language tools或语言模式加载失败:', error);
              resolve(); // 即使加载失败，也继续
            });
          } else {
            resolve();
          }
        };
        
        script.onerror = () => {
          console.warn(`无法从路径加载Ace Editor: ${possiblePaths[currentPathIndex]}`);
          document.head.removeChild(script);
          currentPathIndex++;
          tryLoadScript();
        };
        
        document.head.appendChild(script);
      };

      tryLoadScript();
    });
  }

  /**
   * 加载语言工具扩展
   */
  async loadLanguageTools() {
    return new Promise((resolve, reject) => {
      // 检查是否已经加载
      if (window.ace && window.ace.require && window.ace.require("ace/ext/language_tools")) {
        resolve();
        return;
      }

      const languageToolsPaths = [
        './node_modules/ace-builds/src-noconflict/ext-language_tools.js',
        '../node_modules/ace-builds/src-noconflict/ext-language_tools.js',
        './static/libs/ace/ext-language_tools.js',
        'https://cdnjs.cloudflare.com/ajax/libs/ace/1.32.6/ext-language_tools.min.js'
      ];

      let currentPathIndex = 0;

      const tryLoadLanguageTools = () => {
        if (currentPathIndex >= languageToolsPaths.length) {
          reject(new Error('无法加载language_tools扩展'));
          return;
        }

        const script = document.createElement('script');
        script.src = languageToolsPaths[currentPathIndex];
        
        script.onload = () => {
          console.log(`Language tools加载成功: ${languageToolsPaths[currentPathIndex]}`);
          resolve();
        };
        
        script.onerror = () => {
          console.warn(`无法加载language tools: ${languageToolsPaths[currentPathIndex]}`);
          document.head.removeChild(script);
          currentPathIndex++;
          tryLoadLanguageTools();
        };
        
        document.head.appendChild(script);
      };

      tryLoadLanguageTools();
    });
  }

  /**
   * 加载语言模式
   */
  async loadLanguageModes() {
    // 预加载常用的语言模式以确保语法高亮正常工作
    const commonModes = [
      'javascript', 'typescript', 'python', 'java', 'c_cpp', 
      'html', 'css', 'json', 'xml', 'markdown', 'yaml', 'sql',
      'php', 'ruby', 'golang', 'rust', 'sh', 'batchfile', 'powershell'
    ];
    
    const basePath = window.ace.config.get('basePath') || window.ace.config.get('modePath');
    console.log(`开始加载语言模式，基础路径: ${basePath}`);
    
    const loadPromises = commonModes.map(mode => {
      return new Promise((resolve) => {
        try {
          // 检查模式是否已经加载
          if (window.ace && window.ace.define && window.ace.define.modules[`ace/mode/${mode}`]) {
            console.log(`语言模式已存在: ${mode}`);
            resolve();
            return;
          }
          
          // 动态加载语言模式
          const script = document.createElement('script');
          script.src = `${basePath}mode-${mode}.js`;
          
          script.onload = () => {
            console.log(`语言模式加载成功: ${mode}`);
            resolve();
          };
          
          script.onerror = () => {
            console.warn(`语言模式加载失败: ${mode}`);
            resolve(); // 即使失败也继续
          };
          
          document.head.appendChild(script);
        } catch (error) {
          console.warn(`加载语言模式时出错: ${mode}`, error);
          resolve();
        }
      });
    });
    
    await Promise.all(loadPromises);
    console.log('常用语言模式加载完成');
    
    // 加载主题文件
    await this.loadCommonThemes();
  }

  /**
   * 加载常用主题
   */
  async loadCommonThemes() {
    const commonThemes = [
      'one_dark', 'dracula', 'monokai', 'github', 'tomorrow_night_blue',
      'twilight', 'chrome', 'textmate', 'solarized_dark', 'solarized_light'
    ];
    
    const basePath = window.ace.config.get('basePath') || window.ace.config.get('themePath');
    console.log(`开始加载主题，基础路径: ${basePath}`);
    
    const loadPromises = commonThemes.map(theme => {
      return new Promise((resolve) => {
        try {
          // 检查主题是否已经加载
          if (window.ace && window.ace.define && window.ace.define.modules[`ace/theme/${theme}`]) {
            console.log(`主题已存在: ${theme}`);
            resolve();
            return;
          }
          
          const script = document.createElement('script');
          script.src = `${basePath}theme-${theme}.js`;
          
          script.onload = () => {
            console.log(`主题加载成功: ${theme}`);
            resolve();
          };
          
          script.onerror = () => {
            console.warn(`主题加载失败: ${theme}`);
            resolve(); // 即使失败也继续
          };
          
          document.head.appendChild(script);
        } catch (error) {
          console.warn(`加载主题时出错: ${theme}`, error);
          resolve();
        }
      });
    });
    
    await Promise.all(loadPromises);
    console.log('常用主题加载完成');
  }

  /**
   * 创建编辑器容器
   */
  createContainer() {
    const container = document.createElement('div');
    container.className = 'code-viewer-container';
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
    setTimeout(() => {
      this.editor = window.ace.edit('code-editor');
      this.setupEditor(filePath, content);
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
      
      // 设置当前标签页ID
      this.currentTabId = tabId;
      
      // 延迟创建编辑器实例，确保DOM已渲染
      setTimeout(() => {
        try {
          const editorElement = container.querySelector('#code-editor');
          if (editorElement) {
            this.editor = window.ace.edit(editorElement);
            this.currentFilePath = filePath;
            this.setupEditor(filePath, content);
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
  setupEditor(filePath, content) {
    if (!this.editor) {
      console.error('编辑器未初始化');
      return;
    }

    try {
      // 设置编辑器内容
      this.editor.setValue(content || '', -1);
      
      // 使用智能语言检测
      const detectedMode = this.detectLanguageFromContent(content, filePath);
      console.log(`智能检测语言模式: ${detectedMode} (文件: ${filePath})`);
      
      // 设置语言模式并加载对应的Worker
      this.setEditorMode(detectedMode);
      
      // 为当前模式加载Worker支持
      this.loadWorkerForMode(detectedMode);
      
      // 应用保存的主题和配置
      const theme = this.getCurrentTheme();
      this.editor.setTheme(`ace/theme/${theme}`);
      
      const options = this.getEditorOptions();
      
      // 设置编辑器属性
      this.editor.setReadOnly(this.isReadOnly); // 使用实例属性设置编辑模式
      this.editor.session.setUseWrapMode(options.wrap || false);
      this.editor.session.setTabSize(options.tabSize || 4);
      this.editor.session.setUseSoftTabs(options.useSoftTabs !== false);
      
      // 设置基本选项
      this.editor.setOptions({
        fontFamily: 'Fira Code, JetBrains Mono, Cascadia Code, Monaco, Menlo, Ubuntu Mono, monospace',
        fontSize: options.fontSize || 14,
        cursorStyle: 'smooth',
        showPrintMargin: false,
        highlightActiveLine: true,
        highlightSelectedWord: true,
        highlightGutterLine: true,
        showGutter: true,
        showLineNumbers: true,
        // 启用代码折叠功能
        foldStyle: 'markbegin',
        showFoldWidgets: true,
        // 启用自动补全功能
        enableBasicAutocompletion: true,
        enableLiveAutocompletion: true,
        enableSnippets: true,
        // 启用语法检查
        useWorker: true,
        // 改善用户体验
        scrollPastEnd: 0.5,
        animatedScroll: true,
        fadeFoldWidgets: true,
        showInvisibles: false,
        displayIndentGuides: true
      });
      
      // 启用语法检查和自动补全
      if (window.ace && window.ace.require) {
        try {
          const langTools = window.ace.require("ace/ext/language_tools");
          console.log('Language tools已启用');
        } catch (error) {
          console.warn('启用language tools失败:', error);
        }
      }
      
      // 绑定编辑器事件
      this.bindEditorEvents();
      
      // 强制刷新编辑器以确保语法高亮生效
      this.editor.renderer.updateFull();
      
      const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';
      console.log(`代码编辑器设置完成: ${fileName} (${detectedMode})`);
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
      // 强制设置语言模式
      this.editor.session.setMode(`ace/mode/${mode}`);
      
      // 等待一小段时间后再次确认模式设置
      setTimeout(() => {
        const currentMode = this.editor.session.getMode().$id;
        console.log(`当前编辑器模式: ${currentMode}`);
        
        // 如果模式设置失败，尝试重新设置
        if (!currentMode.includes(mode)) {
          console.warn(`模式设置可能失败，重新尝试设置: ${mode}`);
          this.editor.session.setMode(`ace/mode/${mode}`);
          
          // 再次验证
          setTimeout(() => {
            const finalMode = this.editor.session.getMode().$id;
            if (!finalMode.includes(mode)) {
              console.error(`语言模式设置最终失败: ${mode}，当前模式: ${finalMode}`);
              // 尝试加载缺失的模式文件
              this.loadMissingMode(mode);
            } else {
              console.log(`语言模式设置成功: ${mode}`);
            }
          }, 200);
        } else {
          console.log(`语言模式设置成功: ${mode}`);
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
    if (!this.editor) return;

    // 监听编辑器内容变化，标记标签页为已修改
    this.editor.on('change', () => {
      if (this.currentTabId && window.fileViewer && window.fileViewer.tabManager) {
        window.fileViewer.tabManager.markTabAsDirty(this.currentTabId);
      }
    });

    // 绑定Ctrl+S保存快捷键
    this.editor.commands.addCommand({
      name: 'save',
      bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
      exec: () => {
        this.saveFile();
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
    
    // 如果用户手动设置了主题，优先使用用户设置
    const userTheme = localStorage.getItem('ace-editor-theme');
    if (userTheme) {
      return userTheme;
    }
    
    // 根据应用主题自动选择编辑器主题，使用更专业的主题
    return isDarkMode ? 'one_dark' : 'github';
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
      // JavaScript 系列
      'js': 'javascript',
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
      'json': 'json',
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
      'py': 'python',
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
      console.log(`文件扩展名 ${fileExt} 映射到模式: ${mode}`);
      return mode;
    }
    
    console.log(`未知文件扩展名 ${fileExt}，使用默认文本模式`);
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
    const header = this.contentContainer.querySelector(`[data-tab-id="${tabId}"] .code-viewer-header`);
    if (!header) return;

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
    const header = this.contentContainer.querySelector(`[data-tab-id="${tabId}"] .code-viewer-header`);
    if (!header) return;

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
    if (!this.editor || !this.currentFilePath) return;

    try {
      const content = this.editor.getValue();
      const result = await window.fsAPI.writeFile(this.currentFilePath, content);
      
      if (result.success) {
        // 显示保存成功提示
        this.showNotification('文件保存成功', 'success');
        
        // 标记标签页为已保存（清除*号）
        if (this.currentTabId && window.fileViewer && window.fileViewer.tabManager) {
          window.fileViewer.tabManager.markTabAsClean(this.currentTabId);
        }
      } else {
        this.showNotification('文件保存失败: ' + result.error, 'error');
      }
    } catch (error) {
      console.error('保存文件失败:', error);
      this.showNotification('文件保存失败', 'error');
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

    const commonWorkers = [
      'python',
      'javascript', 
      'json',
      'html',
      'css',
      'xml',
      'yaml',
      'php',
      'java',
      'c_cpp',
      'typescript'
    ];

    const basePath = this.basePath || this.modePath || '/node_modules/ace-builds/src-noconflict/';
    
    for (const worker of commonWorkers) {
      try {
        // 检查Worker是否已经存在
        if (window.ace.require && window.ace.require.modules[`ace/mode/${worker}_worker`]) {
          continue;
        }

        const workerScript = document.createElement('script');
        workerScript.src = `${basePath}worker-${worker}.js`;
        workerScript.async = true;
        
        await new Promise((resolve, reject) => {
          workerScript.onload = () => {
            console.log(`Worker ${worker} 加载成功`);
            resolve();
          };
          workerScript.onerror = () => {
            console.warn(`Worker ${worker} 加载失败`);
            resolve(); // 不阻塞其他Worker的加载
          };
          document.head.appendChild(workerScript);
        });
      } catch (error) {
        console.warn(`加载Worker ${worker} 时出错:`, error);
      }
    }
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
      if (window.ace.require && window.ace.require.modules[`ace/mode/${workerName}_worker`]) {
        return;
      }

      const basePath = this.basePath || this.modePath || '/node_modules/ace-builds/src-noconflict/';
      const workerScript = document.createElement('script');
      workerScript.src = `${basePath}worker-${workerName}.js`;
      workerScript.async = true;
      
      await new Promise((resolve, reject) => {
        workerScript.onload = () => {
          console.log(`Worker ${workerName} 为模式 ${mode} 加载成功`);
          resolve();
        };
        workerScript.onerror = () => {
          console.warn(`Worker ${workerName} 为模式 ${mode} 加载失败`);
          resolve();
        };
        document.head.appendChild(workerScript);
      });
    } catch (error) {
      console.warn(`为模式 ${mode} 加载Worker时出错:`, error);
    }
  }
}

// 导出单例
window.codeViewer = new CodeViewer();