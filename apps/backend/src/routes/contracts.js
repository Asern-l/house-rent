/**
 * 文件说明：合同路由。
 * 覆盖合同创建、签署、取消、上链回写、列表与详情查询。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const PDFDocument = require('pdfkit');
const RENTAL_CHAIN_ABI = require('../../../frontend/src/shared/blockchain/RentalChainABI.json');
const { getDb, saveDb, parseResult, CHAIN_ENV } = require('../db');
const { getUserDb, saveUserDb, parseResult: parseUserResult } = require('../user-db');
const { error, sendError } = require('../app-error');
const {
  upsertOnchainOperation,
  markOnchainOperationConfirmed,
  markOnchainOperationFailed,
  getLatestOnchainStatus,
} = require('../onchain-operations');
const { authMiddleware, requireRole } = require('../auth');
const { logSignFlow, logRiskEvent } = require('../logger');
const { resolveListingPublicState } = require('../listing-public-state');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SIGN_TIME_SKEW_MS = 10 * 60 * 1000;
const PAYMENT_WINDOW_HOURS = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS || 2));
const PAYMENT_WINDOW_MS = PAYMENT_WINDOW_HOURS * 60 * 60 * 1000;
const SAME_LISTING_WINDOW_HOURS = 24;
const SAME_LISTING_MAX_APPLY = 10;
const GLOBAL_WINDOW_MINUTES = 60;
const GLOBAL_MAX_APPLY = 20;
const GLOBAL_COOLDOWN_HOURS = 6;
const SAME_LISTING_COOLDOWN_HOURS = 24;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const GAS_CAP_MULTIPLIER = 10n;
const GAS_CAP_HARD_LIMIT_WEI = ethers.parseEther('0.005');
const GAS_ESTIMATE_UNITS_DEFAULT = 350000n;

const PDF_FONT_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
  path.join(__dirname, '..', '..', '..', 'docs', 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\simsunb.ttf',
  'C:\\Windows\\Fonts\\simfang.ttf',
  'C:\\Windows\\Fonts\\STSONG.TTF',
  'C:\\Windows\\Fonts\\STFANGSO.TTF',
];
const DEPLOY_FILE_LOCAL = path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json');
const DEPLOY_FILE_SEPOLIA = path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
const rentalChainIface = new ethers.Interface(RENTAL_CHAIN_ABI);
const CONTRACT_ONCHAIN_KINDS = ['contract.create'];

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function contractHash(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

// 函数 4: 规范化日期字符串（YYYY-MM-DD）。
function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

// 函数 5: 计算结束日期（按月偏移）。
function addMonthsDateOnly(startDateOnly, months) {
  const d = new Date(`${startDateOnly}T00:00:00`);
  d.setMonth(d.getMonth() + Number(months));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 函数 6: 生成北京时间日期（YYYY-MM-DD）。
function getCnDateOnly(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 函数 7: 生成北京时间日期时间（YYYY-MM-DD HH:mm:ss）。
function getCnDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseCnDateTime(value) {
  const s = String(value || '').trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeWalletAddress(value) {
  const addr = String(value || '').trim();
  return ADDR_RE.test(addr) ? ethers.getAddress(addr) : '';
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

// 函数 2-1: 对租客写入风控冷却时间（仅延长，不缩短已有冷却）。
function setTenantRiskCooldown(userDb, userId, hours) {
  userDb.run(
    `UPDATE users
     SET risk_blocked_until = CASE
       WHEN risk_blocked_until <> '' AND datetime(risk_blocked_until) > datetime('now', '+8 hours', ?)
       THEN risk_blocked_until
       ELSE datetime('now', '+8 hours', ?)
     END
     WHERE id = ?`,
    [`+${hours} hours`, `+${hours} hours`, userId]
  );
}

function createSignMessage({ contractId, contentHash, role, signerAddress, timestamp, deadline }) {
  return [
    'CCL Housing Contract Signature',
    `contractId:${contractId}`,
    `contentHash:${contentHash}`,
    `role:${role}`,
    `signer:${ethers.getAddress(signerAddress)}`,
    `timestamp:${timestamp}`,
    `deadline:${deadline}`,
  ].join('\n');
}

function verifyContractSignature({ contract, role, signerAddress, signature, message }) {
  const normalizedSigner = normalizeWalletAddress(signerAddress);
  if (!normalizedSigner) return { ok: false, code: 'SIGNER_ADDRESS_INVALID', message: '签署钱包地址格式无效' };
  if (!/^0x[a-fA-F0-9]{130}$/.test(String(signature || '').trim())) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: '签名格式无效' };
  }

  let parsed = {};
  for (const line of String(message || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const timestamp = Number(parsed.timestamp || 0);
  const deadline = Number(parsed.deadline || 0);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGN_TIME_SKEW_MS) {
    return { ok: false, code: 'SIGN_EXPIRED', message: '签署声明已过期，请刷新后重试' };
  }
  const createdAt = parseCnDateTime(contract.created_at);
  if (!createdAt) {
    return { ok: false, code: 'CONTRACT_CREATED_AT_INVALID', message: '合同创建时间无效，暂不可签署' };
  }
  const expectedDeadline = createdAt.getTime() + 26 * 60 * 60 * 1000;
  if (!Number.isFinite(deadline) || deadline !== expectedDeadline) {
    return { ok: false, code: 'SIGN_DEADLINE_MISMATCH', message: '签署声明截止时间不匹配' };
  }
  if (Date.now() > deadline) {
    return { ok: false, code: 'SIGN_DEADLINE_EXPIRED', message: '签署声明已过总截止时间，请重新发起合同' };
  }

  const expectedMessage = createSignMessage({
    contractId: contract.id,
    contentHash: contract.content_hash,
    role,
    signerAddress: normalizedSigner,
    timestamp: Number(parsed.timestamp),
    deadline: expectedDeadline,
  });
  if (String(message || '') !== expectedMessage) {
    return { ok: false, code: 'SIGN_MESSAGE_MISMATCH', message: '签署声明与合同内容不匹配' };
  }

  let recovered = '';
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return { ok: false, code: 'SIGNATURE_VERIFY_FAILED', message: '签名验签失败' };
  }
  if (recovered.toLowerCase() !== normalizedSigner.toLowerCase()) {
    return { ok: false, code: 'WALLET_MISMATCH', message: '签名钱包与提交地址不一致' };
  }
  return { ok: true, signerAddress: normalizedSigner };
}

function makeContractContentHash(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

function buildContentHashSpec(content = {}) {
  return {
    algorithm: 'SHA-256',
    fields: {
      contractId: content.contractId || '',
      listingId: content.listingId || '',
      title: content.title || '',
      address: content.address || '',
      rentAmount: content.rentAmount || '',
      oneTimeAmount: content.oneTimeAmount || '',
      tenantWalletAddress: content?.tenant?.walletAddress || '',
      landlordWalletAddress: content?.landlord?.walletAddress || '',
      terms: content.terms || {},
      clauses: Array.isArray(content.clauses) ? content.clauses : [],
      parentContractId: content.parentContractId || '',
    },
  };
}

function buildMessageHash(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';
  return ethers.keccak256(ethers.toUtf8Bytes(raw));
}

function parseSignMessageFields(message) {
  const parsed = {};
  for (const line of String(message || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return parsed;
}

function parseStartDateMs(content = {}) {
  const exactStartAtMs = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exactStartAtMs) && exactStartAtMs > 0) return exactStartAtMs;
  const startDateOnly = normalizeDateOnly(content?.terms?.startDate);
  if (!startDateOnly) return 0;
  const d = new Date(`${startDateOnly}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseEndDateMs(content = {}) {
  const endDateOnly = normalizeDateOnly(content?.terms?.endDate);
  if (!endDateOnly) return 0;
  const d = new Date(`${endDateOnly}T23:59:59+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function resolveChainIdByEnv() {
  return String(CHAIN_ENV || '').toLowerCase() === 'local' ? 31337 : 11155111;
}

function resolveContractAddressByEnv() {
  const deployFile = String(CHAIN_ENV || '').toLowerCase() === 'local' ? DEPLOY_FILE_LOCAL : DEPLOY_FILE_SEPOLIA;
  try {
    if (!fs.existsSync(deployFile)) return '';
    const data = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
    const addr = normalizeWalletAddress(data?.address || '');
    return addr || '';
  } catch {
    return '';
  }
}

function createGasCompAuthorizationDigest({
  contractId, contractContentHash, tenantAddress, landlordAddress, capWei, deadlineEpochMs, nonce, chainId, contractAddress,
}) {
  return ethers.solidityPackedKeccak256(
    ['string', 'bytes32', 'address', 'address', 'uint256', 'uint256', 'bytes32', 'uint256', 'address'],
    [
      String(contractId),
      String(contractContentHash),
      ethers.getAddress(tenantAddress),
      ethers.getAddress(landlordAddress),
      BigInt(String(capWei)),
      BigInt(String(deadlineEpochMs)),
      String(nonce),
      BigInt(String(chainId)),
      ethers.getAddress(contractAddress),
    ]
  );
}

// 函数 2-3: 按网络解析 RPC 地址。
function resolveRpcUrlByChainId(chainIdNum) {
  if (Number(chainIdNum) === 31337) return String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim();
  return String(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com').trim();
}

function resolveChainRuntimeByEnv() {
  const chainId = resolveChainIdByEnv();
  const rpcUrl = resolveRpcUrlByChainId(chainId);
  const contractAddress = resolveContractAddressByEnv();
  return { chainId, rpcUrl, contractAddress };
}

async function loadConfirmedContractTx(txHash) {
  const { rpcUrl, contractAddress } = resolveChainRuntimeByEnv();
  if (!rpcUrl) {
    throw error('CHAIN_RPC_URL_MISSING', '当前网络未配置 RPC 地址，无法校验链上交易');
  }
  if (!contractAddress) {
    throw error('CONTRACT_ADDRESS_MISSING', '当前网络未配置合约地址，无法校验链上交易');
  }
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const [tx, receipt] = await Promise.all([
    provider.getTransaction(txHash),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!tx || !receipt) {
    throw error('ONCHAIN_TX_NOT_FOUND', '链上未找到对应交易');
  }
  if (receipt.status !== 1) {
    throw error('ONCHAIN_TX_REVERTED', '链上交易执行失败');
  }
  if (String(tx.to || '').toLowerCase() !== contractAddress.toLowerCase()) {
    throw error('ONCHAIN_TX_CONTRACT_MISMATCH', '交易目标合约与当前网络配置不一致');
  }
  return { provider, tx, receipt, contractAddress };
}

function parseContractLogs(receipt, contractAddress) {
  const logs = [];
  for (const log of receipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== String(contractAddress || '').toLowerCase()) continue;
    try {
      const parsed = rentalChainIface.parseLog(log);
      if (parsed) logs.push(parsed);
    } catch {
      // ignore unrelated logs
    }
  }
  return logs;
}

function parseContractTx(tx) {
  try {
    return rentalChainIface.parseTransaction({ data: tx.data, value: tx.value });
  } catch {
    return null;
  }
}

function toLowerHex(value) {
  return String(value || '').trim().toLowerCase();
}

function indexedStringHash(value) {
  if (typeof value === 'string') return '';
  const hash = String(value?.hash || value?._hash || '').trim();
  return /^0x[a-fA-F0-9]{64}$/.test(hash) ? hash.toLowerCase() : '';
}

function eventIndexedStringMatches(actualValue, expectedValue) {
  const expected = String(expectedValue || '').trim();
  if (!expected) return false;
  if (typeof actualValue === 'string') return actualValue === expected;
  const actualHash = indexedStringHash(actualValue);
  if (!actualHash) return false;
  return actualHash === ethers.id(expected).toLowerCase();
}

function formatEventIndexedString(actualValue) {
  if (typeof actualValue === 'string') return actualValue;
  return indexedStringHash(actualValue);
}

function summarizeParsedTx(parsedTx) {
  const args0 = parsedTx?.args?.[0];
  return {
    methodName: String(parsedTx?.name || '').trim(),
    contractId: String(args0?.contractId || '').trim(),
    listingId: String(args0?.listingId || '').trim(),
    parentContractId: String(args0?.parentContractId || '').trim(),
  };
}

function summarizeParsedLogs(parsedLogs = []) {
  return parsedLogs.map((log) => ({
    name: String(log?.name || '').trim(),
    contractId: formatEventIndexedString(log?.args?.contractId),
    listingId: formatEventIndexedString(log?.args?.listingId),
    signer: normalizeWalletAddress(log?.args?.signer || ''),
    role: Number(log?.args?.role || 0),
  }));
}

function verifyGasAuthorizationLockOnchain({
  tx,
  receipt,
  contractAddress,
  expectedContractId,
  expectedTenantAddress,
  expectedLandlordAddress,
  expectedContentHash,
  expectedDeadlineMs,
  expectedNonce,
  expectedSignature,
  expectedCapWei,
}) {
  const parsedTx = parseContractTx(tx);
  if (!parsedTx || parsedTx.name !== 'lockGasCompensationEscrow') {
    return { ok: false, code: 'GAS_AUTH_LOCK_METHOD_MISMATCH', message: '链上交易不是 gas 锁仓交易' };
  }
  if (toLowerHex(tx.from) !== String(expectedTenantAddress || '').toLowerCase()) {
    return { ok: false, code: 'GAS_AUTH_LOCK_PAYER_MISMATCH', message: '链上锁仓钱包与租客钱包不一致' };
  }
  if (BigInt(tx.value || 0) !== BigInt(String(expectedCapWei || '0'))) {
    return { ok: false, code: 'GAS_AUTH_LOCK_VALUE_MISMATCH', message: '链上锁仓金额与授权上限不一致' };
  }
  const args = parsedTx.args || [];
  if (String(args[0] || '') !== String(expectedContractId || '')) {
    return { ok: false, code: 'GAS_AUTH_LOCK_CONTRACT_ID_MISMATCH', message: '链上锁仓合同 ID 与数据库不一致' };
  }
  if (toLowerHex(args[1] || '') !== toLowerHex(expectedContentHash || '')) {
    return { ok: false, code: 'GAS_AUTH_LOCK_CONTENT_HASH_MISMATCH', message: '链上锁仓内容哈希与数据库不一致' };
  }
  if (normalizeWalletAddress(args[2] || '')?.toLowerCase() !== String(expectedTenantAddress || '').toLowerCase()) {
    return { ok: false, code: 'GAS_AUTH_LOCK_TENANT_MISMATCH', message: '链上锁仓租客钱包与数据库不一致' };
  }
  if (normalizeWalletAddress(args[3] || '')?.toLowerCase() !== String(expectedLandlordAddress || '').toLowerCase()) {
    return { ok: false, code: 'GAS_AUTH_LOCK_LANDLORD_MISMATCH', message: '链上锁仓房东钱包与数据库不一致' };
  }
  if (BigInt(args[4] || 0) !== BigInt(String(expectedCapWei || '0'))) {
    return { ok: false, code: 'GAS_AUTH_LOCK_CAP_MISMATCH', message: '链上锁仓授权上限与数据库不一致' };
  }
  if (BigInt(args[5] || 0) !== BigInt(String(expectedDeadlineMs || '0'))) {
    return { ok: false, code: 'GAS_AUTH_LOCK_DEADLINE_MISMATCH', message: '链上锁仓截止时间与数据库不一致' };
  }
  if (toLowerHex(args[6] || '') !== toLowerHex(expectedNonce || '')) {
    return { ok: false, code: 'GAS_AUTH_LOCK_NONCE_MISMATCH', message: '链上锁仓 nonce 与数据库不一致' };
  }
  if (String(args[7] || '') !== String(expectedSignature || '')) {
    return { ok: false, code: 'GAS_AUTH_LOCK_SIGNATURE_MISMATCH', message: '链上锁仓授权签名与数据库不一致' };
  }

  const parsedLogs = parseContractLogs(receipt, contractAddress);
  const lockedEvent = parsedLogs.find((log) =>
    log.name === 'GasCompEscrowLocked'
    && eventIndexedStringMatches(log.args?.contractId, expectedContractId)
    && toLowerHex(log.args?.tenant) === String(expectedTenantAddress || '').toLowerCase()
    && toLowerHex(log.args?.landlord) === String(expectedLandlordAddress || '').toLowerCase()
  );
  if (!lockedEvent) {
    return { ok: false, code: 'GAS_AUTH_LOCK_EVENT_MISSING', message: '链上缺少 gas 锁仓事件' };
  }
  if (BigInt(lockedEvent.args?.capWei || 0) !== BigInt(String(expectedCapWei || '0'))) {
    return { ok: false, code: 'GAS_AUTH_LOCK_EVENT_CAP_MISMATCH', message: '链上锁仓事件金额与授权上限不一致' };
  }
  if (BigInt(lockedEvent.args?.deadlineMs || 0) !== BigInt(String(expectedDeadlineMs || '0'))) {
    return { ok: false, code: 'GAS_AUTH_LOCK_EVENT_DEADLINE_MISMATCH', message: '链上锁仓事件截止时间与数据库不一致' };
  }
  return { ok: true };
}

// 函数 2-4: 估算 gas 补偿授权上限（预计 gas 成本 * 10，且不超过硬上限）。
async function estimateGasCompensationCapWei(chainIdNum) {
  const rpcUrl = resolveRpcUrlByChainId(chainIdNum);
  if (!rpcUrl) {
    return {
      estimatedGasUnits: GAS_ESTIMATE_UNITS_DEFAULT.toString(),
      referenceGasPriceWei: '0',
      estimatedGasCostWei: '0',
      capWei: GAS_CAP_HARD_LIMIT_WEI.toString(),
      capRule: 'estimated_gas_cost_x10_with_hard_limit_0.005eth',
    };
  }
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const fee = await provider.getFeeData();
    const gasPrice = (fee.maxFeePerGas && fee.maxFeePerGas > 0n)
      ? fee.maxFeePerGas
      : ((fee.gasPrice && fee.gasPrice > 0n) ? fee.gasPrice : 0n);
    const estimatedGasCostWei = GAS_ESTIMATE_UNITS_DEFAULT * gasPrice;
    const dynamicCapWei = estimatedGasCostWei * GAS_CAP_MULTIPLIER;
    const capWei = dynamicCapWei < GAS_CAP_HARD_LIMIT_WEI ? dynamicCapWei : GAS_CAP_HARD_LIMIT_WEI;
    return {
      estimatedGasUnits: GAS_ESTIMATE_UNITS_DEFAULT.toString(),
      referenceGasPriceWei: gasPrice.toString(),
      estimatedGasCostWei: estimatedGasCostWei.toString(),
      capWei: capWei.toString(),
      capRule: 'estimated_gas_cost_x10_with_hard_limit_0.005eth',
    };
  } catch {
    return {
      estimatedGasUnits: GAS_ESTIMATE_UNITS_DEFAULT.toString(),
      referenceGasPriceWei: '0',
      estimatedGasCostWei: '0',
      capWei: GAS_CAP_HARD_LIMIT_WEI.toString(),
      capRule: 'estimated_gas_cost_x10_with_hard_limit_0.005eth',
    };
  }
}

// 函数 2-5: 计算合同统一截止时间（createdAt + 26h，毫秒）。
function computeContractDeadlineMs(contract) {
  const createdAt = parseCnDateTime(contract.created_at);
  if (!createdAt) return 0;
  return createdAt.getTime() + 26 * 60 * 60 * 1000;
}

function normalizeClauses(input) {
  if (!Array.isArray(input)) return null;
  const out = input
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 50);
  if (out.length === 0) return null;
  for (const c of out) {
    if (c.length > 200) return null;
  }
  return out;
}

function parseStoredClauses(raw) {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (raw && typeof raw === 'object') {
    return [];
  }
  try {
    const arr = JSON.parse(String(raw || '[]'));
    return Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getNextContractVersion(db, contractId, currentVersion = 1) {
  const rows = parseResult(db.exec(
    'SELECT MAX(version) AS max_version FROM contract_versions WHERE contract_id = ?',
    [contractId]
  ));
  const maxVersion = Number(rows[0]?.max_version || 0);
  return Math.max(maxVersion, Number(currentVersion || 1)) + 1;
}

function isNegotiationLocked(contract) {
  return String(contract?.status || '') !== 'pending'
    || Boolean(String(contract?.tenant_signed_at || '').trim())
    || Boolean(String(contract?.landlord_signed_at || '').trim());
}

// 函数 2-2: 为 PDF 选择可用中文字体，避免导出乱码。
function resolvePdfChineseFontPath() {
  return PDF_FONT_CANDIDATES.find((fontPath) => {
    try {
      return fs.existsSync(fontPath);
    } catch {
      return false;
    }
  }) || '';
}


// 函数 3: 创建合同接口（租客发起）。
router.post('/', authMiddleware, requireRole('tenant'), asyncHandler(async (req, res) => {
  const { listingId, startDate, leaseMonths } = req.body || {};
  if (!listingId) {
    return sendError(res, 400, 'LISTING_ID_REQUIRED', 'listingId 不能为空');
  }

  const db = await getDb();
  const userDb = await getUserDb();
  const listings = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [listingId]));
  if (!listings.length) return sendError(res, 404, 'LISTING_NOT_FOUND', '房源不存在');
  const listing = listings[0];
  const listingBodyStatus = String(listing.status || '').trim().toLowerCase();
  if (listingBodyStatus !== 'available' && listingBodyStatus !== 'rented') {
    return sendError(res, 400, 'LISTING_UNAVAILABLE', '房源不可租');
  }

  const relatedContracts = parseResult(db.exec(
    `SELECT id, status, content_json, expires_at, payment_deadline
      FROM contracts
      WHERE listing_id = ?
        AND status NOT IN ('cancelled', 'expired', 'ended')`,
    [listingId]
  ));
  const listingState = resolveListingPublicState(listing, relatedContracts);
  if (listingState.publicStatus !== 'available') {
    return sendError(
      res,
      409,
      listingState.publicStatus === 'rented' ? 'LISTING_OCCUPIED' : 'LISTING_SIGNING_IN_PROGRESS',
      listingState.publicStatus === 'rented'
        ? '该房源当前已有生效合同占用，暂不可重复申请'
        : '该房源当前处于签约流程中，暂不可重复申请'
    );
  }

  const minLeaseMonths = Number(listing.min_lease_months || 1);
  const leaseMonthsNum = Number(leaseMonths ?? minLeaseMonths);
  if (!Number.isInteger(leaseMonthsNum) || leaseMonthsNum < minLeaseMonths || leaseMonthsNum > 12) {
    return sendError(res, 400, 'LEASE_MONTHS_INVALID', `租期必须为 ${minLeaseMonths}-12 月的整数`);
  }
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const maxDate = new Date(todayDate);
  maxDate.setDate(maxDate.getDate() + 3);
  const startDateOnly = normalizeDateOnly(startDate) || getCnDateOnly(todayDate);
  const startAt = new Date(`${startDateOnly}T00:00:00`);
  if (startAt < todayDate || startAt > maxDate) {
    return sendError(res, 400, 'EFFECTIVE_DATE_INVALID', '生效日期仅支持今天至未来3天');
  }

  const [tenant] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [req.user.id]));
  const [landlord] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [listing.landlord_id]));
  if (!tenant || !landlord) {
    return sendError(res, 400, 'USER_PROFILE_MISSING', '用户信息不存在，请重新登录后重试');
  }
  const blockedUntil = parseCnDateTime(tenant.risk_blocked_until);
  if (blockedUntil && blockedUntil > new Date()) {
    logRiskEvent('contract.apply.blocked.active-cooldown', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      blockedUntil: tenant.risk_blocked_until,
      unpaidDefaultCount: tenant.unpaid_default_count || 0,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('TENANT_RISK_COOLDOWN', '当前账号处于风控冷却期，暂不能发起新签约', {
      blockedUntil: tenant.risk_blocked_until,
      unpaidDefaultCount: tenant.unpaid_default_count || 0,
    }));
  }

  const recentTenantApplications = parseResult(db.exec(
    `SELECT COUNT(*) AS count
     FROM contracts
     WHERE tenant_id = ?
       AND created_at >= datetime('now', '+8 hours', '-60 minutes')`,
    [req.user.id]
  ));
  const recentTenantCount = Number(recentTenantApplications[0]?.count || 0);
  if (recentTenantCount >= GLOBAL_MAX_APPLY) {
    setTenantRiskCooldown(userDb, req.user.id, GLOBAL_COOLDOWN_HOURS);
    saveUserDb();
    logRiskEvent('contract.apply.blocked.global-rate', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      windowMinutes: GLOBAL_WINDOW_MINUTES,
      maxApply: GLOBAL_MAX_APPLY,
      hitCount: recentTenantCount,
      cooldownHours: GLOBAL_COOLDOWN_HOURS,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('CONTRACT_APPLY_RATE_LIMITED', `申请签约过于频繁，已触发 ${GLOBAL_COOLDOWN_HOURS} 小时冷却`));
  }

  const recentSameListing = parseResult(db.exec(
    `SELECT COUNT(*) AS count
     FROM contracts
     WHERE tenant_id = ?
       AND listing_id = ?
       AND created_at >= datetime('now', '+8 hours', '-24 hours')`,
    [req.user.id, listingId]
  ));
  const recentSameListingCount = Number(recentSameListing[0]?.count || 0);
  if (recentSameListingCount >= SAME_LISTING_MAX_APPLY) {
    setTenantRiskCooldown(userDb, req.user.id, SAME_LISTING_COOLDOWN_HOURS);
    saveUserDb();
    logRiskEvent('contract.apply.blocked.same-listing', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      windowHours: SAME_LISTING_WINDOW_HOURS,
      maxApply: SAME_LISTING_MAX_APPLY,
      hitCount: recentSameListingCount,
      cooldownHours: SAME_LISTING_COOLDOWN_HOURS,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('CONTRACT_APPLY_DUPLICATE_COOLDOWN', `同一房源 24 小时内最多申请 ${SAME_LISTING_MAX_APPLY} 次，已触发 ${SAME_LISTING_COOLDOWN_HOURS} 小时冷却`));
  }

  const rentAmount = normalizeAmount(listing.rent_amount);
  if (!rentAmount) {
    return sendError(res, 400, 'LISTING_RENT_CONFIG_INVALID', '房源租金配置无效，请房东先修正房源信息');
  }
  const oneTimeAmount = normalizeAmount(Number(rentAmount) * leaseMonthsNum);
  if (!oneTimeAmount) {
    return sendError(res, 400, 'INITIAL_PAYMENT_AMOUNT_INVALID', '合同首笔支付金额计算失败，请检查房源配置');
  }

  const contractId = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const content = {
    contractId,
    listingId,
    title: listing.title,
    address: listing.address,
    rentAmount,
    oneTimeAmount,
    tenant: { id: tenant.id, walletAddress: tenant.wallet_address },
    landlord: { id: landlord.id, walletAddress: landlord.wallet_address },
    terms: {
      paymentMethod: 'one_time',
      startDate: startDateOnly,
      endDate: addMonthsDateOnly(startDateOnly, leaseMonthsNum),
      leaseMonths: leaseMonthsNum,
      minLeaseMonths,
    },
    clauses: parseStoredClauses(listing.clauses_template_json),
    createdAt: getCnDateTime(new Date()),
  };

  const contentJson = JSON.stringify(content, null, 2);
  const contentHash = contractHash(content);
  const expiresAt = getCnDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));

  db.run(`INSERT INTO contracts (id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at, negotiation_status, finalized_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'finalized', datetime('now', '+8 hours'))`, [
    contractId, listingId, req.user.id, listing.landlord_id, contentJson, contentHash, expiresAt,
  ]);
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status, decided_at, decided_by)
     VALUES (?, ?, 1, ?, ?, ?, '初始系统草稿', 'accepted', datetime('now', '+8 hours'), ?)`,
    [`cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, contractId, req.user.id, contentJson, contentHash, req.user.id]
  );
  saveDb();

  res.json({ success: true, data: { contractId, contentHash, expiresAt } });
}));

// 函数 3-1: 查询合同协商版本。
router.get('/:id/versions', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_FORBIDDEN', '无权限查看合同协商记录');
  }
  const versions = parseResult(db.exec(
    `SELECT *
     FROM contract_versions
     WHERE contract_id = ?
     ORDER BY version DESC, created_at DESC`,
    [req.params.id]
  ));
  res.json({ success: true, data: versions });
}));

// 函数 3-2: 保存条款草稿（仅租客，未提交审核）。
router.post('/:id/clauses/draft', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (contract.tenant_id !== req.user.id) return sendError(res, 403, 'TENANT_ONLY', '仅租客可起草条款');
  if (isNegotiationLocked(contract)) {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '仅签署前合同可协商修改'));
  }
  const clauses = normalizeClauses(req.body?.clauses || []);
  if (!clauses) return sendError(res, 400, 'CLAUSES_INVALID', '条款格式不正确（1-50 条，每条不超过 200 字）');
  const current = contract.content_json;
  const draft = JSON.parse(JSON.stringify(current));
  draft.clauses = clauses;
  draft.negotiation = {
    lastDraftBy: req.user.id,
    lastDraftAt: getCnDateTime(new Date()),
    note: String(req.body?.changeNote || '').trim(),
  };
  const draftHash = contractHash(draft);
  const draftVersion = getNextContractVersion(db, req.params.id, contract.version || 1);
  db.run(
    `UPDATE contract_versions
     SET status = 'superseded', decided_at = datetime('now', '+8 hours'), decided_by = ?
     WHERE contract_id = ? AND proposer_id = ? AND status = 'draft'`,
    [req.user.id, req.params.id, req.user.id]
  );
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      `cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      req.params.id,
      draftVersion,
      req.user.id,
      JSON.stringify(draft, null, 2),
      draftHash,
      String(req.body?.changeNote || '').trim(),
    ]
  );
  saveDb();
  res.json({ success: true, message: '条款草稿已保存' });
}));

// 函数 3-3: 提交条款审核（租客 -> 房东）。
router.post('/:id/clauses/submit', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (contract.tenant_id !== req.user.id) return sendError(res, 403, 'TENANT_ONLY', '仅租客可提交审核');
  if (isNegotiationLocked(contract)) {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '仅签署前合同可协商修改'));
  }
  const clauses = normalizeClauses(req.body?.clauses || []);
  if (!clauses) return sendError(res, 400, 'CLAUSES_INVALID', '条款格式不正确（1-50 条，每条不超过 200 字）');
  const current = contract.content_json;
  const next = JSON.parse(JSON.stringify(current));
  next.clauses = clauses;
  next.negotiation = {
    lastProposedBy: req.user.id,
    lastProposedAt: getCnDateTime(new Date()),
    note: String(req.body?.changeNote || '').trim(),
    };

  const nextHash = contractHash(next);
  const nextVersion = getNextContractVersion(db, req.params.id, contract.version || 1);
  const proposalId = `cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.run(
    `UPDATE contract_versions
     SET status = 'superseded', decided_at = datetime('now', '+8 hours'), decided_by = ?
     WHERE contract_id = ? AND proposer_id = ? AND status IN ('draft', 'proposed')`,
    [req.user.id, req.params.id, req.user.id]
  );
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    [proposalId, req.params.id, nextVersion, req.user.id, JSON.stringify(next, null, 2), nextHash, String(req.body?.changeNote || '').trim()]
  );
  db.run(
    "UPDATE contracts SET negotiation_status = 'proposed' WHERE id = ? AND status = 'pending'",
    [req.params.id]
  );
  saveDb();
  res.json({ success: true, message: '条款提案已提交，等待房东审核', data: { proposalId, version: nextVersion, contentHash: nextHash } });
}));

// 函数 3-4: 审核条款提案（房东 approve/reject）。
router.post('/:id/clauses/review', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (contract.landlord_id !== req.user.id) return sendError(res, 403, 'LANDLORD_ONLY', '仅房东可审核条款');
  if (isNegotiationLocked(contract)) {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '当前状态不可处理协商提案'));
  }

  const decision = String(req.body?.decision || '').trim();
  if (!['approve', 'reject'].includes(decision)) return sendError(res, 400, 'DECISION_INVALID', 'decision 仅支持 approve/reject');
  const proposals = parseResult(db.exec(
    "SELECT * FROM contract_versions WHERE contract_id = ? AND status = 'proposed' ORDER BY created_at DESC LIMIT 1",
    [req.params.id]
  ));
  if (!proposals.length) return sendError(res, 404, 'NEGOTIATION_PROPOSAL_NOT_FOUND', '待确认提案不存在');
  const proposal = proposals[0];
  const reviewNote = String(req.body?.note || req.body?.reason || '').trim();
  const proposalContent = typeof proposal.content_json === 'string' ? JSON.parse(proposal.content_json) : (proposal.content_json || {});

  if (decision === 'approve') {
    const reviewedClausesInput = Array.isArray(req.body?.clauses) ? req.body.clauses : proposalContent?.clauses;
    const reviewedClauses = normalizeClauses(reviewedClausesInput || []);
    if (!reviewedClauses) return sendError(res, 400, 'CLAUSES_INVALID', '房东确认版条款格式不正确（1-50 条，每条不超过 200 字）');
    const originalProposalClauses = Array.isArray(proposalContent?.clauses)
      ? proposalContent.clauses.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const reviewAction = JSON.stringify(reviewedClauses) === JSON.stringify(originalProposalClauses)
      ? 'approved_as_is'
      : 'approved_with_edits';
    const landlordFinal = JSON.parse(JSON.stringify(proposalContent || {}));
    landlordFinal.clauses = reviewedClauses;
    landlordFinal.negotiation = {
      mode: 'landlord_confirmed',
      landlordReviewedAt: getCnDateTime(new Date()),
      note: reviewNote,
      basedOnProposalId: proposal.id,
      reviewAction,
    };
    const landlordFinalHash = contractHash(landlordFinal);
    const landlordFinalVersion = getNextContractVersion(db, req.params.id, proposal.version || contract.version || 1);
    db.run(
      `UPDATE contracts
       SET content_json = ?,
           content_hash = ?,
           version = ?,
            negotiation_status = 'finalized',
           finalized_at = datetime('now', '+8 hours')
        WHERE id = ? AND status = 'pending'`,
      [JSON.stringify(landlordFinal, null, 2), landlordFinalHash, landlordFinalVersion, req.params.id]
    );
    db.run(
      "UPDATE contract_versions SET status = 'accepted', decided_at = datetime('now', '+8 hours'), decided_by = ? WHERE id = ?",
      [req.user.id, proposal.id]
    );
    db.run(
      `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status, decided_at, decided_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', datetime('now', '+8 hours'), ?)`,
      [
        `cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        req.params.id,
        landlordFinalVersion,
        req.user.id,
        JSON.stringify(landlordFinal, null, 2),
        landlordFinalHash,
        reviewNote,
        req.user.id,
      ]
    );
    saveDb();
    return res.json({ success: true, message: '房东已确认当前条款版本', data: { version: landlordFinalVersion, contentHash: landlordFinalHash } });
  }
  if (!reviewNote) return sendError(res, 400, 'REJECT_REASON_REQUIRED', '退回需填写备注');
  db.run(
    "UPDATE contracts SET negotiation_status = 'finalized', finalized_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'pending'",
    [req.params.id]
  );
  db.run(
    "UPDATE contract_versions SET status = 'rejected', decided_at = datetime('now', '+8 hours'), decided_by = ?, change_note = ? WHERE id = ?",
    [req.user.id, reviewNote, proposal.id]
  );
  saveDb();
  res.json({ success: true, message: '房东已退回该提议，租客可继续修改并重新提交' });
}));

// 函数 4: 租客签署合同接口。
router.post('/:id/sign-tenant', authMiddleware, asyncHandler(async (req, res) => {
  const { signerAddress, signature, message, gasAuthorization } = req.body || {};
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) return sendError(res, 403, 'SIGN_FORBIDDEN', '无权限签署');
  if (contract.status !== 'pending') {
    return res.status(400).json(error('SIGN_STATUS_INVALID', '当前状态不允许租客签署', { currentStatus: contract.status }));
  }
  if (String(contract.negotiation_status || '') === 'proposed') {
    return res.status(400).json(error('CONTRACT_NOT_FINALIZED', '当前有待房东处理的租客提议，请先完成审核'));
  }
  const content = contract.content_json;
  const boundAddress = normalizeWalletAddress(content?.tenant?.walletAddress);
  const submittedAddress = normalizeWalletAddress(signerAddress);
  if (!boundAddress) {
    return res.status(400).json(error('WALLET_NOT_BOUND', '租客未绑定有效钱包地址，请先在个人中心绑定钱包'));
  }
  if (!submittedAddress || submittedAddress.toLowerCase() !== boundAddress.toLowerCase()) {
    return res.status(400).json(error('WALLET_MISMATCH', '当前签署钱包与合同绑定租客钱包不一致'));
  }
  const verified = verifyContractSignature({ contract, role: 'tenant', signerAddress: submittedAddress, signature, message });
  if (!verified.ok) return res.status(400).json(error(verified.code, verified.message));
  if (!gasAuthorization || typeof gasAuthorization !== 'object') {
    return res.status(400).json(error('GAS_AUTH_MISSING', '缺少 gas 补偿授权签名'));
  }
  const contractAddress = resolveContractAddressByEnv();
  if (!contractAddress) {
    return res.status(500).json(error('CONTRACT_ADDRESS_MISSING', '当前网络未配置合约地址，无法验证 gas 授权'));
  }
  const chainId = resolveChainIdByEnv();
  const deadlineMs = computeContractDeadlineMs(contract);
  if (!deadlineMs) return res.status(400).json(error('CONTRACT_CREATED_AT_INVALID', '合同创建时间无效，无法验证 gas 授权'));

  const gasAuthCapWei = String(gasAuthorization.capWei || '').trim();
  const gasAuthNonce = String(gasAuthorization.nonce || '').trim();
  const gasAuthDigest = String(gasAuthorization.digest || '').trim();
  const gasAuthSignature = String(gasAuthorization.signature || '').trim();
  const gasAuthLockTxHash = String(gasAuthorization.lockTxHash || '').trim();
  if (!/^\d+$/.test(gasAuthCapWei)) return res.status(400).json(error('GAS_AUTH_CAP_INVALID', 'gas 授权上限 capWei 无效'));
  if (!/^0x[a-fA-F0-9]{64}$/.test(gasAuthNonce)) return res.status(400).json(error('GAS_AUTH_NONCE_INVALID', 'gas 授权 nonce 无效'));
  if (!/^0x[a-fA-F0-9]{130}$/.test(gasAuthSignature)) return res.status(400).json(error('GAS_AUTH_SIGNATURE_INVALID', 'gas 授权签名格式无效'));
  if (!/^0x[a-fA-F0-9]{64}$/.test(gasAuthLockTxHash)) return res.status(400).json(error('GAS_AUTH_LOCK_TX_MISSING', '缺少 gas 锁仓交易哈希，请先完成链上锁仓'));

  const expectedGasAuthDigest = createGasCompAuthorizationDigest({
    contractId: contract.id,
    contractContentHash: contract.content_hash,
    tenantAddress: submittedAddress,
    landlordAddress: normalizeWalletAddress(content?.landlord?.walletAddress || ''),
    capWei: gasAuthCapWei,
    deadlineEpochMs: deadlineMs,
    nonce: gasAuthNonce,
    chainId,
    contractAddress,
  });
  if (gasAuthDigest !== expectedGasAuthDigest) {
    return res.status(400).json(error('GAS_AUTH_MESSAGE_MISMATCH', 'gas 授权消息与合同上下文不匹配'));
  }
  let recoveredGasAuth = '';
  try {
    recoveredGasAuth = ethers.verifyMessage(ethers.getBytes(gasAuthDigest), gasAuthSignature);
  } catch {
    return res.status(400).json(error('GAS_AUTH_VERIFY_FAILED', 'gas 授权签名验签失败'));
  }
  if (recoveredGasAuth.toLowerCase() !== submittedAddress.toLowerCase()) {
    return res.status(400).json(error('GAS_AUTH_SIGNER_MISMATCH', 'gas 授权签名钱包与租客钱包不一致'));
  }
  const preparedRows = parseResult(db.exec(
    `SELECT tenant_address, landlord_address, cap_wei, deadline_epoch_ms, nonce, digest, chain_id, contract_address
     FROM contract_gas_authorization_prepares
     WHERE contract_id = ?
     LIMIT 1`,
    [req.params.id]
  ));
  if (!preparedRows.length) {
    return res.status(400).json(error('GAS_AUTH_PREPARE_MISSING', '缺少后端生成的 gas 授权参数，请重新准备后签署'));
  }
  const prepared = preparedRows[0];
  if (String(prepared.cap_wei || '') !== gasAuthCapWei
    || String(prepared.nonce || '').trim() !== gasAuthNonce
    || String(prepared.digest || '').trim() !== gasAuthDigest
    || String(prepared.deadline_epoch_ms || '') !== String(deadlineMs)
    || String(prepared.chain_id || '') !== String(chainId)
    || String(prepared.contract_address || '').trim().toLowerCase() !== String(contractAddress || '').trim().toLowerCase()
    || String(prepared.tenant_address || '').trim().toLowerCase() !== submittedAddress.toLowerCase()
    || String(prepared.landlord_address || '').trim().toLowerCase() !== normalizeWalletAddress(content?.landlord?.walletAddress || '').toLowerCase()
  ) {
    return res.status(400).json(error('GAS_AUTH_PREPARE_MISMATCH', 'gas 授权参数与后端准备值不一致，请重新准备后签署'));
  }
  let lockLoaded;
  try {
    lockLoaded = await loadConfirmedContractTx(gasAuthLockTxHash);
  } catch (chainErr) {
    return res.status(400).json(error(chainErr.code || 'GAS_AUTH_LOCK_VERIFY_FAILED', chainErr.error || chainErr.message || '链上 gas 锁仓交易校验失败'));
  }
  const lockVerify = verifyGasAuthorizationLockOnchain({
    tx: lockLoaded.tx,
    receipt: lockLoaded.receipt,
    contractAddress: lockLoaded.contractAddress,
    expectedContractId: contract.id,
    expectedTenantAddress: submittedAddress,
    expectedLandlordAddress: normalizeWalletAddress(content?.landlord?.walletAddress || ''),
    expectedContentHash: contract.content_hash,
    expectedDeadlineMs: deadlineMs,
    expectedNonce: gasAuthNonce,
    expectedSignature: gasAuthSignature,
    expectedCapWei: gasAuthCapWei,
  });
  if (!lockVerify.ok) {
    return res.status(400).json(error(lockVerify.code, lockVerify.message));
  }
  const existingGasAuth = parseResult(db.exec(
    'SELECT nonce FROM contract_gas_authorizations WHERE contract_id = ? OR nonce = ? LIMIT 1',
    [req.params.id, gasAuthNonce]
  ));
  if (existingGasAuth.length > 0) {
    return res.status(409).json(error('GAS_AUTH_ALREADY_EXISTS', '该合同 gas 授权已存在或 nonce 已被占用'));
  }

  try {
    db.run('BEGIN TRANSACTION');
    db.run(
      `UPDATE contracts
       SET status = 'tenant_signed',
            negotiation_status = 'locked',
            tenant_signed_at = datetime('now', '+8 hours'),
           tenant_signer_address = ?,
           tenant_signature = ?,
           tenant_signature_message = ?,
           tenant_sign_ip = ?,
           tenant_sign_user_agent = ?,
           tenant_sign_request_id = ?
       WHERE id = ? AND status = 'pending'`,
      [
        submittedAddress,
        String(signature || ''),
        String(message || ''),
        getClientIp(req),
        String(req.headers['user-agent'] || ''),
        String(req.requestId || ''),
        req.params.id,
      ]
    );
    if (db.getRowsModified() !== 1) {
      throw error('SIGN_STATE_CHANGED', '合同状态已变化，请刷新后重试');
    }
    db.run(
      `INSERT INTO contract_gas_authorizations (
        id, contract_id, tenant_address, landlord_address, cap_wei, deadline_epoch_ms, nonce, signature, message, chain_id, contract_address, lock_tx_hash, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        `ga_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        req.params.id,
        submittedAddress,
        normalizeWalletAddress(content?.landlord?.walletAddress || ''),
        gasAuthCapWei,
        String(deadlineMs),
        gasAuthNonce,
        gasAuthSignature,
        gasAuthDigest,
        String(chainId),
        contractAddress,
        gasAuthLockTxHash,
      ]
    );
    db.run('DELETE FROM contract_gas_authorization_prepares WHERE contract_id = ?', [req.params.id]);
    db.run('COMMIT');
    saveDb();
  } catch (txErr) {
    try { db.run('ROLLBACK'); } catch { /* ignore */ }
    const raw = String(txErr?.message || txErr || '');
    if (raw.includes('UNIQUE constraint failed')) {
      return res.status(409).json(error('GAS_AUTH_ALREADY_EXISTS', '该合同 gas 授权已存在或 nonce 已被占用'));
    }
    if (txErr?.code && txErr?.error) {
      return res.status(409).json(txErr);
    }
    if (txErr?.code && txErr?.message) {
      return res.status(409).json(error(txErr.code, txErr.message));
    }
    return res.status(500).json(error('SIGN_TENANT_COMMIT_FAILED', '租客签署写库失败，请重试'));
  }
  res.json({
    success: true,
    message: '租客签署成功',
    data: {
      tenantMessageHash: buildMessageHash(message),
      gasAuthorizationDigest: gasAuthDigest,
      gasAuthorizationLockTxHash: gasAuthLockTxHash,
    },
  });
}));

// 函数 4-1: 租客签署前准备 gas 补偿授权参数。
router.get('/:id/gas-authorization/prepare', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (contract.tenant_id !== req.user.id) return sendError(res, 403, 'TENANT_ONLY', '仅租客可准备 gas 授权参数');
  if (contract.status !== 'pending') return res.status(400).json(error('SIGN_STATUS_INVALID', '当前状态不可准备 gas 授权'));
  if (String(contract.negotiation_status || '') === 'proposed') {
    return res.status(400).json(error('CONTRACT_NOT_FINALIZED', '当前有待房东处理的租客提议'));
  }
  const content = contract.content_json;
  const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress || '');
  const landlordAddress = normalizeWalletAddress(content?.landlord?.walletAddress || '');
  if (!tenantAddress || !landlordAddress) return res.status(400).json(error('WALLET_NOT_BOUND', '合同绑定钱包地址无效'));
  const deadlineMs = computeContractDeadlineMs(contract);
  if (!deadlineMs || Date.now() > deadlineMs) return res.status(400).json(error('GAS_AUTH_DEADLINE_EXPIRED', '合同已超出 gas 授权签署时限'));
  const chainId = resolveChainIdByEnv();
  const contractAddress = resolveContractAddressByEnv();
  if (!contractAddress) return res.status(500).json(error('CONTRACT_ADDRESS_MISSING', '当前网络未配置合约地址'));
  const cap = await estimateGasCompensationCapWei(chainId);
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const digest = createGasCompAuthorizationDigest({
    contractId: contract.id,
    contractContentHash: contract.content_hash,
    tenantAddress,
    landlordAddress,
    capWei: cap.capWei,
    deadlineEpochMs: deadlineMs,
    nonce,
    chainId,
    contractAddress,
  });
  res.json({
    success: true,
    data: {
      contractId: contract.id,
      tenantAddress,
      landlordAddress,
      deadline: deadlineMs,
      nonce,
      chainId,
      contractAddress,
      capWei: cap.capWei,
      capRule: cap.capRule,
      estimatedGasUnits: cap.estimatedGasUnits,
      referenceGasPriceWei: cap.referenceGasPriceWei,
      estimatedGasCostWei: cap.estimatedGasCostWei,
      digest,
    },
  });
  db.run(
    `INSERT INTO contract_gas_authorization_prepares (
      id, contract_id, tenant_address, landlord_address, cap_wei, deadline_epoch_ms, nonce, digest, chain_id, contract_address, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
    ON CONFLICT(contract_id) DO UPDATE SET
      tenant_address = excluded.tenant_address,
      landlord_address = excluded.landlord_address,
      cap_wei = excluded.cap_wei,
      deadline_epoch_ms = excluded.deadline_epoch_ms,
      nonce = excluded.nonce,
      digest = excluded.digest,
      chain_id = excluded.chain_id,
      contract_address = excluded.contract_address,
      updated_at = datetime('now', '+8 hours')`,
    [
      `gap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      contract.id,
      tenantAddress,
      landlordAddress,
      cap.capWei,
      String(deadlineMs),
      nonce,
      digest,
      String(chainId),
      contractAddress,
    ]
  );
  saveDb();
}));

// 函数 4-2: 合同参与方链上取消后回写 gas 授权撤销结果（仅房东签署前可用）。
router.post('/:id/gas-authorization/revoke', authMiddleware, asyncHandler(async (req, res) => {
  const revokeTxHash = String(req.body?.txHash || '').trim();
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_PARTY_ONLY', '仅合同参与方可回写 gas 授权撤销结果');
  }
  if (!['pending', 'tenant_signed', 'cancelled', 'expired'].includes(contract.status)) {
    return res.status(400).json(error('GAS_AUTH_REVOKE_FORBIDDEN', '当前合同状态不允许撤销 gas 授权'));
  }
  if (String(contract.landlord_signed_at || '').trim()) {
    return res.status(400).json(error('GAS_AUTH_REVOKE_FORBIDDEN', '房东已签署后不可撤销授权'));
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(revokeTxHash)) {
    return res.status(400).json(error('GAS_AUTH_REVOKE_TX_INVALID', '缺少有效的链上撤销交易哈希'));
  }
  const gasAuthRows = parseResult(db.exec(
    `SELECT id, status
     FROM contract_gas_authorizations
     WHERE contract_id = ?
     LIMIT 1`,
    [req.params.id]
  ));
  if (!gasAuthRows.length) {
    return res.status(404).json(error('GAS_AUTH_NOT_FOUND', '未找到 gas 授权记录'));
  }
  const gasAuth = gasAuthRows[0];
  const opId = `op_gas_revoke_${req.params.id}_${revokeTxHash.toLowerCase()}`;
  upsertOnchainOperation(db, {
    opId,
    entityType: 'gas_auth',
    entityId: req.params.id,
    operationKind: 'gas_auth.revoke',
    txHash: revokeTxHash,
    status: 'pending',
    requestId: req.requestId,
    payload: { contractId: req.params.id, actorId: req.user.id },
  });
  try {
    const loaded = await loadConfirmedContractTx(revokeTxHash);
    const parsedTx = parseContractTx(loaded.tx);
    const parsedLogs = parseContractLogs(loaded.receipt, loaded.contractAddress);
    const content = typeof contract.content_json === 'string' ? JSON.parse(contract.content_json) : (contract.content_json || {});
    const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress || '');
    const nonce = String(parseResult(db.exec(
      `SELECT nonce FROM contract_gas_authorizations WHERE contract_id = ? LIMIT 1`,
      [req.params.id]
    ))[0]?.nonce || '').trim();
    if (!tenantAddress || !nonce) {
      markOnchainOperationFailed(db, {
        opId,
        entityType: 'gas_auth',
        entityId: req.params.id,
        operationKind: 'gas_auth.revoke',
        txHash: revokeTxHash,
        requestId: req.requestId,
        payload: { contractId: req.params.id },
        errorMessage: 'gas authorization record invalid',
      });
      return res.status(400).json(error('GAS_AUTH_RECORD_INVALID', 'gas 授权记录缺少 tenant 或 nonce'));
    }
    const methodName = String(parsedTx?.name || '').trim();
    const revokeByTenant =
      methodName === 'revokeGasCompensationAuthorization'
      && String(parsedTx.args?.[0] || '') === String(req.params.id)
      && normalizeWalletAddress(parsedTx.args?.[1] || '')?.toLowerCase() === tenantAddress.toLowerCase()
      && toLowerHex(parsedTx.args?.[2] || '') === toLowerHex(nonce);
    const cancelByCounterparty =
      methodName === 'cancelPendingGasAuthorization'
      && String(parsedTx.args?.[0] || '') === String(req.params.id)
      && normalizeWalletAddress(parsedTx.args?.[1] || '')?.toLowerCase() === tenantAddress.toLowerCase()
      && toLowerHex(parsedTx.args?.[2] || '') === toLowerHex(nonce);
    if (!revokeByTenant && !cancelByCounterparty) {
      markOnchainOperationFailed(db, {
        opId,
        entityType: 'gas_auth',
        entityId: req.params.id,
        operationKind: 'gas_auth.revoke',
        txHash: revokeTxHash,
        requestId: req.requestId,
        payload: { contractId: req.params.id },
        errorMessage: 'onchain revoke method mismatch',
      });
      return res.status(400).json(error('GAS_AUTH_REVOKE_METHOD_MISMATCH', '链上交易不是 gas 授权撤销交易'));
    }
    const revokedEvent = parsedLogs.find((log) =>
      log.name === 'GasCompRevoked'
      && eventIndexedStringMatches(log.args?.contractId, req.params.id)
      && toLowerHex(log.args?.tenant) === tenantAddress.toLowerCase()
    );
    if (!revokedEvent) {
      markOnchainOperationFailed(db, {
        opId,
        entityType: 'gas_auth',
        entityId: req.params.id,
        operationKind: 'gas_auth.revoke',
        txHash: revokeTxHash,
        requestId: req.requestId,
        payload: { contractId: req.params.id },
        errorMessage: 'gas revoke event missing',
      });
      return res.status(400).json(error('GAS_AUTH_REVOKE_EVENT_MISSING', '链上缺少 gas 授权撤销事件'));
    }
  } catch (chainErr) {
    const chainErrCode = String(chainErr?.code || '').trim();
    if (chainErrCode === 'ONCHAIN_TX_NOT_FOUND') {
      saveDb();
      return res.status(202).json({
        success: true,
        message: 'gas 授权撤销交易已提交，后台将自动确认',
        data: { txHash: revokeTxHash, onchainState: 'pending' },
      });
    }
    markOnchainOperationFailed(db, {
      opId,
      entityType: 'gas_auth',
      entityId: req.params.id,
      operationKind: 'gas_auth.revoke',
      txHash: revokeTxHash,
      requestId: req.requestId,
      payload: { contractId: req.params.id },
      errorMessage: chainErr.error || chainErr.message || 'gas revoke verify failed',
    });
    return res.status(400).json(error(chainErrCode || 'GAS_AUTH_REVOKE_VERIFY_FAILED', chainErr.error || chainErr.message || '链上撤销交易校验失败'));
  }
  db.run(
    `UPDATE contract_gas_authorizations
     SET status = CASE WHEN status = 'active' THEN 'revoked' ELSE status END,
         revoke_tx_hash = CASE
           WHEN COALESCE(revoke_tx_hash, '') = '' THEN ?
           ELSE revoke_tx_hash
         END,
         updated_at = datetime('now', '+8 hours')
     WHERE contract_id = ?`,
    [revokeTxHash, req.params.id]
  );
  markOnchainOperationConfirmed(db, {
    opId,
    entityType: 'gas_auth',
    entityId: req.params.id,
    operationKind: 'gas_auth.revoke',
    txHash: revokeTxHash,
    requestId: req.requestId,
    payload: { contractId: req.params.id, actorId: req.user.id },
    result: { gasAuthStatusBefore: gasAuth.status, gasAuthStatusAfter: 'revoked' },
  });
  saveDb();
  res.json({ success: true, message: 'gas 授权已撤销' });
}));

// 函数 5: 房东签署合同接口。
router.post('/:id/sign-landlord', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { signerAddress, signature, message, txHash } = req.body || {};
    const db = await getDb();
    const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
    if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
    const contract = rows[0];

    if (contract.landlord_id !== req.user.id) return sendError(res, 403, 'SIGN_FORBIDDEN', '无权限签署');
    if (contract.status !== 'tenant_signed') {
      return res.status(400).json(error('SIGN_STATUS_INVALID', '当前状态不允许房东签署', { currentStatus: contract.status }));
    }
    if (String(contract.landlord_signed_at || '').trim()) {
      return res.status(400).json(error('LANDLORD_ALREADY_SIGNED', '房东已签署，请勿重复提交'));
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || '').trim())) {
      return res.status(400).json(error('ONCHAIN_TX_HASH_INVALID', '缺少有效的合同上链交易哈希'));
    }
    const normalizedSignTxHash = String(txHash || '').trim().toLowerCase();
    const signOpId = `op_contract_create_${req.params.id}_${normalizedSignTxHash}`;

    const content = typeof contract.content_json === 'string' ? JSON.parse(contract.content_json) : (contract.content_json || {});
    const tenantAddress = String(content?.tenant?.walletAddress || '').trim();
    const landlordAddress = String(content?.landlord?.walletAddress || '').trim();
    const normalizedTenantAddress = normalizeWalletAddress(tenantAddress);
    const normalizedLandlordAddress = normalizeWalletAddress(landlordAddress);
    const submittedAddress = normalizeWalletAddress(signerAddress);
    if (!normalizedTenantAddress || !normalizedLandlordAddress) {
      return res.status(400).json(error('WALLET_NOT_BOUND', '合同绑定钱包地址不完整或格式无效，请租客和房东先在个人中心绑定钱包后重新发起合同'));
    }
    if (!submittedAddress || submittedAddress.toLowerCase() !== normalizedLandlordAddress.toLowerCase()) {
      return res.status(400).json(error('WALLET_MISMATCH', '当前签署钱包与合同绑定房东钱包不一致'));
    }
    const verified = verifyContractSignature({ contract, role: 'landlord', signerAddress: submittedAddress, signature, message });
    if (!verified.ok) return res.status(400).json(error(verified.code, verified.message));
    const gasAuthRows = parseResult(db.exec(
      `SELECT id, tenant_address, nonce, status, lock_tx_hash
       FROM contract_gas_authorizations
       WHERE contract_id = ?
       LIMIT 1`,
      [req.params.id]
    ));
    if (!gasAuthRows.length) {
      return res.status(400).json(error('GAS_AUTH_NOT_FOUND', '未找到租客 gas 补偿授权，房东暂不可签署'));
    }
    const gasAuth = gasAuthRows[0];
    if (String(gasAuth.status || '') !== 'active') {
      return res.status(400).json(error('GAS_AUTH_STATUS_INVALID', '租客 gas 补偿授权已失效，房东暂不可签署', { gasAuthStatus: gasAuth.status }));
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(gasAuth.lock_tx_hash || '').trim())) {
      return res.status(400).json(error('GAS_AUTH_LOCK_MISSING', '租客尚未完成链上 gas 锁仓，房东暂不可签署'));
    }

    const parentContractId = String(contract.parent_contract_id || content?.parentContractId || '').trim();
    const initialAmountWei = (() => {
      try {
        return ethers.parseEther(String(content?.oneTimeAmount || '0'));
      } catch {
        return 0n;
      }
    })();
    const tenantMessageHash = buildMessageHash(contract.tenant_signature_message || '');
    const landlordMessageHash = buildMessageHash(message || '');
    const tenantSignedAt = (() => {
      const d = parseCnDateTime(contract.tenant_signed_at);
      return d ? d.getTime() : 0;
    })();
    const landlordMessageFields = parseSignMessageFields(message);
    const landlordMessageTimestamp = Number(landlordMessageFields.timestamp || 0);
    const startAtMs = parseStartDateMs(content);
    const endAtMs = parseEndDateMs(content);
    const signOpPayload = {
      contractId: req.params.id,
      listingId: contract.listing_id,
      actorId: req.user.id,
      signerAddress: submittedAddress,
      signature: String(signature || ''),
      message: String(message || ''),
      messageHash: landlordMessageHash,
      messageTimestamp: landlordMessageTimestamp,
      tenantAddress: normalizedTenantAddress,
      landlordAddress: normalizedLandlordAddress,
      parentContractId,
      initialAmountWei: initialAmountWei.toString(),
      startAtMs: Number(startAtMs || 0),
      endAtMs: Number(endAtMs || 0),
      tenantMessageHash,
      tenantSignature: String(contract.tenant_signature || ''),
      tenantSignedAt: Number(tenantSignedAt || 0),
      gasAuthNonce: String(gasAuth.nonce || ''),
    };
    upsertOnchainOperation(db, {
      opId: signOpId,
      entityType: 'contract',
      entityId: req.params.id,
      operationKind: 'contract.create',
      txHash: normalizedSignTxHash,
      status: 'pending',
      requestId: req.requestId,
      payload: signOpPayload,
    });

    let onchainTx;
    let parsedTx;
    let parsedLogs;
    try {
      const loaded = await loadConfirmedContractTx(String(txHash || '').trim());
      onchainTx = loaded.tx;
      parsedTx = parseContractTx(loaded.tx);
      parsedLogs = parseContractLogs(loaded.receipt, loaded.contractAddress);
    } catch (chainErr) {
      const chainErrCode = String(chainErr?.code || '').trim();
      if (chainErrCode === 'ONCHAIN_TX_NOT_FOUND') {
        db.run(
          `UPDATE contracts
           SET landlord_signer_address = ?,
               landlord_signature = ?,
               landlord_signature_message = ?,
               landlord_sign_ip = ?,
               landlord_sign_user_agent = ?,
               landlord_sign_request_id = ?,
               tx_hash = ?,
               updated_at = datetime('now', '+8 hours')
            WHERE id = ? AND status = 'tenant_signed'`,
          [
            submittedAddress,
            String(signature || ''),
            String(message || ''),
            getClientIp(req),
            String(req.headers['user-agent'] || ''),
            String(req.requestId || ''),
            String(txHash || '').trim(),
            req.params.id,
          ]
        );
        saveDb();
        return res.status(202).json({
          success: true,
          message: '房东上链交易已提交，后台将自动补偿确认',
          data: {
            txHash: String(txHash || '').trim(),
            onchainState: 'pending',
          },
        });
      }
      markOnchainOperationFailed(db, {
        opId: signOpId,
        entityType: 'contract',
        entityId: req.params.id,
        operationKind: 'contract.create',
        txHash: normalizedSignTxHash,
        requestId: req.requestId,
        payload: signOpPayload,
        errorMessage: chainErr.error || chainErr.message || 'contract create verify failed',
      });
      return res.status(400).json(error(chainErrCode || 'ONCHAIN_TX_VERIFY_FAILED', chainErr.error || chainErr.message || '链上交易校验失败'));
    }
    const parsedTxSummary = summarizeParsedTx(parsedTx);
    const parsedLogSummary = summarizeParsedLogs(parsedLogs);
    if (!parsedTx || parsedTx.name !== 'createContractRecord') {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_METHOD_MISMATCH',
        txHash: normalizedSignTxHash,
        txFrom: String(onchainTx?.from || '').trim(),
        txTo: String(onchainTx?.to || '').trim(),
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
      });
      return res.status(400).json(error('ONCHAIN_METHOD_MISMATCH', '链上交易不是合同创建交易'));
    }
    if (toLowerHex(onchainTx.from) !== submittedAddress.toLowerCase()) {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_TX_SIGNER_MISMATCH',
        txHash: normalizedSignTxHash,
        txFrom: String(onchainTx?.from || '').trim(),
        expectedSigner: submittedAddress,
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
      });
      return res.status(400).json(error('ONCHAIN_TX_SIGNER_MISMATCH', '链上交易发起钱包与房东签署钱包不一致'));
    }
    const p = parsedTx.args?.[0];
    if (!p) {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_TX_DECODE_FAILED',
        txHash: normalizedSignTxHash,
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
      });
      return res.status(400).json(error('ONCHAIN_TX_DECODE_FAILED', '链上交易参数解析失败'));
    }
    const logVerifyMismatch = (code, expected = {}, actual = {}) => {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code,
        txHash: normalizedSignTxHash,
        txFrom: String(onchainTx?.from || '').trim(),
        txTo: String(onchainTx?.to || '').trim(),
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
        expected,
        actual,
      });
    };
    if (String(p.contractId || '') !== String(contract.id)) {
      logVerifyMismatch('ONCHAIN_CONTRACT_ID_MISMATCH', { contractId: String(contract.id) }, { contractId: String(p.contractId || '') });
      return res.status(400).json(error('ONCHAIN_CONTRACT_ID_MISMATCH', '链上合同 ID 与数据库不一致'));
    }
    if (String(p.listingId || '') !== String(contract.listing_id || '')) {
      logVerifyMismatch('ONCHAIN_LISTING_ID_MISMATCH', { listingId: String(contract.listing_id || '') }, { listingId: String(p.listingId || '') });
      return res.status(400).json(error('ONCHAIN_LISTING_ID_MISMATCH', '链上房源 ID 与数据库不一致'));
    }
    if (String(p.parentContractId || '') !== parentContractId) {
      logVerifyMismatch('ONCHAIN_PARENT_CONTRACT_MISMATCH', { parentContractId }, { parentContractId: String(p.parentContractId || '') });
      return res.status(400).json(error('ONCHAIN_PARENT_CONTRACT_MISMATCH', '链上续约父合同 ID 与数据库不一致'));
    }
    if (toLowerHex(p.tenant) !== normalizedTenantAddress.toLowerCase()) {
      logVerifyMismatch('ONCHAIN_TENANT_MISMATCH', { tenant: normalizedTenantAddress }, { tenant: normalizeWalletAddress(p.tenant || '') });
      return res.status(400).json(error('ONCHAIN_TENANT_MISMATCH', '链上租客钱包与数据库不一致'));
    }
    if (toLowerHex(p.landlord) !== normalizedLandlordAddress.toLowerCase()) {
      logVerifyMismatch('ONCHAIN_LANDLORD_MISMATCH', { landlord: normalizedLandlordAddress }, { landlord: normalizeWalletAddress(p.landlord || '') });
      return res.status(400).json(error('ONCHAIN_LANDLORD_MISMATCH', '链上房东钱包与数据库不一致'));
    }
    if (toLowerHex(p.contentHash) !== toLowerHex(contract.content_hash)) {
      logVerifyMismatch('ONCHAIN_CONTENT_HASH_MISMATCH', { contentHash: String(contract.content_hash || '') }, { contentHash: String(p.contentHash || '') });
      return res.status(400).json(error('ONCHAIN_CONTENT_HASH_MISMATCH', '链上合同哈希与数据库不一致'));
    }
    if (toLowerHex(p.gasAuthNonce) !== toLowerHex(gasAuth.nonce)) {
      logVerifyMismatch('ONCHAIN_GAS_AUTH_NONCE_MISMATCH', { gasAuthNonce: String(gasAuth.nonce || '') }, { gasAuthNonce: String(p.gasAuthNonce || '') });
      return res.status(400).json(error('ONCHAIN_GAS_AUTH_NONCE_MISMATCH', '链上 gas 授权 nonce 与数据库不一致'));
    }
    if (BigInt(p.initialAmountWei || 0) !== initialAmountWei) {
      return res.status(400).json(error('ONCHAIN_INITIAL_AMOUNT_MISMATCH', '链上首笔支付金额与数据库不一致'));
    }
    if (Number(p.startAtMs || 0) !== Number(startAtMs || 0)) {
      return res.status(400).json(error('ONCHAIN_START_AT_MISMATCH', '链上合同起始时间与数据库不一致'));
    }
    if (Number(p.endAtMs || 0) !== Number(endAtMs || 0)) {
      return res.status(400).json(error('ONCHAIN_END_AT_MISMATCH', '链上合同结束时间与数据库不一致'));
    }
    if (toLowerHex(p.tenantMessageHash) !== toLowerHex(tenantMessageHash)) {
      return res.status(400).json(error('ONCHAIN_TENANT_MESSAGE_HASH_MISMATCH', '链上租客签名哈希与数据库不一致'));
    }
    if (toLowerHex(p.landlordMessageHash) !== toLowerHex(landlordMessageHash)) {
      return res.status(400).json(error('ONCHAIN_LANDLORD_MESSAGE_HASH_MISMATCH', '链上房东签名哈希与数据库不一致'));
    }
    if (Number(p.tenantSignedAt || 0) !== Number(tenantSignedAt || 0)) {
      return res.status(400).json(error('ONCHAIN_TENANT_SIGNED_AT_MISMATCH', '链上租客签署时间与数据库不一致'));
    }
    if (String(p.tenantSignature || '') !== String(contract.tenant_signature || '')) {
      return res.status(400).json(error('ONCHAIN_TENANT_SIGNATURE_MISMATCH', '链上租客签名与数据库不一致'));
    }
    if (String(p.landlordSignature || '') !== String(signature || '')) {
      return res.status(400).json(error('ONCHAIN_LANDLORD_SIGNATURE_MISMATCH', '链上房东签名与本次提交不一致'));
    }
    if (!Number.isFinite(landlordMessageTimestamp) || Number(p.landlordSignedAt || 0) < landlordMessageTimestamp) {
      return res.status(400).json(error('ONCHAIN_LANDLORD_SIGNED_AT_INVALID', '链上房东签署时间无效'));
    }

    const contractCreatedLog = parsedLogs.find((log) => log.name === 'ContractCreated' && eventIndexedStringMatches(log.args?.contractId, contract.id));
    if (!contractCreatedLog) {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_CONTRACT_CREATED_EVENT_MISSING',
        txHash: normalizedSignTxHash,
        txFrom: String(onchainTx?.from || '').trim(),
        txTo: String(onchainTx?.to || '').trim(),
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
        expected: {
          contractId: String(contract.id),
          listingId: String(contract.listing_id || ''),
          tenant: normalizedTenantAddress,
          landlord: normalizedLandlordAddress,
          contentHash: String(contract.content_hash || ''),
        },
      });
      return res.status(400).json(error('ONCHAIN_CONTRACT_CREATED_EVENT_MISSING', '链上缺少合同创建事件'));
    }
    if (!eventIndexedStringMatches(contractCreatedLog.args?.listingId, contract.listing_id)
      || toLowerHex(contractCreatedLog.args?.landlord) !== normalizedLandlordAddress.toLowerCase()
      || toLowerHex(contractCreatedLog.args?.tenant) !== normalizedTenantAddress.toLowerCase()
      || toLowerHex(contractCreatedLog.args?.contentHash) !== toLowerHex(contract.content_hash)
    ) {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_CONTRACT_CREATED_EVENT_MISMATCH',
        txHash: normalizedSignTxHash,
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
        actualEvent: {
          contractId: formatEventIndexedString(contractCreatedLog.args?.contractId),
          listingId: formatEventIndexedString(contractCreatedLog.args?.listingId),
          landlord: normalizeWalletAddress(contractCreatedLog.args?.landlord || ''),
          tenant: normalizeWalletAddress(contractCreatedLog.args?.tenant || ''),
          contentHash: String(contractCreatedLog.args?.contentHash || ''),
        },
        expected: {
          contractId: String(contract.id),
          listingId: String(contract.listing_id || ''),
          landlord: normalizedLandlordAddress,
          tenant: normalizedTenantAddress,
          contentHash: String(contract.content_hash || ''),
        },
      });
      return res.status(400).json(error('ONCHAIN_CONTRACT_CREATED_EVENT_MISMATCH', '链上合同创建事件参数与数据库不一致'));
    }
    const tenantSignatureEvent = parsedLogs.find((log) =>
      log.name === 'ContractSignatureAnchored'
      && eventIndexedStringMatches(log.args?.contractId, contract.id)
      && toLowerHex(log.args?.signer) === normalizedTenantAddress.toLowerCase()
      && Number(log.args?.role || 0) === 1
    );
    const landlordSignatureEvent = parsedLogs.find((log) =>
      log.name === 'ContractSignatureAnchored'
      && eventIndexedStringMatches(log.args?.contractId, contract.id)
      && toLowerHex(log.args?.signer) === normalizedLandlordAddress.toLowerCase()
      && Number(log.args?.role || 0) === 2
    );
    if (!tenantSignatureEvent || !landlordSignatureEvent) {
      logSignFlow('sign-landlord.verify-failed', {
        contractId: req.params.id,
        requestId: req.requestId,
        code: 'ONCHAIN_SIGNATURE_EVENT_MISSING',
        txHash: normalizedSignTxHash,
        parsedTx: parsedTxSummary,
        parsedLogs: parsedLogSummary,
      });
      return res.status(400).json(error('ONCHAIN_SIGNATURE_EVENT_MISSING', '链上缺少合同签名锚定事件'));
    }
    if (toLowerHex(tenantSignatureEvent.args?.messageHash) !== toLowerHex(tenantMessageHash)
      || String(tenantSignatureEvent.args?.signature || '') !== String(contract.tenant_signature || '')
      || Number(tenantSignatureEvent.args?.signedAt || 0) !== Number(tenantSignedAt || 0)
    ) {
      return res.status(400).json(error('ONCHAIN_TENANT_SIGNATURE_EVENT_MISMATCH', '链上租客签名锚定事件与数据库不一致'));
    }
    if (toLowerHex(landlordSignatureEvent.args?.messageHash) !== toLowerHex(landlordMessageHash)
      || String(landlordSignatureEvent.args?.signature || '') !== String(signature || '')
      || Number(landlordSignatureEvent.args?.signedAt || 0) < landlordMessageTimestamp
    ) {
      return res.status(400).json(error('ONCHAIN_LANDLORD_SIGNATURE_EVENT_MISMATCH', '链上房东签名锚定事件与本次提交不一致'));
    }
    const paymentDeadline = getCnDateTime(new Date(Date.now() + PAYMENT_WINDOW_MS));
    db.run(
      `UPDATE contracts
       SET landlord_signed_at = datetime('now', '+8 hours'),
           landlord_signer_address = ?,
           landlord_signature = ?,
           landlord_signature_message = ?,
           landlord_sign_ip = ?,
           landlord_sign_user_agent = ?,
           landlord_sign_request_id = ?,
           tx_hash = ?,
           payment_deadline = ?,
           status = 'pending_payment'
       WHERE id = ? AND status = 'tenant_signed'`,
      [
        submittedAddress,
        String(signature || ''),
        String(message || ''),
        getClientIp(req),
        String(req.headers['user-agent'] || ''),
        String(req.requestId || ''),
        String(txHash || '').trim(),
        paymentDeadline,
        req.params.id,
      ]
    );
    if (db.getRowsModified() !== 1) {
      return res.status(409).json(error('SIGN_STATE_CHANGED', '合同状态已变化，请刷新后重试'));
    }
    db.run(
      `UPDATE contract_gas_authorizations
       SET status = 'consumed',
           settle_tx_hash = ?,
           updated_at = datetime('now', '+8 hours')
       WHERE contract_id = ? AND status = 'active'`,
      [String(txHash || '').trim(), req.params.id]
    );
    markOnchainOperationConfirmed(db, {
      opId: signOpId,
      entityType: 'contract',
      entityId: req.params.id,
      operationKind: 'contract.create',
      txHash: normalizedSignTxHash,
      requestId: req.requestId,
      payload: signOpPayload,
      result: { paymentDeadline, onchainState: 'confirmed' },
    });
    saveDb();

    res.json({
      success: true,
      message: '房东签署并上链成功，可继续支付',
      data: {
        contentHash: contract.content_hash,
        tenantAddress: normalizedTenantAddress,
        landlordAddress: normalizedLandlordAddress,
        initialAmount: content?.oneTimeAmount || '',
        onchainState: 'confirmed',
        txHash: String(txHash || '').trim(),
        onchainError: '',
        paymentDeadline,
      },
    });
  } catch (error) {
    logSignFlow('sign-landlord.exception', { contractId: req.params.id, message: error.message, requestId: req.requestId });
    sendError(res, 500, 'LANDLORD_SIGN_FAILED', '房东签署失败');
  }
}));

// 函数 6: 支付成功回写接口（当前仅支持一次性首笔支付）。
router.post('/:id/payments/onchain', authMiddleware, asyncHandler(async (req, res) => {
  const { txHash, amount, payType = 'initial', period = '' } = req.body || {};
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    return sendError(res, 400, 'TX_HASH_INVALID', 'txHash 格式不正确');
  }
  if (payType !== 'initial') {
    return sendError(res, 400, 'PAY_TYPE_INVALID', '当前仅支持 initial');
  }
  if (!amount || Number(amount) <= 0) {
    return sendError(res, 400, 'PAYMENT_AMOUNT_INVALID', 'amount 必须大于 0');
  }

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) {
    return sendError(res, 403, 'TENANT_ONLY', '仅租客可回写支付记录');
  }
  if (contract.status !== 'pending_payment') {
    return res.status(400).json(error('PAYMENT_STATUS_INVALID', '当前状态不允许首笔支付', { currentStatus: contract.status }));
  }

  const content = typeof contract.content_json === 'string' ? JSON.parse(contract.content_json) : contract.content_json;
  const expectedAmount = normalizeAmount(content?.oneTimeAmount || amount);
  const requestedAmount = normalizeAmount(amount);
  if (!expectedAmount || !requestedAmount || expectedAmount !== requestedAmount) {
    return res.status(400).json(error('PAYMENT_AMOUNT_MISMATCH', '支付金额与合同首笔金额不一致', { expectedAmount }));
  }
  const expectedAmountWei = (() => {
    try {
      return ethers.parseEther(String(expectedAmount));
    } catch {
      return 0n;
    }
  })();
  const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress || '');
  const landlordAddress = normalizeWalletAddress(content?.landlord?.walletAddress || '');
  if (!tenantAddress || !landlordAddress) {
    return res.status(400).json(error('WALLET_NOT_BOUND', '合同绑定钱包地址无效，无法校验链上支付'));
  }

  const deadlineAt = parseCnDateTime(contract.payment_deadline || contract.expires_at);
  if (!deadlineAt || deadlineAt <= new Date()) {
    return res.status(400).json(error('PAYMENT_DEADLINE_EXPIRED', '合同已超过支付截止时间，不可支付'));
  }

  const existed = parseResult(db.exec('SELECT id FROM payments WHERE tx_hash = ?', [txHash]));
  if (existed.length > 0) {
    return sendError(res, 409, 'PAYMENT_TX_REUSED', '该支付交易已回写');
  }

  const priorInitial = parseResult(db.exec(
    'SELECT id FROM payments WHERE contract_id = ? AND pay_type = ? AND status = ?',
    [req.params.id, 'initial', 'confirmed']
  ));
  if (priorInitial.length > 0) {
    return sendError(res, 409, 'INITIAL_PAYMENT_ALREADY_RECORDED', '该合同首笔支付已完成');
  }
  const normalizedPaymentTxHash = String(txHash || '').trim().toLowerCase();
  const paymentOpId = `op_payment_initial_${req.params.id}_${normalizedPaymentTxHash}`;
  upsertOnchainOperation(db, {
    opId: paymentOpId,
    entityType: 'payment',
    entityId: req.params.id,
    operationKind: 'payment.initial',
    txHash: normalizedPaymentTxHash,
    status: 'pending',
    requestId: req.requestId,
    payload: { contractId: req.params.id, payerId: req.user.id, payType, amount: String(amount), period: period || '' },
  });

  let onchainTx;
  let parsedTx;
  let parsedLogs;
  try {
    const loaded = await loadConfirmedContractTx(String(txHash || '').trim());
    onchainTx = loaded.tx;
    parsedTx = parseContractTx(loaded.tx);
    parsedLogs = parseContractLogs(loaded.receipt, loaded.contractAddress);
  } catch (chainErr) {
    const chainErrCode = String(chainErr?.code || '').trim();
    if (chainErrCode === 'ONCHAIN_TX_NOT_FOUND') {
      saveDb();
      return res.status(202).json({
        success: true,
        message: '支付交易已提交，后台将自动确认',
        data: { txHash: normalizedPaymentTxHash, onchainState: 'pending' },
      });
    }
    markOnchainOperationFailed(db, {
      opId: paymentOpId,
      entityType: 'payment',
      entityId: req.params.id,
      operationKind: 'payment.initial',
      txHash: normalizedPaymentTxHash,
      requestId: req.requestId,
      payload: { contractId: req.params.id, payerId: req.user.id, payType, amount: String(amount), period: period || '' },
      errorMessage: chainErr.error || chainErr.message || 'payment verify failed',
    });
    return res.status(400).json(error(chainErr.code || 'PAYMENT_TX_VERIFY_FAILED', chainErr.error || chainErr.message || '链上支付交易校验失败'));
  }
  if (!parsedTx || parsedTx.name !== 'recordInitialRentPayment') {
    return res.status(400).json(error('PAYMENT_METHOD_MISMATCH', '链上交易不是首笔支付交易'));
  }
  if (toLowerHex(onchainTx.from) !== tenantAddress.toLowerCase()) {
    return res.status(400).json(error('PAYMENT_PAYER_MISMATCH', '链上付款钱包与合同绑定租客钱包不一致'));
  }
  if (BigInt(onchainTx.value || 0) !== expectedAmountWei) {
    return res.status(400).json(error('PAYMENT_VALUE_MISMATCH', '链上支付金额与合同首笔金额不一致'));
  }
  const payContractId = String(parsedTx.args?.[0] || '');
  const payLandlord = normalizeWalletAddress(parsedTx.args?.[1] || '');
  if (payContractId !== String(contract.id)) {
    return res.status(400).json(error('PAYMENT_CONTRACT_ID_MISMATCH', '链上支付合同 ID 与数据库不一致'));
  }
  if (!payLandlord || payLandlord.toLowerCase() !== landlordAddress.toLowerCase()) {
    return res.status(400).json(error('PAYMENT_LANDLORD_MISMATCH', '链上支付收款房东与数据库不一致'));
  }
  const paymentEvent = parsedLogs.find((log) =>
    log.name === 'RentPaymentRecorded'
    && eventIndexedStringMatches(log.args?.contractId, contract.id)
    && toLowerHex(log.args?.payer) === tenantAddress.toLowerCase()
    && toLowerHex(log.args?.landlord) === landlordAddress.toLowerCase()
  );
  if (!paymentEvent) {
    return res.status(400).json(error('PAYMENT_EVENT_MISSING', '链上缺少首笔支付事件'));
  }
  if (BigInt(paymentEvent.args?.amountWei || 0) !== expectedAmountWei) {
    return res.status(400).json(error('PAYMENT_EVENT_AMOUNT_MISMATCH', '链上支付事件金额与合同首笔金额不一致'));
  }

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.run(
    `INSERT INTO payments (id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+8 hours'))`,
    [paymentId, req.params.id, req.user.id, payType, String(amount), period || '', txHash]
  );

  db.run(
    'UPDATE contracts SET status = \'active\' WHERE id = ? AND status = \'pending_payment\'',
    [req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return sendError(res, 409, 'CONTRACT_STATE_CHANGED', '合同状态已变化，无法完成生效');
  }
  const startDateOnly = normalizeDateOnly(content?.terms?.startDate);
  const startAt = startDateOnly ? new Date(`${startDateOnly}T00:00:00+08:00`) : null;
  const isFutureRenewalStart = !!(contract.parent_contract_id && startAt && !Number.isNaN(startAt.getTime()) && startAt.getTime() > Date.now());

  markOnchainOperationConfirmed(db, {
    opId: paymentOpId,
    entityType: 'payment',
    entityId: req.params.id,
    operationKind: 'payment.initial',
    txHash: normalizedPaymentTxHash,
    requestId: req.requestId,
    payload: { contractId: req.params.id, payerId: req.user.id, payType, amount: String(amount), period: period || '' },
    result: { paymentId, contractStatusAfter: 'active', isFutureRenewalStart },
  });
  saveDb();
  res.json({
    success: true,
    message: isFutureRenewalStart ? '续约支付回写成功，合同已支付待接续' : '支付回写成功',
    data: { paymentId, isFutureRenewalStart },
  });
}));

// 函数 7: 取消合同接口。
router.post('/:id/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];

  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_FORBIDDEN', '无权限取消该合同');
  }
  if (!['pending', 'tenant_signed', 'expired'].includes(contract.status)) {
    return sendError(res, 400, 'CANCEL_STATUS_INVALID', '当前状态不允许取消');
  }
  const gasAuthRows = parseResult(db.exec(
    `SELECT id, status, lock_tx_hash
     FROM contract_gas_authorizations
     WHERE contract_id = ?
     LIMIT 1`,
    [req.params.id]
  ));
  const activeGasAuth = gasAuthRows[0];
  const gasReleasePending = Boolean(
    activeGasAuth
    && String(activeGasAuth.status || '') === 'active'
    && /^0x[a-fA-F0-9]{64}$/.test(String(activeGasAuth.lock_tx_hash || '').trim())
  );
  if (activeGasAuth
    && String(activeGasAuth.status || '') === 'active'
    && /^0x[a-fA-F0-9]{64}$/.test(String(activeGasAuth.lock_tx_hash || '').trim())
  ) {
  }

  if (contract.status !== 'expired') {
    db.run(
      'UPDATE contracts SET status = \'cancelled\' WHERE id = ? AND status IN (\'pending\', \'tenant_signed\')',
      [req.params.id]
    );
    if (db.getRowsModified() !== 1) {
      return sendError(res, 409, 'CONTRACT_STATE_CHANGED', '合同状态已变化，无法取消');
    }
  }
  saveDb();
  res.json({
    success: true,
    message: gasReleasePending
      ? (contract.status === 'expired' ? '过期合同已确认结束，gas 待释放' : '合同已取消，gas 待释放')
      : (contract.status === 'expired' ? '过期合同已确认结束' : '合同已取消'),
    data: {
      gasReleasePending,
    },
  });
}));

// 函数 8: 获取合同支付记录接口。
router.get('/:id/payments', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_FORBIDDEN', '无权限查看该合同支付记录');
  }
  const payments = parseResult(db.exec(
    `SELECT id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at DESC`,
    [req.params.id]
  ));
  res.json({ success: true, data: payments });
}));

// 函数 8-2: 下载合同 PDF。
router.get('/:id/pdf', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_FORBIDDEN', '无权限下载该合同');
  }
  const content = contract.content_json || {};
  const contentHashSpec = buildContentHashSpec(content);
  const tenantMessageHash = buildMessageHash(contract.tenant_signature_message || '');
  const landlordMessageHash = buildMessageHash(contract.landlord_signature_message || '');
  const payments = parseResult(db.exec(
    `SELECT pay_type, amount, period, tx_hash, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at ASC`,
    [req.params.id]
  ));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${contract.id}.pdf"`);
  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);
  const cnFontPath = resolvePdfChineseFontPath();
  if (cnFontPath) {
    try {
      doc.registerFont('cn', cnFontPath);
      doc.font('cn');
    } catch (error) {
      logSignFlow('contract.pdf.font-fallback', {
        contractId: req.params.id,
        requestId: req.requestId || '',
        message: error?.message || 'pdf_font_load_failed',
        fontPath: cnFontPath,
      });
    }
  }
  doc.fontSize(18).text('CCL 房屋租赁合同', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`合同编号：${contract.id}`);
  doc.text(`合同类型：${contract.parent_contract_id ? '续约合同' : '普通合同'}`);
  if (contract.parent_contract_id) doc.text(`父合同编号：${contract.parent_contract_id}`);
  doc.text(`合同状态：${contract.status}`);
  doc.text(`合同版本：v${contract.version || 1}`);
  doc.text(`合同哈希：${contract.content_hash}`);
  doc.text(`链上交易哈希：${contract.tx_hash || '-'}`);
  doc.moveDown();
  doc.fontSize(13).text('合同主体');
  doc.fontSize(10).text(`租客：${content?.tenant?.walletAddress || '-'}`);
  doc.text(`房东：${content?.landlord?.walletAddress || '-'}`);
  doc.moveDown();
  doc.fontSize(13).text('合同条款');
  doc.fontSize(10).text(`房源：${content?.title || '-'} / ${content?.address || '-'}`);
  doc.text(`月租：${content?.rentAmount || '-'} ETH / 月`);
  doc.text(`首笔支付金额：${content?.oneTimeAmount || '-'} ETH`);
  doc.text(`租期：${content?.terms?.startDate || '-'} 至 ${content?.terms?.endDate || '-'}`);
  doc.moveDown(0.5);
  doc.fontSize(11).text('附加条款');
  const clauses = Array.isArray(content?.clauses)
    ? content.clauses.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (clauses.length === 0) {
    doc.fontSize(10).text('无');
  } else {
    clauses.forEach((clause, index) => {
      doc.fontSize(10).text(`${index + 1}. ${clause}`);
    });
  }
  doc.moveDown();
  doc.fontSize(13).text('签署信息');
  doc.fontSize(10).text(`租客签署时间：${contract.tenant_signed_at || '-'}`);
  doc.text(`租客签署地址：${contract.tenant_signer_address || '-'}`);
  doc.text(`租客消息哈希：${tenantMessageHash || '-'}`);
  doc.text(`房东签署时间：${contract.landlord_signed_at || '-'}`);
  doc.text(`房东签署地址：${contract.landlord_signer_address || '-'}`);
  doc.text(`房东消息哈希：${landlordMessageHash || '-'}`);
  doc.moveDown(0.5);
  doc.fontSize(11).text('租客签名消息原文');
  doc.fontSize(9).text(contract.tenant_signature_message || '-', { width: 500 });
  doc.moveDown(0.2);
  doc.fontSize(11).text('租客签名结果');
  doc.fontSize(9).text(contract.tenant_signature || '-', { width: 500 });
  doc.moveDown(0.5);
  doc.fontSize(11).text('房东签名消息原文');
  doc.fontSize(9).text(contract.landlord_signature_message || '-', { width: 500 });
  doc.moveDown(0.2);
  doc.fontSize(11).text('房东签名结果');
  doc.fontSize(9).text(contract.landlord_signature || '-', { width: 500 });
  doc.moveDown();
  doc.fontSize(13).text('支付记录');
  if (payments.length === 0) {
    doc.fontSize(10).text('-');
  } else {
    payments.forEach((p) => {
      doc.fontSize(9).text(`${p.pay_type} | ${p.amount} ETH | ${p.period || '-'} | ${p.tx_hash} | ${p.paid_at}`);
    });
  }
  doc.moveDown();
  doc.fontSize(10).fillColor('black').text('content_hash 生成说明');
  doc.fontSize(8).fillColor('gray').text(`算法：${contentHashSpec.algorithm}`);
  doc.fontSize(8).fillColor('gray').text(`字段：${JSON.stringify(contentHashSpec.fields)}`);
  doc.fontSize(8).fillColor('gray').text(`生成时间：${getCnDateTime(new Date())}`);
  doc.end();
}));
// 函数 8-3: 租客基于原合同发起续约合同。
router.post('/:id/renewals', authMiddleware, requireRole('tenant'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'PARENT_CONTRACT_NOT_FOUND', '原合同不存在');
  const parent = rows[0];
  if (parent.tenant_id !== req.user.id) {
    return sendError(res, 403, 'TENANT_ONLY', '仅租客可发起续约申请');
  }
  if (parent.status !== 'active') {
    return sendError(res, 400, 'RENEWAL_PARENT_STATUS_INVALID', '仅已支付成功的原合同可发起续约申请');
  }
  const parentContent = JSON.parse(JSON.stringify(parent.content_json || {}));
  const parentEndDate = normalizeDateOnly(parentContent?.terms?.endDate);
  if (!parentEndDate) {
    return sendError(res, 400, 'RENEWAL_PARENT_END_DATE_INVALID', '原合同缺少有效结束日期，无法发起续约');
  }
  const now = new Date();
  const parentEndAt = new Date(`${parentEndDate}T23:59:59+08:00`);
  if (Number.isNaN(parentEndAt.getTime()) || parentEndAt.getTime() <= now.getTime()) {
    return sendError(res, 400, 'RENEWAL_WINDOW_EXPIRED', '原合同已过续约申请时点，请重新发起新合同');
  }
  const existingRenewal = parseResult(db.exec(
    `SELECT id FROM contracts
      WHERE parent_contract_id = ?
       AND status NOT IN ('cancelled','expired','ended')
      LIMIT 1`,
    [parent.id]
  ));
  if (existingRenewal.length > 0) return sendError(res, 409, 'RENEWAL_ALREADY_EXISTS', '该原合同已有进行中的续约合同');

  const renewalId = `cnt_ren_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nextLeaseMonths = Number(req.body?.leaseMonths ?? parentContent?.terms?.leaseMonths ?? 1);
  if (!Number.isInteger(nextLeaseMonths) || nextLeaseMonths < 1 || nextLeaseMonths > 12) {
    return sendError(res, 400, 'LEASE_MONTHS_INVALID', '租期必须为 1-12 月的整数');
  }
  const nextStartDate = parentEndDate;
  const nextEndDate = addMonthsDateOnly(nextStartDate, nextLeaseMonths);
  const nextRentAmount = normalizeAmount(parentContent.rentAmount);
  if (!nextRentAmount) return sendError(res, 400, 'RENT_AMOUNT_INVALID', '租金必须为大于 0 的数字');

  let clauses = Array.isArray(parentContent?.clauses) ? parentContent.clauses.map((x) => String(x || '').trim()).filter(Boolean) : [];
  let clauseSource = 'parent_contract';
  if (clauses.length === 0) {
    const listingRows = parseResult(db.exec('SELECT clauses_template_json FROM listings WHERE id = ?', [parent.listing_id]));
    clauses = parseStoredClauses(listingRows[0]?.clauses_template_json);
    clauseSource = 'listing_default';
  }

  const content = JSON.parse(JSON.stringify(parentContent));
  content.contractId = renewalId;
  content.parentContractId = parent.id;
  content.rentAmount = nextRentAmount;
  content.oneTimeAmount = normalizeAmount(Number(nextRentAmount) * nextLeaseMonths);
  content.terms = {
    ...(content.terms || {}),
    startDate: nextStartDate,
    endDate: nextEndDate,
    leaseMonths: nextLeaseMonths,
  };
  content.clauses = clauses;
  content.renewal = {
    parentContractId: parent.id,
    clauseSource,
    requestedBy: req.user.id,
    createdAt: getCnDateTime(new Date()),
    startAtMs: parentEndAt.getTime(),
    note: String(req.body?.changeNote || '续约申请'),
    requestedLeaseMonths: nextLeaseMonths,
  };
  const contentJson = JSON.stringify(content, null, 2);
  const contentHash = makeContractContentHash(content);
  const expiresAt = getCnDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const nextVersion = Number(parent.version || 1) + 1;
  db.run(
    `INSERT INTO contracts (
      id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at,
      negotiation_status, version, parent_contract_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'finalized', ?, ?)`,
    [renewalId, parent.listing_id, parent.tenant_id, parent.landlord_id, contentJson, contentHash, expiresAt, nextVersion, parent.id]
  );
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status, decided_at, decided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', datetime('now', '+8 hours'), ?)`,
    [`cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, renewalId, nextVersion, req.user.id, contentJson, contentHash, String(req.body?.changeNote || '续约申请初始化'), req.user.id]
  );
  saveDb();
  res.json({ success: true, message: '续约合同已创建，请按正常流程重新签署', data: { contractId: renewalId, contentHash, clauseSource } });
}));

// 函数 9: 前端签署失败上报接口。
router.post('/:id/sign-client-report', authMiddleware, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  logSignFlow('client.report', {
    contractId: req.params.id,
    userId: req.user.id,
    requestId: req.requestId,
    ...payload,
  });
  res.json({ success: true });
}));

// 函数 10: 获取我的合同列表接口。
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id
    WHERE c.tenant_id = ? OR c.landlord_id = ? ORDER BY c.created_at DESC`, [req.user.id, req.user.id]));
  rows.forEach((row) => {
    const onchain = getLatestOnchainStatus(db, 'contract', row.id, CONTRACT_ONCHAIN_KINDS);
    row.onchain_state = onchain.status;
    row.onchain_error_message = onchain.errorMessage;
    row.onchain_tx_hash = onchain.txHash;
  });
  res.json({ success: true, data: rows });
}));

// 函数 11: 获取合同详情接口。
router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const userDb = await getUserDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id WHERE c.id = ?`, [req.params.id]));
  if (!rows.length) return sendError(res, 404, 'CONTRACT_NOT_FOUND', '合同不存在');
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return sendError(res, 403, 'CONTRACT_FORBIDDEN', '无权限查看该合同');
  }
  // 补充双方联系方式
  const tenantProfiles = parseUserResult(userDb.exec('SELECT phone, nickname FROM users WHERE id = ?', [contract.tenant_id]));
  const landlordProfiles = parseUserResult(userDb.exec('SELECT phone, nickname FROM users WHERE id = ?', [contract.landlord_id]));
  contract.tenant_phone = tenantProfiles[0]?.phone || '';
  contract.landlord_phone = landlordProfiles[0]?.phone || '';
  const gasAuthRows = parseResult(db.exec(
    `SELECT status, tenant_address, landlord_address, cap_wei, deadline_epoch_ms, nonce, contract_address,
            lock_tx_hash, mark_tx_hash, revoke_tx_hash, settle_tx_hash, updated_at
     FROM contract_gas_authorizations
     WHERE contract_id = ?
     LIMIT 1`,
    [req.params.id]
  ));
  contract.gas_auth = gasAuthRows[0] || null;
  const renewalChildRows = parseResult(db.exec(
    `SELECT id, status, created_at
     FROM contracts
     WHERE parent_contract_id = ?
       AND status NOT IN ('cancelled','expired','ended')
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.params.id]
  ));
  contract.renewal_child_contract = renewalChildRows[0] || null;
  contract.is_renewal = !!String(contract.parent_contract_id || '').trim();
  {
    const onchain = getLatestOnchainStatus(db, 'contract', contract.id, CONTRACT_ONCHAIN_KINDS);
    contract.onchain_state = onchain.status;
    contract.onchain_error_message = onchain.errorMessage;
    contract.onchain_tx_hash = onchain.txHash;
  }
  res.json({ success: true, data: contract });
}));

module.exports = router;

