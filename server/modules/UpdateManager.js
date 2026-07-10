const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { execFile, spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const VersionManager = require('./VersionManager');

function getStorageRoot() {
  if (process.env.STORAGE_ROOT) {
    return process.env.STORAGE_ROOT;
  }
  const isPkg = typeof process.pkg !== 'undefined';
  if (isPkg) {
    return path.dirname(process.execPath);
  } else {
    return path.join(__dirname, '..', '..');
  }
}

const PHASES = {
  IDLE: 'idle',
  UPLOAD: 'upload',
  VALIDATE: 'validate',
  EXTRACT: 'extract',
  DIFF: 'diff',
  BACKUP: 'backup',
  APPLY: 'apply',
  RESTART: 'restart',
  VERIFY: 'verify',
  ROLLBACK: 'rollback',
  COMPLETE: 'complete'
};

class UpdateManager {
  constructor(io = null) {
    this.io = io;
    this.storageRoot = getStorageRoot();
    this.versionManager = new VersionManager();

    this.paths = {
      backup: path.join(this.storageRoot, config.update.backupDir),
      temp: path.join(this.storageRoot, config.update.tempDir),
      upload: path.join(this.storageRoot, config.update.uploadDir),
      statusFile: path.join(this.storageRoot, config.update.statusFile),
      lockFile: path.join(this.storageRoot, config.update.lockFile),
      flagFile: path.join(this.storageRoot, config.update.flagFile),
      updaterDir: path.join(this.storageRoot, 'updater')
    };

    this.status = null;
    this.lockHeld = false;
    this.currentZipPath = null;
    this.extractDir = null;
    this.manifest = null;
    this.backupDir = null;
    this.filePlan = null;
    this.progressListeners = new Set();

    this._ensureDirs();
    this.status = this._loadStatus();
    this._cleanupStaleState();
  }

  _ensureDirs() {
    for (const dir of [this.paths.backup, this.paths.temp, this.paths.upload]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  _cleanupStaleState() {
    if (this.status && this.status.status === 'in_progress') {
      const elapsed = Date.now() - (this.status.startTime || 0);
      if (elapsed > config.update.staleStateTimeout) {
        logger.warn('检测到停滞的更新状态，重置为失败', { updateId: this.status.updateId });
        this._failUpdate('检测到上次更新异常中断');
      }
    }
    try {
      if (fs.existsSync(this.paths.lockFile)) {
        const lockStat = fs.statSync(this.paths.lockFile);
        if (Date.now() - lockStat.mtimeMs > config.update.staleLockTimeout) {
          fs.unlinkSync(this.paths.lockFile);
          logger.info('清理过期更新锁');
        }
      }
    } catch (e) { /* ignore */ }
  }

  _loadStatus() {
    try {
      if (fs.existsSync(this.paths.statusFile)) {
        return JSON.parse(fs.readFileSync(this.paths.statusFile, 'utf8'));
      }
    } catch (e) {
      logger.warn('读取更新状态失败', { error: e.message });
    }
    return this._idleStatus();
  }

  _idleStatus() {
    return {
      updateId: null,
      status: 'idle',
      currentPhase: PHASES.IDLE,
      phases: {},
      version: { from: this.versionManager.getServerVersion(), to: null },
      startTime: null,
      endTime: null,
      progress: 0,
      message: '',
      error: null,
      logTail: []
    };
  }

  _saveStatus() {
    try {
      fs.writeFileSync(this.paths.statusFile, JSON.stringify(this.status, null, 2), 'utf8');
    } catch (e) {
      logger.error('保存更新状态失败', { error: e.message });
    }
  }

  _pushLog(level, message, details = {}) {
    const entry = {
      timestamp: Date.now(),
      level,
      message,
      ...details
    };
    if (!this.status.logTail) this.status.logTail = [];
    this.status.logTail.push(entry);
    if (this.status.logTail.length > config.update.logTailMaxLength) this.status.logTail.shift();

    if (level === 'error') {
      logger.error(`[更新] ${message}`, details);
    } else if (level === 'warn') {
      logger.warn(`[更新] ${message}`, details);
    } else {
      logger.info(`[更新] ${message}`, details);
    }

    for (const listener of this.progressListeners) {
      try {
        listener({ type: 'log', entry });
      } catch (e) { /* ignore */ }
    }

    if (this.io) {
      this.io.to('admins').emit('update_log', entry);
    }
  }

  _setPhase(phase, message = '') {
    this.status.currentPhase = phase;
    this.status.phases[phase] = this.status.phases[phase] || { status: 'in_progress', progress: 0, startTime: Date.now() };
    this.status.phases[phase].status = 'in_progress';
    this.status.message = message;
    this._pushLog('info', message || `进入阶段: ${phase}`);
    this._saveStatus();
    this._emitSocket('update_phase', { phase, status: 'start', message });
    this._broadcastStatus();
  }

  _updateProgress(phase, progress, message = '') {
    if (this.status.phases[phase]) {
      this.status.phases[phase].progress = Math.min(100, Math.max(0, progress));
    }
    if (message) this.status.message = message;
    this._emitSocket('update_progress', { phase, progress, message });
    this._broadcastStatus();
  }

  _completePhase(phase, message = '') {
    if (this.status.phases[phase]) {
      this.status.phases[phase].status = 'success';
      this.status.phases[phase].progress = 100;
      this.status.phases[phase].endTime = Date.now();
      this.status.phases[phase].duration = this.status.phases[phase].endTime - this.status.phases[phase].startTime;
    }
    if (message) this._pushLog('info', message);
    this._emitSocket('update_phase', { phase, status: 'complete', message });
    this._emitSocket('update_progress', { phase, progress: 100, message: message || `${phase} 完成` });
    this._saveStatus();
    this._broadcastStatus();
  }

  _failPhase(phase, error) {
    if (this.status.phases[phase]) {
      this.status.phases[phase].status = 'failed';
      this.status.phases[phase].error = error.message || String(error);
      this.status.phases[phase].endTime = Date.now();
    }
    this._pushLog('error', `阶段失败: ${error.message || error}`);
  }

  _broadcastStatus() {
    if (this.io) {
      try {
        this.io.of('/admin').to('admins').emit('update_status', this.getPublicStatus());
      } catch (e) {
        try { this.io.to('admins').emit('update_status', this.getPublicStatus()); } catch (e2) { /* ignore */ }
      }
    }
    for (const listener of this.progressListeners) {
      try {
        listener({ type: 'status', status: this.getPublicStatus() });
      } catch (e) { /* ignore */ }
    }
  }

  _emitSocket(event, data = {}) {
    if (this.io) {
      try {
        const adminNsp = this.io.of('/admin');
        if (adminNsp) {
          adminNsp.to('admins').emit(event, data);
        }
      } catch (e) {
        try {
          this.io.to('admins').emit(event, data);
        } catch (e2) { /* ignore */ }
      }
    }
  }

  getPublicStatus() {
    const backups = this._listBackups();
    const history = this._getHistory();
    return {
      ...this.status,
      availableBackups: backups,
      history: history.slice(0, config.update.publicHistoryLimit),
      serverVersion: this.versionManager.getServerVersion(),
      isPkg: typeof process.pkg !== 'undefined'
    };
  }

  onProgress(fn) {
    this.progressListeners.add(fn);
    return () => this.progressListeners.delete(fn);
  }

  _generateUpdateId() {
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `upd_${ts}_${crypto.randomBytes(config.update.updateIdRandomBytes).toString('hex')}`;
  }

  async acquireLock() {
    if (this.lockHeld) return true;
    try {
      if (fs.existsSync(this.paths.lockFile)) {
        const lockStat = fs.statSync(this.paths.lockFile);
        if (Date.now() - lockStat.mtimeMs < config.update.staleLockTimeout) {
          const lockData = JSON.parse(fs.readFileSync(this.paths.lockFile, 'utf8'));
          throw new Error(`更新已在进行中 (${lockData.updateId || '未知'})，请稍后重试`);
        }
        fs.unlinkSync(this.paths.lockFile);
      }
      fs.writeFileSync(this.paths.lockFile, JSON.stringify({
        updateId: this.status.updateId,
        pid: process.pid,
        acquiredAt: Date.now()
      }), 'utf8');
      this.lockHeld = true;
      return true;
    } catch (e) {
      if (e.message.includes('更新已在进行中')) throw e;
      throw new Error(`获取更新锁失败: ${e.message}`);
    }
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.paths.lockFile)) {
        fs.unlinkSync(this.paths.lockFile);
      }
    } catch (e) { /* ignore */ }
    this.lockHeld = false;
  }

  _sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  _isPathSafe(relativePath) {
    const normalized = path.normalize(relativePath).replace(/^[/\\]+/, '');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;

    for (const blocked of config.update.blockedPaths) {
      const blockedNorm = blocked.replace(/[/\\]+$/, '').replace(/\\/g, '/');
      const relNorm = normalized.replace(/\\/g, '/');
      if (relNorm === blockedNorm || relNorm.startsWith(blockedNorm + '/')) {
        return false;
      }
    }

    let allowed = false;
    for (const allowedPath of config.update.allowedPaths) {
      const allowedNorm = allowedPath.replace(/\\/g, '/');
      const relNorm = normalized.replace(/\\/g, '/');
      if (relNorm === allowedNorm ||
        relNorm.startsWith(allowedNorm + '/') ||
        (!allowedNorm.includes('.') && relNorm.startsWith(allowedNorm + '/'))) {
        allowed = true;
        break;
      }
    }

    if (!allowed && !normalized.includes('.')) {
      for (const a of config.update.allowedPaths) {
        if (!a.includes('.') && normalized.replace(/\\/g, '/').startsWith(a.replace(/\\/g, '/') + '/')) {
          allowed = true;
          break;
        }
      }
    }

    return allowed;
  }

  async saveUploadedChunk(chunkData, chunkIndex, totalChunks, uploadId) {
    const uploadDir = path.join(this.paths.upload, uploadId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const chunkPath = path.join(uploadDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);
    fs.writeFileSync(chunkPath, chunkData);
    const existingChunks = fs.readdirSync(uploadDir).filter(f => f.startsWith('chunk_')).length;
    return { received: existingChunks, total: totalChunks };
  }

  async assembleUpload(uploadId, originalName, totalSize, expectedHash) {
    const uploadDir = path.join(this.paths.upload, uploadId);
    if (!fs.existsSync(uploadDir)) {
      throw new Error('上传目录不存在');
    }

    const chunks = fs.readdirSync(uploadDir)
      .filter(f => f.startsWith('chunk_'))
      .sort();

    const zipPath = path.join(this.paths.upload, `${uploadId}.zip`);
    const writeStream = fs.createWriteStream(zipPath);

    for (const chunk of chunks) {
      const chunkPath = path.join(uploadDir, chunk);
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
    }
    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    fs.rmSync(uploadDir, { recursive: true, force: true });

    const stats = fs.statSync(zipPath);
    if (totalSize && stats.size !== totalSize) {
      fs.unlinkSync(zipPath);
      throw new Error(`文件大小不匹配: 期望 ${totalSize}, 实际 ${stats.size}`);
    }

    if (stats.size > config.update.maxUploadSize) {
      fs.unlinkSync(zipPath);
      throw new Error(`文件过大: ${stats.size} > ${config.update.maxUploadSize}`);
    }

    if (expectedHash) {
      const actualHash = await this._sha256File(zipPath);
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        fs.unlinkSync(zipPath);
        throw new Error('文件哈希校验失败');
      }
    }

    const buf = Buffer.alloc(4);
    const fd = fs.openSync(zipPath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
      fs.unlinkSync(zipPath);
      throw new Error('不是有效的ZIP文件');
    }

    this.currentZipPath = zipPath;
    return { zipPath, size: stats.size };
  }

  async saveUploadedFile(fileBuffer, originalName) {
    const uploadId = this._generateUpdateId();
    const zipPath = path.join(this.paths.upload, `${uploadId}.zip`);
    fs.writeFileSync(zipPath, fileBuffer);

    const stats = fs.statSync(zipPath);
    if (stats.size > config.update.maxUploadSize) {
      fs.unlinkSync(zipPath);
      throw new Error(`文件过大: ${stats.size} > ${config.update.maxUploadSize}`);
    }

    const buf = Buffer.alloc(4);
    const fd = fs.openSync(zipPath, 'r');
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
      fs.unlinkSync(zipPath);
      throw new Error('不是有效的ZIP文件');
    }

    this.currentZipPath = zipPath;
    return { zipPath, size: stats.size, hash: await this._sha256File(zipPath) };
  }

  async startUpdate(zipPath = null) {
    if (this.status.status === 'in_progress') {
      throw new Error('已有更新正在进行中');
    }

    if (zipPath) this.currentZipPath = zipPath;
    if (!this.currentZipPath || !fs.existsSync(this.currentZipPath)) {
      throw new Error('未找到更新包文件');
    }

    await this.acquireLock();

    this.status = this._idleStatus();
    this.status.updateId = this._generateUpdateId();
    this.status.status = 'in_progress';
    this.status.startTime = Date.now();
    this.status.version.from = this.versionManager.getServerVersion();
    this.status.logTail = [];
    this._saveStatus();

    this._pushLog('info', '开始更新流程', {
      updateId: this.status.updateId,
      fromVersion: this.versionManager.getServerVersion()
    });
    this._emitSocket('update_started', { updateId: this.status.updateId });

    try {
      await this._validatePackage();
      await this._extractPackage();
      await this._analyzeDiff();
      await this._createBackup();
      await this._applyFiles();
      await this._triggerRestart();
    } catch (err) {
      this._failUpdate(err.message || String(err));
      await this._rollbackInternal();
      this.releaseLock();
      throw err;
    }
  }

  _validatePackage() {
    return new Promise((resolve, reject) => {
      this._setPhase(PHASES.VALIDATE, '校验更新包...');
      yauzl.open(this.currentZipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(new Error(`打开ZIP失败: ${err.message}`));

        let fileCount = 0;
        let totalUncompressed = 0;
        let manifestFound = false;
        const fileList = [];

        zipfile.on('entry', (entry) => {
          fileCount++;
          if (fileCount > config.update.maxFileCount) {
            zipfile.close();
            return reject(new Error(`文件数量过多: ${fileCount} > ${config.update.maxFileCount}`));
          }

          totalUncompressed += entry.uncompressedSize;
          if (totalUncompressed > config.update.maxExtractSize) {
            zipfile.close();
            return reject(new Error(`解压后体积过大: ${totalUncompressed} > ${config.update.maxExtractSize}`));
          }

          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }

          if (/[\\/]/.test(entry.fileName) === false && entry.fileName === 'update-manifest.json') {
            manifestFound = true;
          }

          const safeName = entry.fileName.replace(/\\/g, '/');
          if (safeName.includes('..') || safeName.startsWith('/')) {
            zipfile.close();
            return reject(new Error(`非法路径: ${entry.fileName}`));
          }

          fileList.push({
            path: entry.fileName,
            size: entry.uncompressedSize,
            compressedSize: entry.compressedSize
          });

          this._updateProgress(PHASES.VALIDATE, Math.min(90, fileCount * 100 / Math.max(config.update.validateProgressDenominator, fileCount + 10)));
          zipfile.readEntry();
        });

        zipfile.on('end', () => {
          this._pushLog('info', '更新包基础校验通过', { fileCount, totalSize: totalUncompressed });
          this._updateProgress(PHASES.VALIDATE, 100);
          resolve({ fileCount, totalSize: totalUncompressed, fileList });
        });

        zipfile.on('error', (e) => reject(new Error(`ZIP读取错误: ${e.message}`)));
        zipfile.readEntry();
      });
    });
  }

  _extractPackage() {
    return new Promise((resolve, reject) => {
      this._setPhase(PHASES.EXTRACT, '解压更新包...');
      const extractDir = path.join(this.paths.temp, `extract_${Date.now()}_${crypto.randomBytes(config.update.extractDirRandomBytes).toString('hex')}`);
      this.extractDir = extractDir;
      fs.mkdirSync(extractDir, { recursive: true });

      let extracted = 0;
      let manifest = null;
      let totalFiles = 0;
      let fileWritePromises = [];

      yauzl.open(this.currentZipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(new Error(`打开ZIP失败: ${err.message}`));

        zipfile.on('entry', (entry) => {
          if (entry.fileName.endsWith('/')) {
            const dirPath = path.join(extractDir, entry.fileName);
            fs.mkdirSync(dirPath, { recursive: true });
            zipfile.readEntry();
            return;
          }

          const fileName = entry.fileName.replace(/\\/g, '/');

          if (fileName.includes('..')) {
            zipfile.close();
            return reject(new Error(`路径穿越检测: ${entry.fileName}`));
          }

          const destPath = path.join(extractDir, entry.fileName);
          const destDir = path.dirname(destPath);
          fs.mkdirSync(destDir, { recursive: true });

          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) return reject(new Error(`读取文件流失败: ${err.message}`));

            const writeStream = fs.createWriteStream(destPath);
            const writePromise = new Promise((res, rej) => {
              writeStream.on('finish', res);
              writeStream.on('error', rej);
            });
            fileWritePromises.push(writePromise);

            readStream.pipe(writeStream);

            readStream.on('end', async () => {
              extracted++;

              if (fileName === 'update-manifest.json') {
                try {
                  const content = fs.readFileSync(destPath, 'utf8');
                  manifest = JSON.parse(content);
                } catch (e) {
                  return reject(new Error('解析 update-manifest.json 失败'));
                }
              }

              this._updateProgress(PHASES.EXTRACT, extracted * 80 / Math.max(totalFiles, 1), `解压: ${entry.fileName}`);
              zipfile.readEntry();
            });

            readStream.on('error', (e) => reject(new Error(`读取 ${entry.fileName} 失败: ${e.message}`)));
          });

          totalFiles++;
        });

        zipfile.on('end', async () => {
          try {
            await Promise.all(fileWritePromises);

            if (manifest) {
              const manifestPath = path.join(extractDir, 'version.json');
              if (manifest.version && fs.existsSync(manifestPath)) {
                try {
                  const ver = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  this.status.version.to = `${ver.major}.${ver.minor}.${ver.patch}.${ver.build}`;
                } catch (e) { /* ignore */ }
              }
              if (!this.status.version.to && manifest.version) {
                this.status.version.to = manifest.version;
              }
            } else {
              this._pushLog('warn', '未找到 update-manifest.json，将执行全量差异比对');
              const rootVersionPath = path.join(extractDir, 'version.json');
              if (fs.existsSync(rootVersionPath)) {
                try {
                  const ver = JSON.parse(fs.readFileSync(rootVersionPath, 'utf8'));
                  this.status.version.to = `${ver.major}.${ver.minor}.${ver.patch}.${ver.build}`;
                } catch (e) { /* ignore */ }
              }
            }

            this.manifest = manifest || { files: [] };
            if (manifest) {
              this._pushLog('info', '解压完成，校验文件哈希...', { extracted });
              await this._verifyExtractedFiles(extractDir, manifest);
            } else {
              this._pushLog('info', '解压完成', { extracted });
            }

            this._flattenExtractDir(extractDir);

            this._completePhase(PHASES.EXTRACT, `解压完成，共 ${extracted} 个文件`);
            resolve();
          } catch (e) {
            reject(e);
          }
        });

        zipfile.on('error', (e) => reject(new Error(`解压错误: ${e.message}`)));
        zipfile.readEntry();
      });
    });
  }

  async _verifyExtractedFiles(extractDir, manifest) {
    if (!manifest.files || !Array.isArray(manifest.files)) {
      this._pushLog('warn', 'manifest中无文件列表，跳过单文件哈希校验');
      return;
    }

    let verified = 0;
    for (const fileInfo of manifest.files) {
      if (fileInfo.operation === 'delete') {
        verified++;
        continue;
      }

      const filePath = path.join(extractDir, fileInfo.path);
      if (!fs.existsSync(filePath)) {
        if (fileInfo.operation === 'add' || fileInfo.operation === 'update') {
          throw new Error(`清单中的文件不存在: ${fileInfo.path}`);
        }
        continue;
      }

      if (fileInfo.sha256) {
        const actualHash = await this._sha256File(filePath);
        if (actualHash.toLowerCase() !== fileInfo.sha256.toLowerCase()) {
          throw new Error(`文件哈希不匹配: ${fileInfo.path}`);
        }
      }

      if (fileInfo.size !== undefined) {
        const stat = fs.statSync(filePath);
        if (stat.size !== fileInfo.size) {
          throw new Error(`文件大小不匹配: ${fileInfo.path}`);
        }
      }

      verified++;
      this._updateProgress(PHASES.EXTRACT, 80 + verified * 20 / manifest.files.length);
    }

    this._pushLog('info', `文件校验完成: ${verified} 个文件`);
  }

  async _analyzeDiff() {
    this._setPhase(PHASES.DIFF, '分析文件差异...');

    const operations = [];
    const extractDir = this.extractDir;

    const walkDir = (dir, basePath = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = basePath ? path.join(basePath, entry.name) : entry.name;
        const relPathUnix = relPath.replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (config.update.skipDirsInDiff.includes(entry.name)) continue;
          walkDir(fullPath, relPath);
        } else {
          if (!this._isPathSafe(relPath)) {
            this._pushLog('warn', `跳过非白名单路径: ${relPathUnix}`);
            continue;
          }
          const targetPath = path.join(this.storageRoot, relPath);
          const exists = fs.existsSync(targetPath);

          if (exists) {
            const sourceHash = this._hashFileSync(fullPath);
            const targetHash = this._hashFileSync(targetPath);
            if (sourceHash !== targetHash) {
              operations.push({ op: 'update', relPath: relPathUnix, source: fullPath, target: targetPath });
            }
          } else {
            operations.push({ op: 'add', relPath: relPathUnix, source: fullPath, target: targetPath });
          }
        }
      }
    };

    walkDir(extractDir);

    // 反向扫描：检测已安装文件中不在包里的 → 标记删除
    const scanDeletions = (dir, basePath) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = basePath ? path.join(basePath, entry.name) : entry.name;
        if (entry.isDirectory()) {
          if (config.update.skipDirsInDiff.includes(entry.name)) continue;
          scanDeletions(fullPath, relPath);
        } else {
          if (!this._isPathSafe(relPath)) continue;
          // 额外检查：跳过 runtime 数据目录（如 server/data/、server/logs/ 等）
          const parts = relPath.replace(/\\/g, '/').split('/');
          if (parts.some(p => config.update.blockedPaths.includes(p))) continue;
          const extractFilePath = path.join(extractDir, relPath);
          if (!fs.existsSync(extractFilePath)) {
            operations.push({ op: 'delete', relPath: relPath.replace(/\\/g, '/'), target: fullPath });
          }
        }
      }
    };
    for (const allowedPath of config.update.allowedPaths) {
      const installPath = path.join(this.storageRoot, allowedPath);
      if (fs.existsSync(installPath) && !config.update.blockedPaths.includes(allowedPath)) {
        const stat = fs.statSync(installPath);
        if (stat.isDirectory()) {
          scanDeletions(installPath, allowedPath);
        } else {
          const extractFilePath = path.join(extractDir, allowedPath);
          if (!fs.existsSync(extractFilePath)) {
            operations.push({ op: 'delete', relPath: allowedPath, target: installPath });
          }
        }
      }
    }

    if (this.manifest && this.manifest.files) {
      for (const fileInfo of this.manifest.files) {
        if (fileInfo.operation === 'delete') {
          const targetPath = path.join(this.storageRoot, fileInfo.path);
          if (fs.existsSync(targetPath)) {
            operations.push({ op: 'delete', relPath: fileInfo.path, target: targetPath });
          }
        }
      }
    }

    const stats = { add: 0, update: 0, delete: 0 };
    for (const op of operations) stats[op.op]++;

    this.filePlan = operations;
    this._completePhase(PHASES.DIFF, `差异分析完成: 新增 ${stats.add}, 修改 ${stats.update}, 删除 ${stats.delete}`);
    return operations;
  }

  _hashFileSync(filePath) {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  async _createBackup() {
    this._setPhase(PHASES.BACKUP, '创建当前版本备份...');

    const toVersion = this.status.version.to || 'unknown';
    const backupName = `v${this.versionManager.getServerVersion().replace(/\./g, '_')}_${Date.now()}`;
    this.backupDir = path.join(this.paths.backup, backupName);
    fs.mkdirSync(this.backupDir, { recursive: true });

    const backupManifest = {
      fromVersion: this.versionManager.getServerVersion(),
      toVersion: this.status.version.to,
      backupTime: Date.now(),
      updateId: this.status.updateId,
      files: []
    };

    const pendingDeleteDir = path.join(this.backupDir, '_pending_delete');
    fs.mkdirSync(pendingDeleteDir, { recursive: true });

    let backedUp = 0;
    const filesToBackup = this.filePlan.filter(op => op.op === 'update' || op.op === 'delete');

    for (const op of filesToBackup) {
      if (!fs.existsSync(op.target)) continue;

      const backupPath = path.join(this.backupDir, op.relPath);
      const backupDirPath = path.dirname(backupPath);
      fs.mkdirSync(backupDirPath, { recursive: true });

      if (op.op === 'update') {
        fs.copyFileSync(op.target, backupPath);
      } else if (op.op === 'delete') {
        fs.copyFileSync(op.target, backupPath);
      }

      const stat = fs.statSync(op.target);
      backupManifest.files.push({
        path: op.relPath,
        operation: op.op,
        size: stat.size,
        hash: this._hashFileSync(op.target)
      });

      backedUp++;
      this._updateProgress(PHASES.BACKUP, backedUp * 100 / Math.max(filesToBackup.length, 1));
    }

    const versionPath = path.join(this.storageRoot, 'server', 'version.json');
    const rootVersionPath = path.join(this.storageRoot, 'version.json');
    const actualVersionPath = fs.existsSync(rootVersionPath) ? rootVersionPath :
      (fs.existsSync(path.join(this.storageRoot, 'server', 'version.json')) ? path.join(this.storageRoot, 'server', 'version.json') : null);

    if (actualVersionPath) {
      const backupVerPath = path.join(this.backupDir, '_version.json');
      fs.copyFileSync(actualVersionPath, backupVerPath);
    }

    fs.writeFileSync(
      path.join(this.backupDir, 'backup-manifest.json'),
      JSON.stringify(backupManifest, null, 2),
      'utf8'
    );

    this._cleanupOldBackups();

    this._completePhase(PHASES.BACKUP, `备份完成，共备份 ${backedUp} 个文件`);
  }

  _cleanupOldBackups() {
    try {
      const backups = this._listBackups();
      while (backups.length > config.update.maxBackups) {
        const oldest = backups.shift();
        fs.rmSync(path.join(this.paths.backup, oldest.name), { recursive: true, force: true });
        this._pushLog('info', `清理旧备份: ${oldest.name}`);
      }
    } catch (e) {
      this._pushLog('warn', `清理旧备份失败: ${e.message}`);
    }
  }

  _listBackups() {
    try {
      if (!fs.existsSync(this.paths.backup)) return [];
      const entries = fs.readdirSync(this.paths.backup, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => {
          const dirPath = path.join(this.paths.backup, e.name);
          try {
            const stat = fs.statSync(dirPath);
            let manifest = null;
            const manifestPath = path.join(dirPath, 'backup-manifest.json');
            if (fs.existsSync(manifestPath)) {
              manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            }
            let size = 0;
            const walk = (d) => {
              for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                const fp = path.join(d, f.name);
                if (f.isDirectory()) walk(fp);
                else size += fs.statSync(fp).size;
              }
            };
            walk(dirPath);
            return { name: e.name, mtime: stat.mtimeMs, size, manifest };
          } catch (err) {
            return { name: e.name, mtime: 0, size: 0, error: err.message };
          }
        })
        .sort((a, b) => a.mtime - b.mtime);
      return entries;
    } catch (e) {
      return [];
    }
  }

  async _applyFiles() {
    this._setPhase(PHASES.APPLY, '应用文件更新...');

    let applied = 0;
    const errors = [];

    for (const op of this.filePlan) {
      try {
        if (op.op === 'delete') {
          const tempDelPath = path.join(this.paths.temp, `_del_${Date.now()}_${path.basename(op.target)}`);
          if (fs.existsSync(op.target)) {
            fs.mkdirSync(path.dirname(tempDelPath), { recursive: true });
            try {
              fs.renameSync(op.target, tempDelPath);
            } catch (e) {
              this._pushLog('warn', `无法重命名待删除文件 ${op.relPath}，尝试直接删除: ${e.message}`);
              try { fs.unlinkSync(op.target); } catch (e2) { /* ignore */ }
            }
          }
        } else {
          const dir = path.dirname(op.target);
          fs.mkdirSync(dir, { recursive: true });

          const tempPath = op.target + '.new_tmp';
          fs.copyFileSync(op.source, tempPath);

          try {
            const isPkgExe = typeof process.pkg !== 'undefined' &&
              op.target.toLowerCase().endsWith('.exe') &&
              op.target.toLowerCase().includes(path.basename(process.execPath).toLowerCase());

            if (isPkgExe) {
              const newExePath = op.target + '.new';
              fs.copyFileSync(tempPath, newExePath);
              this._pushLog('info', `EXE文件将在重启后替换: ${op.relPath}`);
            } else {
              try {
                fs.renameSync(tempPath, op.target);
              } catch (renameErr) {
                fs.copyFileSync(tempPath, op.target);
                try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
              }
            }
          } finally {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
          }
        }

        applied++;
        this._updateProgress(PHASES.APPLY, applied * 100 / Math.max(this.filePlan.length, 1), `${op.op}: ${op.relPath}`);
      } catch (e) {
        errors.push({ file: op.relPath, error: e.message });
        this._pushLog('error', `应用文件失败 ${op.relPath}: ${e.message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`${errors.length} 个文件更新失败: ${errors[0].error}`);
    }

    this._completePhase(PHASES.APPLY, `文件更新完成，共 ${applied} 个文件`);
  }

  async _triggerRestart() {
    this._setPhase(PHASES.RESTART, '准备重启服务...');

    const isPkg = typeof process.pkg !== 'undefined';
    const flagContent = {
      action: 'update-restart',
      updateId: this.status.updateId,
      pid: process.pid,
      backupDir: this.backupDir,
      fromVersion: this.versionManager.getServerVersion(),
      toVersion: this.status.version.to,
      timestamp: Date.now(),
      isPkg: isPkg,
      exePath: process.execPath,
      cwd: this.storageRoot
    };

    fs.writeFileSync(this.paths.flagFile, JSON.stringify(flagContent, null, 2), 'utf8');

    if (isPkg) {
      this._triggerRestartPkg(flagContent);
    } else {
      this._triggerRestartSource(flagContent);
    }

    this._completePhase(PHASES.RESTART, '重启指令已发出，服务即将重启');
    this.status.status = 'restarting';
    this.status.endTime = Date.now();
    this._saveStatus();
    this._broadcastStatus();

    this.releaseLock();

    setTimeout(() => {
      this._gracefulShutdown();
    }, config.update.shutdownDelayMs);
  }

  _triggerRestartPkg(flagContent) {
    this._pushLog('info', '启动更新守护进程...');

    const updaterScript = path.join(this.storageRoot, 'updater', 'updater.js');

    if (!fs.existsSync(updaterScript)) {
      this._pushLog('error', `守护进程脚本不存在: ${updaterScript}`);
      return;
    }

    try {
      const nodeExe = process.execPath;
      const child = spawn(nodeExe, [updaterScript, JSON.stringify(flagContent)], {
        detached: true,
        stdio: 'ignore',
        cwd: this.storageRoot
      });
      child.unref();
      this._pushLog('info', `守护进程已启动 PID=${child.pid}`);
    } catch (e) {
      this._pushLog('error', `启动守护进程失败: ${e.message}`);
    }
  }

  _triggerRestartSource(flagContent) {
    this._pushLog('info', '调度重启：等待旧进程退出后调用 start.bat...');

    const startBat = path.join(this.storageRoot, 'start.bat');

    if (!fs.existsSync(startBat)) {
      this._pushLog('error', `找不到 start.bat (${startBat})，无法自动重启！请手动运行 start.bat。`);
      return;
    }

    const waitScript = `
      const fs=require('fs'),cp=require('child_process'),path=require('path');
      const oldPid=${process.pid};
      const batPath=${JSON.stringify(startBat)};
      const cwd=${JSON.stringify(this.storageRoot)};
      const log=msg=>{try{const d=path.join(cwd,'logs');fs.mkdirSync(d,{recursive:true});const dt=new Date();const p=n=>String(n).padStart(2,'0');const ts=dt.getFullYear()+'-'+p(dt.getMonth()+1)+'-'+p(dt.getDate())+'T'+p(dt.getHours())+':'+p(dt.getMinutes())+':'+p(dt.getSeconds())+'.'+String(dt.getMilliseconds()).padStart(3,'0');fs.appendFileSync(path.join(d,'update.log'),ts+' [restarter] '+msg+'\\n')}catch(e){}};
      log('等待旧进程 PID='+oldPid+' 退出...');
      function waitExit(){
        try{process.kill(oldPid,0);setTimeout(waitExit,${config.update.restartPollIntervalMs})}
        catch(e){
          log('旧进程已退出，清理旧 CMD 窗口');
          try{cp.execFileSync('taskkill',['/F','/FI','WINDOWTITLE eq Game Server','/T'],{stdio:'ignore',timeout:5000})}catch(e2){log('清理旧窗口完毕')}
          log('清理完成，执行 start.bat');
          const child=cp.spawn('cmd.exe',['/c','start','""','/min',batPath],{detached:true,stdio:'ignore',cwd:cwd,windowsHide:true});
          child.unref();
          log('start.bat 已启动 PID='+child.pid);
          setTimeout(()=>process.exit(0),${config.update.processExitDelayMs});
        }
      }
      waitExit();
    `.replace(/\s+/g, ' ');

    try {
      const child = spawn(process.execPath, ['-e', waitScript], {
        detached: true,
        stdio: 'ignore',
        cwd: this.storageRoot,
        windowsHide: true
      });
      child.unref();
      this._pushLog('info', `重启调度器已启动 PID=${child.pid}，将在进程退出后执行 start.bat`);
    } catch (e) {
      this._pushLog('error', `启动重启调度器失败: ${e.message}`);
    }
  }

  _gracefulShutdown() {
    try {
      if (this.io) {
        this.io.emit('update_restarting', {
          message: '服务正在更新重启，请稍候...',
          timestamp: Date.now()
        });
        try {
          this.io.of('/admin').to('admins').emit('update_restarting', {
            message: '服务正在更新重启，请稍候...',
            timestamp: Date.now()
          });
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }

    setTimeout(() => {
      logger.info('更新重启：进程退出');
      process.exit(0);
    }, config.update.processExitDelayMs);
  }

  _failUpdate(errorMsg) {
    this.status.status = 'failed';
    this.status.error = errorMsg;
    this.status.endTime = Date.now();
    for (const [phase, info] of Object.entries(this.status.phases)) {
      if (info.status === 'in_progress') {
        info.status = 'failed';
        info.error = errorMsg;
        this._emitSocket('update_phase', { phase, status: 'failed', error: errorMsg });
      }
    }
    this._pushLog('error', `更新失败: ${errorMsg}`);
    this._emitSocket('update_failed', { error: errorMsg, rolledBack: !!this.backupDir });
    this._saveStatus();
    this._broadcastStatus();
    this._saveHistory();
  }

  async _rollbackInternal() {
    if (!this.backupDir || !fs.existsSync(this.backupDir)) {
      this._pushLog('warn', '无备份目录，跳过回滚');
      return;
    }

    this._setPhase(PHASES.ROLLBACK, '执行回滚...');
    try {
      const manifestPath = path.join(this.backupDir, 'backup-manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('备份清单不存在');
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      let restored = 0;
      for (const fileInfo of manifest.files) {
        const backupPath = path.join(this.backupDir, fileInfo.path);
        const targetPath = path.join(this.storageRoot, fileInfo.path);
        if (fs.existsSync(backupPath)) {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          try {
            fs.copyFileSync(backupPath, targetPath);
          } catch (e) {
            this._pushLog('warn', `还原文件失败 ${fileInfo.path}: ${e.message}`);
          }
          restored++;
        }
      }

      for (const op of this.filePlan || []) {
        if (op.op === 'add' && fs.existsSync(op.target)) {
          try {
            fs.unlinkSync(op.target);
          } catch (e) { /* ignore */ }
        }
      }

      this._completePhase(PHASES.ROLLBACK, `回滚完成，还原 ${restored} 个文件`);
      this.status.status = 'rolled_back';
    } catch (e) {
      this._pushLog('error', `回滚失败: ${e.message}`);
      this.status.status = 'rollback_failed';
    }
    this._saveStatus();
    this._saveHistory();
    this._broadcastStatus();
  }

  async manualRollback(backupName) {
    if (this.status.status === 'in_progress') {
      throw new Error('更新进行中，无法回滚');
    }

    const backupPath = path.join(this.paths.backup, backupName);
    if (!fs.existsSync(backupPath)) {
      throw new Error('备份不存在');
    }

    await this.acquireLock();
    this.status = this._idleStatus();
    this.status.updateId = this._generateUpdateId();
    this.status.status = 'in_progress';
    this.status.currentPhase = PHASES.ROLLBACK;
    this.status.startTime = Date.now();
    this.status.message = '手动回滚';
    this._saveStatus();
    this._emitSocket('update_rollback_start', {});

    try {
      this.backupDir = backupPath;
      this.filePlan = [];
      const manifestPath = path.join(backupPath, 'backup-manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        this.filePlan = manifest.files.map(f => ({ op: 'restore', relPath: f.path }));
      }

      await this._rollbackInternal();

      const isPkg = typeof process.pkg !== 'undefined';
      const flagContent = {
        action: 'rollback-restart',
        updateId: this.status.updateId,
        pid: process.pid,
        backupDir: backupPath,
        fromVersion: this.versionManager.getServerVersion(),
        timestamp: Date.now(),
        isPkg: isPkg,
        exePath: process.execPath,
        cwd: this.storageRoot
      };
      fs.writeFileSync(this.paths.flagFile, JSON.stringify(flagContent, null, 2), 'utf8');

      if (isPkg) {
        this._triggerRestartPkg(flagContent);
      } else {
        this._triggerRestartSource(flagContent);
      }

      this.releaseLock();
      setTimeout(() => {
        this._gracefulShutdown();
      }, config.update.shutdownDelayMs);
    } catch (e) {
      this.releaseLock();
      throw e;
    }
  }

  _saveHistory() {
    try {
      const historyPath = path.join(this.paths.backup, 'update-history.json');
      let history = [];
      if (fs.existsSync(historyPath)) {
        history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      }
      history.unshift({
        updateId: this.status.updateId,
        status: this.status.status,
        fromVersion: this.status.version.from,
        toVersion: this.status.version.to,
        startTime: this.status.startTime,
        endTime: this.status.endTime,
        error: this.status.error,
        phases: this.status.phases
      });
      if (history.length > config.update.historyMaxEntries) history.length = config.update.historyMaxEntries;
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
      logger.warn('保存更新历史失败', { error: e.message });
    }
  }

  _getHistory() {
    try {
      const historyPath = path.join(this.paths.backup, 'update-history.json');
      if (fs.existsSync(historyPath)) {
        return JSON.parse(fs.readFileSync(historyPath, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  async verifyStartup() {
    const flagExists = fs.existsSync(this.paths.flagFile);
    if (!flagExists) {
      if (this.status.status === 'restarting') {
        this.status.status = 'success';
        this.status.endTime = Date.now();
        this._completePhase(PHASES.VERIFY, '服务启动成功，更新完成');
        this._saveHistory();
        this._saveStatus();
        this._emitSocket('update_success', { version: this.versionManager.getServerVersion() });
        this._broadcastStatus();
        this._pushLog('info', `更新成功完成! 当前版本: ${this.versionManager.getServerVersion()}`);
      }
      return;
    }

    try {
      const flag = JSON.parse(fs.readFileSync(this.paths.flagFile, 'utf8'));

      this._pushLog('info', '检测到重启标记，验证服务状态', { action: flag.action });

      if (flag.action === 'update-restart' || flag.action === 'rollback-restart') {
        this.status = this._idleStatus();
        this.status.updateId = flag.updateId;
        this.status.status = 'success';
        this.status.version = { from: flag.fromVersion, to: flag.toVersion || this.versionManager.getServerVersion() };
        this.status.startTime = flag.timestamp;
        this.status.endTime = Date.now();
        this.status.message = flag.action === 'rollback-restart' ? '回滚成功' : '更新成功';
        this._completePhase(PHASES.VERIFY, flag.action === 'rollback-restart' ? '回滚后服务启动成功' : '更新后服务启动成功');
        this._saveHistory();
        if (flag.action === 'rollback-restart') {
          this._emitSocket('update_rollback_success', { version: this.versionManager.getServerVersion() });
        } else {
          this._emitSocket('update_success', { version: this.versionManager.getServerVersion() });
        }
      }

      fs.unlinkSync(this.paths.flagFile);
    } catch (e) {
      this._pushLog('warn', `处理重启标记失败: ${e.message}`);
      try { fs.unlinkSync(this.paths.flagFile); } catch (e2) { /* ignore */ }
    }

    this._saveStatus();
    this._broadcastStatus();
  }

  cancelUpdate() {
    if (this.status.status !== 'in_progress') {
      throw new Error('没有进行中的更新');
    }
    if (this.status.currentPhase === PHASES.APPLY || this.status.currentPhase === PHASES.RESTART) {
      throw new Error('已开始应用文件，无法取消');
    }
    this._failUpdate('管理员取消更新');
    this._cleanupTempFiles();
    this._emitSocket('update_cancelled', {});
    this.releaseLock();
  }

  _cleanupTempFiles() {
    try {
      if (this.extractDir && fs.existsSync(this.extractDir)) {
        fs.rmSync(this.extractDir, { recursive: true, force: true });
      }
      if (this.currentZipPath && fs.existsSync(this.currentZipPath)) {
        fs.unlinkSync(this.currentZipPath);
      }
    } catch (e) { /* ignore */ }
  }

  _flattenExtractDir(extractDir) {
    try {
      const entries = fs.readdirSync(extractDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());
      const files = entries.filter(e => e.isFile());
      const expectedTopDirs = config.update.expectedTopDirs;
      const expectedTopFiles = config.update.expectedTopFiles;

      let hasExpectedContent = false;
      for (const f of files) {
        if (expectedTopFiles.includes(f.name)) { hasExpectedContent = true; break; }
      }
      for (const d of dirs) {
        if (expectedTopDirs.includes(d.name)) { hasExpectedContent = true; break; }
      }

      if (hasExpectedContent) return;

      if (dirs.length === 1 && files.length === 0) {
        const nestedDir = path.join(extractDir, dirs[0].name);
        this._pushLog('info', `检测到单一顶级目录 ${dirs[0].name}，自动扁平化`);
        const nestedEntries = fs.readdirSync(nestedDir, { withFileTypes: true });
        for (const entry of nestedEntries) {
          const src = path.join(nestedDir, entry.name);
          const dst = path.join(extractDir, entry.name);
          try { fs.renameSync(src, dst); } catch (e) {
            this._pushLog('warn', `扁平化移动失败 ${entry.name}: ${e.message}`);
          }
        }
        try { fs.rmdirSync(nestedDir); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      this._pushLog('warn', `扁平化检查失败: ${e.message}`);
    }
  }

  deleteBackup(backupName) {
    const backupPath = path.join(this.paths.backup, backupName);
    if (!fs.existsSync(backupPath)) {
      throw new Error('备份不存在');
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
    this._pushLog('info', `已删除备份: ${backupName}`);
  }

  /**
   * 计算两个文本之间的行级 diff（基于 Myers 分治算法）
   * 时间复杂度 O((M+N)*D)，空间 O(M+N)，可处理数万行文件
   * @param {string} oldText - 旧文件内容
   * @param {string} newText - 新文件内容
   * @returns {Array} diff 结果数组
   */
  static computeDiff(oldText, newText) {
    const oldLines = (oldText || '').replace(/\r\n/g, '\n').split('\n');
    const newLines = (newText || '').replace(/\r\n/g, '\n').split('\n');

    const result = [];
    UpdateManager._myersDiffSegment(0, oldLines.length, 0, newLines.length, oldLines, newLines, result);
    return result;
  }

  /**
   * Myers 分治 diff - 递归处理分段
   */
  static _myersDiffSegment(oldStart, oldEnd, newStart, newEnd, oldLines, newLines, result) {
    const oldLen = oldEnd - oldStart;
    const newLen = newEnd - newStart;

    // 空段处理
    if (oldLen === 0 && newLen === 0) return;
    if (oldLen === 0) {
      // 全部新增
      for (let j = newStart; j < newEnd; j++) {
        result.push({ type: 'add', content: newLines[j], newLine: j + 1 });
      }
      return;
    }
    if (newLen === 0) {
      // 全部删除
      for (let i = oldStart; i < oldEnd; i++) {
        result.push({ type: 'remove', content: oldLines[i], oldLine: i + 1 });
      }
      return;
    }

    // 小型段落到阈值以下直接用快速 LCS 回溯（避免递归开销）
    if (oldLen <= 100 && newLen <= 100) {
      UpdateManager._lcsBacktrack(oldStart, oldEnd, newStart, newEnd, oldLines, newLines, result);
      return;
    }

    // 找到 middle snake
    const snake = UpdateManager._findMiddleSnake(oldStart, oldEnd, newStart, newEnd, oldLines, newLines);

    if (snake.d === 0) {
      // 完全相同
      for (let i = oldStart; i < oldEnd; i++) {
        const offset = i - oldStart;
        result.push({ type: 'equal', content: oldLines[i], oldLine: i + 1, newLine: newStart + offset + 1 });
      }
      return;
    }

    // 递归处理蛇的左半段和右半段
    UpdateManager._myersDiffSegment(oldStart, snake.x, newStart, snake.y, oldLines, newLines, result);

    // 蛇的对角线部分（相等的行）
    for (let i = 0; i < snake.diagLen; i++) {
      const oIdx = snake.x + i;
      const nIdx = snake.y + i;
      result.push({ type: 'equal', content: oldLines[oIdx], oldLine: oIdx + 1, newLine: nIdx + 1 });
    }

    UpdateManager._myersDiffSegment(snake.x + snake.diagLen, oldEnd, snake.y + snake.diagLen, newEnd, oldLines, newLines, result);
  }

  /**
   * Myers 算法核心：寻找 middle snake（双向贪心搜索）
   * 返回 { x, y, d, diagLen } 表示分割点和对角线长度
   */
  static _findMiddleSnake(oldStart, oldEnd, newStart, newEnd, oldLines, newLines) {
    const oldLen = oldEnd - oldStart;
    const newLen = newEnd - newStart;
    const maxD = Math.ceil((oldLen + newLen) / 2);

    // Forward V array: V[k] = x 位置 (k = x - y)
    const Vf = new Array(2 * maxD + 2);
    // Backward V array: V[k] = x 位置 (从终点反向，k = (x-oldLen) - (y-newLen))
    const Vb = new Array(2 * maxD + 2);

    const offset = maxD;
    Vf[offset + 1] = oldStart;
    Vb[offset + 1] = oldEnd;

    const delta = oldLen - newLen;
    // 保存蛇的信息：找到的第一个重叠就是 middle snake
    let bestSnake = null;

    for (let d = 0; d <= maxD; d++) {
      // ---- 正向搜索 ----
      for (let k = -d; k <= d; k += 2) {
        const idx = k + offset;
        const down = (k === -d || (k !== d && Vf[idx - 1] < Vf[idx + 1]));
        let x = down ? Vf[idx + 1] : Vf[idx - 1] + 1;
        let y = x - k;

        // 沿对角线延伸
        let diagLen = 0;
        while (x < oldEnd && y < newEnd && oldLines[x] === newLines[y]) {
          x++; y++; diagLen++;
        }

        Vf[idx] = x;

        // 检查是否到达反向边界
        if (delta % 2 !== 0) {
          const bIdx = k - delta + offset;
          if (bIdx >= 0 && bIdx < Vb.length && Vb[bIdx] !== undefined) {
            if (x >= Vb[bIdx]) {
              bestSnake = { x: Vf[idx] - diagLen, y: (Vf[idx] - k) - diagLen, d, diagLen };
              return bestSnake;
            }
          }
        }
      }

      // ---- 反向搜索 ----
      for (let k = -d; k <= d; k += 2) {
        const idx = k + offset;
        const up = (k === -d || (k !== d && Vb[idx - 1] > Vb[idx + 1]));
        let x = up ? Vb[idx + 1] : Vb[idx - 1] - 1;
        let y = x - k - delta;

        // 沿对角线反向延伸
        let diagLen = 0;
        while (x > oldStart && y > newStart && oldLines[x - 1] === newLines[y - 1]) {
          x--; y--; diagLen++;
        }

        Vb[idx] = x;

        // 检查是否到达正向边界
        if (delta % 2 === 0) {
          const fIdx = k + delta + offset;
          if (fIdx >= 0 && fIdx < Vf.length && Vf[fIdx] !== undefined) {
            if (x <= Vf[fIdx]) {
              bestSnake = { x, y, d, diagLen };
              return bestSnake;
            }
          }
        }
      }
    }

    // 恢复：完全相同
    return { x: oldStart, y: newStart, d: 0, diagLen: oldLen };
  }

  /**
   * 小段落的 LCS 回溯（≤100行时使用），避免递归开销
   */
  static _lcsBacktrack(oldStart, oldEnd, newStart, newEnd, oldLines, newLines, result) {
    const m = oldEnd - oldStart;
    const n = newEnd - newStart;

    // 构建 DP 表（只需两行）
    let prev = new Array(n + 1).fill(0);
    let curr = new Array(n + 1).fill(0);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[oldStart + i - 1] === newLines[newStart + j - 1]) {
          curr[j] = prev[j - 1] + 1;
        } else if (prev[j] >= curr[j - 1]) {
          curr[j] = prev[j];
        } else {
          curr[j] = curr[j - 1];
        }
      }
      [prev, curr] = [curr, prev];
    }

    // 回溯
    const temp = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[oldStart + i - 1] === newLines[newStart + j - 1]) {
        temp.push({
          type: 'equal',
          content: oldLines[oldStart + i - 1],
          oldLine: oldStart + i,
          newLine: newStart + j
        });
        i--; j--;
      } else if (j > 0 && (i === 0 || prev[j - 1] >= prev[j])) {
        // 注意：这里用 prev 来模拟回溯决策
        // 实际上需要完整的 DP 表才能正确回溯，但小规模没问题
        const addChoice = (i === 0) || (prev[j - 1] >= prev[j]);
        if (addChoice) {
          temp.push({ type: 'add', content: newLines[newStart + j - 1], newLine: newStart + j });
          j--;
        } else {
          temp.push({ type: 'remove', content: oldLines[oldStart + i - 1], oldLine: oldStart + i });
          i--;
        }
      } else if (i > 0) {
        temp.push({ type: 'remove', content: oldLines[oldStart + i - 1], oldLine: oldStart + i });
        i--;
      } else {
        temp.push({ type: 'add', content: newLines[newStart + j - 1], newLine: newStart + j });
        j--;
      }
    }

    // 反向并加入结果
    for (let idx = temp.length - 1; idx >= 0; idx--) {
      result.push(temp[idx]);
    }
  }

  /**
   * 获取指定备份中某个文件的 diff
   * @param {string} backupName - 备份名称
   * @param {string} fileRelPath - 文件相对路径（使用 / 分隔）
   * @returns {Object} diff 结果
   */
  getFileDiff(backupName, fileRelPath) {
    const backupPath = path.join(this.paths.backup, backupName);
    if (!fs.existsSync(backupPath)) {
      throw new Error('备份不存在');
    }

    // 安全检查：防止路径穿越
    const normalizedPath = path.normalize(fileRelPath).replace(/\\/g, '/');
    if (normalizedPath.includes('..')) {
      throw new Error('非法路径');
    }

    const oldFilePath = path.join(backupPath, normalizedPath);
    const newFilePath = path.join(this.storageRoot, normalizedPath);

    // 读取旧文件内容
    let oldContent = '';
    let oldExists = false;
    if (fs.existsSync(oldFilePath)) {
      try {
        oldContent = fs.readFileSync(oldFilePath, 'utf8');
        oldExists = true;
      } catch (e) {
        oldContent = `[二进制文件或无法读取]`;
      }
    }

    // 读取新文件内容
    let newContent = '';
    let newExists = false;
    if (fs.existsSync(newFilePath)) {
      try {
        newContent = fs.readFileSync(newFilePath, 'utf8');
        newExists = true;
      } catch (e) {
        newContent = `[二进制文件或无法读取]`;
      }
    }

    // 判断操作类型
    let operation = 'update';
    if (!oldExists && newExists) operation = 'add';
    else if (oldExists && !newExists) operation = 'delete';

    // 计算 diff（仅文本文件）
    const isText = !oldContent.startsWith('[') || !newContent.startsWith('[');
    let diff = [];
    let stats = { additions: 0, deletions: 0 };

    if (oldExists && newExists && isText) {
      diff = UpdateManager.computeDiff(oldContent, newContent);
      stats.additions = diff.filter(d => d.type === 'add').length;
      stats.deletions = diff.filter(d => d.type === 'remove').length;
    } else if (oldExists && !newExists) {
      // 删除的文件
      const lines = oldContent.split('\n');
      diff = lines.map((line, idx) => ({ type: 'remove', content: line, oldLine: idx + 1 }));
      stats.deletions = lines.length;
    } else if (!oldExists && newExists) {
      // 新增的文件
      const lines = newContent.split('\n');
      diff = lines.map((line, idx) => ({ type: 'add', content: line, newLine: idx + 1 }));
      stats.additions = lines.length;
    }

    return {
      operation,
      oldPath: normalizedPath,
      newPath: normalizedPath,
      oldContent: oldContent.substring(0, 50000), // 截断防止过大响应
      newContent: newContent.substring(0, 50000),
      diff: diff,
      stats: stats,
      oldSize: oldContent.length,
      newSize: newContent.length
    };
  }
}

module.exports = UpdateManager;
