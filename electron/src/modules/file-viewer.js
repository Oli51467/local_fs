// 文件展示模块 - 主进程逻辑
const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ELECTRON_ROOT = path.join(__dirname, '..', '..');
const STATIC_DEV_ROOT = path.join(ELECTRON_ROOT, 'static');

const toFileUrl = (absolutePath) => 'file://' + absolutePath.replace(/\\/g, '/');

const decodeFileUrl = (input) => {
  if (typeof input !== 'string') {
    return input;
  }
  if (!input.startsWith('file://')) {
    return input;
  }
  try {
    const url = new URL(input);
    let pathname = url.pathname || '';
    if (process.platform === 'win32' && pathname.startsWith('/')) {
      pathname = pathname.slice(1);
    }
    return decodeURIComponent(pathname);
  } catch (error) {
    return input.replace(/^file:\/\//i, '');
  }
};

const normalizePathString = (input) => {
  if (typeof input !== 'string') {
    return '';
  }
  return input.replace(/\\/g, '/');
};

const uniquePush = (collection, value, seen) => {
  if (!value) {
    return;
  }
  const normalized = path.normalize(value);
  if (seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  collection.push(normalized);
};

const isWindows = process.platform === 'win32';

const ensureWithinBase = (targetPath, basePath) => {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(basePath);
  const lhs = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget;
  const rhs = isWindows ? resolvedBase.toLowerCase() : resolvedBase;
  if (!lhs.startsWith(rhs)) {
    throw new Error(`Invalid resource path requested: ${targetPath}`);
  }
};

const sanitizeRelativePath = (relativePath) => {
  if (typeof relativePath !== 'string') {
    throw new TypeError('relativePath must be a string');
  }
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/g, '');
  if (!normalized) {
    throw new Error('relativePath cannot be empty');
  }
  return normalized;
};

const resolveStaticAsset = (...segments) => {
  const relativePath = sanitizeRelativePath(path.join(...segments));
  const baseDir = app.isPackaged ? path.join(process.resourcesPath, 'static') : STATIC_DEV_ROOT;
  const absolutePath = path.resolve(baseDir, relativePath);
  ensureWithinBase(absolutePath, baseDir);
  return absolutePath;
};

const resolveDistAsset = (relativePath) => {
  const sanitized = sanitizeRelativePath(relativePath);
  const baseDir = app.isPackaged ? process.resourcesPath : ELECTRON_ROOT;
  const absolutePath = path.resolve(baseDir, sanitized);
  ensureWithinBase(absolutePath, baseDir);
  return absolutePath;
};

const DEFAULT_INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
];

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const hexToRgbTuple = (input) => {
  if (!input || typeof input !== 'string') {
    return null;
  }
  let hex = input.trim().replace(/^#/, '');
  if (hex.length === 8) {
    hex = hex.slice(2);
  }
  if (hex.length !== 6) {
    return null;
  }
  const num = Number.parseInt(hex, 16);
  if (Number.isNaN(num)) {
    return null;
  }
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
};

const rgbTupleToHex = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length !== 3) {
    return null;
  }
  const hex = rgb
    .map((channel) => {
      const value = Math.max(0, Math.min(255, Math.round(channel)));
      return value.toString(16).padStart(2, '0');
    })
    .join('')
    .toLowerCase();
  return `#${hex}`;
};

const rgbToHsl = (rgb) => {
  if (!Array.isArray(rgb) || rgb.length !== 3) {
    return null;
  }
  const [r0, g0, b0] = rgb.map((channel) => clamp01(channel / 255));
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  const delta = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r0:
        h = (g0 - b0) / delta + (g0 < b0 ? 6 : 0);
        break;
      case g0:
        h = (b0 - r0) / delta + 2;
        break;
      default:
        h = (r0 - g0) / delta + 4;
        break;
    }
    h /= 6;
  }

  return [clamp01(h), clamp01(s), clamp01(l)];
};

const hslToRgb = (hsl) => {
  if (!Array.isArray(hsl) || hsl.length !== 3) {
    return null;
  }
  const [h, s, l] = hsl.map(clamp01);
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
};

const normalizeColorHex = (value) => {
  const rgb = hexToRgbTuple(value);
  return rgb ? rgbTupleToHex(rgb) : null;
};

const applyTintToHex = (hex, tint) => {
  if (typeof tint !== 'number' || tint === 0) {
    return normalizeColorHex(hex);
  }
  const rgb = hexToRgbTuple(hex);
  if (!rgb) {
    return normalizeColorHex(hex);
  }
  const hsl = rgbToHsl(rgb);
  if (!hsl) {
    return normalizeColorHex(hex);
  }
  const [h, s, l] = hsl;
  const adjustedL = tint < 0 ? l * (1 + tint) : 1 - (1 - l) * (1 - tint);
  const tintedRgb = hslToRgb([h, s, clamp01(adjustedL)]);
  return rgbTupleToHex(tintedRgb);
};

const buildThemeColorResolver = (themes) => {
  if (!themes || !themes.themeElements || !Array.isArray(themes.themeElements.clrScheme)) {
    return null;
  }
  const scheme = themes.themeElements.clrScheme;
  return (themeIndex, tint) => {
    if (themeIndex == null) {
      return null;
    }
    const idx = Number(themeIndex);
    const entry = scheme[idx];
    const base = entry && (entry.rgb || entry.color || entry);
    return base ? applyTintToHex(base, typeof tint === 'number' ? tint : 0) : null;
  };
};

const createStyleResolver = (styles, themes) => {
  const fonts = (styles && styles.Fonts) || [];
  const fills = (styles && styles.Fills) || [];
  const cellXfs = (styles && styles.CellXf) || [];
  const resolveThemeColor = buildThemeColorResolver(themes);
  const styleCache = new Map();

  const resolveColor = (colorDef) => {
    if (!colorDef || typeof colorDef !== 'object') {
      return null;
    }
    if (colorDef.rgb) {
      return normalizeColorHex(colorDef.rgb);
    }
    if (typeof colorDef.theme === 'number' && resolveThemeColor) {
      return resolveThemeColor(colorDef.theme, colorDef.tint);
    }
    if (typeof colorDef.indexed === 'number') {
      const hex = DEFAULT_INDEXED_COLORS[colorDef.indexed];
      return hex ? normalizeColorHex(hex) : null;
    }
    return null;
  };

  const resolveAlignment = (alignment) => {
    if (!alignment || typeof alignment !== 'object') {
      return {};
    }
    const style = {};
    if (typeof alignment.horizontal === 'string') {
      const horizontal = alignment.horizontal.toLowerCase();
      if (horizontal === 'center' || horizontal === 'centercontinuous') {
        style.ht = 0;
      } else if (horizontal === 'right') {
        style.ht = 2;
      } else if (horizontal === 'left' || horizontal === 'general' || horizontal === 'justify') {
        style.ht = 1;
      }
    }
    if (typeof alignment.vertical === 'string') {
      const vertical = alignment.vertical.toLowerCase();
      if (vertical === 'center' || vertical === 'middle') {
        style.vt = 0;
      } else if (vertical === 'bottom') {
        style.vt = 2;
      } else if (vertical === 'top') {
        style.vt = 1;
      }
    }
    return style;
  };

  return (styleIndex) => {
    if (typeof styleIndex !== 'number' || styleIndex < 0) {
      return null;
    }
    if (styleCache.has(styleIndex)) {
      const cached = styleCache.get(styleIndex);
      return cached ? { ...cached } : null;
    }

    const xf = cellXfs[styleIndex];
    if (!xf) {
      styleCache.set(styleIndex, null);
      return null;
    }

    const style = {};
    if (typeof xf.fontId === 'number') {
      const font = fonts[xf.fontId];
      if (font) {
        const fontColor = resolveColor(font.color);
        if (fontColor) {
          style.fc = fontColor;
        }
        if (font.bold) {
          style.bl = 1;
        }
        if (font.italic) {
          style.it = 1;
        }
        if (font.underline) {
          style.un = 1;
        }
        if (font.sz) {
          style.fs = font.sz;
        }
        if (font.name) {
          style.ff = font.name;
        }
      }
    }

    if (typeof xf.fillId === 'number') {
      const fill = fills[xf.fillId];
      if (fill && fill.patternType && fill.patternType.toLowerCase() !== 'none') {
        const fillColor = resolveColor(fill.fgColor || fill.bgColor);
        if (fillColor) {
          style.bg = fillColor;
        }
      }
    }

    const alignmentStyle = resolveAlignment(xf.alignment);
    Object.assign(style, alignmentStyle);

    if (Object.keys(style).length === 0) {
      styleCache.set(styleIndex, null);
      return null;
    }

    styleCache.set(styleIndex, style);
    return { ...style };
  };
};

const buildSheetXmlLookup = (workbook) => {
  const lookup = {};
  const files = (workbook && workbook.files) || {};
  const sheetsMeta = (workbook.Workbook && workbook.Workbook.Sheets) || [];
  const relEntry = files['xl/_rels/workbook.xml.rels'];
  const relContent = relEntry && relEntry.content ? relEntry.content.toString('utf8') : '';
  const relMap = {};

  if (relContent) {
    const relRegex = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = relRegex.exec(relContent)) !== null) {
      const id = match[1];
      const target = match[2];
      if (id && target) {
        relMap[id] = target;
      }
    }
  }

  (workbook.SheetNames || []).forEach((sheetName, index) => {
    const meta = sheetsMeta[index];
    let target = meta && relMap[meta.id];
    if (!target) {
      target = `worksheets/sheet${index + 1}.xml`;
    }
    let normalizedTarget = target.replace(/^[/\\]+/, '');
    if (!normalizedTarget.startsWith('xl/')) {
      normalizedTarget = `xl/${normalizedTarget}`;
    }
    const fileEntry = files[normalizedTarget];
    lookup[sheetName] = fileEntry && fileEntry.content ? fileEntry.content.toString('utf8') : '';
  });

  return lookup;
};

const extractCellStyleMap = (sheetXml) => {
  const map = new Map();
  if (!sheetXml || typeof sheetXml !== 'string') {
    return map;
  }
  const cellRegex = /<c\b[^>]*>/gi;
  let match;
  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const tag = match[0];
    const refMatch = tag.match(/\br="([^"]+)"/i);
    if (!refMatch) {
      continue;
    }
    const styleMatch = tag.match(/\bs="(\d+)"/i);
    if (!styleMatch) {
      continue;
    }
    const styleIndex = Number.parseInt(styleMatch[1], 10);
    if (Number.isNaN(styleIndex)) {
      continue;
    }
    map.set(refMatch[1], styleIndex);
  }
  return map;
};

class FileViewerModule {
  constructor() {
    this.runtimePaths = this.loadRuntimePaths();
    this.initializeIpcHandlers();
  }

  loadRuntimePaths() {
    const resolveEnvPath = (key) => {
      const value = process.env[key];
      if (!value) {
        return null;
      }
      try {
        return path.resolve(value);
      } catch (error) {
        return null;
      }
    };

    return {
      externalRoot: resolveEnvPath('FS_APP_EXTERNAL_ROOT'),
      dataRoot: resolveEnvPath('FS_APP_DATA_DIR'),
      metaRoot: resolveEnvPath('FS_APP_META_DIR')
    };
  }

  resolveMarkdownAssetPath(baseFilePath, rawAssetPath) {
    if (!rawAssetPath || typeof rawAssetPath !== 'string') {
      return null;
    }

    let asset = normalizePathString(rawAssetPath.trim());
    if (!asset) {
      return null;
    }

    if (/^(https?:|data:|blob:|mailto:|javascript:)/i.test(asset)) {
      return asset;
    }

    asset = normalizePathString(decodeFileUrl(asset));
    if (!asset) {
      return null;
    }
    const candidates = [];
    const seen = new Set();

    const pushCandidate = (candidate) => uniquePush(candidates, candidate, seen);

    const pushRuntimeRelative = (relativePath) => {
      if (!relativePath) {
        return;
      }
      const trimmed = normalizePathString(relativePath).replace(/^([/\\])+/, '');
      if (!trimmed) {
        return;
      }
      const { externalRoot, dataRoot, metaRoot } = this.runtimePaths || {};
      if (externalRoot) {
        pushCandidate(path.resolve(externalRoot, trimmed));
      }
      if (dataRoot) {
        pushCandidate(path.resolve(dataRoot, trimmed));
      }
      if (metaRoot) {
        pushCandidate(path.resolve(metaRoot, trimmed));
      }
    };

    const isAbsoluteAsset = path.isAbsolute(asset);
    if (isAbsoluteAsset) {
      pushCandidate(asset);
    } else if (asset.startsWith('/')) {
      pushRuntimeRelative(asset);
    }

    const resolvedBaseDir = typeof baseFilePath === 'string' && baseFilePath
      ? path.resolve(path.dirname(baseFilePath))
      : null;

    if (resolvedBaseDir) {
      pushCandidate(path.resolve(resolvedBaseDir, asset));
    }

    if (!isAbsoluteAsset && !asset.startsWith('/')) {
      pushRuntimeRelative(asset);
    }

    const assetFileName = path.basename(asset);
    const assetHasSubdirectory = asset.includes('/') || asset.includes('\\');
    if (assetFileName && !assetHasSubdirectory) {
      if (resolvedBaseDir) {
        pushCandidate(path.resolve(resolvedBaseDir, assetFileName));
      }
      const { externalRoot, dataRoot } = this.runtimePaths || {};
      if (dataRoot) {
        pushCandidate(path.resolve(dataRoot, assetFileName));
      }
      if (externalRoot) {
        pushCandidate(path.resolve(externalRoot, assetFileName));
      }
    }

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch (error) {
        // ignore access errors for individual candidates
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    if (isAbsoluteAsset) {
      return asset;
    }

    return resolvedBaseDir ? path.resolve(resolvedBaseDir, asset) : asset;
  }

  // 初始化IPC处理器
  initializeIpcHandlers() {
    // 读取文件内容（文本格式）
    ipcMain.handle('read-file', (event, filePath) => {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        console.error('读取文件失败:', error);
        throw new Error(`读取文件失败: ${error.message}`);
      }
    });

    // 读取文件为Buffer（二进制格式）
    ipcMain.handle('read-file-buffer', (event, filePath) => {
      try {
        return fs.readFileSync(filePath);
      } catch (error) {
        console.error('读取文件Buffer失败:', error);
        throw new Error(`读取文件Buffer失败: ${error.message}`);
      }
    });

    // 写入文件内容
    ipcMain.handle('write-file', (event, filePath, content) => {
      try {
        fs.writeFileSync(filePath, content, 'utf-8');
        return { success: true };
      } catch (error) {
        console.error('写文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 获取文件信息
    ipcMain.handle('get-file-info', (event, filePath) => {
      try {
        const stats = fs.statSync(filePath);
        return {
          success: true,
          info: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            mtime: stats.mtime,
            ctime: stats.ctime,
            extension: path.extname(filePath).toLowerCase()
          }
        };
      } catch (error) {
        console.error('获取文件信息失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 检查文件是否存在
    ipcMain.handle('file-exists', (event, filePath) => {
      try {
        return fs.existsSync(filePath);
      } catch (error) {
        console.error('检查文件存在性失败:', error);
        return false;
      }
    });

    // 获取文件MIME类型（基于扩展名）
    ipcMain.handle('get-file-mime-type', (event, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.css': 'text/css',
        '.xml': 'text/xml',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt': 'application/vnd.ms-powerpoint',
        '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed',
        '.7z': 'application/x-7z-compressed',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime'
      };
      
      return mimeTypes[ext] || 'application/octet-stream';
    });

    // 判断文件是否为文本文件
    ipcMain.handle('is-text-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('text/') || 
             mimeType === 'application/json' || 
             mimeType === 'application/xml';
    });

    // 判断文件是否为图片文件
    ipcMain.handle('is-image-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('image/');
    });

    // 判断文件是否为视频文件
    ipcMain.handle('is-video-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('video/');
    });

    // 判断文件是否为音频文件
    ipcMain.handle('is-audio-file', (event, filePath) => {
      const mimeType = this.getFileMimeType(filePath);
      return mimeType.startsWith('audio/');
    });

    // PDF.js 资源路径
    ipcMain.handle('get-pdf-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'pdf.js');
      return toFileUrl(libPath);
    });

    // PDF Worker路径
    ipcMain.handle('get-pdf-worker-path', () => {
      const workerPath = resolveStaticAsset('libs', 'pdf.worker.min.js');
      return toFileUrl(workerPath);
    });

    ipcMain.handle('get-docx-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'docx-preview.js');
      return toFileUrl(libPath);
    });

    ipcMain.handle('get-jszip-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'jszip.min.js');
      return toFileUrl(libPath);
    });

    ipcMain.handle('get-pptx-lib-path', () => {
      const libPath = resolveStaticAsset('libs', 'pptx-preview.umd.js');
      return toFileUrl(libPath);
    });

    // 读取Excel（xlsx/xls）文件
    ipcMain.handle('read-xlsx-file', async (event, filePath) => {
      try {
        const workbook = XLSX.readFile(filePath, { cellStyles: true, bookFiles: true });
        const sheetXmlLookup = buildSheetXmlLookup(workbook);
        const resolveStyle = createStyleResolver(workbook.Styles, workbook.Themes);
        const sheets = workbook.SheetNames.map((name) => {
          const ws = workbook.Sheets[name];
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
          const cellData = [];
          const styleMap = extractCellStyleMap(sheetXmlLookup[name]);

          for (let R = range.s.r; R <= range.e.r; ++R) {
            const row = [];
            for (let C = range.s.c; C <= range.e.c; ++C) {
              const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
              const cell = ws[cellAddress];
              
              if (cell) {
                const cellInfo = {
                  v: cell.v, // 值
                  t: cell.t, // 类型
                };
                const styleIndex = styleMap.get(cellAddress);
                const style = resolveStyle(styleIndex);
                if (style) {
                  cellInfo.s = style;
                }

                row[C] = cellInfo;
              } else {
                row[C] = null;
              }
            }
            cellData[R] = row;
          }
          
          // 获取合并单元格信息
          const merges = ws['!merges'] || [];
          
          // 转换为简单的二维数组格式（保持兼容性）
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
          
          return { 
            name, 
            aoa, 
            cellData, // 包含格式信息的完整单元格数据
            merges // 合并单元格信息
          };
        });
        return {
          success: true,
          sheets,
          fileName: path.basename(filePath)
        };
      } catch (error) {
        console.error('读取Excel文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    // 保存Excel（xlsx/xls）文件
    ipcMain.handle('save-xlsx-file', async (event, payload) => {
      try {
        const { filePath, sheets } = payload || {};
        if (!filePath || !Array.isArray(sheets)) {
          throw new Error('参数无效: 需要 filePath 和 sheets');
        }
        const wb = XLSX.utils.book_new();
        sheets.forEach((sheet) => {
          const name = sheet.name || 'Sheet1';
          const aoa = Array.isArray(sheet.aoa) ? sheet.aoa : [];
          const ws = XLSX.utils.aoa_to_sheet(aoa);
          XLSX.utils.book_append_sheet(wb, ws, name);
        });
        XLSX.writeFile(wb, filePath);
        return { success: true };
      } catch (error) {
        console.error('保存Excel文件失败:', error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.on('resolve-markdown-asset-sync', (event, payload) => {
      try {
        const { filePath, assetPath } = payload || {};
        event.returnValue = this.resolveMarkdownAssetPath(filePath, assetPath);
      } catch (error) {
        console.error('解析Markdown资源路径失败:', error);
        event.returnValue = null;
      }
    });

    ipcMain.handle('get-dist-asset-path', (event, relativePath) => {
      const assetPath = resolveDistAsset(relativePath);
      return toFileUrl(assetPath);
    });

    ipcMain.on('get-dist-asset-path-sync', (event, relativePath) => {
      try {
        const assetPath = resolveDistAsset(relativePath);
        event.returnValue = toFileUrl(assetPath);
      } catch (error) {
        event.returnValue = '';
      }
    });

    // PPTX文件读取
    ipcMain.handle('read-pptx-file', async (event, filePath) => {
      try {
        const buffer = fs.readFileSync(filePath);
        return {
          success: true,
          buffer: buffer,
          fileName: path.basename(filePath)
        };
      } catch (error) {
        console.error('读取PPTX文件失败:', error);
        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  // 获取文件MIME类型的内部方法
  getFileMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.html': 'text/html',
      '.css': 'text/css',
      '.xml': 'text/xml',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt': 'application/vnd.ms-powerpoint',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.zip': 'application/zip',
      '.rar': 'application/x-rar-compressed',
      '.7z': 'application/x-7z-compressed',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = FileViewerModule;
