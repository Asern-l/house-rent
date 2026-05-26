/**
 * 文件说明：房源路由。
 * 提供发布、查询、上下架管理接口。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, saveDb, parseResult, CHAIN_ENV } = require('../db');
const { getUserDb, parseResult: parseUserResult } = require('../user-db');
const { authMiddleware, requireRole } = require('../auth');
const { logListingError } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'data', 'uploads', 'listings');
const MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;

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
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
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


async function scoreListingPayload({ title, description, address, imageUrls }) {
  const endpoint = String(process.env.AI_SCORE_ENDPOINT || '').trim();
  if (endpoint) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, address, imageUrls }),
    });
    if (!resp.ok) throw new Error(`AI score endpoint failed: ${resp.status}`);
    const data = await resp.json();
    return {
      score: Number(data.score || 0),
      confidence: Number(data.confidence || 0.7),
      riskTags: Array.isArray(data.riskTags) ? data.riskTags : [],
      reason: String(data.reason || '外部 AI 服务评分'),
      modelVersion: String(data.modelVersion || 'external-ai'),
      source: 'external_ai',
    };
  }

  const risks = [];
  let score = 72;
  if (String(description || '').length >= 80) score += 8; else risks.push('description_short');
  if (Array.isArray(imageUrls) && imageUrls.length >= 3) score += 8; else risks.push('image_count_low');
  if (String(address || '').length >= 6) score += 6; else risks.push('address_weak');
  if (String(title || '').length >= 6) score += 4; else risks.push('title_short');
  return {
    score: Math.max(0, Math.min(100, score)),
    confidence: 0.62,
    riskTags: risks,
    reason: risks.length ? `启发式评分：${risks.join(', ')}` : '启发式评分：信息完整度较高',
    modelVersion: 'local-heuristic-v1',
    source: 'local_fallback',
  };
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
  const { draft, chainAnchor, txHash } = req.body || {};
  if (!draft || !chainAnchor) return res.status(400).json({ error: 'draft 与 chainAnchor 不能为空' });
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) return res.status(400).json({ error: 'txHash 格式不正确' });

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
  const existed = parseResult(db.exec('SELECT id FROM listings WHERE id = ?', [draft.listingId]));
  if (existed.length) return res.status(409).json({ error: 'listingId 已存在，请重新发起发布流程' });

  const score = await scoreListingPayload({
    title: draft.title,
    description: draft.description,
    address: draft.address,
    imageUrls: Array.isArray(draft.imageUrls) ? draft.imageUrls : [],
  }).catch((error) => ({ score: null, confidence: 0, riskTags: ['score_failed'], reason: error.message, modelVersion: 'score_failed', source: 'error' }));

  db.run(`INSERT INTO listings (
    id, landlord_id, title, description, address, district, rent_amount,
    rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
    image_urls, ai_score, ai_confidence, ai_risk_tags, ai_score_reason,
    ai_model_version, ai_score_source, ai_scored_at, image_hashes, tx_hash,
    onchain_status, onchain_attempts, onchain_error, onchain_last_attempt_at, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), ?, ?, 'confirmed', 1, '', datetime('now', '+8 hours'), 'available')`, [
    draft.listingId, req.user.id, draft.title, draft.description, draft.address, draft.district || '', draft.rentAmount,
    draft.rentCycle || 'month', Number(draft.minLeaseMonths || 1), Number(draft.bedrooms || 1), Number(draft.livingrooms || 1),
    Number(draft.bathrooms || 1), Number(draft.area || 0), JSON.stringify(Array.isArray(draft.imageUrls) ? draft.imageUrls : []),
    score.score, score.confidence, JSON.stringify(score.riskTags), score.reason, score.modelVersion, score.source,
    JSON.stringify(Array.isArray(draft.imageHashes) ? draft.imageHashes : []), txHash,
  ]);

  logListingOperation(db, {
    listingId: draft.listingId,
    operatorId: req.user.id,
    action: 'create_listing_onchain_commit',
    after: {
      txHash,
      contentHash: expectedHash,
      landlordWallet: chainAnchor.landlordWallet,
      score,
      snapshot: {
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
        txHash,
      },
    },
    requestId: req.requestId,
    source: 'web',
  });
  saveDb();

  res.json({ success: true, data: { id: draft.listingId, txHash, contentHash: expectedHash, aiScore: score.score, aiRiskTags: score.riskTags } });
}));

// 函数 2: 批量补齐房东昵称与邮箱。
async function attachLandlordProfile(rows) {
  if (!rows.length) return rows;
  const userDb = await getUserDb();
  const landlordIds = [...new Set(rows.map((item) => item.landlord_id).filter(Boolean))];
  if (landlordIds.length === 0) return rows;

  const placeholders = landlordIds.map(() => '?').join(',');
  const users = parseUserResult(userDb.exec(
    `SELECT id, nickname, email FROM users WHERE id IN (${placeholders})`,
    landlordIds
  ));
  const profileMap = new Map(users.map((u) => [u.id, u]));

  return rows.map((item) => {
    const profile = profileMap.get(item.landlord_id) || {};
    return {
      ...item,
      landlord_name: profile.nickname || '',
      landlord_email: profile.email || '',
    };
  });
}

// 函数 7: 发布房源接口（房东）。
router.post('/', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  res.status(410).json({ error: '请改用新流程：/listings/prepare-create -> 钱包上链 -> /listings/commit-create' });
}));

// 函数 3: 获取房源列表接口。
router.get('/', asyncHandler(async (req, res) => {
  const { keyword = '', status = 'available' } = req.query;
  const db = await getDb();
  const rows = parseResult(db.exec(
    `SELECT *
     FROM listings
     WHERE status = ? AND (title LIKE ? OR description LIKE ? OR address LIKE ?)
     ORDER BY created_at DESC`,
    [status, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
  ));
  const data = await attachLandlordProfile(rows);
  res.json({ success: true, data, total: data.length });
}));

// 函数 4: 获取当前房东房源列表接口。
router.get('/my', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(
    'SELECT * FROM listings WHERE landlord_id = ? ORDER BY created_at DESC',
    [req.user.id]
  ));
  res.json({ success: true, data: rows });
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
  const [detail] = await attachLandlordProfile(rows);
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

  const history = logs.map((item) => ({
    id: item.id,
    action: item.action,
    before: safeParseJson(item.before_json, {}),
    after: safeParseJson(item.after_json, {}),
    note: item.note || '',
    source: item.source || '',
    createdAt: item.created_at,
  }));

  res.json({
    success: true,
    data: {
      listingId: req.params.id,
      createdAt: listingRows[0].created_at,
      history,
    },
  });
}));

// 函数 6: 状态更新旧接口（已下线，改为先上链再回写）。
router.put('/:id/status', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  res.status(410).json({ error: '请改用新流程：/listings/:id/status/prepare -> 钱包上链 -> /listings/:id/status/commit' });
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
  const chainStatusMap = { available: 0, offline: 3, closed: 4 };
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
  const { status, txHash } = req.body || {};
  if (!['available', 'offline', 'closed'].includes(status)) {
    return res.status(400).json({ error: '状态仅支持 available / offline / closed' });
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) {
    return res.status(400).json({ error: 'txHash 格式不正确' });
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
    return res.status(400).json({ error: '状态未变化，无需回写' });
  }

  db.run('UPDATE listings SET status = ?, tx_hash = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status IN (\'available\', \'offline\')', [status, txHash, req.params.id]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });
  }
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_status_onchain_commit',
    before: { status: currentStatus },
    after: {
      status,
      txHash,
      snapshot: buildListingSnapshot(
        parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]))[0],
        { status, txHash }
      ),
    },
    requestId: req.requestId,
    source: 'web',
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

  const imageHashes = imageUrls.map((u) => `0x${crypto.createHash('sha256').update(u).digest('hex')}`);
  const rentAmountWei = toWeiString(rentAmount);
  const imageRootHash = calcImageRootHash(imageHashes);
  if (!rentAmountWei) return res.status(400).json({ error: '租金转换 wei 失败' });

  res.json({
    success: true,
    data: {
      listingId: req.params.id,
      contentHash: listing.content_hash,
      rentAmount,
      minLeaseMonths,
      imageUrls,
      imageHashes,
      chainAnchor: {
        listingId: req.params.id,
        contentHash: listing.content_hash,
        rentAmountWei,
        minLeaseMonths,
        imageRootHash,
      },
    },
  });
}));

// 函数 6-5: 条款更新回写（链上成功后入库）。
router.post('/:id/terms/commit', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { rentAmount, minLeaseMonths, imageUrls, txHash, chainAnchor } = req.body || {};
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) return res.status(400).json({ error: 'txHash 格式不正确' });
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

  const expectedRentAmountWei = toWeiString(normalizedRentAmount);
  const expectedImageHashes = normalizedImageUrls.map((u) => `0x${crypto.createHash('sha256').update(u).digest('hex')}`);
  const expectedImageRootHash = calcImageRootHash(expectedImageHashes);
  if (String(chainAnchor?.contentHash || '').toLowerCase() !== String(listing.content_hash || '').toLowerCase()) {
    return res.status(400).json({ error: 'contentHash 必须保持与当前一致' });
  }
  if (String(chainAnchor?.rentAmountWei || '') !== String(expectedRentAmountWei || '')) return res.status(400).json({ error: 'rentAmountWei 校验失败' });
  if (Number(chainAnchor?.minLeaseMonths || 0) !== minLeaseMonthsNum) return res.status(400).json({ error: 'minLeaseMonths 校验失败' });
  if (String(chainAnchor?.imageRootHash || '').toLowerCase() !== String(expectedImageRootHash || '').toLowerCase()) return res.status(400).json({ error: 'imageRootHash 校验失败' });

  db.run(
    `UPDATE listings
     SET rent_amount = ?, min_lease_months = ?, image_urls = ?, image_hashes = ?, tx_hash = ?, updated_at = datetime('now', '+8 hours')
     WHERE id = ? AND landlord_id = ? AND status IN ('available','offline')`,
    [normalizedRentAmount, minLeaseMonthsNum, JSON.stringify(normalizedImageUrls), JSON.stringify(expectedImageHashes), txHash, req.params.id, req.user.id]
  );
  if (db.getRowsModified() !== 1) return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });

  const latest = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]))[0];
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_terms_onchain_commit',
    before: buildListingSnapshot(listing),
    after: buildListingSnapshot(latest),
    requestId: req.requestId,
    source: 'web',
  });
  saveDb();
  res.json({
    success: true,
    message: '链上条款更新成功',
    data: buildListingSnapshot(latest),
  });
}));

// 函数 6-3: 编辑房源基础信息（已下线，content 锁定不可改）。
router.put('/:id', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  res.status(410).json({ error: '房源内容已锁定（content_hash 不可修改）' });
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

// 函数 9: 重新评分接口。
router.post('/:id/score', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const listing = rows[0];
  const score = await scoreListingPayload({
    title: listing.title,
    description: listing.description,
    address: listing.address,
    imageUrls: parseJsonArray(listing.image_urls),
  });
  db.run(
    `UPDATE listings
     SET ai_score = ?, ai_confidence = ?, ai_risk_tags = ?, ai_score_reason = ?,
         ai_model_version = ?, ai_score_source = ?, ai_scored_at = datetime('now', '+8 hours'),
         updated_at = datetime('now', '+8 hours')
     WHERE id = ?`,
    [score.score, score.confidence, JSON.stringify(score.riskTags), score.reason, score.modelVersion, score.source, req.params.id]
  );
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'score_listing',
    after: score,
    requestId: req.requestId,
    source: 'web',
  });
  saveDb();
  res.json({ success: true, data: score });
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
