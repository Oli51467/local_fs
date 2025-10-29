/* eslint-disable no-console */
(async () => {
  const resolveAsset = window.fsAPI && typeof window.fsAPI.getAssetPathSync === 'function'
    ? (relative) => {
        try {
          return window.fsAPI.getAssetPathSync(relative) || '';
        } catch (error) {
          console.warn('解析资源路径失败:', relative, error);
          return '';
        }
      }
    : null;

  const toFsPath = (maybeFileUrl) => {
    if (!maybeFileUrl) {
      return '';
    }
    if (maybeFileUrl.startsWith('file://')) {
      try {
        return decodeURIComponent(new URL(maybeFileUrl).pathname);
      } catch (error) {
        console.warn('解析 file:// URL 失败:', maybeFileUrl, error);
        return '';
      }
    }
    return maybeFileUrl;
  };

  const fileExists = async (fsPath) => {
    if (!fsPath || !window.fsAPI || typeof window.fsAPI.fileExists !== 'function') {
      return false;
    }
    try {
      return await window.fsAPI.fileExists(fsPath);
    } catch (error) {
      console.warn('检查资源存在性失败:', fsPath, error);
      return false;
    }
  };

  if (!resolveAsset) {
    console.warn('未能获取资源解析器，跳过可选的 node_modules 资源加载。');
    return;
  }

  const styleLinks = Array.from(document.querySelectorAll('link[data-asset-href]'));
  for (const link of styleLinks) {
    const target = link.getAttribute('data-asset-href');
    const resolved = target ? resolveAsset(target) : '';
    const fsPath = toFsPath(resolved);
    const exists = await fileExists(fsPath);
    if (resolved && exists) {
      link.href = resolved;
    } else {
      console.warn('无法解析样式资源或文件不存在:', target);
      link.remove();
    }
  }

  const scriptTags = Array.from(document.querySelectorAll('script[data-asset-src]'));
  for (const script of scriptTags) {
    const target = script.getAttribute('data-asset-src');
    const resolved = target ? resolveAsset(target) : '';
    const fsPath = toFsPath(resolved);
    const exists = await fileExists(fsPath);
    if (resolved && exists) {
      script.src = resolved;
    } else {
      console.warn('无法解析脚本资源或文件不存在:', target);
      script.remove();
    }
  }
})();
