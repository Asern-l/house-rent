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
const { logListingError } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'listings');
const MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOCAL_DEV_PRIVATE_KEY = '0xe4a2d851548a27b70a5befe096b9f222d00b7ad529951bb2536cd4df767571c8';
const RENTAL_ABI_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'shared', 'blockchain', 'RentalChainABI.json');
const DEPLOYMENT_PATH = path.join(__dirname, '..', '..', '..', '..', 'blockchain', `deployments-rental-${CHAIN_ENV === 'local' ? 'localhost' : 'sepolia'}.json`);

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

function getRentalChainAddress() {
  const fromEnv = String(process.env.RENTAL_CHAIN_ADDRESS || process.env[`RENTAL_CHAIN_ADDRESS_${CHAIN_ENV.toUpperCase()}`] || '').trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(fromEnv)) return ethers.getAddress(fromEnv);
  if (fs.existsSync(DEPLOYMENT_PATH)) {
    try {
      const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, 'utf8'));
      if (/^0x[a-fA-F0-9]{40}$/.test(deployment.address)) return ethers.getAddress(deployment.address);
    } catch {}
  }
  return '';
}

function getChainRpcUrl() {
  if (CHAIN_ENV === 'local') return process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545';
  return process.env.SEPOLIA_RPC_URL || '';
}

function getRelayerPrivateKey() {
  const configured = String(process.env.LISTING_ONCHAIN_PRIVATE_KEY || process.env.PAYMENT_AUTH_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(configured)) return configured;
  if (CHAIN_ENV === 'local') return LOCAL_DEV_PRIVATE_KEY;
  return '';
}

async function attemptListingOnchain(listingId, requestId = '') {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [listingId]));
  if (!rows.length) return { ok: false, message: '房源不存在' };
  const listing = rows[0];
  if (listing.tx_hash) return { ok: true, txHash: listing.tx_hash };
  const rpcUrl = getChainRpcUrl();
  const privateKey = getRelayerPrivateKey();
  const contractAddress = getRentalChainAddress();
  if (!rpcUrl || !privateKey || !contractAddress) {
    const msg = '房源上链配置缺失';
    db.run(
      `UPDATE listings
       SET onchain_status = 'failed',
           onchain_attempts = onchain_attempts + 1,
           onchain_error = ?,
           onchain_last_attempt_at = datetime('now', '+8 hours'),
           onchain_next_retry_at = datetime('now', '+8 hours', '+5 minutes')
       WHERE id = ?`,
      [msg, listingId]
    );
    saveDb();
    return { ok: false, message: msg };
  }
  db.run(
    `UPDATE listings
     SET onchain_status = 'pending',
         onchain_attempts = onchain_attempts + 1,
         onchain_error = '',
         onchain_last_attempt_at = datetime('now', '+8 hours')
     WHERE id = ?`,
    [listingId]
  );
  saveDb();
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const abi = JSON.parse(fs.readFileSync(RENTAL_ABI_PATH, 'utf8'));
    const rental = new ethers.Contract(contractAddress, abi, wallet);
    const tx = await rental.storeListing(listingId);
    const receipt = await tx.wait();
    const txHash = receipt?.hash || tx.hash;
    db.run(
      `UPDATE listings
       SET tx_hash = ?,
           onchain_status = 'confirmed',
           onchain_error = '',
           onchain_next_retry_at = '',
           updated_at = datetime('now', '+8 hours')
       WHERE id = ? AND tx_hash IS NULL`,
      [txHash, listingId]
    );
    logListingOperation(db, {
      listingId,
      operatorId: 'system',
      action: 'listing_onchain_confirmed',
      after: { txHash },
      requestId,
      source: 'relayer',
    });
    saveDb();
    return { ok: true, txHash };
  } catch (error) {
    const msg = error?.shortMessage || error?.reason || error?.message || 'listing_onchain_failed';
    db.run(
      `UPDATE listings
       SET onchain_status = 'failed',
           onchain_error = ?,
           onchain_next_retry_at = datetime('now', '+8 hours', '+5 minutes')
       WHERE id = ? AND tx_hash IS NULL`,
      [msg, listingId]
    );
    logListingOperation(db, {
      listingId,
      operatorId: 'system',
      action: 'listing_onchain_failed',
      after: { error: msg },
      requestId,
      source: 'relayer',
    });
    saveDb();
    return { ok: false, message: msg };
  }
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

// 函数 7: 发布房源接口（房东）。
router.post('/', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  try {
    const {
      title, description, address, district = '', rentAmount,
      rentCycle = 'month', minLeaseMonths = 1, bedrooms = 1,
      livingrooms = 1, bathrooms = 1, area = 0, imageUrls = [],
    } = req.body;

    if (!title || !description || !address || rentAmount === undefined || rentAmount === null || rentAmount === '') {
      return res.status(400).json({ error: '标题、描述、地址、租金为必填项' });
    }
    const normalizedRentAmount = normalizeAmount(rentAmount);
    if (!normalizedRentAmount) {
      return res.status(400).json({ error: '租金必须为大于 0 的数字' });
    }
    const minLeaseMonthsNum = Number(minLeaseMonths ?? 1);
    if (!Number.isInteger(minLeaseMonthsNum) || minLeaseMonthsNum < 1 || minLeaseMonthsNum > 12) {
      return res.status(400).json({ error: '最少租期必须为 1-12 月的整数' });
    }

    const normalizedImageUrls = normalizeImageUrls(imageUrls);
    if (!normalizedImageUrls) {
      return res.status(400).json({ error: `imageUrls 格式不正确，且最多 ${MAX_IMAGE_COUNT} 张` });
    }

    const id = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const imageHashes = normalizedImageUrls.map((u) => {
      const h = crypto.createHash('sha256').update(u).digest('hex');
      return `0x${h}`;
    });

    const db = await getDb();
    const score = await scoreListingPayload({
      title,
      description,
      address,
      imageUrls: normalizedImageUrls,
    }).catch((error) => ({
      score: null,
      confidence: 0,
      riskTags: ['score_failed'],
      reason: error.message,
      modelVersion: 'score_failed',
      source: 'error',
    }));
    db.run(`INSERT INTO listings (
    id, landlord_id, title, description, address, district, rent_amount,
    rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
    image_urls, ai_score, ai_confidence, ai_risk_tags, ai_score_reason,
    ai_model_version, ai_score_source, ai_scored_at, image_hashes, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'), ?, 'available')`, [
      id, req.user.id, title, description, address, district, normalizedRentAmount,
      rentCycle, minLeaseMonthsNum, Number(bedrooms), Number(livingrooms),
      Number(bathrooms), Number(area), JSON.stringify(normalizedImageUrls), score.score,
      score.confidence, JSON.stringify(score.riskTags), score.reason,
      score.modelVersion, score.source,
      JSON.stringify(imageHashes),
    ]);
    logListingOperation(db, {
      listingId: id,
      operatorId: req.user.id,
      action: 'create_listing',
      after: { rentAmount: normalizedRentAmount, score },
      requestId: req.requestId,
      source: 'web',
    });
    saveDb();

    attemptListingOnchain(id, req.requestId).catch(() => {});
    res.json({ success: true, data: { id, imageHashes, aiScore: score.score, aiRiskTags: score.riskTags } });
  } catch (error) {
    logListingError('create-listing.exception', {
      requestId: req.requestId,
      userId: req.user?.id || '',
      message: error.message,
      stack: error.stack,
      body: req.body || {},
    });
    res.status(500).json({ error: '发布失败：服务内部错误，请查看日志' });
  }
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

// 函数 6: 更新房源状态接口（房东上下架）。
router.put('/:id/status', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['available', 'offline'].includes(status)) {
    return res.status(400).json({ error: '状态仅支持 available 或 offline' });
  }
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT id, status FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) {
    return res.status(403).json({ error: '无权限操作该房源' });
  }
  const currentStatus = rows[0].status;
  if (!['available', 'offline'].includes(currentStatus)) {
    return res.status(400).json({ error: '当前房源处于签约/履约流程中，暂不允许手动上下架' });
  }

  db.run('UPDATE listings SET status = ?, updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status IN (\'available\', \'offline\')', [status, req.params.id]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });
  }
  logListingOperation(db, {
    listingId: req.params.id,
    operatorId: req.user.id,
    action: 'update_status',
    before: { status: currentStatus },
    after: { status },
    requestId: req.requestId,
    source: 'web',
  });
  saveDb();
  res.json({ success: true, message: '状态更新成功' });
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

// 函数 10: 手动重试房源上链。
router.post('/:id/onchain/retry', authMiddleware, requireRole('landlord'), asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT id FROM listings WHERE id = ? AND landlord_id = ?', [req.params.id, req.user.id]));
  if (!rows.length) return res.status(403).json({ error: '无权限操作该房源' });
  const result = await attemptListingOnchain(req.params.id, req.requestId);
  if (!result.ok) return res.status(503).json({ error: result.message || '房源上链失败' });
  res.json({ success: true, message: '房源上链成功', data: { txHash: result.txHash } });
}));

// 函数 11: 查询房源操作日志。
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

async function retryPendingListingOnchain() {
  const db = await getDb();
  const rows = parseResult(db.exec(
    `SELECT id
     FROM listings
     WHERE tx_hash IS NULL
       AND onchain_status IN ('pending','failed')
       AND (onchain_next_retry_at = '' OR datetime(onchain_next_retry_at) <= datetime('now', '+8 hours'))
     ORDER BY onchain_last_attempt_at ASC
     LIMIT 3`
  ));
  for (const row of rows) {
    await attemptListingOnchain(row.id, 'background');
  }
}

router.retryPendingListingOnchain = retryPendingListingOnchain;

module.exports = router;
