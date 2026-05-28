/**
 * 文件说明：日志工具。
 * 将关键错误写入 logs 目录下的 JSONL 文件，方便排查问题。
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');
const NETWORK_LOG_DIR = path.join(LOG_DIR, 'networks');
const COMMON_LOG_DIR = path.join(LOG_DIR, 'common');
const USER_LOG_FILE = path.join(COMMON_LOG_DIR, 'user-event.log');

// 函数 0: 解析网络键（sepolia/local）。
function resolveNetworkKey(detail = {}) {
  const fromPreferred = String(detail.preferredNetwork || detail.network || '').trim().toLowerCase();
  if (fromPreferred === 'local' || fromPreferred === 'sepolia') return fromPreferred;

  const chainId = String(detail.chainId || '').trim().toLowerCase();
  if (chainId === '31337' || chainId === '0x7a69') return 'local';
  if (chainId === '11155111' || chainId === '0xaa36a7') return 'sepolia';

  const envChain = String(process.env.CHAIN_ENV || 'sepolia').trim().toLowerCase();
  return envChain === 'local' ? 'local' : 'sepolia';
}

// 函数 0-1: 构建按网络目录拆分的日志文件路径。
function getNetworkLogFile(baseName, networkKey) {
  return path.join(NETWORK_LOG_DIR, networkKey, `${baseName}.log`);
}

// 函数 1: 确保日志目录存在。
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 函数 2: 以 JSON 行格式写入日志文件。
function writeJsonLine(filePath, payload) {
  try {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    // 日志写入失败时仅静默降级，避免污染控制台。
  }
}

// 函数 3: 生成北京时间字符串（用于展示）。
function formatCnTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

// 函数 4: 记录签署流程日志。
function logSignFlow(stage, detail = {}) {
  const now = new Date();
  const networkKey = resolveNetworkKey(detail);
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    network: networkKey,
    stage,
    ...detail,
  };
  writeJsonLine(getNetworkLogFile('sign-flow-error', networkKey), payload);
}

// 函数 5: 记录房源相关错误日志。
function logListingError(stage, detail = {}) {
  const now = new Date();
  const networkKey = resolveNetworkKey(detail);
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    network: networkKey,
    stage,
    ...detail,
  };
  writeJsonLine(getNetworkLogFile('listing-error', networkKey), payload);
}

// 函数 6: 记录通用 API 错误日志（覆盖 4xx/5xx 与路由兜底）。
function logApiError(stage, detail = {}) {
  const now = new Date();
  const networkKey = resolveNetworkKey(detail);
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    network: networkKey,
    stage,
    ...detail,
  };
  writeJsonLine(getNetworkLogFile('api-error', networkKey), payload);
}

// 函数 7: 记录进程级系统错误日志（未捕获异常/Promise 拒绝等）。
function logSystemError(stage, detail = {}) {
  const now = new Date();
  const networkKey = resolveNetworkKey(detail);
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    network: networkKey,
    stage,
    ...detail,
  };
  writeJsonLine(getNetworkLogFile('system-error', networkKey), payload);
}

// 函数 8: 记录签约风控事件日志。
function logRiskEvent(stage, detail = {}) {
  const now = new Date();
  const networkKey = resolveNetworkKey(detail);
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    network: networkKey,
    stage,
    ...detail,
  };
  writeJsonLine(getNetworkLogFile('risk-event', networkKey), payload);
}

// 函数 9: 记录共享账号相关用户事件（公共目录）。
function logUserEvent(stage, detail = {}) {
  const now = new Date();
  const payload = {
    at: now.toISOString(),
    cnAt: formatCnTime(now),
    stage,
    ...detail,
  };
  writeJsonLine(USER_LOG_FILE, payload);
}

module.exports = {
  logSignFlow,
  logListingError,
  logApiError,
  logSystemError,
  logRiskEvent,
  logUserEvent,
  USER_LOG_FILE,
};
