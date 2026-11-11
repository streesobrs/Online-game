// 解析客户端真实 IP（兼容 Nginx 等反向代理）
function getClientIp(socket) {
  const handshake = (socket && socket.handshake) || {};
  const headers = handshake.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded
    || headers['x-real-ip']
    || handshake.address
    || (socket && socket.conn && socket.conn.remoteAddress)
    || '';
  return String(raw).replace(/^::ffff:/, '') || '未知';
}

module.exports = { getClientIp };
