/**
 * 文件说明：房源路由。
 * 提供发布、查询、上下架管理接口。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getDb, saveDb, parseResult, CHAIN_ENV } = require('../db');
const { getUserDb, parseResult: parseUserResult } = require('../user-db');
const { authMiddleware, requireRole } = require('../auth');
const { logListingError, logRiskEvent } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'data', 'uploads', 'listings');
const MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const RENTAL_CHAIN_ABI = require('../../../frontend/src/shared/blockchain/RentalChainABI.json');
const iface = new ethers.Interface(RENTAL_CHAIN_ABI);

function createTraceId(prefix = 'web') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function getCnDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseJsonArray(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 函数 1-0: 将 ETH 字符串金额转换为 wei 字符串。
function toWeiString(amountStr) {
  const raw = String(amountStr || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [intPart, fracPart = ''] = raw.split('.');
  const frac18 = `${fracPart}000000000000000000`.slice(0, 18);
  const wei = (BigInt(intPart) * (10n ** 18n)) + BigInt(frac18);
  if (wei <= 0n) return null;
  return wei.toString();
}

// 函数 5-1: 安全解析日志中的 JSON 字段。
function safeParseJson(raw, fallback = {}) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return fallback;
  try {
    let parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    try {
      // 容错处理：去除 BOM/控制字符后再尝试一次解析。
      const sanitized = text
        .replace(/^\uFEFF/, '')
        .replace(/\u0000/g, '')
        .trim();
      if (!sanitized) return fallback;
      let parsed = JSON.parse(sanitized);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
}

function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : s;
}

function parseCnDateTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 函数 5-2: 生成房源完整快照（用于历史回放渲染）。
function buildListingSnapshot(row, overrides = {}) {
  const base = {
    id: row.id,
    title: row.title,
    description: row.description,
    address: row.address,
    district: row.district || '',
    rentAmount: row.rent_amount,
    minLeaseMonths: Number(row.min_lease_months || 1),
    imageUrls: parseJsonArray(row.image_urls),
    imageHashes: parseJsonArray(row.image_hashes),
    status: row.status,
    contentHash: row.content_hash || '',
    txHash: row.tx_hash || '',
    updatedAt: row.updated_at || '',
  };
  return { ...base, ...overrides };
}

function parseContractContent(contract = {}) {
  if (typeof contract.content_json === 'string') {
    return safeParseJson(contract.content_json, {});
  }
  return contract.content_json && typeof contract.content_json === 'object' ? contract.content_json : {};
}

function parseContractStartAtMs(contract = {}) {
  const content = parseContractContent(contract);
  const exactStartAtMs = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exactStartAtMs) && exactStartAtMs > 0) return exactStartAtMs;
  const startDateOnly = normalizeDateOnly(content?.terms?.startDate);
  if (!startDateOnly) return 0;
  const d = new Date(`${startDateOnly}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseContractEndAtMs(contract = {}) {
  const content = parseContractContent(contract);
  const endDateOnly = normalizeDateOnly(content?.terms?.endDate);
  if (!endDateOnly) return 0;
  const d = new Date(`${endDateOnly}T23:59:59+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function isContractCurrentlyOccupying(contract, now = Date.now()) {
  const startAtMs = parseContractStartAtMs(contract);
  const endAtMs = parseContractEndAtMs(contract);
  return String(contract.status || '') === 'active' && startAtMs > 0 && startAtMs <= now && now < endAtMs;
}

function isContractSigningOrReserved(contract, now = Date.now()) {
  const status = String(contract.status || '');
  if (status === 'pending' || status === 'tenant_signed') return true;
  if (status === 'pending_payment') {
    const deadline = parseCnDateTime(contract.payment_deadline || contract.expires_at);
    return !!deadline && deadline.getTime() > now;
  }
  if (status === 'active') {
    const startAtMs = parseContractStartAtMs(contract);
    const endAtMs = parseContractEndAtMs(contract);
    return startAtMs > now && endAtMs > now;
  }
  return false;
}

// 函数 5-3: 计算历史快照哈希（用于版本防篡改绑定）。
function calcSnapshotHash(snapshot) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(snapshot || {})).digest('hex')}`;
}

// 函数 5-4: 构建历史记录链上绑定信息。
function buildHistoryBinding({ snapshot, verified, txHash }) {
  return {
    snapshotHash: calcSnapshotHash(snapshot),
    chainVersion: Number(verified?.args?.version || 0),
    chainNonce: Number(verified?.args?.nonce || 0),
    txHash: String(txHash || '').toLowerCase(),
    eventName: String(verified?.eventName || ''),
    blockNumber: Number(verified?.blockNumber || 0),
    blockTime: Number(verified?.blockTime || 0),
  };
}

// 函数 1-1: 构建房源内容哈希载荷（用于锚点哈希计算）。
function buildListingContentHashPayload(draft) {
  const payload = {
    listingId: String(draft.listingId || ''),
    landlordWallet: String(draft.landlordWallet || '').toLowerCase(),
    title: String(draft.title || '').trim(),
    description: String(draft.description || '').trim(),
    address: String(draft.address || '').trim(),
    district: String(draft.district || '').trim(),
    rentAmount: String(draft.rentAmount || '').trim(),
    minLeaseMonths: Number(draft.minLeaseMonths || 1),
    bedrooms: Number(draft.bedrooms || 1),
    livingrooms: Number(draft.livingrooms || 1),
    bathrooms: Number(draft.bathrooms || 1),
    area: Number(draft.area || 0),
    imageHashes: Array.isArray(draft.imageHashes) ? draft.imageHashes.map((x) => String(x || '').toLowerCase()) : [],
  };
  return payload;
}

// 函数 1-2: 计算房源内容哈希。
function calcListingContentHash(draft) {
  const payload = buildListingContentHashPayload(draft);
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

// 函数 1-3: 计算图片根哈希（无图片返回 bytes32 0）。
function calcImageRootHash(imageHashes) {
  if (!Array.isArray(imageHashes) || imageHashes.length === 0) return ZERO_BYTES32;
  const normalized = imageHashes.map((x) => String(x || '').toLowerCase());
  const digest = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return `0x${digest}`;
}

// 函数 1-3b: 校验 bytes32 字符串格式。
function isBytes32Hex(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value || '').trim());
}

// 函数 1-4: 读取当前网络配置（合约地址唯一来源：部署 JSON 文件）。
function getChainRuntime() {
  const rpcUrl = CHAIN_ENV === 'local'
    ? String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim()
    : String(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com').trim();

  let contractAddress = '';
  const deployFile = CHAIN_ENV === 'local'
    ? path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json')
    : path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
  if (fs.existsSync(deployFile)) {
    const deploy = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
    contractAddress = String(deploy.address || '').trim();
  }
  return { rpcUrl, contractAddress };
}

// 函数 1-5: 规范化并验证交易哈希。
function normalizeTxHash(txHash) {
  const value = String(txHash || '').trim();
  return /^0x[a-fA-F0-9]{64}$/.test(value) ? value.toLowerCase() : '';
}

// 函数 1-6b: 解析并修复房源 content_hash（优先数据库，异常时回退链上并回填）。
async function resolveListingContentHash(db, listing) {
  const dbHash = String(listing?.content_hash || '').trim().toLowerCase();
  if (isBytes32Hex(dbHash)) return dbHash;

  try {
    const { rpcUrl, contractAddress } = getChainRuntime();
    if (rpcUrl && ethers.isAddress(contractAddress)) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(contractAddress, RENTAL_CHAIN_ABI, provider);
      const chainState = await contract.getListing(String(listing.id));
      const onchainHash = String(chainState?.contentHash ?? chainState?.[2] ?? '').trim().toLowerCase();
      const onchainExists = Boolean(chainState?.exists ?? chainState?.[11]);
      if (onchainExists && isBytes32Hex(onchainHash)) {
        db.run('UPDATE listings SET content_hash = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?', [onchainHash, listing.id]);
        listing.content_hash = onchainHash;
        saveDb();
        return onchainHash;
      }
    }
  } catch {
    // ignore and fallback to local reconstruction
  }

  try {
    const userDb = await getUserDb();
    const users = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [listing.landlord_id]));
    const landlordWallet = String(users?.[0]?.wallet_address || '').trim().toLowerCase();
    if (!ethers.isAddress(landlordWallet)) return '';

    const imageUrls = parseJsonArray(listing.image_urls);
    let imageHashes = parseJsonArray(listing.image_hashes).map((x) => String(x || '').toLowerCase());
    if (!imageHashes.length && imageUrls.length) {
      imageHashes = imageUrls.map((u) => `0x${crypto.createHash('sha256').update(String(u || '')).digest('hex')}`);
    }

    const rebuiltHash = calcListingContentHash({
      listingId: listing.id,
      landlordWallet,
      title: listing.title,
      description: listing.description,
      address: listing.address,
      district: listing.district || '',
      rentAmount: listing.rent_amount,
      minLeaseMonths: Number(listing.min_lease_months || 1),
      bedrooms: Number(listing.bedrooms || 1),
      livingrooms: Number(listing.livingrooms || 1),
      bathrooms: Number(listing.bathrooms || 1),
      area: Number(listing.area || 0),
      imageHashes,
    });
    if (!isBytes32Hex(rebuiltHash)) return '';

    db.run('UPDATE listings SET content_hash = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ?', [rebuiltHash, listing.id]);
    listing.content_hash = rebuiltHash;
    saveDb();
    return rebuiltHash;
  } catch {
    return '';
  }
}

// 函数 1-6: 记录链上操作幂等状态。
function upsertChainOperation(db, payload) {
  db.run(
    `INSERT INTO listing_chain_operations (op_id, listing_id, action, tx_hash, status, request_id, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(op_id) DO UPDATE SET
       tx_hash = excluded.tx_hash,
       status = excluded.status,
       request_id = excluded.request_id,
       detail_json = excluded.detail_json,
       updated_at = datetime('now', '+8 hours')`,
    [
      payload.opId,
      payload.listingId,
      payload.action,
      payload.txHash || '',
      payload.status || 'pending',
      payload.requestId || '',
      JSON.stringify(payload.detail || {}),
    ]
  );
}

// 函数 1-7: 链上真实性校验（回执/地址/事件/参数）。
async function verifyOnchainTx({
  txHash,
  expectedFrom,
  eventName,
  argChecker,
}) {
  const { rpcUrl, contractAddress } = getChainRuntime();
  if (!rpcUrl) throw new Error('RPC 未配置，无法校验链上交易');
  if (!ethers.isAddress(contractAddress)) throw new Error('合约地址未配置或格式不正确');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('链上回执不存在，交易可能未确认');
  if (receipt.status !== 1) throw new Error('链上交易执行失败');

  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error('无法获取交易详情');
  if (String(tx.to || '').toLowerCase() !== contractAddress.toLowerCase()) {
    throw new Error('交易目标合约地址不匹配');
  }
  if (String(tx.from || '').toLowerCase() !== String(expectedFrom || '').toLowerCase()) {
    throw new Error('交易发送者与房东绑定钱包不匹配');
  }

  // 解包 Indexed 对象为 hash 字符串，方便 argChecker 比较。
  function normalizeArgs(args) {
    const obj = typeof args.toObject === 'function' ? args.toObject() : args;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = (value && typeof value === 'object' && value._isIndexed) ? String(value.hash) : value;
    }
    return result;
  }

  const candidates = [];
  for (const log of receipt.logs || []) {
    if (String(log.address || '').toLowerCase() !== contractAddress.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      candidates.push({ name: parsed.name, args: normalizeArgs(parsed.args) });
    } catch {
      // ignore non-matching log
    }
  }
  const matched = candidates.find((item) => item?.name === eventName && argChecker(item.args));
  if (!matched) throw new Error(`未找到匹配事件：${eventName}`);

  const block = await provider.getBlock(receipt.blockNumber);
  return {
    txHash,
    from: tx.from,
    to: tx.to,
    blockNumber: Number(receipt.blockNumber || 0),
    blockTime: Number(block?.timestamp || 0),
    eventName,
    args: matched.args,
  };
}

function logListingOperation(db, { listingId, operatorId, action, before = {}, after = {}, requestId = '', source = 'api', note = '' }) {
  db.run(
    `INSERT INTO listing_operation_logs (id, listing_id, operator_id, action, before_json, after_json, request_id, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `llog_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      listingId,
      operatorId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      requestId,
      source,
      note,
    ]
  );
}
// 函数 2: 确保上传目录存在。
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_ROOT)) {
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }
}

// 函数 3: 解析 data URL 图片并返回二进制与 mime。
function parseDataUrlImage(input) {
  const s = String(input || '');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) return null;
  const mime = m[1];
  const base64 = m[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return null;
  return { mime, buffer };
}

// 函数 4: 由 mime 推断文件扩展名。
function extByMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return '';
}

// 函数 5: 校验与规范化图片 URL 数组。
function normalizeImageUrls(imageUrls) {
  if (!Array.isArray(imageUrls)) return null;
  if (imageUrls.length > MAX_IMAGE_COUNT) return null;
  const out = [];
  for (const item of imageUrls) {
    const url = String(item || '').trim();
    if (!url) continue;
    if (!/^\/uploads\/listings\/[A-Za-z0-9._/-]+$/.test(url) && !/^https?:\/\/\S+$/i.test(url)) {
      return null;
    }
    out.push(url);
  }
  return out;
}

// 函数 6: 上传房源图片接口（房东）。
router.post('/upload-images', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (images.length === 0) {
      return res.status(400).json({ error: 'images 不能为空' });
    }
    if (images.length > MAX_IMAGE_COUNT) {
      return res.status(400).json({ error: `单次最多上传 ${MAX_IMAGE_COUNT} 张图片` });
    }
    const db = await getDb();
    const recentUploads = parseResult(db.exec(
      `SELECT COUNT(*) AS count
       FROM listing_operation_logs
       WHERE operator_id = ?
         AND action = 'upload_images'
         AND datetime(created_at) >= datetime('now', '+8 hours', '-10 minutes')`,
      [req.user.id]
    ))[0]?.count || 0;
    if (Number(recentUploads) >= 10) {
      return res.status(429).json({ error: '图片上传过于频繁，请稍后重试' });
    }

    ensureUploadDir();
    const uploaded = [];
    for (const raw of images) {
      const parsed = parseDataUrlImage(raw?.dataUrl);
      if (!parsed) {
        return res.status(400).json({ error: '图片格式不正确，仅支持 jpeg/png/webp 的 data URL' });
      }
      if (!ALLOWED_MIME.has(parsed.mime)) {
        return res.status(400).json({ error: '图片类型不支持，仅支持 jpeg/png/webp' });
      }
      if (parsed.buffer.length > MAX_IMAGE_SIZE) {
        return res.status(400).json({ error: `单张图片不能超过 ${MAX_IMAGE_SIZE / (1024 * 1024)}MB` });
      }

      const hash = crypto.createHash('sha256').update(parsed.buffer).digest('hex');
      const ext = extByMime(parsed.mime);
      const fileName = `${Date.now()}_${hash.slice(0, 16)}.${ext}`;
      const savePath = path.join(UPLOAD_ROOT, fileName);
      fs.writeFileSync(savePath, parsed.buffer);
      uploaded.push({
        url: `/uploads/listings/${fileName}`,
        hash: `0x${hash}`,
        size: parsed.buffer.length,
        mime: parsed.mime,
      });
    }

    logListingOperation(db, {
      listingId: 'unassigned',
      operatorId: req.user.id,
      action: 'upload_images',
      after: { count: uploaded.length, totalSize: uploaded.reduce((sum, item) => sum + item.size, 0) },
      requestId: req.requestId,
      source: 'web',
    });
    saveDb();
    res.json({ success: true, data: { images: uploaded } });
  } catch (error) {
    logListingError('upload-images.exception', {
      requestId: req.requestId,
      userId: req.user?.id || '',
      message: error.message,
    });
    res.status(500).json({ error: '图片上传失败' });
  }
}));

// 函数 6-0: 客户端房源流程失败上报（前端诊断日志）。
router.post('/client-report', authMiddleware, asyncHandler(async (req, res) => {
  const body = req.body || {};
  logListingError('client.report', {
    requestId: req.requestId || body.requestId || createTraceId('listing'),
    userId: req.user?.id || '',
    listingId: body.listingId || '',
    stage: body.stage || '',
    message: body.message || '',
    stack: body.stack || '',
    preferredNetwork: body.preferredNetwork || '',
    walletAddress: body.walletAddress || '',
    chainId: body.chainId || '',
    pageUrl: body.pageUrl || '',
    extra: body.extra || {},
  });
  res.json({ success: true });
}));

// 函数 6-1: 预创建房源，返回上链锚点参数（先上链后入库）。
router.post('/prepare-create', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const {
    title, description, address, district = '', rentAmount,
    rentCycle = 'month', minLeaseMonths = 1, bedrooms = 1,
    livingrooms = 1, bathrooms = 1, area = 0, imageUrls = [],
  } = req.body || {};

  if (!title || !description || !address || rentAmount === undefined || rentAmount === null || rentAmount === '') {
    return res.status(400).json({ error: '标题、描述、地址、租金为必填项' });
  }
  const normalizedRentAmount = normalizeAmount(rentAmount);
  if (!normalizedRentAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });
  const minLeaseMonthsNum = Number(minLeaseMonths ?? 1);
  if (!Number.isInteger(minLeaseMonthsNum) || minLeaseMonthsNum < 1 || minLeaseMonthsNum > 12) {
    return res.status(400).json({ error: '最少租期必须为 1-12 月的整数' });
  }
  const normalizedImageUrls = normalizeImageUrls(imageUrls);
  if (!normalizedImageUrls) return res.status(400).json({ error: `imageUrls 格式不正确，且最多 ${MAX_IMAGE_COUNT} 张` });

  const userDb = await getUserDb();
  const users = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]));
  if (!users.length) return res.status(404).json({ error: '用户不存在' });
  const landlordWallet = String(users[0].wallet_address || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(landlordWallet)) {
    return res.status(400).json({ error: '请先在个人中心绑定有效钱包地址后再发布房源' });
  }

  const listingId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const imageHashes = normalizedImageUrls.map((u) => `0x${crypto.createHash('sha256').update(u).digest('hex')}`);
  const rentAmountWei = toWeiString(normalizedRentAmount);
  if (!rentAmountWei) return res.status(400).json({ error: '租金转换 wei 失败' });
  const imageRootHash = calcImageRootHash(imageHashes);
  const draft = {
    listingId, title, description, address, district,
    rentAmount: normalizedRentAmount, rentCycle, minLeaseMonths: minLeaseMonthsNum,
    bedrooms: Number(bedrooms), livingrooms: Number(livingrooms), bathrooms: Number(bathrooms), area: Number(area),
    imageUrls: normalizedImageUrls, imageHashes, landlordWallet,
  };
  const contentHash = calcListingContentHash(draft);
  res.json({
    success: true,
    data: {
      draft,
      chainAnchor: {
        listingId,
        landlordWallet,
        contentHash,
        rentAmountWei,
        minLeaseMonths: minLeaseMonthsNum,
        imageRootHash,
      },
    },
  });
}));

// 函数 6-2: 提交房源创建（必须已完成链上交易并回传 txHash）。
router.post('/commit-create', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { draft, chainAnchor, txHash, operationId = '' } = req.body || {};
  if (!draft || !chainAnchor) return res.status(400).json({ error: 'draft 与 chainAnchor 不能为空' });
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) return res.status(400).json({ error: 'txHash 格式不正确' });

  const expectedHash = calcListingContentHash(draft);
  if (String(chainAnchor.contentHash || '').toLowerCase() !== expectedHash.toLowerCase()) return res.status(400).json({ error: 'contentHash 校验失败，请重新发起发布流程' });
  if (String(chainAnchor.listingId || '') !== String(draft.listingId || '')) return res.status(400).json({ error: 'listingId 不匹配' });
  const expectedWei = toWeiString(draft.rentAmount);
  const expectedImageRootHash = calcImageRootHash(Array.isArray(draft.imageHashes) ? draft.imageHashes : []);
  if (String(chainAnchor.rentAmountWei || '') !== String(expectedWei || '')) return res.status(400).json({ error: 'rentAmountWei 校验失败，请重新发起发布流程' });
  if (Number(chainAnchor.minLeaseMonths || 0) !== Number(draft.minLeaseMonths || 0)) return res.status(400).json({ error: 'minLeaseMonths 校验失败，请重新发起发布流程' });
  if (String(chainAnchor.imageRootHash || '').toLowerCase() !== String(expectedImageRootHash || '').toLowerCase()) return res.status(400).json({ error: 'imageRootHash 校验失败，请重新发起发布流程' });

  const userDb = await getUserDb();
  const users = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]));
  if (!users.length) return res.status(404).json({ error: '用户不存在' });
  const boundWallet = String(users[0].wallet_address || '').trim().toLowerCase();
  if (!boundWallet || boundWallet !== String(chainAnchor.landlordWallet || '').trim().toLowerCase()) {
    return res.status(400).json({ error: '房东钱包与当前账号绑定钱包不一致' });
  }

  const db = await getDb();
  const opId = String(operationId || `op_create_${draft.listingId}_${normalizedTxHash}`).trim();
  const existedOp = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE op_id = ?', [opId]));
  if (existedOp.length && existedOp[0].status === 'confirmed') {
    return res.json({ success: true, message: '重复提交已幂等处理', data: { id: draft.listingId, txHash: normalizedTxHash, contentHash: expectedHash } });
  }
  const reusedTx = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE tx_hash = ? AND op_id <> ?', [normalizedTxHash, opId]));
  if (reusedTx.length) return res.status(409).json({ error: 'txHash 已被其它操作占用' });

  const existed = parseResult(db.exec('SELECT id FROM listings WHERE id = ?', [draft.listingId]));
  if (existed.length) return res.status(409).json({ error: 'listingId 已存在，请重新发起发布流程' });

  upsertChainOperation(db, {
    opId,
    listingId: draft.listingId,
    action: 'create',
    txHash: normalizedTxHash,
    status: 'pending',
    requestId: req.requestId,
    detail: { phase: 'verify_onchain' },
  });

  let verified;
  try {
    verified = await verifyOnchainTx({
      txHash: normalizedTxHash,
      expectedFrom: boundWallet,
      eventName: 'ListingCreated',
      argChecker: (args) => (
        String(args.listingId).toLowerCase() === ethers.id(String(draft.listingId)).toLowerCase() &&
        String(args.landlord).toLowerCase() === boundWallet &&
        String(args.contentHash).toLowerCase() === String(expectedHash).toLowerCase() &&
        String(args.rentAmountWei) === String(expectedWei) &&
        Number(args.minLeaseMonths) === Number(draft.minLeaseMonths) &&
        String(args.imageRootHash).toLowerCase() === String(expectedImageRootHash).toLowerCase()
      ),
    });
  } catch (error) {
    upsertChainOperation(db, {
      opId,
      listingId: draft.listingId,
      action: 'create',
      txHash: normalizedTxHash,
      status: 'failed',
      requestId: req.requestId,
      detail: { message: error?.message || 'verify_failed' },
    });
    throw error;
  }

  db.run(`INSERT INTO listings (
    id, landlord_id, title, description, address, district, rent_amount,
    rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
    image_urls, image_hashes, tx_hash,
    onchain_status, onchain_attempts, onchain_error, onchain_last_attempt_at, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 1, '', datetime('now', '+8 hours'), 'available')`, [
    draft.listingId, req.user.id, draft.title, draft.description, draft.address, draft.district || '', draft.rentAmount,
    draft.rentCycle || 'month', Number(draft.minLeaseMonths || 1), Number(draft.bedrooms || 1), Number(draft.livingrooms || 1),
    Number(draft.bathrooms || 1), Number(draft.area || 0), JSON.stringify(Array.isArray(draft.imageUrls) ? draft.imageUrls : []),
    JSON.stringify(Array.isArray(draft.imageHashes) ? draft.imageHashes : []), normalizedTxHash,
  ]);

  db.run(
    `UPDATE listings
     SET chain_version = ?, chain_nonce = ?, chain_block_number = ?, chain_block_time = ?
     WHERE id = ?`,
    [
      Number(verified.args.version || 0),
      Number(verified.args.nonce || 0),
      Number(verified.blockNumber || 0),
      Number(verified.blockTime || 0),
      draft.listingId,
    ]
  );

  const createdSnapshot = {
    id: draft.listingId,
    title: draft.title,
    description: draft.description,
    address: draft.address,
    district: draft.district || '',
    rentAmount: draft.rentAmount,
    minLeaseMonths: Number(draft.minLeaseMonths || 1),
    imageUrls: Array.isArray(draft.imageUrls) ? draft.imageUrls : [],
    imageHashes: Array.isArray(draft.imageHashes) ? draft.imageHashes : [],
    status: 'available',
    contentHash: expectedHash,
    txHash: normalizedTxHash,
  };
  logListingOperation(db, {
    listingId: draft.listingId,
    operatorId: req.user.id,
    action: 'create_listing_onchain_commit',
    after: {
      txHash: normalizedTxHash,
      contentHash: expectedHash,
      landlordWallet: chainAnchor.landlordWallet,
      snapshot: createdSnapshot,
      binding: buildHistoryBinding({ snapshot: createdSnapshot, verified, txHash: normalizedTxHash }),
    },
    requestId: req.requestId,
    source: 'web',
  });
  upsertChainOperation(db, {
    opId,
    listingId: draft.listingId,
    action: 'create',
    txHash: normalizedTxHash,
    status: 'confirmed',
    requestId: req.requestId,
    detail: {
      eventName: verified.eventName,
      blockNumber: verified.blockNumber,
      blockTime: verified.blockTime,
    },
  });
  logRiskEvent('listing.onchain.commit.create', {
    listingId: draft.listingId,
    txHash: normalizedTxHash,
    chainId: CHAIN_ENV,
    opId,
    eventName: verified.eventName,
    blockNumber: verified.blockNumber,
  });
  saveDb();

  res.json({ success: true, data: { id: draft.listingId, txHash: normalizedTxHash, contentHash: expectedHash } });
}));

// 函数 2: 批量补齐房东昵称与手机号。
async function attachLandlordProfile(rows) {
  if (!rows.length) return rows;
  const userDb = await getUserDb();
  const landlordIds = [...new Set(rows.map((item) => item.landlord_id).filter(Boolean))];
  if (landlordIds.length === 0) return rows;

  const placeholders = landlordIds.map(() => '?').join(',');
  const users = parseUserResult(userDb.exec(
    `SELECT id, nickname, phone FROM users WHERE id IN (${placeholders})`,
    landlordIds
  ));
  const profileMap = new Map(users.map((u) => [u.id, u]));

  return rows.map((item) => {
    const profile = profileMap.get(item.landlord_id) || {};
    return {
      ...item,
      landlord_name: profile.nickname || '',
      landlord_phone: profile.phone || '',
    };
  });
}

function resolveListingPublicStatus(listing, contracts = []) {
  const status = String(listing.status || '').trim().toLowerCase();
  if (status !== 'available' && status !== 'rented') return status;
  const now = Date.now();
  if (contracts.some((item) => isContractCurrentlyOccupying(item, now))) return 'rented';
  if (contracts.some((item) => isContractSigningOrReserved(item, now))) return 'signing';
  return 'available';
}

async function attachPublicListingState(rows) {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map((item) => item.id).filter(Boolean))];
  if (ids.length === 0) return rows;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const contracts = parseResult(db.exec(
    `SELECT id, listing_id, status, content_json, expires_at, payment_deadline, parent_contract_id
     FROM contracts
     WHERE listing_id IN (${placeholders})
       AND status NOT IN ('cancelled', 'expired', 'ended')`,
    ids
  ));
  const byListing = new Map();
  contracts.forEach((item) => {
    const key = item.listing_id;
    if (!byListing.has(key)) byListing.set(key, []);
    byListing.get(key).push(item);
  });
  return rows.map((item) => {
    const related = byListing.get(item.id) || [];
    const now = Date.now();
    const activeContract = related
      .filter((contract) => isContractCurrentlyOccupying(contract, now))
      .sort((a, b) => parseContractStartAtMs(b) - parseContractStartAtMs(a))[0] || null;
    const signingContract = related
      .filter((contract) => !activeContract || contract.id !== activeContract.id)
      .filter((contract) => isContractSigningOrReserved(contract, now))
      .sort((a, b) => {
        const aDeadline = parseCnDateTime(a.payment_deadline || a.expires_at)?.getTime() || 0;
        const bDeadline = parseCnDateTime(b.payment_deadline || b.expires_at)?.getTime() || 0;
        return bDeadline - aDeadline;
      })[0] || null;

    return {
      ...item,
      public_status: resolveListingPublicStatus(item, related),
      active_contract_id: activeContract?.id || '',
      signing_contract_id: signingContract?.id || '',
    };
  });
}

// 函数 2-3: 获取房源列表接口。
router.get('/', asyncHandler(async (req, res) => {
  const rawKeyword = String(req.query.keyword || '').trim();
  const status = String(req.query.status || 'public').trim();
  // 转义 LIKE 通配符，防止 % 和 _ 绕过关键词过滤
  const keyword = rawKeyword.replace(/[%_]/g, '\\$&');
  const db = await getDb();
  const isPublicStatusFilter = ['public', 'available', 'signing', 'rented'].includes(status);
  const statusSql = isPublicStatusFilter
    ? "status IN ('available','rented')"
    : 'status = ?';
  const params = isPublicStatusFilter
    ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
    : [status, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`];
  const rows = parseResult(db.exec(
    `SELECT *
     FROM listings
     WHERE ${statusSql} AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\')
     ORDER BY created_at DESC`,
    params
  ));
  let data = await attachPublicListingState(rows);
  if (['available', 'signing', 'rented'].includes(status)) {
    data = data.filter((item) => item.public_status === status);
  }
  data = await attachLandlordProfile(data);
  res.json({ success: true, data, total: data.length });
}));

// 函数 4: 获取当前房东房源列表接口。
router.get('/my', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(
    'SELECT * FROM listings WHERE landlord_id = ? ORDER BY created_at DESC',
    [req.user.id]
  ));
  const data = await attachPublicListingState(rows);
  res.json({ success: true, data });
}));

// 函数 5: 获取房源详情接口。
router.get('/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(
    `SELECT *
     FROM listings
     WHERE id = ?`,
    [req.params.id]
  ));
  if (!rows.length) {
    return res.status(404).json({ error: '房源不存在' });
  }
  const [detailWithState] = await attachPublicListingState(rows);
  const [detail] = await attachLandlordProfile([detailWithState]);
  res.json({ success: true, data: detail });
}));

// 函数 5-1: 查询房源历史版本（公开只读）。
router.get('/:id/history', asyncHandler(async (req, res) => {
  const db = await getDb();
  const listingRows = parseResult(db.exec('SELECT id, created_at FROM listings WHERE id = ?', [req.params.id]));
  if (!listingRows.length) {
    return res.status(404).json({ error: '房源不存在' });
  }

  const logs = parseResult(db.exec(
    `SELECT id, action, before_json, after_json, note, source, created_at
     FROM listing_operation_logs
     WHERE listing_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.params.id]
  ));

  const history = logs.map((item) => {
    const before = safeParseJson(item.before_json, {});
    const after = safeParseJson(item.after_json, {});
    const snapshot = after?.snapshot
      || ((after && typeof after === 'object')
        ? (() => {
          const { binding: _ignoredBinding, ...rest } = after;
          return rest;
        })()
        : after);
    const binding = after?.binding || null;
    const expectedSnapshotHash = snapshot && typeof snapshot === 'object' ? calcSnapshotHash(snapshot) : '';
    const bindingVerified = Boolean(
      binding &&
      binding.snapshotHash &&
      expectedSnapshotHash &&
      String(binding.snapshotHash).toLowerCase() === String(expectedSnapshotHash).toLowerCase() &&
      Number(binding.chainVersion || 0) > 0 &&
      Number(binding.chainNonce || 0) > 0
    );
    return {
      id: item.id,
      action: item.action,
      before,
      after,
      note: item.note || '',
      source: item.source || '',
      createdAt: item.created_at,
      bindingVerified,
      expectedSnapshotHash,
      binding,
    };
  });

  res.json({
    success: true,
    data: {
      listingId: req.params.id,
      createdAt: listingRows[0].created_at,
      history,
    },
  });
}));

// 函数 6-1: 状态更新预检查，返回上链参数。
router.post('/:id/status/prepare', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['available', 'offline', 'closed'].includes(status)) {
    return res.status(400).json({ error: '状态仅支持 available / offline / closed' });
  }
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT id, status FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) {
    return res.status(403).json({ error: '无权限操作该房源' });
  }
  const currentStatus = rows[0].status;
  if (!['available', 'offline'].includes(currentStatus)) {
    return res.status(400).json({ error: '当前房源处于签约/履约流程中或已关闭，暂不允许修改状态' });
  }
  if (currentStatus === status) {
    return res.status(400).json({ error: '状态未变化，无需重复提交' });
  }
  const chainStatusMap = { available: 0, offline: 2, closed: 3 };
  res.json({
    success: true,
    data: {
      listingId: req.params.id,
      fromStatus: currentStatus,
      toStatus: status,
      toStatusEnum: chainStatusMap[status],
    },
  });
}));

// 函数 6-2: 状态更新回写（必须已完成链上交易）。
router.post('/:id/status/commit', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { status, txHash, operationId = '' } = req.body || {};
  if (!['available', 'offline', 'closed'].includes(status)) {
    return res.status(400).json({ error: '状态仅支持 available / offline / closed' });
  }
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) return res.status(400).json({ error: 'txHash 格式不正确' });
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT id, status FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) {
    return res.status(403).json({ error: '无权限操作该房源' });
  }
  const currentStatus = rows[0].status;
  if (!['available', 'offline'].includes(currentStatus)) {
    return res.status(400).json({ error: '当前房源处于签约/履约流程中或已关闭，暂不允许修改状态' });
  }
  if (currentStatus === status) {
    return res.status(400).json({ error: '状态未变化，无需回写' });
  }
  const opId = String(operationId || `op_status_${req.params.id}_${status}_${normalizedTxHash}`).trim();
  const existedOp = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE op_id = ?', [opId]));
  if (existedOp.length && existedOp[0].status === 'confirmed') {
    return res.json({ success: true, message: '重复提交已幂等处理' });
  }
  const reusedTx = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE tx_hash = ? AND op_id <> ?', [normalizedTxHash, opId]));
  if (reusedTx.length) return res.status(409).json({ error: 'txHash 已被其它操作占用' });
  upsertChainOperation(db, {
    opId,
    listingId: req.params.id,
    action: 'status',
    txHash: normalizedTxHash,
    status: 'pending',
    requestId: req.requestId,
    detail: { toStatus: status },
  });
  const userDb = await getUserDb();
  const users = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]));
  if (!users.length) return res.status(404).json({ error: '用户不存在' });
  const boundWallet = String(users[0].wallet_address || '').trim().toLowerCase();
  if (!boundWallet) return res.status(400).json({ error: '当前账号未绑定钱包地址' });

  const chainEnumMap = { available: 0, offline: 1, closed: 2 };
  const listingRow = parseResult(db.exec('SELECT chain_version, chain_nonce, status FROM listings WHERE id = ?', [req.params.id]));
  const expectedVersion = Number(listingRow[0]?.chain_version || 0);
  const expectedNonce = Number(listingRow[0]?.chain_nonce || 0);
  const oldStatusEnum = { available: 0, rented: 0, offline: 1, closed: 2 }[listingRow[0]?.status] ?? -1;

  let verified;
  try {
    verified = await verifyOnchainTx({
      txHash: normalizedTxHash,
      expectedFrom: boundWallet,
      eventName: 'ListingStatusChanged',
      argChecker: (args) => (
        String(args.listingId).toLowerCase() === ethers.id(String(req.params.id)).toLowerCase() &&
        Number(args.oldStatus) === oldStatusEnum &&
        Number(args.newStatus) === Number(chainEnumMap[status]) &&
        Number(args.version) === expectedVersion + 1 &&
        Number(args.nonce) === expectedNonce + 1
      ),
    });
  } catch (error) {
    upsertChainOperation(db, {
      opId,
      listingId: req.params.id,
      action: 'status',
      txHash: normalizedTxHash,
      status: 'failed',
      requestId: req.requestId,
      detail: { message: error?.message || 'verify_failed', toStatus: status },
    });
    throw error;
  }

  db.run('UPDATE listings SET status = ?, tx_hash = ?, chain_version = ?, chain_nonce = ?, chain_block_number = ?, chain_block_time = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status IN (\'available\', \'offline\')', [
    status,
    normalizedTxHash,
    Number(verified.args.version || 0),
    Number(verified.args.nonce || 0),
    Number(verified.blockNumber || 0),
    Number(verified.blockTime || 0),
    req.params.id,
  ]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });
  }
  const statusSnapshot = buildListingSnapshot(
    parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]))[0],
    { status, txHash: normalizedTxHash }
  );
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_status_onchain_commit',
    before: { status: currentStatus },
    after: {
      status,
      txHash: normalizedTxHash,
      snapshot: statusSnapshot,
      binding: buildHistoryBinding({ snapshot: statusSnapshot, verified, txHash: normalizedTxHash }),
    },
    requestId: req.requestId,
    source: 'web',
  });
  upsertChainOperation(db, {
    opId,
    listingId: req.params.id,
    action: 'status',
    txHash: normalizedTxHash,
    status: 'confirmed',
    requestId: req.requestId,
    detail: { eventName: verified.eventName, blockNumber: verified.blockNumber, toStatus: status },
  });
  logRiskEvent('listing.onchain.commit.status', {
    listingId: req.params.id,
    txHash: normalizedTxHash,
    chainId: CHAIN_ENV,
    opId,
    eventName: verified.eventName,
    blockNumber: verified.blockNumber,
  });
  saveDb();
  res.json({ success: true, message: status === 'closed' ? '房源已销毁（已关闭）' : '状态更新成功' });
}));

// 函数 6-4: 条款更新预检查（链上 updateListingTerms，contentHash 保持不变）。
router.post('/:id/terms/prepare', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const listing = rows[0];
  if (!['available', 'offline'].includes(listing.status)) {
    return res.status(400).json({ error: '房源处于签约/履约流程中，暂不允许修改条款' });
  }

  const rentAmount = normalizeAmount(req.body?.rentAmount);
  const minLeaseMonths = Number(req.body?.minLeaseMonths ?? listing.min_lease_months);
  let imageUrls = Array.isArray(req.body?.imageUrls) ? req.body.imageUrls : parseJsonArray(listing.image_urls);
  imageUrls = normalizeImageUrls(imageUrls);
  if (!rentAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });
  if (!Number.isInteger(minLeaseMonths) || minLeaseMonths < 1 || minLeaseMonths > 12) {
    return res.status(400).json({ error: '最少租期必须为 1-12 月的整数' });
  }
  if (!imageUrls) return res.status(400).json({ error: `imageUrls 格式不正确，且最多 ${MAX_IMAGE_COUNT} 张` });
  const contentHash = await resolveListingContentHash(db, listing);
  if (!isBytes32Hex(contentHash)) {
    return res.status(400).json({ error: '当前房源 contentHash 无效，请先重新发布或完成一次上链修复' });
  }

  const imageHashes = imageUrls.map((u) => `0x${crypto.createHash('sha256').update(u).digest('hex')}`);
  const rentAmountWei = toWeiString(rentAmount);
  const imageRootHash = calcImageRootHash(imageHashes);
  if (!rentAmountWei) return res.status(400).json({ error: '租金转换 wei 失败' });

  res.json({
    success: true,
    data: {
      listingId: req.params.id,
      contentHash,
      rentAmount,
      minLeaseMonths,
      imageUrls,
      imageHashes,
      chainAnchor: {
        listingId: req.params.id,
        contentHash,
        rentAmountWei,
        minLeaseMonths,
        imageRootHash,
      },
    },
  });
}));

// 函数 6-5: 条款更新回写（链上成功后入库）。
router.post('/:id/terms/commit', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { rentAmount, minLeaseMonths, imageUrls, txHash, chainAnchor, operationId = '' } = req.body || {};
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) return res.status(400).json({ error: 'txHash 格式不正确' });
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const listing = rows[0];
  if (!['available', 'offline'].includes(listing.status)) {
    return res.status(400).json({ error: '房源处于签约/履约流程中，暂不允许修改条款' });
  }

  const normalizedRentAmount = normalizeAmount(rentAmount);
  const minLeaseMonthsNum = Number(minLeaseMonths);
  const normalizedImageUrls = normalizeImageUrls(Array.isArray(imageUrls) ? imageUrls : []);
  if (!normalizedRentAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });
  if (!Number.isInteger(minLeaseMonthsNum) || minLeaseMonthsNum < 1 || minLeaseMonthsNum > 12) {
    return res.status(400).json({ error: '最少租期必须为 1-12 月的整数' });
  }
  if (!normalizedImageUrls) return res.status(400).json({ error: `imageUrls 格式不正确，且最多 ${MAX_IMAGE_COUNT} 张` });
  const contentHash = await resolveListingContentHash(db, listing);
  if (!isBytes32Hex(contentHash)) {
    return res.status(400).json({ error: '当前房源 contentHash 无效，无法完成上链校验' });
  }

  const expectedRentAmountWei = toWeiString(normalizedRentAmount);
  const expectedImageHashes = normalizedImageUrls.map((u) => `0x${crypto.createHash('sha256').update(u).digest('hex')}`);
  const expectedImageRootHash = calcImageRootHash(expectedImageHashes);
  if (String(chainAnchor?.contentHash || '').toLowerCase() !== contentHash) {
    return res.status(400).json({ error: 'contentHash 必须保持与当前一致' });
  }
  if (String(chainAnchor?.rentAmountWei || '') !== String(expectedRentAmountWei || '')) return res.status(400).json({ error: 'rentAmountWei 校验失败' });
  if (Number(chainAnchor?.minLeaseMonths || 0) !== minLeaseMonthsNum) return res.status(400).json({ error: 'minLeaseMonths 校验失败' });
  if (String(chainAnchor?.imageRootHash || '').toLowerCase() !== String(expectedImageRootHash || '').toLowerCase()) return res.status(400).json({ error: 'imageRootHash 校验失败' });
  const opId = String(operationId || `op_terms_${req.params.id}_${normalizedTxHash}`).trim();
  const existedOp = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE op_id = ?', [opId]));
  if (existedOp.length && existedOp[0].status === 'confirmed') {
    return res.json({ success: true, message: '重复提交已幂等处理', data: buildListingSnapshot(listing) });
  }
  const reusedTx = parseResult(db.exec('SELECT * FROM listing_chain_operations WHERE tx_hash = ? AND op_id <> ?', [normalizedTxHash, opId]));
  if (reusedTx.length) return res.status(409).json({ error: 'txHash 已被其它操作占用' });
  upsertChainOperation(db, {
    opId,
    listingId: req.params.id,
    action: 'terms',
    txHash: normalizedTxHash,
    status: 'pending',
    requestId: req.requestId,
    detail: { rentAmount: normalizedRentAmount, minLeaseMonths: minLeaseMonthsNum },
  });

  const userDb = await getUserDb();
  const users = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]));
  if (!users.length) return res.status(404).json({ error: '用户不存在' });
  const boundWallet = String(users[0].wallet_address || '').trim().toLowerCase();
  if (!boundWallet) return res.status(400).json({ error: '当前账号未绑定钱包地址' });

  let verified;
  try {
    verified = await verifyOnchainTx({
      txHash: normalizedTxHash,
      expectedFrom: boundWallet,
      eventName: 'ListingContentUpdated',
      argChecker: (args) => (
        String(args.listingId).toLowerCase() === ethers.id(String(req.params.id)).toLowerCase() &&
        String(args.newContentHash).toLowerCase() === contentHash &&
        String(args.newRentAmountWei) === String(expectedRentAmountWei) &&
        Number(args.newMinLeaseMonths) === minLeaseMonthsNum &&
        String(args.newImageRootHash).toLowerCase() === String(expectedImageRootHash).toLowerCase() &&
        Number(args.version) === Number(listing.chain_version || 0) + 1 &&
        Number(args.nonce) === Number(listing.chain_nonce || 0) + 1
      ),
    });
  } catch (error) {
    upsertChainOperation(db, {
      opId,
      listingId: req.params.id,
      action: 'terms',
      txHash: normalizedTxHash,
      status: 'failed',
      requestId: req.requestId,
      detail: { message: error?.message || 'verify_failed' },
    });
    throw error;
  }

  db.run(
    `UPDATE listings
     SET rent_amount = ?, min_lease_months = ?, image_urls = ?, image_hashes = ?, tx_hash = ?,
         chain_version = ?, chain_nonce = ?, chain_block_number = ?, chain_block_time = ?,
         updated_at = datetime('now', '+8 hours')
     WHERE id = ? AND landlord_id = ? AND status IN ('available','offline')`,
    [
      normalizedRentAmount,
      minLeaseMonthsNum,
      JSON.stringify(normalizedImageUrls),
      JSON.stringify(expectedImageHashes),
      normalizedTxHash,
      Number(verified.args.version || 0),
      Number(verified.args.nonce || 0),
      Number(verified.blockNumber || 0),
      Number(verified.blockTime || 0),
      req.params.id,
      req.user.id,
    ]
  );
  if (db.getRowsModified() !== 1) return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });

  const latest = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]))[0];
  const beforeSnapshot = buildListingSnapshot(listing);
  const afterSnapshot = buildListingSnapshot(latest);
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_terms_onchain_commit',
    before: beforeSnapshot,
    after: {
      snapshot: afterSnapshot,
      binding: buildHistoryBinding({ snapshot: afterSnapshot, verified, txHash: normalizedTxHash }),
    },
    requestId: req.requestId,
    source: 'web',
  });
  upsertChainOperation(db, {
    opId,
    listingId: req.params.id,
    action: 'terms',
    txHash: normalizedTxHash,
    status: 'confirmed',
    requestId: req.requestId,
    detail: { eventName: verified.eventName, blockNumber: verified.blockNumber },
  });
  logRiskEvent('listing.onchain.commit.terms', {
    listingId: req.params.id,
    txHash: normalizedTxHash,
    chainId: CHAIN_ENV,
    opId,
    eventName: verified.eventName,
    blockNumber: verified.blockNumber,
  });
  saveDb();
  res.json({
    success: true,
    message: '链上条款更新成功',
    data: buildListingSnapshot(latest),
  });
}));

// 函数 7: 改价接口（仅可租/下架状态允许改价）。
router.put('/:id/price', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const nextAmount = normalizeAmount(req.body?.rentAmount);
  if (!nextAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const listing = rows[0];
  if (!['available', 'offline'].includes(listing.status)) {
    return res.status(400).json({ error: '房源处于签约/履约流程中，暂不允许改价' });
  }
  db.run(
    "UPDATE listings SET rent_amount = ?, updated_at = datetime('now', '+8 hours') WHERE id = ? AND landlord_id = ? AND status IN ('available','offline')",
    [nextAmount, req.params.id, req.user.id]
  );
  if (db.getRowsModified() !== 1) return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_price',
    before: { rentAmount: listing.rent_amount },
    after: { rentAmount: nextAmount },
    requestId: req.requestId,
    source: 'web',
    note: String(req.body?.reason || ''),
  });
  saveDb();
  res.json({ success: true, message: '改价成功', data: { rentAmount: nextAmount } });
}));

// 函数 8: 删除房源图片并同步哈希。
router.delete('/:id/images', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url 不能为空' });
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const listing = rows[0];
  const imageUrls = parseJsonArray(listing.image_urls);
  if (!imageUrls.includes(url)) return res.status(404).json({ error: '图片不属于该房源' });
  const nextUrls = imageUrls.filter((item) => item !== url);
  const nextHashes = nextUrls.map((item) => `0x${crypto.createHash('sha256').update(item).digest('hex')}`);
  db.run(
    "UPDATE listings SET image_urls = ?, image_hashes = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?",
    [JSON.stringify(nextUrls), JSON.stringify(nextHashes), req.params.id]
  );
  if (url.startsWith('/uploads/listings/')) {
    const fileName = path.basename(url);
    const filePath = path.join(UPLOAD_ROOT, fileName);
    if (filePath.startsWith(UPLOAD_ROOT) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'delete_image',
    before: { imageUrls },
    after: { imageUrls: nextUrls },
    requestId: req.requestId,
    source: 'web',
  });
  saveDb();
  res.json({ success: true, message: '图片已删除', data: { imageUrls: nextUrls, imageHashes: nextHashes } });
}));

// 函数 10: 查询房源操作日志。
router.get('/:id/logs', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT id FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限查看该房源日志' });
  const logs = parseResult(db.exec(
    'SELECT * FROM listing_operation_logs WHERE listing_id = ? ORDER BY created_at DESC LIMIT 100',
    [req.params.id]
  ));
  res.json({ success: true, data: logs });
}));

module.exports = router;
