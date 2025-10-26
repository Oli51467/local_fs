/**
 * ChatReferenceManager
 * 负责渲染、交互与导航聊天消息中的参考资料区块。
 */
(function initChatReferenceManager(global) {
  const ChatUtils = global.ChatUtils;

  class ChatReferenceManager {
    constructor(options = {}) {
      this.setStatus = typeof options.setStatus === 'function' ? options.setStatus : () => {};
      this.appendSystemError = typeof options.appendSystemError === 'function'
        ? options.appendSystemError
        : () => {};
      this.getStatusElement = typeof options.getStatusElement === 'function'
        ? options.getStatusElement
        : () => null;
      this.delayMs = typeof options.delayMs === 'number' ? options.delayMs : 150;
    }

    updateReferenceSection(wrapper, metadata) {
      if (!wrapper) {
        return;
      }
      const existingSection = wrapper.querySelector('.chat-reference-section');
      const references = this.extractReferences(metadata);
      if (!references.length) {
        if (existingSection && existingSection.parentElement) {
          existingSection.parentElement.removeChild(existingSection);
        }
        const existingSeparator = wrapper.querySelector('.chat-reference-separator');
        if (existingSeparator && existingSeparator.parentElement) {
          existingSeparator.parentElement.removeChild(existingSeparator);
        }
        return;
      }

      const section = this.renderReferenceSection(references, metadata);
      if (!section) {
        if (existingSection && existingSection.parentElement) {
          existingSection.parentElement.removeChild(existingSection);
        }
        const existingSeparator = wrapper.querySelector('.chat-reference-separator');
        if (existingSeparator && existingSeparator.parentElement) {
          existingSeparator.parentElement.removeChild(existingSeparator);
        }
        return;
      }

      let separator = wrapper.querySelector('.chat-reference-separator');
      if (!separator) {
        separator = global.document.createElement('div');
        separator.className = 'chat-reference-separator';
      }

      if (existingSection && existingSection.parentElement) {
        existingSection.replaceWith(section);
      } else {
        wrapper.appendChild(section);
      }

      if (separator.parentElement !== wrapper) {
        wrapper.insertBefore(separator, section);
      } else if (separator.nextElementSibling !== section) {
        wrapper.insertBefore(separator, section);
      }
    }

    extractReferences(metadata) {
      if (!metadata || typeof metadata !== 'object') {
        return [];
      }
      const raw = metadata.references;
      if (!Array.isArray(raw) || !raw.length) {
        return [];
      }
      const seen = new Set();
      const result = [];
      raw
        .filter((item) => item && typeof item === 'object')
        .filter((item) => (item.selected === undefined) || Boolean(item.selected))
        .forEach((reference) => {
          const key = this.getReferenceKey(reference);
          if (key) {
            if (!seen.has(key)) {
              seen.add(key);
              result.push(reference);
            }
          } else {
            result.push(reference);
          }
        });
      return result;
    }

    renderReferenceSection(references, metadata) {
      const summaryCard = this.createSummaryReferenceCard(metadata);
      const referenceList = Array.isArray(references) ? references : [];
      if (!summaryCard && !referenceList.length) {
        return null;
      }

      const section = global.document.createElement('div');
      section.className = 'chat-reference-section';

      const header = global.document.createElement('div');
      header.className = 'chat-reference-title';
      header.textContent = '参考资料';
      section.appendChild(header);

      const list = global.document.createElement('div');
      list.className = 'chat-reference-list';

      if (summaryCard) {
        list.appendChild(summaryCard);
      }

      referenceList.forEach((reference) => {
        const item = this.createReferenceItem(reference, metadata);
        if (item) {
          list.appendChild(item);
        }
      });

      if (!list.children.length) {
        return null;
      }

      section.appendChild(list);
      return section;
    }

    createSummaryReferenceCard(metadata) {
      if (!metadata || typeof metadata !== 'object') {
        return null;
      }
      const useSummarySearch = Boolean(metadata.use_summary_search);
      const retrievalContext = metadata.retrieval_context || {};
      if (!useSummarySearch || retrievalContext.mode !== 'summary' || !retrievalContext.summary_search_applied) {
        return null;
      }
      const rawMatches = Array.isArray(retrievalContext.summary_matches) ? retrievalContext.summary_matches : [];
      if (!rawMatches.length) {
        return null;
      }

      const seen = new Set();
      const matches = rawMatches.map((match, index) => {
        if (!match || typeof match !== 'object') {
          return null;
        }
        const summaryText = typeof match.summary_text === 'string'
          ? match.summary_text
          : (match.summary_preview || '');
        const key = this.getSummaryMatchKey(match, index);
        if (key && seen.has(key)) {
          return null;
        }
        if (key) {
          seen.add(key);
        }
        return {
          name: (match.filename || '').trim() || `文档-${match.rank || index + 1}`,
          summary: summaryText,
          score: Number.isFinite(match.score) ? Number(match.score) : null,
          vectorScore: Number.isFinite(match.vector_score) ? Number(match.vector_score) : null,
          lexicalScore: Number.isFinite(match.lexical_score) ? Number(match.lexical_score) : null,
          modelName: (match.summary_model_name || '').trim()
        };
      }).filter(Boolean);

      if (!matches.length) {
        return null;
      }

      const card = global.document.createElement('div');
      card.className = 'chat-reference-item is-summary';

      const header = global.document.createElement('div');
      header.className = 'chat-reference-summary-header';
      const title = global.document.createElement('span');
      title.className = 'chat-reference-summary-title';
      title.textContent = '参考文档主题';
      header.appendChild(title);

      const summaryMeta = global.document.createElement('span');
      summaryMeta.className = 'chat-reference-summary-meta';
      const thresholdValue = Number(retrievalContext.summary_threshold);
      const threshold = Number.isFinite(thresholdValue) ? thresholdValue.toFixed(2) : '0.70';
      summaryMeta.textContent = `命中 ${matches.length} 篇 · 阈值 ≥ ${threshold}`;
      header.appendChild(summaryMeta);

      card.appendChild(header);

      const list = global.document.createElement('div');
      list.className = 'chat-reference-summary-list';

      matches.forEach((match) => {
        const entry = global.document.createElement('div');
        entry.className = 'chat-reference-summary-item';

        const nameEl = global.document.createElement('div');
        nameEl.className = 'chat-reference-summary-name';
        nameEl.textContent = match.name;
        entry.appendChild(nameEl);

        const metaParts = [];
        if (Number.isFinite(match.score)) {
          metaParts.push(`综合 ${match.score.toFixed(2)}`);
        }
        if (Number.isFinite(match.vectorScore)) {
          metaParts.push(`语义 ${match.vectorScore.toFixed(2)}`);
        }
        if (Number.isFinite(match.lexicalScore)) {
          metaParts.push(`词法 ${match.lexicalScore.toFixed(2)}`);
        }
        if (match.modelName) {
          metaParts.push(`模型 ${match.modelName}`);
        }

        if (metaParts.length) {
          const metaLine = global.document.createElement('div');
          metaLine.className = 'chat-reference-summary-submeta';
          metaLine.textContent = metaParts.join(' · ');
          entry.appendChild(metaLine);
        }

        const textEl = global.document.createElement('div');
        textEl.className = 'chat-reference-summary-text';
        const summaryContent = match.summary && match.summary.trim()
          ? this.buildReferenceSnippet(match.summary.trim())
          : '暂无主题概述内容。';
        textEl.textContent = summaryContent;
        entry.appendChild(textEl);

        list.appendChild(entry);
      });

      card.appendChild(list);
      return card;
    }

    getReferenceKey(reference) {
      if (!reference || typeof reference !== 'object') {
        return '';
      }
      const absolute = ChatUtils.normalizePath(reference.absolute_path);
      if (absolute) {
        return `abs:${absolute}`;
      }
      const projectPath = ChatUtils.normalizePath(reference.project_relative_path);
      if (projectPath) {
        return `proj:${projectPath}`;
      }
      const filePath = ChatUtils.normalizePath(reference.file_path);
      if (filePath) {
        return `file:${filePath}`;
      }
      if (reference.reference_id) {
        return `id:${reference.reference_id}`;
      }
      const displayName = (reference.display_name || reference.filename || '').trim();
      if (displayName) {
        return `name:${displayName}`;
      }
      if (reference.snippet) {
        return `snippet:${String(reference.snippet).slice(0, 64)}`;
      }
      return '';
    }

    getSummaryMatchKey(match, index) {
      if (!match || typeof match !== 'object') {
        return `idx:${index}`;
      }
      const filename = (match.filename || '').trim();
      const summary = typeof match.summary_text === 'string'
        ? match.summary_text.trim()
        : (typeof match.summary_preview === 'string' ? match.summary_preview.trim() : '');
      const scorePart = Number.isFinite(match.score) ? match.score.toFixed(3) : 'na';
      if (filename || summary) {
        return `summary:${filename || summary}:${scorePart}`;
      }
      return `idx:${index}`;
    }

    createReferenceItem(reference, metadata) {
      if (!reference || typeof reference !== 'object') {
        return null;
      }

      const chunkList = this.collectReferenceChunks(reference, metadata);
      const chunkCount = chunkList.length || (Array.isArray(reference.chunk_indices) ? reference.chunk_indices.length : 0);

      const item = global.document.createElement('div');
      item.className = 'chat-reference-item';
      item.setAttribute('data-file-path', reference.file_path || '');

      const header = global.document.createElement('div');
      header.className = 'chat-reference-header';

      const headerMain = global.document.createElement('div');
      headerMain.className = 'chat-reference-header-main';

      const toggleButton = global.document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'chat-reference-toggle';
      toggleButton.setAttribute('aria-label', '折叠参考片段');
      toggleButton.setAttribute('aria-expanded', 'true');

      const toggleIcon = global.document.createElement('span');
      toggleIcon.className = 'chat-reference-toggle-icon';
      toggleButton.appendChild(toggleIcon);

      const textWrapper = global.document.createElement('div');
      textWrapper.className = 'chat-reference-texts';

      const docButton = global.document.createElement('button');
      docButton.type = 'button';
      docButton.className = 'chat-reference-name';
      const displayName = reference.display_name || reference.filename || '未命名文件';
      docButton.textContent = reference.reference_id ? `${reference.reference_id} · ${displayName}` : displayName;
      docButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleReferenceClick(reference, metadata, docButton);
      });
      textWrapper.appendChild(docButton);

      headerMain.appendChild(toggleButton);
      headerMain.appendChild(textWrapper);
      header.appendChild(headerMain);

      const meta = global.document.createElement('span');
      meta.className = 'chat-reference-meta';
      const metaParts = [];
      if (reference.score && Number.isFinite(reference.score)) {
        metaParts.push(`相关性 ${Number(reference.score).toFixed(2)}`);
      }
      if (chunkCount) {
        metaParts.push(`片段 ${chunkCount} 个`);
      } else if (reference.snippet) {
        metaParts.push('片段摘要 1 条');
      }
      meta.textContent = metaParts.length ? metaParts.join(' · ') : '暂无片段预览';
      header.appendChild(meta);

      const chunkContainer = global.document.createElement('div');
      chunkContainer.className = 'chat-reference-chunks';
      chunkContainer.hidden = false;
      chunkContainer.style.display = 'flex';

      const setExpanded = (expanded) => {
        if (expanded) {
          item.classList.remove('is-collapsed');
          item.classList.add('is-expanded');
          chunkContainer.hidden = false;
          chunkContainer.style.display = 'flex';
          toggleButton.setAttribute('aria-expanded', 'true');
          toggleButton.setAttribute('aria-label', '折叠参考片段');
        } else {
          item.classList.remove('is-expanded');
          item.classList.add('is-collapsed');
          chunkContainer.hidden = true;
          chunkContainer.style.display = 'none';
          toggleButton.setAttribute('aria-expanded', 'false');
          toggleButton.setAttribute('aria-label', '展开参考片段');
        }
      };

      const handleToggle = () => {
        const expanded = item.classList.contains('is-expanded');
        setExpanded(!expanded);
      };

      toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleToggle();
      });

      header.addEventListener('click', (event) => {
        if (event.target.closest('.chat-reference-name')) return;
        if (event.target.closest('.chat-reference-meta')) return;
        if (event.target.closest('.chat-reference-toggle')) return;
        handleToggle();
      });

      if (chunkList.length) {
        chunkList.forEach((chunk, index) => {
          const chunkBlock = global.document.createElement('button');
          chunkBlock.type = 'button';
          chunkBlock.className = 'chat-reference-chunk';
          chunkBlock.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.handleReferenceClick(reference, metadata, chunkBlock, chunk);
          });

          const chunkContent = global.document.createElement('div');
          chunkContent.className = 'chat-reference-chunk-content';
          chunkContent.textContent = this.buildReferenceSnippet(chunk.content);

          const chunkLabel = global.document.createElement('div');
          chunkLabel.className = 'chat-reference-chunk-label';
          chunkLabel.textContent = `片段 ${index + 1}`;

          chunkBlock.appendChild(chunkLabel);
          chunkBlock.appendChild(chunkContent);
          chunkContainer.appendChild(chunkBlock);
        });
      } else if (reference.snippet) {
        const snippetBlock = global.document.createElement('div');
        snippetBlock.className = 'chat-reference-chunk is-static';
        snippetBlock.setAttribute('tabindex', '-1');

        const snippetLabel = global.document.createElement('div');
        snippetLabel.className = 'chat-reference-chunk-label';
        snippetLabel.textContent = '片段摘要';

        const snippetContent = global.document.createElement('div');
        snippetContent.className = 'chat-reference-chunk-content';
        snippetContent.textContent = this.buildReferenceSnippet(reference.snippet);

        snippetBlock.appendChild(snippetLabel);
        snippetBlock.appendChild(snippetContent);
        chunkContainer.appendChild(snippetBlock);
      } else {
        const empty = global.document.createElement('div');
        empty.className = 'chat-reference-empty';
        empty.textContent = '未找到片段内容，可尝试打开文档查看详情。';
        chunkContainer.appendChild(empty);
      }

      item.appendChild(header);
      item.appendChild(chunkContainer);
      setExpanded(true);

      return item;
    }

    async handleReferenceClick(reference, metadata, trigger, preferredChunk = null) {
      if (!reference || typeof reference !== 'object') {
        return;
      }

      const isHTMLElement = typeof global.HTMLElement === 'function' && trigger instanceof global.HTMLElement;
      const targetButton = isHTMLElement ? trigger : null;
      if (targetButton) {
        targetButton.classList.add('is-activating');
      }

      try {
        const chunks = this.collectReferenceChunks(reference, metadata).slice();
        if (preferredChunk) {
          const matchIndex = chunks.findIndex((candidate) => this.isSameReferenceChunk(candidate, preferredChunk));
          if (matchIndex > 0) {
            const [selected] = chunks.splice(matchIndex, 1);
            chunks.unshift(selected);
          } else if (matchIndex === -1) {
            chunks.unshift(preferredChunk);
          }
        }
        const targetPath = await this.resolveReferencePath(reference, chunks);
        if (!targetPath) {
          this.setStatus('无法定位参考资料路径。', 'warning');
          return;
        }

        try {
          const exists = typeof global.window.fsAPI?.fileExists === 'function'
            ? await global.window.fsAPI.fileExists(targetPath)
            : true;
          if (!exists) {
            const statusEl = this.getStatusElement();
            if (statusEl) {
              statusEl.textContent = '该文件已不存在';
              statusEl.dataset.statusType = 'error';
            } else {
              this.appendSystemError('该文件已不存在');
            }
            return;
          }
        } catch (error) {
          const statusEl = this.getStatusElement();
          if (statusEl) {
            statusEl.textContent = '该文件已不存在';
            statusEl.dataset.statusType = 'error';
          } else {
            this.appendSystemError('该文件已不存在');
          }
          return;
        }

        if (typeof global.window.switchToFileMode === 'function') {
          global.window.switchToFileMode();
        }

        const searchModule = global.window.RendererModules?.search;
        if (searchModule && typeof searchModule.openSearchResult === 'function') {
          const primaryChunk = Array.isArray(chunks) && chunks.length ? chunks[0] : null;
          const referencePayload = {
            source: 'chat_reference',
            sources: ['chat-reference'],
            absolute_path: ChatUtils.normalizePath(targetPath),
            file_path: reference.project_relative_path || reference.file_path || '',
            path: reference.project_relative_path || reference.file_path || '',
            chunk_text: primaryChunk?.content || '',
            text: primaryChunk?.content || '',
            match_preview: primaryChunk?.content || '',
            match_field: 'chunk_text',
            chunk_index: primaryChunk?.chunk_index,
            filename: reference.display_name || reference.filename || '',
            display_name: reference.display_name || reference.filename || ''
          };

          try {
            await searchModule.openSearchResult(referencePayload);
            await this.highlightReferenceChunk(targetPath, reference, chunks, metadata);
          } catch (error) {
            console.warn('调用搜索模块打开参考资料失败，尝试备用逻辑:', error);
            await this.openReferenceManually(targetPath, reference, chunks, metadata);
          }
        } else {
          await this.openReferenceManually(targetPath, reference, chunks, metadata);
        }
      } finally {
        if (targetButton) {
          targetButton.classList.remove('is-activating');
        }
      }
    }

    async openReferenceManually(targetPath, reference, chunks, metadata) {
      let viewer = global.window.fileViewer;
      if ((!viewer || typeof viewer.openFile !== 'function')
        && global.window.explorerModule
        && typeof global.window.explorerModule.getFileViewer === 'function') {
        viewer = global.window.explorerModule.getFileViewer();
        if (viewer) {
          global.window.fileViewer = viewer;
        }
      }

      if (viewer && typeof viewer.openFile === 'function') {
        if (typeof global.window.switchToFileMode === 'function') {
          global.window.switchToFileMode();
        }

        try {
          await viewer.openFile(targetPath);
          await this.delay(this.delayMs);
        } catch (error) {
          console.error('打开参考资料失败:', error);
          this.setStatus('打开参考资料失败，请稍后重试。', 'error');
        }
      }

      await this.focusFileInTree(targetPath);
      await this.highlightReferenceChunk(targetPath, reference, chunks, metadata);
    }

    async resolveReferencePath(reference, chunks = []) {
      const candidateSet = new Set();
      const addCandidate = (value) => {
        ChatUtils.expandPathVariants(value).forEach((variant) => {
          if (variant) {
            candidateSet.add(variant);
          }
        });
      };

      addCandidate(reference.absolute_path);
      addCandidate(reference.project_relative_path);
      addCandidate(reference.file_path);

      (Array.isArray(chunks) ? chunks : []).forEach((chunk) => {
        if (!chunk) {
          return;
        }
        addCandidate(chunk.absolute_path);
        addCandidate(chunk.file_path || chunk.path);
      });

      for (const candidate of candidateSet) {
        if (!candidate) {
          continue;
        }

        if (/^[a-zA-Z]:/.test(candidate)) {
          return candidate.replace(/\\/g, '/');
        }

        if (candidate.startsWith('/')) {
          return candidate;
        }

        let resolved = null;
        if (typeof global.window.fsAPI?.resolveProjectPath === 'function') {
          try {
            resolved = await global.window.fsAPI.resolveProjectPath(candidate);
          } catch (error) {
            resolved = null;
          }
        }
        if (!resolved && typeof global.window.fsAPI?.resolveProjectPathSync === 'function') {
          try {
            resolved = global.window.fsAPI.resolveProjectPathSync(candidate);
          } catch (error) {
            resolved = null;
          }
        }
        if (resolved) {
          return ChatUtils.normalizePath(resolved);
        }

        if (global.window.fileTreeData && global.window.fileTreeData.path) {
          const rootPath = ChatUtils.normalizePath(global.window.fileTreeData.path);
          if (rootPath) {
            const combined = ChatUtils.normalizePath(`${rootPath}/${candidate}`);
            if (combined.startsWith('/')) {
              return combined;
            }
          }
        }
      }

      return null;
    }

    async focusFileInTree(targetPath) {
      if (!targetPath) {
        return;
      }

      if (global.window.RendererModules?.fileTree?.setSelectedItemPath) {
        global.window.RendererModules.fileTree.setSelectedItemPath(targetPath);
      }
      if (global.window.explorerModule && typeof global.window.explorerModule.setSelectedItemPath === 'function') {
        global.window.explorerModule.setSelectedItemPath(targetPath);
      }

      const selector = `[data-path="${ChatUtils.cssEscape(targetPath)}"]`;
      const treeElement = global.document.querySelector(selector);
      if (treeElement) {
        global.document.querySelectorAll('.file-item.selected').forEach((el) => el.classList.remove('selected'));
        treeElement.classList.add('selected');
        treeElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    collectReferenceChunks(reference, metadata) {
      if (!metadata || !Array.isArray(metadata.chunks)) {
        return [];
      }
      const referenceVariants = new Set();
      ChatUtils.expandPathVariants(reference.file_path).forEach((variant) => referenceVariants.add(variant));
      ChatUtils.expandPathVariants(reference.project_relative_path).forEach((variant) => referenceVariants.add(variant));
      ChatUtils.expandPathVariants(reference.absolute_path).forEach((variant) => referenceVariants.add(variant));

      const displayName = (reference.display_name || reference.filename || '').trim();

      return metadata.chunks.filter((chunk) => {
        if (!chunk) {
          return false;
        }
        const chunkVariants = new Set();
        ChatUtils.expandPathVariants(chunk.file_path || chunk.path).forEach((variant) => chunkVariants.add(variant));
        ChatUtils.expandPathVariants(chunk.absolute_path).forEach((variant) => chunkVariants.add(variant));

        const hasMatch = [...chunkVariants].some((variant) => {
          if (!variant) {
            return false;
          }
          if (referenceVariants.has(variant)) {
            return true;
          }
          for (const refVariant of referenceVariants) {
            if (!refVariant) {
              continue;
            }
            if (variant === refVariant || variant.endsWith(refVariant) || refVariant.endsWith(variant)) {
              return true;
            }
          }
          return false;
        });

        if (hasMatch) {
          return true;
        }

        if (displayName) {
          const chunkName = (chunk.filename || '').trim();
          if (chunkName && chunkName === displayName) {
            return true;
          }
        }

        return false;
      });
    }


    isSameReferenceChunk(left, right) {
      if (!left || !right) {
        return false;
      }
      if (typeof left.vector_id === 'number' && typeof right.vector_id === 'number' && left.vector_id === right.vector_id) {
        return true;
      }
      if (typeof left.chunk_index === 'number' && typeof right.chunk_index === 'number') {
        const leftPath = (left.file_path || left.path || '').trim();
        const rightPath = (right.file_path || right.path || '').trim();
        if (left.chunk_index === right.chunk_index && leftPath && rightPath && leftPath === rightPath) {
          return true;
        }
      }
      if (left.content && right.content && left.content === right.content) {
        return true;
      }
      return false;
    }

    buildReferenceSnippet(content) {
      if (content === null || content === undefined) {
        return '片段内容为空';
      }
      const normalized = String(content).trim();
      if (!normalized) {
        return '片段内容为空';
      }
      const limit = 680;
      if (normalized.length <= limit) {
        return normalized;
      }
      return `${normalized.slice(0, limit).trim()} ...`;
    }

    async highlightReferenceChunk(targetPath, reference, chunks, metadata) {
      const searchModule = global.window.RendererModules?.search;
      if (!searchModule || typeof searchModule.highlightSearchMatchWithRetry !== 'function') {
        return;
      }

      const chunkList = Array.isArray(chunks) && chunks.length
        ? chunks
        : this.collectReferenceChunks(reference, metadata);

      if (!chunkList.length) {
        return;
      }

      const primaryChunk = chunkList[0];
      const payload = {
        chunk_text: primaryChunk.content,
        text: primaryChunk.content,
        match_preview: primaryChunk.content,
        match_field: 'chunk_text',
        file_path: reference.file_path || reference.project_relative_path || reference.absolute_path || targetPath,
        path: reference.file_path || reference.project_relative_path || reference.absolute_path || targetPath,
        chunk_index: primaryChunk.chunk_index,
        filename: reference.display_name || reference.filename
      };

      try {
        await searchModule.highlightSearchMatchWithRetry(targetPath, payload);
      } catch (error) {
        console.warn('高亮参考片段失败:', error);
      }
    }

    delay(ms = 150) {
      return new Promise((resolve) => {
        global.setTimeout(resolve, ms);
      });
    }
  }

  global.ChatReferenceManager = ChatReferenceManager;
})(typeof window !== 'undefined' ? window : globalThis);
