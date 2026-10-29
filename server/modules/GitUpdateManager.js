// GitUpdateManager.js - 基于 Git 的自动更新
// 从远端仓库获取最新提交，用 `git archive`（或 GitHub 源码包）自动生成更新包，
// 再交给 UpdateManager 走已有的 校验 -> 解压 -> 差异 -> 备份 -> 应用 -> 重启 流程。
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

class GitUpdateManager {
  constructor(updateManager) {
    this.updateManager = updateManager;
    this.versionManager = updateManager.versionManager;
    this.storageRoot = updateManager.storageRoot;

    this._cache = null;
    this._checkPromise = null;
    this._applying = false;
    this._gitRetryAt = 0; // git 直连失败后的冷却截止时间，避免每次检查都卡满超时

    // 回滚（手动或失败自动回滚）后清除已部署提交记录，下次检查会重新提示可更新
    this.updateManager.onRollback = () => {
      this._writeState({});
      this._cache = null;
    };
  }

  get cfg() {
    return config.update.git;
  }

  get statePath() {
    return path.join(this.storageRoot, this.cfg.stateFile);
  }

  // ==================== 已部署提交状态 ====================

  _readState() {
    try {
      if (fs.existsSync(this.statePath)) {
        // 去掉 BOM（用记事本/PowerShell 手动保存会带上），否则 JSON.parse 失败会被当成“首次同步”
        const raw = fs.readFileSync(this.statePath, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') return data;
      }
    } catch (e) {
      logger.warn('读取 Git 更新状态失败', { error: e.message });
    }
    return {};
  }

  _writeState(state) {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (e) {
      logger.warn('保存 Git 更新状态失败', { error: e.message });
    }
  }

  // ==================== Git 命令封装 ====================

  _git(args, timeoutMs) {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: this.storageRoot,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
      }, (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || '').trim() || err.message;
          return reject(new Error(detail));
        }
        resolve(String(stdout || '').trim());
      });
    });
  }

  _hasGitRepo() {
    return fs.existsSync(path.join(this.storageRoot, '.git'));
  }

  async _countCommits(range) {
    try {
      const out = await this._git(['rev-list', '--count', range], this.cfg.checkTimeoutMs);
      const n = Number(out);
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }

  // ==================== 远端信息获取 ====================

  _httpHeaders(json = true) {
    const headers = { 'User-Agent': 'game-server-updater' };
    if (json) headers.Accept = 'application/vnd.github+json';
    if (this.cfg.token) headers.Authorization = `Bearer ${this.cfg.token}`;
    return headers;
  }

  async _fetchJson(url, timeoutMs) {
    const res = await fetch(url, {
      headers: this._httpHeaders(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
  }

  async _fetchBuffer(url, timeoutMs) {
    const res = await fetch(url, {
      headers: this._httpHeaders(false),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async _checkViaGit() {
    const cfg = this.cfg;
    await this._git(['fetch', cfg.remote, cfg.branch, '--quiet'], cfg.checkTimeoutMs);

    const sha = await this._git(['rev-parse', 'FETCH_HEAD'], cfg.checkTimeoutMs);
    const versionRaw = await this._git(['show', `${sha}:server/version.json`], cfg.checkTimeoutMs);
    const versionData = JSON.parse(versionRaw);

    const head = await this._git(['rev-parse', 'HEAD'], cfg.checkTimeoutMs).catch(() => '');
    const logLine = await this._git(
      ['log', '-1', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI', sha],
      cfg.checkTimeoutMs
    ).catch(() => '');
    const [logSha, shortSha, subject, author, date] = logLine.split('\x1f');

    return {
      source: 'git',
      sha: logSha || sha,
      shortCommit: shortSha || sha.slice(0, 7),
      subject: subject || '',
      author: author || '',
      date: date || '',
      versionData,
      head: head || ''
    };
  }

  async _checkViaGithub() {
    const cfg = this.cfg;
    const repoApi = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}`;
    const commit = await this._fetchJson(
      `${repoApi}/commits/${encodeURIComponent(cfg.branch)}`,
      cfg.checkTimeoutMs
    );

    const sha = commit.sha;
    const versionData = await this._fetchJson(
      `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${sha}/server/version.json`,
      cfg.checkTimeoutMs
    );

    return {
      source: 'github',
      sha,
      shortCommit: String(sha).slice(0, 7),
      subject: String((commit.commit && commit.commit.message) || '').split('\n')[0],
      author: (commit.commit && commit.commit.author && commit.commit.author.name) || '',
      date: (commit.commit && commit.commit.committer && commit.commit.committer.date) || '',
      versionData,
      head: ''
    };
  }

  _buildOf(versionStr) {
    const parts = String(versionStr || '').split('.');
    const n = Number(parts[3]);
    return Number.isFinite(n) ? n : 0;
  }

  async _doCheck() {
    const localVersion = this.versionManager.getServerVersion();
    const localBuild = this._buildOf(localVersion);
    const state = this._readState();
    const errors = [];

    let remote = null;
    if (this._hasGitRepo() && Date.now() >= this._gitRetryAt) {
      try {
        remote = await this._checkViaGit();
        this._gitRetryAt = 0;
      } catch (e) {
        errors.push(`git: ${e.message}`);
        // github.com 直连不通（国内网络常见）时，每次检查都会卡满超时，
        // 失败后冷却一段时间直接走 GitHub API，避免管理页长时间等待
        this._gitRetryAt = Date.now() + 5 * 60 * 1000;
        logger.warn('Git 方式检查更新失败，尝试 GitHub API', { error: e.message });
      }
    }
    if (!remote) {
      try {
        remote = await this._checkViaGithub();
      } catch (e) {
        errors.push(`github: ${e.message}`);
      }
    }
    if (!remote) {
      throw new Error(`无法获取远端版本: ${errors.join('; ') || '未知错误'}`);
    }

    const remoteVersion = `${remote.versionData.major}.${remote.versionData.minor}.${remote.versionData.patch}.${remote.versionData.build}`;
    const remoteBuild = this._buildOf(remoteVersion);

    // 取本地 HEAD：有已部署记录时以记录为准，没有记录时用本地 HEAD 兜底
    let localHead = remote.head;
    if (!localHead && this._hasGitRepo()) {
      try {
        localHead = await this._git(['rev-parse', 'HEAD'], this.cfg.checkTimeoutMs);
      } catch (e) {
        localHead = '';
        logger.warn('读取本地 Git HEAD 失败，改为只按版本号判断', { error: e.message });
      }
    }
    const appliedCommit = state.commit || localHead || null;
    let behind = null;
    let ahead = null;
    if (remote.source === 'git' && appliedCommit) {
      behind = await this._countCommits(`${appliedCommit}..${remote.sha}`);
      ahead = await this._countCommits(`${remote.sha}..${appliedCommit}`);
    }

    let updateAvailable = false;
    let reason = '';
    if (appliedCommit && appliedCommit === remote.sha) {
      reason = '已是最新提交';
    } else if (behind !== null) {
      // Git 直连可用时以提交数判断（最准确）
      if (ahead !== null && ahead > 0) {
        reason = '本地提交领先或已分叉，暂不自动更新';
      } else if (behind > 0) {
        updateAvailable = true;
        reason = `落后远端 ${behind} 个提交`;
      } else {
        reason = '已是最新提交';
      }
    } else if (remoteBuild > localBuild) {
      // 回退到 GitHub API 时只剩版本号可比，版本号更高才提示更新
      updateAvailable = true;
      reason = `远端版本更高（${remoteVersion} > ${localVersion}）`;
    } else if (remoteBuild < localBuild) {
      reason = `本地版本更高（${localVersion}），不自动更新`;
    } else {
      reason = '版本号一致，已是最新';
    }

    return {
      enabled: true,
      source: remote.source,
      mode: typeof process.pkg !== 'undefined' ? 'pkg' : 'source',
      checkedAt: Date.now(),
      local: {
        version: localVersion,
        build: localBuild,
        head: localHead ? localHead.slice(0, 7) : null,
        appliedCommit: appliedCommit ? appliedCommit.slice(0, 7) : null
      },
      remote: {
        version: remoteVersion,
        build: remoteBuild,
        commit: remote.sha,
        shortCommit: remote.shortCommit,
        message: remote.subject,
        author: remote.author,
        date: remote.date,
        url: `https://github.com/${this.cfg.owner}/${this.cfg.repo}/commit/${remote.sha}`
      },
      behind,
      ahead,
      updateAvailable,
      reason,
      errors
    };
  }

  /**
   * 检查远端是否有新提交。
   * force=true 时忽略缓存（管理页手动点击“检查更新”）。
   */
  async check(force = false) {
    if (!this.cfg.enabled) {
      throw new Error('Git 自动更新未启用');
    }
    if (!force && this._cache && Date.now() - this._cache.checkedAt < this.cfg.cacheTtlMs) {
      return this._cache;
    }
    if (this._checkPromise) return this._checkPromise;

    this._checkPromise = this._doCheck()
      .then(result => {
        this._cache = result;
        return result;
      })
      .finally(() => {
        this._checkPromise = null;
      });
    return this._checkPromise;
  }

  // ==================== 更新包生成与执行 ====================

  async _downloadPackage(info) {
    const cfg = this.cfg;
    // 提交哈希来自远端响应，先校验格式再拼进 git 参数/下载地址，防止被当作选项或注入路径
    if (!/^[0-9a-f]{40}$/.test(String(info.remote.commit || ''))) {
      throw new Error(`非法的远端提交: ${info.remote.commit}`);
    }
    const uploadDir = this.updateManager.paths.upload;
    fs.mkdirSync(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, `git_${Date.now()}_${info.remote.shortCommit}.zip`);

    try {
      if (info.source === 'git') {
        logger.info('使用 git archive 生成更新包', { commit: info.remote.commit });
        await this._git(
          ['archive', '--format=zip', `--output=${filePath}`, info.remote.commit],
          cfg.downloadTimeoutMs
        );
      } else {
        logger.info('从 GitHub 下载源码包', { commit: info.remote.commit });
        // 配置了 token 时走 API zipball（私有仓库也可用），否则用公开的 codeload
        const codeloadUrl = `https://codeload.github.com/${cfg.owner}/${cfg.repo}/zip/${info.remote.commit}`;
        let buffer;
        if (cfg.token) {
          try {
            buffer = await this._fetchBuffer(
              `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/zipball/${info.remote.commit}`,
              cfg.downloadTimeoutMs
            );
          } catch (e) {
            // token 失效/权限不足时，公开仓库仍可通过 codeload 下载
            logger.warn('API 下载更新包失败，回退 codeload', { error: e.message });
            buffer = await this._fetchBuffer(codeloadUrl, cfg.downloadTimeoutMs);
          }
        } else {
          buffer = await this._fetchBuffer(codeloadUrl, cfg.downloadTimeoutMs);
        }
        fs.writeFileSync(filePath, buffer);
      }

      const stat = fs.statSync(filePath);
      if (stat.size > config.update.maxUploadSize) {
        throw new Error(`更新包过大: ${stat.size} > ${config.update.maxUploadSize}`);
      }

      const head = Buffer.alloc(4);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, head, 0, 4, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (head[0] !== 0x50 || head[1] !== 0x4B || head[2] !== 0x03 || head[3] !== 0x04) {
        throw new Error('生成的更新包不是有效的ZIP文件');
      }

      this.updateManager.currentZipPath = filePath;
      return filePath;
    } catch (err) {
      // 失败时清理残留的半个包，避免 update/uploads 堆积
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      throw err;
    }
  }

  /**
   * 检查并直接执行一次 Git 自动更新（生成包 -> 复用 UpdateManager 流程）。
   */
  async apply() {
    if (!config.update.enabled || !this.cfg.enabled) {
      throw new Error('Git 自动更新未启用');
    }
    if (typeof process.pkg !== 'undefined') {
      throw new Error('当前为 EXE 打包运行，Git 自动更新仅支持源码运行模式');
    }
    if (this._applying) {
      throw new Error('正在准备自动更新，请稍候');
    }
    if (this.updateManager.status && this.updateManager.status.status === 'in_progress') {
      throw new Error('已有更新正在进行中');
    }

    this._applying = true;
    try {
      const info = await this.check(true);
      if (!info.updateAvailable) {
        throw new Error(info.reason || '已是最新版本');
      }

      const zipPath = await this._downloadPackage(info);
      const previousState = this._readState();
      const nextState = {
        commit: info.remote.commit,
        build: info.remote.build,
        version: info.remote.version,
        source: info.source,
        appliedAt: Date.now()
      };

      this.updateManager.startUpdate(zipPath, {
        onApplied: () => {
          this._writeState(nextState);
          this._cache = null;
          logger.info('Git 自动更新已记录部署提交', {
            commit: info.remote.shortCommit,
            version: info.remote.version
          });
        }
      }).catch(err => {
        logger.error('Git 自动更新执行失败', { error: err.message });
        this._writeState(previousState);
        this._cache = null;
      });

      return {
        version: info.remote.version,
        commit: info.remote.commit,
        shortCommit: info.remote.shortCommit,
        fromVersion: info.local.version
      };
    } finally {
      this._applying = false;
    }
  }
}

module.exports = GitUpdateManager;
