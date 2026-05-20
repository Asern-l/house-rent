/**
 * 文件说明：房源路由。
 * 提供发布、查询、上下架管理接口。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDb, saveDb, parseResult } = require('../db');
const { getUserDb, parseResult: parseUserResult } = require('../user-db');
const { authMiddleware, requireRole } = require('../auth');
const { logListingError } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'listings');
const MAX_IMAGE_COUNT = 12;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
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
    db.run(`INSERT INTO listings (
    id, landlord_id, title, description, address, district, rent_amount,
    rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
    image_urls, ai_score, image_hashes, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`, [
      id, req.user.id, title, description, address, district, normalizedRentAmount,
      rentCycle, minLeaseMonthsNum, Number(bedrooms), Number(livingrooms),
      Number(bathrooms), Number(area), JSON.stringify(normalizedImageUrls), null,
      JSON.stringify(imageHashes),
    ]);
    saveDb();

    res.json({ success: true, data: { id, imageHashes } });
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

  db.run('UPDATE listings SET status = ?, updated_at = datetime(\'now\') WHERE id = ? AND status IN (\'available\', \'offline\')', [status, req.params.id]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态已变化，请刷新后重试' });
  }
  saveDb();
  res.json({ success: true, message: '状态更新成功' });
}));

module.exports = router;


