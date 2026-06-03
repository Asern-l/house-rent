/**
 * 文件说明：后端服务入口。
 * 负责加载中间件、注册路由、数据库迁移和服务启动。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const RENTAL_CHAIN_ABI = require('../../frontend/src/shared/blockchain/RentalChainABI.json');
const { migrate, getDb, parseResult, saveDb, CHAIN_ENV, DB_PATH } = require('./db');
const { getUserDb, saveUserDb, getUserDbPath } = require('./user-db');
const { logApiError, logSystemError, logRiskEvent } = require('./logger');
const {
  upsertOnchainOperation,
  markOnchainOperationConfirmed,
  markOnchainOperationFailed,
} = require('./onchain-operations');
const { parseContractEndAtMs } = require('./listing-public-state');
const { isIpfsEnabled, addJsonToIpfs, sha256Hex } = require('./ipfs');
const { createNotifications } = require('./notifications');
const contractRoutes = require('./routes/contracts');
const listingRoutes = require('./routes/listings');
const notificationRoutes = require('./routes/notifications');
const { AppError, error: buildError } = require('./app-error');
const iface = new ethers.Interface(RENTAL_CHAIN_ABI);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '127.0.0.1');
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || '100mb');
const PAYMENT_WINDOW_HOURS = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS || 2));
const PLATFORM_FEE_BPS = 10n;
const PERFORMANCE_GUARANTEE_BPS = 1000n;
const BPS_DENOMINATOR = 10000n;
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 函数 1: 生成请求追踪ID，便于前后端日志关联。
function createRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 函数 2: 生成北京时间字符串（用于接口展示）。
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

function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function computePlatformFeeBreakdownFromEth(amountEth, leaseMonths = 1) {
  const normalized = normalizeAmount(amountEth);
  if (!normalized) {
    return {
      platformFeeWei: '0',
      landlordNetWei: '0',
      performanceGuaranteeWei: '0',
      escrowWei: '0',
      monthlyReleaseWei: '0',
    };
  }
  const grossWei = ethers.parseEther(String(normalized));
  const feeWei = (grossWei * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const netWei = grossWei - feeWei;
  const guaranteeWei = (netWei * PERFORMANCE_GUARANTEE_BPS) / BPS_DENOMINATOR;
  const escrowWei = netWei - guaranteeWei;
  const monthlyReleaseWei = escrowWei / BigInt(Math.max(1, Number(leaseMonths || 1)));
  return {
    platformFeeWei: feeWei.toString(),
    landlordNetWei: netWei.toString(),
    performanceGuaranteeWei: guaranteeWei.toString(),
    escrowWei: escrowWei.toString(),
    monthlyReleaseWei: monthlyReleaseWei.toString(),
  };
}

// 函数 3: 安装基础中间件（安全、跨域、解析、日志、限流）。
function setupMiddlewares() {
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(':method :url :status :response-time ms'));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后重试' },
    skip: (req) => req.path === '/health',
  }));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));
}

// 函数 4: 安装请求ID中间件。
function setupRequestId() {
  app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || '').trim() || createRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
}

// 函数 5: 注册业务路由。
function setupRoutes() {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/listings', listingRoutes);
  app.use('/api/contracts', contractRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/verify', require('./routes/verify'));

  app.get('/api/health', (req, res) => {
    const now = new Date();
    res.json({
      success: true,
      status: 'ok',
      now: now.toISOString(),
      nowCn: formatCnTime(now),
      chainEnv: CHAIN_ENV,
      dbFile: DB_PATH,
    });
  });

  app.get('/api/console/status', asyncHandler(async (req, res) => {
    const db = await getDb();
    const counts = {
      listings: parseResult(db.exec('SELECT COUNT(*) AS count FROM listings'))[0]?.count || 0,
      contracts: parseResult(db.exec('SELECT COUNT(*) AS count FROM contracts'))[0]?.count || 0,
      payments: parseResult(db.exec('SELECT COUNT(*) AS count FROM payments'))[0]?.count || 0,
      pendingOnchainOperations: parseResult(db.exec("SELECT COUNT(*) AS count FROM onchain_operations WHERE status = 'pending'"))[0]?.count || 0,
      pendingOnchainContracts: parseResult(db.exec("SELECT COUNT(*) AS count FROM onchain_operations WHERE entity_type = 'contract' AND status = 'pending'"))[0]?.count || 0,
      pendingOnchainListings: parseResult(db.exec("SELECT COUNT(*) AS count FROM onchain_operations WHERE entity_type = 'listing' AND status = 'pending'"))[0]?.count || 0,
    };
    res.json({
      success: true,
      data: {
        chainEnv: CHAIN_ENV,
        dbFile: DB_PATH,
        authPort: Number(process.env.AUTH_PORT || 3005),
        port: PORT,
        rpcUrl: CHAIN_ENV === 'local' ? (process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545') : (process.env.SEPOLIA_RPC_URL || ''),
        rentalChainAddress: (() => {
          const fs = require('fs');
          const df = CHAIN_ENV === 'local'
            ? path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json')
            : path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
          try { if (fs.existsSync(df)) return JSON.parse(fs.readFileSync(df, 'utf8')).address || ''; } catch {}
          return '';
        })(),
        counts,
      },
    });
  }));
}

// 函数 5-1: 记录请求完成时的 4xx/5xx 响应日志（覆盖非异常分支）。
function setupResponseStatusLogger() {
  app.use((req, res, next) => {
    const startAt = Date.now();
    res.on('finish', () => {
      const status = Number(res.statusCode || 0);
      if (status < 400) return;
      logApiError('response.status', {
        requestId: req.requestId || '',
        method: req.method,
        url: req.originalUrl || req.url || '',
        status,
        userId: req.user?.id || '',
        ip: req.ip || '',
        durationMs: Date.now() - startAt,
      });
    });
    next();
  });
}

// 函数 6: 注册兜底异常处理。
function setupErrorHandlers() {
  app.use((req, res) => {
    logApiError('not-found', {
      requestId: req.requestId || '',
      method: req.method,
      url: req.originalUrl || req.url || '',
      status: 404,
      ip: req.ip || '',
      userId: req.user?.id || '',
    });
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      logApiError('middleware.payload-too-large', {
        requestId: req.requestId || '',
        method: req.method,
        url: req.originalUrl || req.url || '',
        status: 413,
        userId: req.user?.id || '',
        ip: req.ip || '',
        message: err?.message || 'payload_too_large',
      });
      return res.status(413).json({ error: `请求体过大，请压缩图片或减少上传数量（当前限制 ${JSON_BODY_LIMIT}）` });
    }

    logApiError('middleware.exception', {
      requestId: req.requestId || '',
      method: req.method,
      url: req.originalUrl || req.url || '',
      status: err?.status || 500,
      userId: req.user?.id || '',
      ip: req.ip || '',
      message: err?.message || 'unknown_error',
      stack: err?.stack || '',
    });
    if (err instanceof AppError) {
      return res.status(err.status).json(buildError(err.code, err.message, err.extra));
    }
    res.status(500).json({ error: '服务端内部错误' });
  });
}

// 函数 6-1: 获取链运行配置（合约地址唯一来源：部署 JSON 文件）。
function getChainRuntime() {
  const rpcUrl = CHAIN_ENV === 'local'
    ? String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim()
    : String(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com').trim();

  let contractAddress = '';
  const deployFile = CHAIN_ENV === 'local'
    ? path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json')
    : path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
  if (fs.existsSync(deployFile)) {
    const deploy = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
    contractAddress = String(deploy.address || '').trim();
  }
  return { rpcUrl, contractAddress };
}

function loadCurrentDeployment() {
  const deployFile = CHAIN_ENV === 'local'
    ? path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json')
    : path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
  if (!fs.existsSync(deployFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(deployFile, 'utf8')) || {};
  } catch {
    return {};
  }
}

function normalizeWalletAddress(value) {
  const addr = String(value || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return '';
  return ethers.getAddress(addr);
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

function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

function safeParseJsonObject(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function enqueueNotificationsForDb(db, entries) {
  createNotifications(db, entries);
}

function buildListingPublicSnapshotPayload({
  listingId,
  landlordId = '',
  title,
  description,
  address,
  district = '',
  rentAmount,
  rentCycle = 'month',
  minLeaseMonths = 1,
  bedrooms = 1,
  livingrooms = 1,
  bathrooms = 1,
  area = 0,
  clauses = [],
  imageUrls = [],
  imageHashes = [],
  imageCids = [],
  contentHash = '',
  status = 'available',
  txHash = '',
}) {
  return {
    listingId: String(listingId || ''),
    landlordId: String(landlordId || ''),
    title: String(title || '').trim(),
    description: String(description || '').trim(),
    address: String(address || '').trim(),
    district: String(district || '').trim(),
    rentAmount: String(rentAmount || '').trim(),
    rentCycle: String(rentCycle || 'month').trim(),
    minLeaseMonths: Number(minLeaseMonths || 1),
    bedrooms: Number(bedrooms || 1),
    livingrooms: Number(livingrooms || 1),
    bathrooms: Number(bathrooms || 1),
    area: Number(area || 0),
    clauses: Array.isArray(clauses) ? clauses : [],
    imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
    imageHashes: Array.isArray(imageHashes) ? imageHashes.map((item) => String(item || '').toLowerCase()) : [],
    imageCids: Array.isArray(imageCids) ? imageCids.map((item) => String(item || '').trim()) : [],
    contentHash: String(contentHash || '').trim().toLowerCase(),
    status: String(status || 'available').trim().toLowerCase(),
    txHash: String(txHash || '').trim().toLowerCase(),
  };
}

async function storeListingPublicSnapshot(snapshot) {
  const json = JSON.stringify(snapshot);
  if (!isIpfsEnabled()) {
    return { cid: '', contentHash: sha256Hex(json) };
  }
  const uploaded = await addJsonToIpfs(snapshot, {
    fileName: `listing-snapshot-${String(snapshot.listingId || 'unknown')}.json`,
  });
  return { cid: uploaded.cid, contentHash: uploaded.contentHash };
}

function normalizeEventArgs(args) {
  const obj = typeof args?.toObject === 'function' ? args.toObject() : (args || {});
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = (value && typeof value === 'object' && value._isIndexed) ? String(value.hash) : value;
  }
  return result;
}

async function loadConfirmedOnchainTx(provider, contractAddress, txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { pending: true };
  if (receipt.status !== 1) return { failed: true, reason: 'onchain_tx_reverted', receipt };
  const tx = await provider.getTransaction(txHash);
  if (!tx) return { failed: true, reason: 'onchain_tx_missing', receipt };
  if (toLowerHex(tx.to) !== toLowerHex(contractAddress)) {
    return { failed: true, reason: 'onchain_tx_target_invalid', receipt, tx };
  }
  const block = await provider.getBlock(receipt.blockNumber);
  const parsedLogs = [];
  for (const log of receipt.logs || []) {
    if (toLowerHex(log.address) !== toLowerHex(contractAddress)) continue;
    try {
      const parsedLog = iface.parseLog({ topics: log.topics, data: log.data });
      parsedLogs.push({ name: parsedLog.name, args: normalizeEventArgs(parsedLog.args) });
    } catch {
      // ignore unrelated logs
    }
  }
  return {
    pending: false,
    failed: false,
    receipt,
    tx,
    block,
    parsedLogs,
  };
}

// 函数 6-2: 链上补偿任务（修复 pending 操作和缺失区块元数据）。
async function reconcileUnifiedOnchainOperations() {
  const db = await getDb();
  const pendingOps = parseResult(db.exec(
    `SELECT op_id, entity_type, entity_id, operation_kind, tx_hash, payload_json, status
     FROM onchain_operations
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 80`
  ));
  if (pendingOps.length === 0) return;

  const { rpcUrl, contractAddress } = getChainRuntime();
  const hasRuntime = rpcUrl && ethers.isAddress(contractAddress);
  const provider = hasRuntime ? new ethers.JsonRpcProvider(rpcUrl) : null;
  const contract = hasRuntime ? new ethers.Contract(contractAddress, RENTAL_CHAIN_ABI, provider) : null;

  for (const op of pendingOps) {
    try {
      if (String(op.operation_kind || '').startsWith('listing.')) {
        if (!hasRuntime) continue;
        const payload = safeParseJsonObject(op.payload_json, {});
        const loaded = await loadConfirmedOnchainTx(provider, contractAddress, op.tx_hash);
        if (loaded.pending) continue;
        if (loaded.failed) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: loaded.reason || 'listing onchain operation failed',
          });
          continue;
        }
        const boundWallet = toLowerHex(payload.landlordWallet);
        if (boundWallet && toLowerHex(loaded.tx.from) !== boundWallet) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'listing_signer_mismatch',
          });
          continue;
        }
        if (op.operation_kind === 'listing.create') {
          const draft = payload.draft || {};
          const chainAnchor = payload.chainAnchor || {};
          const createdLog = loaded.parsedLogs.find((log) =>
            log.name === 'ListingCreated'
            && String(log.args?.listingId || '').toLowerCase() === ethers.id(String(draft.listingId || '')).toLowerCase()
          );
          const expectedWei = String(chainAnchor.rentAmountWei || '');
          const expectedImageRootHash = toLowerHex(chainAnchor.imageRootHash);
          if (
            !createdLog
            || toLowerHex(createdLog.args?.landlord) !== boundWallet
            || toLowerHex(createdLog.args?.contentHash) !== toLowerHex(chainAnchor.contentHash)
            || String(createdLog.args?.rentAmountWei || '') !== expectedWei
            || Number(createdLog.args?.minLeaseMonths || 0) !== Number(chainAnchor.minLeaseMonths || 0)
            || toLowerHex(createdLog.args?.imageRootHash) !== expectedImageRootHash
          ) {
            markOnchainOperationFailed(db, {
              opId: op.op_id,
              entityType: op.entity_type,
              entityId: op.entity_id,
              operationKind: op.operation_kind,
              txHash: op.tx_hash,
              errorMessage: 'listing_create_event_mismatch',
            });
            continue;
          }
          const snapshotLog = loaded.parsedLogs.find((log) =>
            log.name === 'ListingSnapshotAnchored'
            && String(log.args?.listingId || '').toLowerCase() === ethers.id(String(draft.listingId || '')).toLowerCase()
            && Number(log.args?.version || 0) === Number(createdLog.args?.version || 0)
            && toLowerHex(log.args?.contentHash) === toLowerHex(chainAnchor.contentHash)
            && toLowerHex(log.args?.snapshotHash) === toLowerHex(chainAnchor.snapshotHash)
            && String(log.args?.snapshotCid || '').trim() === String(chainAnchor.snapshotCid || '').trim()
          );
          if (!snapshotLog) {
            markOnchainOperationFailed(db, {
              opId: op.op_id,
              entityType: op.entity_type,
              entityId: op.entity_id,
              operationKind: op.operation_kind,
              txHash: op.tx_hash,
              errorMessage: 'listing_snapshot_anchor_mismatch',
            });
            continue;
          }

          const existed = parseResult(db.exec('SELECT id, tx_hash FROM listings WHERE id = ?', [payload.listingId || op.entity_id]))[0];
          if (!existed) {
            db.run(`INSERT INTO listings (
              id, landlord_id, title, description, address, district, rent_amount,
              rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
              clauses_template_json, image_urls, image_hashes, image_cids, public_snapshot_cid, public_snapshot_hash, tx_hash, status,
              chain_version, chain_nonce, chain_block_number, chain_block_time, content_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?)`, [
              draft.listingId,
              payload.landlordId || '',
              draft.title || '',
              draft.description || '',
              draft.address || '',
              draft.district || '',
              draft.rentAmount || '',
              draft.rentCycle || 'month',
              Number(draft.minLeaseMonths || 1),
              Number(draft.bedrooms || 1),
              Number(draft.livingrooms || 1),
              Number(draft.bathrooms || 1),
              Number(draft.area || 0),
              JSON.stringify(Array.isArray(draft.clauses) ? draft.clauses : []),
              JSON.stringify(Array.isArray(draft.imageUrls) ? draft.imageUrls : []),
              JSON.stringify(Array.isArray(draft.imageHashes) ? draft.imageHashes : []),
              JSON.stringify(Array.isArray(draft.imageCids) ? draft.imageCids : []),
              String(chainAnchor.snapshotCid || '').trim(),
              String(chainAnchor.snapshotHash || '').trim().toLowerCase(),
              op.tx_hash,
              Number(createdLog.args?.version || 0),
              Number(createdLog.args?.nonce || 0),
              Number(loaded.receipt.blockNumber || 0),
              Number(loaded.block?.timestamp || 0),
              String(chainAnchor.contentHash || ''),
            ]);
          } else {
            db.run(
                `UPDATE listings
                 SET tx_hash = ?,
                    image_cids = CASE WHEN COALESCE(image_cids, '') = '' OR image_cids = '[]' THEN ? ELSE image_cids END,
                    public_snapshot_cid = CASE WHEN COALESCE(public_snapshot_cid, '') = '' THEN ? ELSE public_snapshot_cid END,
                    public_snapshot_hash = CASE WHEN COALESCE(public_snapshot_hash, '') = '' THEN ? ELSE public_snapshot_hash END,
                    chain_version = ?,
                    chain_nonce = ?,
                    chain_block_number = ?,
                   chain_block_time = ?,
                   content_hash = CASE WHEN COALESCE(content_hash, '') = '' THEN ? ELSE content_hash END,
                   updated_at = datetime('now', '+8 hours')
               WHERE id = ?`,
              [
                op.tx_hash,
                JSON.stringify(Array.isArray(draft.imageCids) ? draft.imageCids : []),
                String(chainAnchor.snapshotCid || '').trim(),
                String(chainAnchor.snapshotHash || '').trim().toLowerCase(),
                Number(createdLog.args?.version || 0),
                Number(createdLog.args?.nonce || 0),
                Number(loaded.receipt.blockNumber || 0),
                Number(loaded.block?.timestamp || 0),
                String(chainAnchor.contentHash || ''),
                payload.listingId || op.entity_id,
              ]
            );
          }
          markOnchainOperationConfirmed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            result: {
              eventName: 'ListingCreated',
              blockNumber: Number(loaded.receipt.blockNumber || 0),
              blockTime: Number(loaded.block?.timestamp || 0),
            },
          });
          continue;
        }

        if (op.operation_kind === 'listing.status') {
          const statusLog = loaded.parsedLogs.find((log) =>
            log.name === 'ListingStatusChanged'
            && String(log.args?.listingId || '').toLowerCase() === ethers.id(String(payload.listingId || op.entity_id)).toLowerCase()
          );
          const nextStatus = String(payload.nextStatus || '').trim();
          const nextStatusEnum = { available: 0, offline: 1, closed: 2 }[nextStatus];
          if (
            !statusLog
            || Number(statusLog.args?.newStatus ?? -1) !== Number(nextStatusEnum ?? -1)
          ) {
            markOnchainOperationFailed(db, {
              opId: op.op_id,
              entityType: op.entity_type,
              entityId: op.entity_id,
              operationKind: op.operation_kind,
              txHash: op.tx_hash,
              errorMessage: 'listing_status_event_mismatch',
            });
            continue;
          }
          db.run(
            `UPDATE listings
             SET status = ?,
                 tx_hash = ?,
                 chain_version = ?,
                 chain_nonce = ?,
                 chain_block_number = ?,
                 chain_block_time = ?,
                 updated_at = datetime('now', '+8 hours')
             WHERE id = ?`,
            [
              nextStatus,
              op.tx_hash,
              Number(statusLog.args?.version || 0),
              Number(statusLog.args?.nonce || 0),
              Number(loaded.receipt.blockNumber || 0),
              Number(loaded.block?.timestamp || 0),
              payload.listingId || op.entity_id,
            ]
          );
          markOnchainOperationConfirmed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            result: { eventName: 'ListingStatusChanged', toStatus: nextStatus },
          });
          continue;
        }

        if (op.operation_kind === 'listing.terms') {
          const termsLog = loaded.parsedLogs.find((log) =>
            log.name === 'ListingContentUpdated'
            && String(log.args?.listingId || '').toLowerCase() === ethers.id(String(payload.listingId || op.entity_id)).toLowerCase()
          );
          if (
            !termsLog
            || toLowerHex(termsLog.args?.newContentHash) !== toLowerHex(payload.contentHash)
            || String(termsLog.args?.newRentAmountWei || '') !== String(payload.expectedRentAmountWei || '')
            || Number(termsLog.args?.newMinLeaseMonths || 0) !== Number(payload.minLeaseMonths || 0)
            || toLowerHex(termsLog.args?.newImageRootHash) !== toLowerHex(payload.expectedImageRootHash)
          ) {
            markOnchainOperationFailed(db, {
              opId: op.op_id,
              entityType: op.entity_type,
              entityId: op.entity_id,
              operationKind: op.operation_kind,
              txHash: op.tx_hash,
              errorMessage: 'listing_terms_event_mismatch',
            });
            continue;
          }
          const snapshotLog = loaded.parsedLogs.find((log) =>
            log.name === 'ListingSnapshotAnchored'
            && String(log.args?.listingId || '').toLowerCase() === ethers.id(String(payload.listingId || op.entity_id)).toLowerCase()
            && Number(log.args?.version || 0) === Number(termsLog.args?.version || 0)
            && toLowerHex(log.args?.contentHash) === toLowerHex(payload.contentHash)
            && toLowerHex(log.args?.snapshotHash) === toLowerHex(payload.snapshotHash)
            && String(log.args?.snapshotCid || '').trim() === String(payload.snapshotCid || '').trim()
          );
          if (!snapshotLog) {
            markOnchainOperationFailed(db, {
              opId: op.op_id,
              entityType: op.entity_type,
              entityId: op.entity_id,
              operationKind: op.operation_kind,
              txHash: op.tx_hash,
              errorMessage: 'listing_snapshot_anchor_mismatch',
            });
            continue;
          }
          db.run(
            `UPDATE listings
             SET rent_amount = ?,
                 min_lease_months = ?,
                 clauses_template_json = ?,
                 image_urls = ?,
                 image_hashes = ?,
                 image_cids = ?,
                 public_snapshot_cid = ?,
                 public_snapshot_hash = ?,
                 tx_hash = ?,
                 chain_version = ?,
                 chain_nonce = ?,
                 chain_block_number = ?,
                 chain_block_time = ?,
                 updated_at = datetime('now', '+8 hours')
             WHERE id = ?`,
            [
              String(payload.rentAmount || ''),
              Number(payload.minLeaseMonths || 1),
              JSON.stringify(Array.isArray(payload.clauses) ? payload.clauses : []),
              JSON.stringify(Array.isArray(payload.imageUrls) ? payload.imageUrls : []),
              JSON.stringify(Array.isArray(payload.imageHashes) ? payload.imageHashes : []),
              JSON.stringify(Array.isArray(payload.imageCids) ? payload.imageCids : []),
              String(payload.snapshotCid || '').trim(),
              String(payload.snapshotHash || '').trim().toLowerCase(),
              op.tx_hash,
              Number(termsLog.args?.version || 0),
              Number(termsLog.args?.nonce || 0),
              Number(loaded.receipt.blockNumber || 0),
              Number(loaded.block?.timestamp || 0),
              payload.listingId || op.entity_id,
            ]
          );
          markOnchainOperationConfirmed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            result: { eventName: 'ListingContentUpdated' },
          });
          continue;
        }
        continue;
      }

      if (op.operation_kind === 'contract.create') {
        if (!hasRuntime) continue;
        const payload = safeParseJsonObject(op.payload_json, {});
        const contractRow = parseResult(db.exec(
          `SELECT id, listing_id, parent_contract_id, content_hash, tenant_signature, status, payment_deadline
           FROM contracts
           WHERE id = ?
           LIMIT 1`,
          [op.entity_id]
        ))[0];
        if (!contractRow) continue;
        if (['pending_payment', 'active'].includes(String(contractRow.status || '')) && String(contractRow.payment_deadline || '').trim()) {
          markOnchainOperationConfirmed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            result: { contractStatusAfter: contractRow.status, paymentDeadline: contractRow.payment_deadline || '' },
          });
          continue;
        }
        const loaded = await loadConfirmedOnchainTx(provider, contractAddress, op.tx_hash);
        if (loaded.pending) continue;
        if (loaded.failed) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: loaded.reason || 'contract create reconcile failed',
          });
          continue;
        }
        let parsedTx;
        try {
          parsedTx = contract.interface.parseTransaction({ data: loaded.tx.data, value: loaded.tx.value });
        } catch {
          parsedTx = null;
        }
        if (!parsedTx || parsedTx.name !== 'createContractRecord') {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'onchain_tx_method_invalid',
          });
          continue;
        }
        const args = parsedTx.args?.[0];
        if (
          !args
          || String(args.contractId || '') !== String(contractRow.id)
          || String(args.listingId || '') !== String(contractRow.listing_id || '')
          || String(args.parentContractId || '') !== String(payload.parentContractId || '')
          || toLowerHex(args.tenant) !== toLowerHex(payload.tenantAddress)
          || toLowerHex(args.landlord) !== toLowerHex(payload.landlordAddress)
          || toLowerHex(args.contentHash) !== toLowerHex(contractRow.content_hash)
          || toLowerHex(args.gasAuthNonce) !== toLowerHex(String(payload.gasAuthNonce || ''))
          || BigInt(args.initialAmountWei || 0) !== BigInt(String(payload.initialAmountWei || '0'))
          || BigInt(args.startAtMs || 0) !== BigInt(Number(payload.startAtMs || 0))
          || BigInt(args.endAtMs || 0) !== BigInt(Number(payload.endAtMs || 0))
          || toLowerHex(args.tenantMessageHash) !== toLowerHex(payload.tenantMessageHash)
          || toLowerHex(args.landlordMessageHash) !== toLowerHex(payload.messageHash)
          || BigInt(args.tenantSignedAt || 0) !== BigInt(Number(payload.tenantSignedAt || 0))
          || String(args.tenantSignature || '') !== String(payload.tenantSignature || contractRow.tenant_signature || '')
          || String(args.landlordSignature || '') !== String(payload.signature || '')
        ) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'onchain_calldata_mismatch',
          });
          continue;
        }
        const createdEvent = loaded.parsedLogs.find((log) =>
          log.name === 'ContractCreated' && eventIndexedStringMatches(log.args?.contractId, contractRow.id)
        );
        const tenantAnchored = loaded.parsedLogs.find((log) =>
          log.name === 'ContractSignatureAnchored'
          && eventIndexedStringMatches(log.args?.contractId, contractRow.id)
          && Number(log.args?.role || 0) === 1
          && toLowerHex(log.args?.signer) === toLowerHex(payload.tenantAddress)
        );
        const landlordAnchored = loaded.parsedLogs.find((log) =>
          log.name === 'ContractSignatureAnchored'
          && eventIndexedStringMatches(log.args?.contractId, contractRow.id)
          && Number(log.args?.role || 0) === 2
          && toLowerHex(log.args?.signer) === toLowerHex(payload.landlordAddress)
        );
        if (!createdEvent || !tenantAnchored || !landlordAnchored) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'onchain_event_missing',
          });
          continue;
        }
        const landlordSignedAtMs = Number(landlordAnchored.args?.signedAt || 0) || (Number(loaded.block?.timestamp || 0) * 1000);
        const paymentDeadline = getCnDateTime(new Date(landlordSignedAtMs + PAYMENT_WINDOW_MS));
        db.run(
          `UPDATE contracts
           SET landlord_signed_at = ?,
               landlord_signer_address = ?,
               landlord_signature = ?,
               landlord_signature_message = ?,
               tx_hash = ?,
               payment_deadline = ?,
               status = CASE WHEN status = 'tenant_signed' THEN 'pending_payment' ELSE status END,
               updated_at = datetime('now', '+8 hours')
           WHERE id = ?`,
          [
            getCnDateTime(new Date(landlordSignedAtMs)),
            String(payload.signerAddress || payload.landlordAddress || ''),
            String(payload.signature || ''),
            String(payload.message || ''),
            op.tx_hash,
            paymentDeadline,
            contractRow.id,
          ]
        );
        db.run(
          `UPDATE contract_gas_authorizations
           SET status = 'consumed',
               settle_tx_hash = ?,
               updated_at = datetime('now', '+8 hours')
           WHERE contract_id = ?
             AND status = 'active'`,
          [op.tx_hash, contractRow.id]
        );
        enqueueNotificationsForDb(db, [
          {
            recipientId: contractRow.tenant_id,
            actorId: contractRow.landlord_id,
            actorRole: 'landlord',
            kind: 'contract.pending_payment',
            entityType: 'contract',
            entityId: contractRow.id,
            title: '房东已签署，合同待支付',
            body: `合同 ${contractRow.id} 已完成上链签署，当前等待租客支付。`,
            metadata: { contractId: contractRow.id, listingId: contractRow.listing_id, txHash: op.tx_hash, paymentDeadline },
            dedupeKey: `contract.pending_payment:${contractRow.id}:${op.tx_hash}`,
          },
        ]);
        markOnchainOperationConfirmed(db, {
          opId: op.op_id,
          entityType: op.entity_type,
          entityId: op.entity_id,
          operationKind: op.operation_kind,
          txHash: op.tx_hash,
          result: { contractStatusAfter: 'pending_payment', paymentDeadline },
        });
        continue;
      }

      if (!provider || !contract) continue;
      const receipt = await provider.getTransactionReceipt(op.tx_hash);
      if (!receipt) continue;
      if (receipt.status !== 1) {
        markOnchainOperationFailed(db, {
          opId: op.op_id,
          entityType: op.entity_type,
          entityId: op.entity_id,
          operationKind: op.operation_kind,
          txHash: op.tx_hash,
          errorMessage: 'onchain transaction reverted',
        });
        continue;
      }
      const tx = await provider.getTransaction(op.tx_hash);
      if (!tx || toLowerHex(tx.to) !== toLowerHex(contractAddress)) {
        markOnchainOperationFailed(db, {
          opId: op.op_id,
          entityType: op.entity_type,
          entityId: op.entity_id,
          operationKind: op.operation_kind,
          txHash: op.tx_hash,
          errorMessage: 'onchain target contract mismatch',
        });
        continue;
      }
      const parsedTx = contract.interface.parseTransaction({ data: tx.data, value: tx.value });
      const parsedLogs = [];
      for (const log of receipt.logs || []) {
        if (toLowerHex(log.address) !== toLowerHex(contractAddress)) continue;
        try {
          parsedLogs.push(contract.interface.parseLog({ topics: log.topics, data: log.data }));
        } catch {
          // ignore
        }
      }

      if (op.operation_kind === 'payment.initial') {
        const paymentRow = parseResult(db.exec('SELECT id FROM payments WHERE tx_hash = ?', [op.tx_hash]))[0];
        if (paymentRow) {
          markOnchainOperationConfirmed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            result: { paymentId: paymentRow.id },
          });
          continue;
        }
        const contractRow = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [op.entity_id]))[0];
        if (!contractRow) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'contract not found for payment reconcile',
          });
          continue;
        }
        const content = typeof contractRow.content_json === 'string' ? JSON.parse(contractRow.content_json) : (contractRow.content_json || {});
        const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress || '');
        const landlordAddress = normalizeWalletAddress(content?.landlord?.walletAddress || '');
        const expectedAmountWei = ethers.parseEther(String(content?.oneTimeAmount || '0'));
        const paymentBreakdown = computePlatformFeeBreakdownFromEth(content?.oneTimeAmount || '0', Number(content?.terms?.leaseMonths || 1));
        const deployment = loadCurrentDeployment();
        const platformFeeRecipient = (() => {
          try {
            const addr = String(deployment?.platformFeeRecipient || deployment?.trustedSigner || deployment?.deployer || '').trim();
            return /^0x[a-fA-F0-9]{40}$/.test(addr) ? addr.toLowerCase() : '';
          } catch {
            return '';
          }
        })();
        if (!parsedTx || parsedTx.name !== 'recordInitialRentPayment') {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'payment method mismatch',
          });
          continue;
        }
        if (toLowerHex(tx.from) !== toLowerHex(tenantAddress) || BigInt(tx.value || 0) !== expectedAmountWei) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'payment payer or amount mismatch',
          });
          continue;
        }
        if (String(parsedTx.args?.[0] || '') !== String(contractRow.id) || toLowerHex(parsedTx.args?.[1] || '') !== toLowerHex(landlordAddress)) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'payment calldata mismatch',
          });
          continue;
        }
        const paymentEvent = parsedLogs.find((log) =>
          log.name === 'RentPaymentRecorded'
          && eventIndexedStringMatches(log.args?.contractId, contractRow.id)
          && toLowerHex(log.args?.payer) === toLowerHex(tenantAddress)
          && toLowerHex(log.args?.landlord) === toLowerHex(landlordAddress)
          && BigInt(log.args?.amountWei || 0) === expectedAmountWei
          && BigInt(log.args?.platformFeeWei || 0) === BigInt(paymentBreakdown.platformFeeWei || 0)
          && BigInt(log.args?.performanceGuaranteeWei || 0) === BigInt(paymentBreakdown.performanceGuaranteeWei || 0)
          && BigInt(log.args?.escrowWei || 0) === BigInt(paymentBreakdown.escrowWei || 0)
          && (!platformFeeRecipient || toLowerHex(log.args?.platformFeeRecipient) === platformFeeRecipient)
        );
        if (!paymentEvent) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'payment event missing',
          });
          continue;
        }
        const payload = safeParseJsonObject(op.payload_json, {});
        const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        db.run(
          `INSERT INTO payments (id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+8 hours'))`,
          [
            paymentId,
            contractRow.id,
            String(payload.payerId || contractRow.tenant_id || ''),
            String(payload.payType || 'initial'),
            String(payload.amount || content?.oneTimeAmount || ''),
            String(payload.period || ''),
            op.tx_hash,
          ]
        );
        db.run(
          "UPDATE contracts SET status = 'active' WHERE id = ? AND status = 'pending_payment'",
          [contractRow.id]
        );
        const startDateOnly = normalizeDateOnly(content?.terms?.startDate);
        const startAt = startDateOnly ? new Date(`${startDateOnly}T00:00:00+08:00`) : null;
        const isFutureRenewalStart = !!(contractRow.parent_contract_id && startAt && !Number.isNaN(startAt.getTime()) && startAt.getTime() > Date.now());
        enqueueNotificationsForDb(db, [
          {
            recipientId: contractRow.landlord_id,
            actorId: contractRow.tenant_id,
            actorRole: 'tenant',
            kind: 'contract.payment_confirmed',
            entityType: 'contract',
            entityId: contractRow.id,
            title: isFutureRenewalStart ? '续约合同已支付待接续' : '合同首笔支付已完成',
            body: isFutureRenewalStart
              ? `租客已完成合同 ${contractRow.id} 的首笔支付，合同已支付待接续。`
              : `租客已完成合同 ${contractRow.id} 的首笔支付。`,
            metadata: { contractId: contractRow.id, listingId: contractRow.listing_id, txHash: op.tx_hash, isFutureRenewalStart },
            dedupeKey: `contract.payment_confirmed.landlord:${contractRow.id}:${op.tx_hash}`,
          },
          {
            recipientId: contractRow.tenant_id,
            actorId: contractRow.tenant_id,
            actorRole: 'tenant',
            kind: 'contract.payment_confirmed',
            entityType: 'contract',
            entityId: contractRow.id,
            title: isFutureRenewalStart ? '续约付款已确认' : '付款已确认',
            body: isFutureRenewalStart
              ? `合同 ${contractRow.id} 的首笔支付已确认，合同将按约定时间接续生效。`
              : `合同 ${contractRow.id} 的首笔支付已确认。`,
            metadata: { contractId: contractRow.id, listingId: contractRow.listing_id, txHash: op.tx_hash, isFutureRenewalStart },
            dedupeKey: `contract.payment_confirmed.tenant:${contractRow.id}:${op.tx_hash}`,
            allowSelf: true,
          },
        ]);
        markOnchainOperationConfirmed(db, {
          opId: op.op_id,
          entityType: op.entity_type,
          entityId: op.entity_id,
          operationKind: op.operation_kind,
          txHash: op.tx_hash,
          result: { paymentId, contractStatusAfter: 'active', isFutureRenewalStart },
        });
        continue;
      }

      if (op.operation_kind === 'gas_auth.revoke') {
        const contractRow = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [op.entity_id]))[0];
        const gasAuth = parseResult(db.exec('SELECT * FROM contract_gas_authorizations WHERE contract_id = ? LIMIT 1', [op.entity_id]))[0];
        if (!contractRow || !gasAuth) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'gas authorization not found',
          });
          continue;
        }
        const content = typeof contractRow.content_json === 'string' ? JSON.parse(contractRow.content_json) : (contractRow.content_json || {});
        const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress || '');
        const methodName = String(parsedTx?.name || '').trim();
        const isRevokeMethod =
          (methodName === 'revokeGasCompensationAuthorization' || methodName === 'cancelPendingGasAuthorization')
          && String(parsedTx.args?.[0] || '') === String(contractRow.id)
          && toLowerHex(parsedTx.args?.[1] || '') === toLowerHex(tenantAddress)
          && toLowerHex(parsedTx.args?.[2] || '') === toLowerHex(gasAuth.nonce);
        if (!isRevokeMethod) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'gas revoke method mismatch',
          });
          continue;
        }
        const revokedEvent = parsedLogs.find((log) =>
          log.name === 'GasCompRevoked'
          && eventIndexedStringMatches(log.args?.contractId, contractRow.id)
          && toLowerHex(log.args?.tenant) === toLowerHex(tenantAddress)
        );
        if (!revokedEvent) {
          markOnchainOperationFailed(db, {
            opId: op.op_id,
            entityType: op.entity_type,
            entityId: op.entity_id,
            operationKind: op.operation_kind,
            txHash: op.tx_hash,
            errorMessage: 'gas revoke event missing',
          });
          continue;
        }
        db.run(
          `UPDATE contract_gas_authorizations
           SET status = CASE WHEN status = 'active' THEN 'revoked' ELSE status END,
               revoke_tx_hash = CASE WHEN COALESCE(revoke_tx_hash, '') = '' THEN ? ELSE revoke_tx_hash END,
               updated_at = datetime('now', '+8 hours')
           WHERE contract_id = ?`,
          [op.tx_hash, contractRow.id]
        );
        enqueueNotificationsForDb(db, [
          {
            recipientId: contractRow.tenant_id,
            actorId: String(safeParseJsonObject(op.payload_json, {}).actorId || ''),
            kind: 'contract.gas_refund_ready',
            entityType: 'contract',
            entityId: contractRow.id,
            title: 'Gas 预付已取回',
            body: `合同 ${contractRow.id} 的 gas 预付授权已撤销并完成链上确认。`,
            metadata: { contractId: contractRow.id, listingId: contractRow.listing_id, txHash: op.tx_hash },
            dedupeKey: `contract.gas_refund_ready:${contractRow.id}:${op.tx_hash}`,
            allowSelf: true,
          },
        ]);
        markOnchainOperationConfirmed(db, {
          opId: op.op_id,
          entityType: op.entity_type,
          entityId: op.entity_id,
          operationKind: op.operation_kind,
          txHash: op.tx_hash,
          result: { gasAuthStatusAfter: 'revoked' },
        });
      }
    } catch (error) {
      logSystemError('reconcile.onchain-operations.exception', {
        opId: op.op_id,
        operationKind: op.operation_kind,
        txHash: op.tx_hash,
        message: error?.message || 'reconcile_onchain_operations_failed',
      });
    }
  }

  saveDb();
}

// 函数 7: 处理超时未支付合同（按配置窗口或 payment_deadline 自动取消）。
async function expirePendingPaymentContracts() {
  const db = await getDb();
  const timeoutContracts = parseResult(db.exec(
    `SELECT id, listing_id, tenant_id, landlord_id
     FROM contracts
     WHERE status = 'pending_payment'
       AND landlord_signed_at IS NOT NULL
       AND (
         datetime(landlord_signed_at, ?) <= datetime('now', '+8 hours')
         OR (payment_deadline IS NOT NULL AND payment_deadline <> '' AND datetime(payment_deadline) <= datetime('now', '+8 hours'))
       )`,
    [`+${PAYMENT_WINDOW_HOURS} hours`]
  ));
  if (timeoutContracts.length === 0) return;

  timeoutContracts.forEach((item) => {
    db.run(
      "UPDATE contracts SET status = 'cancelled_before_payment' WHERE id = ? AND status = 'pending_payment'",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;
    enqueueNotificationsForDb(db, [
      {
        recipientId: item.tenant_id,
        kind: 'contract.payment_timeout_cancelled',
        entityType: 'contract',
        entityId: item.id,
        title: '合同已因支付超时取消',
        body: `合同 ${item.id} 已因超过支付时限自动取消。`,
        metadata: { contractId: item.id, listingId: item.listing_id },
        dedupeKey: `contract.payment_timeout_cancelled.tenant:${item.id}`,
      },
      {
        recipientId: item.landlord_id,
        kind: 'contract.payment_timeout_cancelled',
        entityType: 'contract',
        entityId: item.id,
        title: '合同已因租客支付超时取消',
        body: `合同 ${item.id} 已因租客未在时限内完成支付而自动取消。`,
        metadata: { contractId: item.id, listingId: item.listing_id },
        dedupeKey: `contract.payment_timeout_cancelled.landlord:${item.id}`,
      },
    ]);

    getUserDb().then((userDb) => {
      userDb.run(
        `UPDATE users
         SET unpaid_default_count = COALESCE(unpaid_default_count, 0) + 1,
             risk_blocked_until = datetime('now', '+8 hours', '+24 hours')
         WHERE id = ?`,
        [item.tenant_id]
      );
      saveUserDb();
    }).catch((err) => {
      console.error('未付款风控计数更新失败:', err);
    });

  });

  saveDb();
}

// 函数 7-1: 处理签约前超时合同（pending/tenant_signed 到 expires_at 自动过期并释放房源）。
async function expireUnsignedContractsByExpiresAt() {
  const db = await getDb();
  const timeoutContracts = parseResult(db.exec(
    `SELECT id, listing_id, tenant_id, landlord_id, status, expires_at
     FROM contracts
     WHERE status IN ('pending', 'tenant_signed')
       AND datetime(expires_at) <= datetime('now', '+8 hours')`
  ));
  if (timeoutContracts.length === 0) return;

  timeoutContracts.forEach((item) => {
    db.run(
      "UPDATE contracts SET status = 'expired' WHERE id = ? AND status IN ('pending', 'tenant_signed')",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;
    enqueueNotificationsForDb(db, [
      {
        recipientId: item.tenant_id,
        kind: 'contract.sign_timeout_expired',
        entityType: 'contract',
        entityId: item.id,
        title: '合同已因签约超时关闭',
        body: `合同 ${item.id} 已超过签约时限，系统已自动关闭。`,
        metadata: { contractId: item.id, listingId: item.listing_id, fromStatus: item.status, expiresAt: item.expires_at },
        dedupeKey: `contract.sign_timeout_expired.tenant:${item.id}`,
      },
      {
        recipientId: item.landlord_id,
        kind: 'contract.sign_timeout_expired',
        entityType: 'contract',
        entityId: item.id,
        title: '合同申请已因签约超时关闭',
        body: `合同 ${item.id} 已超过签约时限，系统已自动关闭。`,
        metadata: { contractId: item.id, listingId: item.listing_id, fromStatus: item.status, expiresAt: item.expires_at },
        dedupeKey: `contract.sign_timeout_expired.landlord:${item.id}`,
      },
    ]);

    logRiskEvent('contract.auto-expire.release', {
      contractId: item.id,
      listingId: item.listing_id,
      userId: item.tenant_id,
      fromStatus: item.status,
      expiresAt: item.expires_at,
      preferredNetwork: CHAIN_ENV,
    });
  });

  saveDb();
}

// 函数 8: 处理租期到期合同（active -> ended）。
async function expireActiveContractsByEndDate() {
  const db = await getDb();
  const activeContracts = parseResult(db.exec(
    `SELECT id, listing_id, tenant_id, landlord_id, content_json
     FROM contracts
     WHERE status = 'active'`
  ));
  if (activeContracts.length === 0) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let changed = false;

  activeContracts.forEach((item) => {
    let content = item.content_json;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        return;
      }
    }
    const endAtMs = parseContractEndAtMs({ content_json: content });
    if (!endAtMs || endAtMs > now.getTime()) return;

    db.run(
      "UPDATE contracts SET status = 'ended' WHERE id = ? AND status = 'active'",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;
    enqueueNotificationsForDb(db, [
      {
        recipientId: item.tenant_id,
        kind: 'contract.ended_by_time',
        entityType: 'contract',
        entityId: item.id,
        title: '合同租期已结束',
        body: `合同 ${item.id} 已按租期自然结束。`,
        metadata: { contractId: item.id, listingId: item.listing_id },
        dedupeKey: `contract.ended_by_time.tenant:${item.id}`,
      },
      {
        recipientId: item.landlord_id,
        kind: 'contract.ended_by_time',
        entityType: 'contract',
        entityId: item.id,
        title: '合同租期已结束',
        body: `合同 ${item.id} 已按租期自然结束。`,
        metadata: { contractId: item.id, listingId: item.listing_id },
        dedupeKey: `contract.ended_by_time.landlord:${item.id}`,
      },
    ]);
    changed = true;
  });

  if (changed) {
    saveDb();
  }
}

// 函数 9: 启动服务。
async function startServer() {
  try {
    await getUserDb(CHAIN_ENV);
    await migrate();
    setInterval(() => {
      expireUnsignedContractsByExpiresAt().catch((err) => {
        logSystemError('job.expireUnsignedContractsByExpiresAt.failed', { message: err?.message || 'unknown_error', stack: err?.stack || '' });
      });
      expirePendingPaymentContracts().catch((err) => {
        logSystemError('job.expirePendingPaymentContracts.failed', { message: err?.message || 'unknown_error', stack: err?.stack || '' });
      });
      expireActiveContractsByEndDate().catch((err) => {
        logSystemError('job.expireActiveContractsByEndDate.failed', { message: err?.message || 'unknown_error', stack: err?.stack || '' });
      });
      reconcileUnifiedOnchainOperations().catch((err) => {
        logSystemError('job.reconcileUnifiedOnchainOperations.failed', { message: err?.message || 'unknown_error', stack: err?.stack || '' });
      });
    }, 60 * 1000);
    const server = app.listen(PORT, HOST, () => {
      console.log(`后端启动成功: http://${HOST}:${PORT} (CHAIN_ENV=${CHAIN_ENV})`);
      console.log(`当前网络账号库: ${getUserDbPath(CHAIN_ENV)}`);
      console.log(`JSON_BODY_LIMIT=${JSON_BODY_LIMIT}`);
    });
    server.on('error', (error) => {
      logSystemError('server.listen.error', {
        message: error?.message || 'listen_failed',
        code: error?.code || '',
        port: PORT,
      });
      if (error?.code === 'EADDRINUSE') {
        logSystemError('server.listen.eaddrinuse', { message: `端口 ${PORT} 已被占用，请先关闭占用进程后重试。`, port: PORT });
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('后端启动失败:', error);
    process.exit(1);
  }
}

setupMiddlewares();
setupRequestId();
setupResponseStatusLogger();
setupRoutes();
setupErrorHandlers();

// 函数 10: 注册进程级异常日志，避免漏记崩溃原因。
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack || '') : '';
  logSystemError('process.unhandledRejection', { message, stack });
});

process.on('uncaughtException', (error) => {
  logSystemError('process.uncaughtException', {
    message: error?.message || 'unknown_error',
    stack: error?.stack || '',
  });
});

startServer();
