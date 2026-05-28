/**
 * 共享常量：钱包登录签名消息格式（前后端共用）。
 * 版本化以支持未来格式变更。
 * 兼容 CJS (Node require) 和 ESM (Vite import)。
 */

const LOGIN_MESSAGE_VERSION = 2;

/**
 * 构造登录签名原文。
 * @param {string} walletAddress - 钱包地址
 * @param {number} timestamp - 时间戳
 * @param {string} nonce - 服务端下发的一次性 nonce
 */
function createLoginMessage(walletAddress, timestamp, nonce = '') {
  const addr = String(walletAddress || '').trim().toLowerCase();
  return [
    `CCL Housing Login v${LOGIN_MESSAGE_VERSION}`,
    `wallet:0x${addr.replace(/^0x/, '')}`,
    `timestamp:${timestamp}`,
    `nonce:${String(nonce)}`,
  ].join('\n');
}

// CJS / ESM 双导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLoginMessage, LOGIN_MESSAGE_VERSION };
}
export { createLoginMessage, LOGIN_MESSAGE_VERSION };
