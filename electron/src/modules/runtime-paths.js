const { ipcMain } = require('electron');
const path = require('path');

const CHANNELS = {
  GET_ASYNC: 'fs-app:get-runtime-paths',
  GET_SYNC: 'fs-app:get-runtime-paths-sync',
  RESOLVE_ASYNC: 'fs-app:resolve-project-path',
  RESOLVE_SYNC: 'fs-app:resolve-project-path-sync',
  RELATIVE_ASYNC: 'fs-app:project-relative-path',
  RELATIVE_SYNC: 'fs-app:project-relative-path-sync'
};

class RuntimePathsModule {
  constructor(appPaths) {
    this.appPaths = appPaths || {};
    this.normalizedPaths = this.normalizePaths(appPaths);
    this.registerHandlers();
  }

  normalizePaths(appPaths) {
    const projectRootFallback = path.resolve(__dirname, '..', '..', '..');
    const externalRoot = path.resolve(appPaths?.externalRoot || projectRootFallback);
    const dataRoot = path.resolve(appPaths?.dataRoot || path.join(externalRoot, 'data'));
    const metaRoot = path.resolve(appPaths?.metaRoot || path.join(externalRoot, 'meta'));
    return {
      externalRoot,
      dataRoot,
      metaRoot
    };
  }

  getRuntimePaths() {
    // Return a shallow copy to avoid accidental external mutation
    return { ...this.normalizedPaths };
  }

  resolveFileUrl(target) {
    try {
      const url = new URL(target);
      if (url.protocol !== 'file:') {
        return null;
      }
      const decoded = decodeURIComponent(url.pathname);
      if (!decoded) {
        return null;
      }
      // On Windows, url.pathname starts with a leading slash before the drive letter
      return process.platform === 'win32' && decoded.startsWith('/')
        ? decoded.slice(1)
        : decoded;
    } catch (error) {
      return null;
    }
  }

  resolveProjectPath(targetPath) {
    if (typeof targetPath !== 'string') {
      return null;
    }

    const trimmed = targetPath.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('file://')) {
      const converted = this.resolveFileUrl(trimmed);
      if (!converted) {
        return null;
      }
      return this.resolveProjectPath(converted);
    }

    const { externalRoot } = this.normalizedPaths;
    const rootResolved = path.resolve(externalRoot);
    const candidate = path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(rootResolved, trimmed));

    const relative = path.relative(rootResolved, candidate);
    const outsideRoot = relative.startsWith('..') || path.isAbsolute(relative);

    if (outsideRoot) {
      return null;
    }

    return candidate;
  }

  makeProjectRelative(targetPath) {
    const absolute = this.resolveProjectPath(targetPath);
    if (!absolute) {
      return null;
    }

    const { externalRoot } = this.normalizedPaths;
    const relative = path.relative(path.resolve(externalRoot), absolute).replace(/\\/g, '/');
    return relative || '';
  }

  registerHandlers() {
    ipcMain.handle(CHANNELS.GET_ASYNC, () => this.getRuntimePaths());
    ipcMain.on(CHANNELS.GET_SYNC, (event) => {
      try {
        event.returnValue = this.getRuntimePaths();
      } catch (error) {
        event.returnValue = null;
      }
    });

    ipcMain.handle(CHANNELS.RESOLVE_ASYNC, (event, targetPath) => this.resolveProjectPath(targetPath));
    ipcMain.on(CHANNELS.RESOLVE_SYNC, (event, targetPath) => {
      try {
        event.returnValue = this.resolveProjectPath(targetPath);
      } catch (error) {
        event.returnValue = null;
      }
    });

    ipcMain.handle(CHANNELS.RELATIVE_ASYNC, (event, targetPath) => this.makeProjectRelative(targetPath));
    ipcMain.on(CHANNELS.RELATIVE_SYNC, (event, targetPath) => {
      try {
        event.returnValue = this.makeProjectRelative(targetPath);
      } catch (error) {
        event.returnValue = null;
      }
    });
  }
}

module.exports = RuntimePathsModule;
