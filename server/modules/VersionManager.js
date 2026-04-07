// VersionManager.js - 版本管理模块
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class VersionManager {
    constructor() {
        // 加载版本配置
        this.versionConfig = this.loadVersionConfig();
        // 构建完整版本号
        this.serverVersion = this.buildVersionString();
    }

    // 加载版本配置
    loadVersionConfig() {
        const versionConfigPath = path.join(__dirname, '..', 'version.json');
        try {
            if (fs.existsSync(versionConfigPath)) {
                const data = fs.readFileSync(versionConfigPath, 'utf8');
                return JSON.parse(data);
            } else {
                // 默认配置
                return {
                    major: 1,
                    minor: 3,
                    patch: 0,
                    build: 100
                };
            }
        } catch (err) {
            logger.error('加载版本配置失败', { error: err.message });
            return {
                major: 1,
                minor: 3,
                patch: 0,
                build: 1780
            };
        }
    }

    // 保存版本配置
    saveVersionConfig() {
        const versionConfigPath = path.join(__dirname, '..', 'version.json');
        try {
            fs.writeFileSync(versionConfigPath, JSON.stringify(this.versionConfig, null, 2), 'utf8');
        } catch (err) {
            logger.error('保存版本配置失败', { error: err.message });
        }
    }

    // 增加构建版本号
    incrementBuild() {
        this.versionConfig.build += 1;
        this.saveVersionConfig();
        this.serverVersion = this.buildVersionString();
        return this.serverVersion;
    }

    // 构建版本字符串
    buildVersionString() {
        const { major, minor, patch, build } = this.versionConfig;
        return `${major}.${minor}.${patch}.${build}`;
    }

    // 获取对外显示的版本号（不含构建号）
    getDisplayVersion() {
        const { major, minor, patch } = this.versionConfig;
        return `${major}.${minor}.${patch}`;
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

    // 更新版本号（手动更新）
    updateVersion(major, minor, patch) {
        this.versionConfig.major = major || this.versionConfig.major;
        this.versionConfig.minor = minor || this.versionConfig.minor;
        this.versionConfig.patch = patch || this.versionConfig.patch;
        this.saveVersionConfig();
        this.serverVersion = this.buildVersionString();
        return this.serverVersion;
    }
}

module.exports = VersionManager;