// 会话 Token 的签发与校验
// 安全要点：
//   1. 使用 HMAC-SHA256 签名，客户端无法伪造账号 ID；
//   2. 签名密钥来自 SESSION_SECRET 环境变量，未配置时自动生成并落盘到 data/system/session.key，
//      重启后已登录用户不会被强制下线；
//   3. 校验使用 timingSafeEqual，避免时序侧信道；
//   4. 保留原有的 7 天有效期语义（config.security.sessionTokenExpiry）。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

const TOKEN_PREFIX = 'v2';
const TOKEN_MAX_LENGTH = 512;
const SECRET_MIN_LENGTH = 32;
const CLOCK_SKEW_MS = 5 * 60 * 1000; // 允许 5 分钟时钟偏差

let cachedSecret = null;

function getSecretFilePath() {
  return path.join(config.paths.data, 'system', 'session.key');
}

function readSecretFromFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const value = fs.readFileSync(filePath, 'utf8').trim();
    return value.length >= SECRET_MIN_LENGTH ? value : null;
  } catch (err) {
    logger.warn('读取会话密钥失败', { error: err.message });
    return null;
  }
}

function persistSecret(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (err) {
    logger.warn('会话密钥无法落盘，重启后所有登录状态将失效', { error: err.message });
    return false;
  }
}

function getSecret() {
  if (cachedSecret) return cachedSecret;

  const fromEnv = String(process.env.SESSION_SECRET || '').trim();
  if (fromEnv.length >= SECRET_MIN_LENGTH) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  if (fromEnv) {
    logger.warn('SESSION_SECRET 过短，已忽略（至少需要 32 个字符）');
  }

  const filePath = getSecretFilePath();
  const fromFile = readSecretFromFile(filePath);
  if (fromFile) {
    cachedSecret = fromFile;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(48).toString('hex');
  if (persistSecret(filePath, generated)) {
    logger.info('已生成新的会话签名密钥', { path: filePath });
  } else {
    logger.warn('使用临时会话签名密钥，重启后需要重新登录');
  }
  cachedSecret = generated;
  return cachedSecret;
}

function signPayload(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/**
 * 签发会话 Token
 * @param {string} accountId 账号 ID
 * @returns {string} v2.<base64url(payload)>.<hmac>
 */
function signSessionToken(accountId) {
  if (!accountId) throw new Error('账号ID不能为空');
  const payload = `${accountId}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`;
  const body = Buffer.from(payload, 'utf8').toString('base64url');
  return `${TOKEN_PREFIX}.${body}.${signPayload(body)}`;
}

/**
 * 校验会话 Token
 * @param {string} token
 * @returns {string|null} 校验通过时返回 accountId，否则返回 null
 */
function verifySessionToken(token) {
  try {
    if (typeof token !== 'string' || !token || token.length > TOKEN_MAX_LENGTH) return null;

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;

    const [, body, mac] = parts;
    if (!body || !mac) return null;

    const expected = signPayload(body);
    const actualBuf = Buffer.from(mac);
    const expectedBuf = Buffer.from(expected);
    if (actualBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;

    const payload = Buffer.from(body, 'base64url').toString('utf8');
    const [accountId, timestamp] = payload.split('|');
    if (!accountId || !/^[A-Za-z0-9_-]{4,64}$/.test(accountId)) return null;

    const issuedAt = Number(timestamp);
    if (!Number.isFinite(issuedAt)) return null;

    const age = Date.now() - issuedAt;
    if (age < -CLOCK_SKEW_MS) return null;
    if (age > config.security.sessionTokenExpiry) return null;

    return accountId;
  } catch (err) {
    logger.warn('校验会话Token失败', { error: err.message });
    return null;
  }
}

module.exports = {
  signSessionToken,
  verifySessionToken,
  // 仅用于测试：清空内存中的密钥缓存
  _resetSecretCache: () => { cachedSecret = null; }
};
