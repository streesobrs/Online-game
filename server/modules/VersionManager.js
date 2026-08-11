// VersionManager.js - 版本管理模块
// 版本数据源：server/version.json（通过 config 模块统一加载）
const config = require('../config');
const logger = require('../utils/logger');

class VersionManager {
    constructor() {
        // 从 config 获取版本数据（唯一数据源）
        this.reload();
    }

    // 从 config 重新加载版本数据
    reload() {
        const internals = config._versionInternals;
        if (internals) {
            internals.reload();
        }
        this.versionConfig = config.versionData;
        this.serverVersion = config.versionData.version;
    }

    // 获取 version.json 的存储路径（兼容开发和打包环境）
    // 仅供外部需要时使用，内部应通过 config 访问
    getVersionConfigPath() {
        return config._versionInternals.getVersionJsonPath();
    }

    // 保存版本配置（代理到 config）
    saveVersionConfig() {
        // 版本变更通过 config._versionInternals 处理
        // 此方法保留以兼容旧调用方
    }

    // 增加构建版本号
    incrementBuild() {
        const newVersion = config._versionInternals.incrementBuild();
        this.serverVersion = newVersion;
        this.versionConfig = config.versionData;
        logger.info('构建版本号已增加', { newVersion });
        return newVersion;
    }

    // 构建版本字符串
    buildVersionString() {
        return this.serverVersion;
    }

    // 获取对外显示的版本号（不含构建号）
    getDisplayVersion() {
        return config.versionData.displayVersion;
    }

    // 解析版本号
    parseVersion(versionStr) {
        const parts = versionStr.split('.').map(Number);
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0,
            build: parts[3] || 0
        };
    }

    // 检查版本兼容性
    checkCompatibility(clientVersion) {
        try {
            const server = this.parseVersion(this.serverVersion);
            const client = this.parseVersion(clientVersion);

            // 主版本不同则不兼容
            if (server.major !== client.major) {
                return {
                    compatible: false,
                    reason: `主版本不兼容，服务端版本: ${this.serverVersion}，客户端版本: ${clientVersion}`
                };
            }

            // 次版本和修订版本不同则兼容但有警告
            let warning = null;
            if (server.minor > client.minor) {
                warning = `服务端版本较新 (${this.serverVersion})，建议升级客户端以获得完整功能`;
            } else if (client.minor > server.minor) {
                warning = `客户端版本较新 (${clientVersion})，部分功能可能不可用`;
            }

            return {
                compatible: true,
                serverVersion: this.serverVersion,
                clientVersion: clientVersion,
                warning
            };
        } catch (err) {
            logger.error('版本检查失败', { error: err.message, clientVersion });
            return {
                compatible: false,
                reason: '版本格式无效'
            };
        }
    }

    // 获取服务端版本
    getServerVersion() {
        return this.serverVersion;
    }

    // 获取完整版本数据
    getVersionData() {
        return config.versionData;
    }

    // 更新版本号（手动更新）
    updateVersion(major, minor, patch) {
        const newVersion = config._versionInternals.updateVersion(major, minor, patch);
        this.serverVersion = newVersion;
        this.versionConfig = config.versionData;
        logger.info('版本号已更新', { newVersion });
        return newVersion;
    }
}

module.exports = VersionManager;
