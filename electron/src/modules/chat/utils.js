/**
 * ChatUtils 模块
 * 提供聊天模块使用的纯工具函数，避免在 ChatModule 中重复定义。
 */
(function initChatUtils(global) {
  const assetUrlCache = new Map();

  const WINDOWS_1252_REVERSE = new Map([
    [0x20ac, 0x80],
    [0x201a, 0x82],
    [0x0192, 0x83],
    [0x201e, 0x84],
    [0x2026, 0x85],
    [0x2020, 0x86],
    [0x2021, 0x87],
    [0x02c6, 0x88],
    [0x2030, 0x89],
    [0x0160, 0x8a],
    [0x2039, 0x8b],
    [0x0152, 0x8c],
    [0x017d, 0x8e],
    [0x2018, 0x91],
    [0x2019, 0x92],
    [0x201c, 0x93],
    [0x201d, 0x94],
    [0x2022, 0x95],
    [0x2013, 0x96],
    [0x2014, 0x97],
    [0x02dc, 0x98],
    [0x2122, 0x99],
    [0x0161, 0x9a],
    [0x203a, 0x9b],
    [0x0153, 0x9c],
    [0x017e, 0x9e],
    [0x0178, 0x9f]
  ]);

  function getAssetUrl(relativePath) {
    if (!relativePath) {
      return '';
    }
    if (assetUrlCache.has(relativePath)) {
      return assetUrlCache.get(relativePath);
    }
    const raw = String(relativePath).trim();
    if (!raw) {
      assetUrlCache.set(relativePath, '');
      return '';
    }
    if (/^(?:file|https?|data):/i.test(raw)) {
      assetUrlCache.set(relativePath, raw);
      return raw;
    }
    let resolved = `./${raw.replace(/^([./\\])+/, '')}`;
    try {
      if (global.fsAPI && typeof global.fsAPI.getAssetPathSync === 'function') {
        const candidate = global.fsAPI.getAssetPathSync(raw);
        if (candidate) {
          resolved = candidate;
        }
      } else if (global.location) {
        resolved = new global.URL(resolved.replace(/^\.\//, ''), global.location.href).href;
      }
    } catch (error) {
      console.warn('解析资源路径失败，使用默认相对路径:', error);
    }
    if (!/^(?:file|https?):/i.test(resolved) && global.location) {
      try {
        resolved = new global.URL(resolved, global.location.href).href;
      } catch (error) {
        // ignore
      }
    }
    assetUrlCache.set(relativePath, resolved);
    return resolved;
  }

  function normalizeModelText(text) {
    if (typeof text !== 'string' || !text) {
      return '';
    }
    const normalized = text.replace(/\r\n/g, '\n');
    const containsMojibake = /[\u0080-\u00FF]/.test(normalized) && !/[\u4e00-\u9fff]/.test(normalized);
    if (!containsMojibake) {
      return normalized;
    }
    try {
      const byteValues = [];
      for (const char of normalized) {
        const codePoint = char.codePointAt(0);
        if (codePoint === undefined) {
          continue;
        }
        if (codePoint <= 0xff) {
          byteValues.push(codePoint);
          continue;
        }
        const mapped = WINDOWS_1252_REVERSE.get(codePoint);
        if (mapped !== undefined) {
          byteValues.push(mapped);
          continue;
        }
        return normalized;
      }
      if (!global.TextDecoder || !global.Uint8Array) {
        return normalized;
      }
      const decoder = new global.TextDecoder('utf-8', { fatal: false });
      const decoded = decoder.decode(global.Uint8Array.from(byteValues));
      if (!decoded || /[\uFFFD]/.test(decoded)) {
        return normalized;
      }
      return decoded.replace(/\r\n/g, '\n');
    } catch (error) {
      console.debug('normalizeModelText fallback triggered:', error);
      if (typeof global.decodeURIComponent === 'function' && typeof global.escape === 'function') {
        try {
          return global.decodeURIComponent(global.escape(normalized));
        } catch (decodeError) {
          console.debug('decodeURIComponent fallback failed:', decodeError);
        }
      }
      return normalized;
    }
  }

  function formatTimestamp(value, locale = 'zh-CN') {
    if (!value) {
      return '';
    }
    try {
      const date = new Date(value);
      return date.toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return '';
    }
  }

  function normalizePath(value) {
    if (!value || typeof value !== 'string') {
      return '';
    }
    return value
      .trim()
      .replace(/^file:\/\//i, '')
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/');
  }

  function expandPathVariants(value) {
    const variants = new Set();
    const normalized = normalizePath(value);
    if (!normalized) {
      return variants;
    }

    variants.add(normalized);

    const withoutLeading = normalized.replace(/^\/+/, '');
    if (withoutLeading !== normalized) {
      variants.add(withoutLeading);
    }

    const runtimePaths = typeof global.fsAPI?.getRuntimePathsSync === 'function'
      ? global.fsAPI.getRuntimePathsSync()
      : null;
    const externalRoot = normalizePath(runtimePaths?.externalRoot);
    if (externalRoot && normalized.startsWith(externalRoot)) {
      const trimmed = normalized.slice(externalRoot.length).replace(/^\/+/, '');
      if (trimmed) {
        variants.add(trimmed);
      }
    }

    return variants;
  }

  function cssEscape(value) {
    if (typeof value !== 'string') {
      return '';
    }
    if (global.CSS && typeof global.CSS.escape === 'function') {
      return global.CSS.escape(value);
    }
    return value.replace(/['"\\]/g, '\\$&');
  }

  global.ChatUtils = {
    getAssetUrl,
    normalizeModelText,
    formatTimestamp,
    normalizePath,
    expandPathVariants,
    cssEscape
  };
})(typeof window !== 'undefined' ? window : globalThis);

