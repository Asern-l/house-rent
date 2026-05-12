const express = require('express');
const { getDb, saveDb } = require('../db');
const { authMiddleware, requireRole } = require('../auth');
const crypto = require('crypto');

const router = express.Router();

// 发布房源
router.post('/', authMiddleware, requireRole('landlord'), async (req, res) => {
  try {
    const { title, description, address, district, rentAmount, rentCycle,
      depositMonths, bedrooms, livingrooms, bathrooms, area, imageUrls } = req.body;

    if (!title || !description || !address || !rentAmount) {
      return res.status(400).json({ error: '标题、描述、地址、租金为必填项' });
    }

    const id = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 模拟 AI 检测分数（80-95之间的随机数，演示用）
    const aiScore = Math.floor(Math.random() * 16) + 80;

    // 模拟图片哈希
    const imageHashes = (imageUrls || []).map(() =>
      '0x' + crypto.randomBytes(32).toString('hex')
    );

    const db = await getDb();

    const stmt = db.prepare(`INSERT INTO listings 
      (id, landlord_id, title, description, address, district,
       rent_amount, rent_cycle, deposit_months,
       bedrooms, livingrooms, bathrooms, area,
       image_urls, ai_score, image_hashes, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`);

    stmt.run([
      id, req.user.id, title, description, address, district || '',
      rentAmount, rentCycle || 'month', depositMonths || 2,
      bedrooms || 0, livingrooms || 0, bathrooms || 0, area || 0,
      JSON.stringify(imageUrls || []), aiScore,
      JSON.stringify(imageHashes)
    ]);
    saveDb();

    res.json({
      success: true,
      data: {
        id, aiScore, imageHashes,
        message: `房源发布成功！AI可信度评分：${aiScore}分`
      }
    });
  } catch (err) {
    console.error('发布房源失败:', err);
    res.status(500).json({ error: '发布失败，请重试' });
  }
});

// 获取房源列表
router.get('/', async (req, res) => {
  try {
    const { status, district, minRent, maxRent, keyword } = req.query;
    const db = await getDb();

    let sql = `SELECT l.*, u.nickname as landlord_name, u.phone as landlord_phone
               FROM listings l JOIN users u ON l.landlord_id = u.id WHERE 1=1`;
    const params = [];

    if (status) {
      sql += ` AND l.status = ?`;
      params.push(status);
    } else {
      sql += ` AND l.status = 'available'`;
    }
    if (district) { sql += ` AND l.district = ?`; params.push(district); }
    if (minRent) { sql += ` AND CAST(l.rent_amount AS REAL) >= ?`; params.push(minRent); }
    if (maxRent) { sql += ` AND CAST(l.rent_amount AS REAL) <= ?`; params.push(maxRent); }
    if (keyword) { sql += ` AND (l.title LIKE ? OR l.description LIKE ? OR l.address LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

    sql += ` ORDER BY l.created_at DESC`;

    const result = db.exec(sql, params);
    const listings = parseQueryResult(result);

    res.json({ success: true, data: listings, total: listings.length });
  } catch (err) {
    console.error('获取房源列表失败:', err);
    res.status(500).json({ error: '获取房源列表失败' });
  }
});

// 获取我的房源
router.get('/mine', authMiddleware, requireRole('landlord'), async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT * FROM listings WHERE landlord_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    const listings = parseQueryResult(result);
    res.json({ success: true, data: listings });
  } catch (err) {
    console.error('获取我的房源失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取房源详情
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT l.*, u.nickname as landlord_name, u.phone as landlord_phone
       FROM listings l JOIN users u ON l.landlord_id = u.id
       WHERE l.id = ?`, [req.params.id]
    );
    const listings = parseQueryResult(result);
    if (listings.length === 0) {
      return res.status(404).json({ error: '房源不存在' });
    }
    res.json({ success: true, data: listings[0] });
  } catch (err) {
    console.error('获取房源详情失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

// 更新房源状态（房东操作）
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['available', 'offline'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `状态无效，允许: ${validStatuses.join(', ')}` });
    }

    const db = await getDb();
    const listing = db.exec(
      `SELECT * FROM listings WHERE id = ? AND landlord_id = ?`,
      [req.params.id, req.user.id]
    );
    if (parseQueryResult(listing).length === 0) {
      return res.status(403).json({ error: '无权操作该房源' });
    }

    db.run(`UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, req.params.id]);
    saveDb();

    res.json({ success: true, message: '状态更新成功' });
  } catch (err) {
    res.status(500).json({ error: '更新失败' });
  }
});

function parseQueryResult(result) {
  if (result.length === 0 || result[0].values.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => {
      obj[c] = row[i];
      // 尝试解析 JSON 字符串字段
      if (typeof row[i] === 'string' && (row[i].startsWith('[') || row[i].startsWith('{'))) {
        try { obj[c] = JSON.parse(row[i]); } catch (e) { /* keep as string */ }
      }
    });
    return obj;
  });
}

module.exports = router;
