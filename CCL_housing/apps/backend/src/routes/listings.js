/**
 * 文件说明：房源路由。
 * 提供发布、查询、上下架管理接口。
 */
const express = require('express');
const crypto = require('crypto');
const { getDb, saveDb, parseResult } = require('../db');
const { authMiddleware, requireRole } = require('../auth');
const { logListingError } = require('../logger');

const router = express.Router();

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

// 函数 2: 发布房源接口（房东）。
router.post('/', authMiddleware, requireRole('landlord'), async (req, res) => {
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

    const id = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const imageHashes = imageUrls.map(() => `0x${crypto.randomBytes(32).toString('hex')}`);

    const db = await getDb();
    db.run(`INSERT INTO listings (
    id, landlord_id, title, description, address, district, rent_amount,
    rent_cycle, min_lease_months, bedrooms, livingrooms, bathrooms, area,
    image_urls, ai_score, image_hashes, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`, [
      id, req.user.id, title, description, address, district, normalizedRentAmount,
      rentCycle, minLeaseMonthsNum, Number(bedrooms), Number(livingrooms),
      Number(bathrooms), Number(area), JSON.stringify(imageUrls), null,
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
});

// 函数 2: 获取房源列表接口。
router.get('/', async (req, res) => {
  const { keyword = '', status = 'available' } = req.query;
  const db = await getDb();
  const rows = parseResult(db.exec(
    `SELECT l.*, u.nickname AS landlord_name, u.phone AS landlord_phone
     FROM listings l JOIN users u ON l.landlord_id = u.id
     WHERE l.status = ? AND (l.title LIKE ? OR l.description LIKE ? OR l.address LIKE ?)
     ORDER BY l.created_at DESC`,
    [status, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
  ));
  res.json({ success: true, data: rows, total: rows.length });
});

// 函数 3: 获取当前房东房源列表接口。
router.get('/my', authMiddleware, requireRole('landlord'), async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(
    'SELECT * FROM listings WHERE landlord_id = ? ORDER BY created_at DESC',
    [req.user.id]
  ));
  res.json({ success: true, data: rows });
});

// 函数 4: 获取房源详情接口。
router.get('/:id', async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(
    `SELECT l.*, u.nickname AS landlord_name, u.phone AS landlord_phone
     FROM listings l JOIN users u ON l.landlord_id = u.id WHERE l.id = ?`,
    [req.params.id]
  ));
  if (!rows.length) {
    return res.status(404).json({ error: '房源不存在' });
  }
  res.json({ success: true, data: rows[0] });
});

// 函数 5: 更新房源状态接口（房东上下架）。
router.put('/:id/status', authMiddleware, requireRole('landlord'), async (req, res) => {
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
});

module.exports = router;
