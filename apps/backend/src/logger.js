/**
 * 文件说明：日志工具。
 * 将关键错误写入 logs 目录下的 JSONL 文件，方便排查问题。
 */
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', '..', 'logs');
const SIGN_LOG_FILE = path.join(LOG_DIR, 'sign-flow-error.log');
const LISTING_LOG_FILE = path.join(LOG_DIR, 'listing-error.log');

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

// 函数 0-1: 构建按网络拆分的日志文件路径。
function getEnvLogFile(baseName, networkKey) {
  return path.join(LOG_DIR, `${baseName}.${networkKey}.log`);
}

// 函数 1: 确保日志目录存在。
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// 函数 2: 以 JSON 行格式写入日志文件。
function writeJsonLine(filePath, payload) {
  ensureLogDir();
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
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
  console.error('[sign-flow]', payload);
  writeJsonLine(SIGN_LOG_FILE, payload);
  writeJsonLine(getEnvLogFile('sign-flow-error', networkKey), payload);
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
  console.error('[listing]', payload);
  writeJsonLine(LISTING_LOG_FILE, payload);
  writeJsonLine(getEnvLogFile('listing-error', networkKey), payload);
}

module.exports = { logSignFlow, logListingError, SIGN_LOG_FILE, LISTING_LOG_FILE };
