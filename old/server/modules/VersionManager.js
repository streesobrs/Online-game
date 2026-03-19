// VersionManager.js - 版本管理模块
const config = require('../config');
const logger = require('../utils/logger');

class VersionManager {
    constructor() {
        this.serverVersion = config.version || '1.0.0';
    }

    // 解析版本号
    parseVersion(versionStr) {
        const parts = versionStr.split('.').map(Number);
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0
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
}

module.exports = VersionManager;