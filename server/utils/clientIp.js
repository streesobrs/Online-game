// 解析客户端真实 IP（兼容 Nginx 等反向代理）
const config = require('../config');

function getClientIp(socket) {
  const handshake = (socket && socket.handshake) || {};
  const headers = handshake.headers || {};

  // 只有显式开启 trustProxy 时才采信代理头，否则一律以 TCP 对端地址为准，
  // 避免客户端自行伪造 X-Forwarded-For 污染登录记录
  let raw = '';
  if (config.server.trustProxy) {
    const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    raw = forwarded || headers['x-real-ip'] || '';
  }
  if (!raw) {
    raw = handshake.address
      || (socket && socket.conn && socket.conn.remoteAddress)
      || '';
  }
  return String(raw).replace(/^::ffff:/, '') || '未知';
}

module.exports = { getClientIp };
