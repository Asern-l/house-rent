/**
 * 文件说明：合同路由。
 * 覆盖合同创建、签署、取消、上链回写、列表与详情查询。
 */
const express = require('express');
const crypto = require('crypto');
const { getDb, saveDb, parseResult } = require('../db');
const { getUserDb, parseResult: parseUserResult } = require('../user-db');
const { authMiddleware, requireRole } = require('../auth');
const { logSignFlow } = require('../logger');

const router = express.Router();

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

// 函数 2: 判断合同是否为终态。
function isTerminalStatus(status) {
  return ['cancelled', 'expired', 'ended'].includes(status);
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

// 函数 3: 创建合同接口（租客发起）。
router.post('/', authMiddleware, requireRole('tenant'), async (req, res) => {
  const { listingId, startDate, leaseMonths } = req.body || {};
  if (!listingId) {
    return res.status(400).json({ error: 'listingId 不能为空' });
  }

  const db = await getDb();
  const userDb = await getUserDb();
  const listings = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [listingId]));
  if (!listings.length) return res.status(404).json({ error: '房源不存在' });
  const listing = listings[0];
  if (listing.status !== 'available') return res.status(400).json({ error: '房源不可租' });

  // 同一房源若已有进行中合同，不允许再次发起。
  const existingContracts = parseResult(db.exec(
    `SELECT id, status FROM contracts
     WHERE listing_id = ?
       AND status NOT IN ('cancelled', 'expired', 'ended')`,
    [listingId]
  ));
  if (existingContracts.length > 0) {
    return res.status(409).json({ error: '该房源已有进行中的合同，暂不可重复申请' });
  }

  const minLeaseMonths = Number(listing.min_lease_months || 1);
  const leaseMonthsNum = Number(leaseMonths ?? minLeaseMonths);
  if (!Number.isInteger(leaseMonthsNum) || leaseMonthsNum < minLeaseMonths || leaseMonthsNum > 12) {
    return res.status(400).json({ error: `租期必须为 ${minLeaseMonths}-12 月的整数` });
  }
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const maxDate = new Date(todayDate);
  maxDate.setDate(maxDate.getDate() + 3);
  const startDateOnly = normalizeDateOnly(startDate) || getCnDateOnly(todayDate);
  const startAt = new Date(`${startDateOnly}T00:00:00`);
  if (startAt < todayDate || startAt > maxDate) {
    return res.status(400).json({ error: '生效日期仅支持今天至未来3天' });
  }

  const [tenant] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [req.user.id]));
  const [landlord] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [listing.landlord_id]));
  if (!tenant || !landlord) {
    return res.status(400).json({ error: '用户信息不存在，请重新登录后重试' });
  }
  const rentAmount = normalizeAmount(listing.rent_amount);
  if (!rentAmount) {
    return res.status(400).json({ error: '房源租金配置无效，请房东先修正房源信息' });
  }
  const oneTimeAmount = normalizeAmount(Number(rentAmount) * leaseMonthsNum);
  if (!oneTimeAmount) {
    return res.status(400).json({ error: '合同首笔支付金额计算失败，请检查房源配置' });
  }

  const contractId = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const content = {
    contractId,
    listingId,
    title: listing.title,
    address: listing.address,
    rentAmount,
    oneTimeAmount,
    tenant: { id: tenant.id, nickname: tenant.nickname, walletAddress: tenant.wallet_address },
    landlord: { id: landlord.id, nickname: landlord.nickname, walletAddress: landlord.wallet_address },
    terms: {
      paymentMethod: 'one_time',
      startDate: startDateOnly,
      endDate: addMonthsDateOnly(startDateOnly, leaseMonthsNum),
      leaseMonths: leaseMonthsNum,
      minLeaseMonths,
    },
    createdAt: getCnDateTime(new Date()),
  };

  const contentJson = JSON.stringify(content, null, 2);
  const contentHash = `0x${crypto.createHash('sha256').update(contentJson).digest('hex')}`;
  const expiresAt = getCnDateTime(new Date(Date.now() + 48 * 60 * 60 * 1000));

  db.run('UPDATE listings SET status = \'locked\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'available\'', [listingId]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源已被其他租客占用，请刷新后重试' });
  }

  try {
    db.run(`INSERT INTO contracts (id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, [
      contractId, listingId, req.user.id, listing.landlord_id, contentJson, contentHash, expiresAt,
    ]);
  } catch (error) {
    db.run('UPDATE listings SET status = \'available\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'', [listingId]);
    throw error;
  }
  saveDb();

  res.json({ success: true, data: { contractId, contentHash, expiresAt } });
});

// 函数 4: 租客签署合同接口。
router.post('/:id/sign-tenant', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) return res.status(403).json({ error: '无权限签署' });
  if (contract.status !== 'pending') {
    return res.status(400).json({ error: '当前状态不允许租客签署', currentStatus: contract.status });
  }

  db.run(
    'UPDATE contracts SET status = \'tenant_signed\', tenant_signed_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'pending\'',
    [req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '合同状态已变化，请刷新后重试' });
  }
  saveDb();
  res.json({ success: true, message: '租客签署成功' });
});

// 函数 5: 房东签署合同接口。
router.post('/:id/sign-landlord', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
    if (!rows.length) return res.status(404).json({ error: '合同不存在' });
    const contract = rows[0];

    if (contract.landlord_id !== req.user.id) return res.status(403).json({ error: '无权限签署' });
    if (contract.status !== 'tenant_signed') {
      return res.status(400).json({ error: '当前状态不允许房东签署', currentStatus: contract.status });
    }

    const content = contract.content_json;
    const tenantAddress = String(content?.tenant?.walletAddress || '').trim();
    const landlordAddress = String(content?.landlord?.walletAddress || '').trim();
    const addrRe = /^0x[a-fA-F0-9]{40}$/;
    if (!addrRe.test(tenantAddress) || !addrRe.test(landlordAddress)) {
      return res.status(400).json({
        error: '合同绑定钱包地址不完整或格式无效，请租客和房东先在个人中心绑定钱包后重新发起合同',
      });
    }

    db.run(
      'UPDATE contracts SET status = \'pending_payment\', landlord_signed_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'tenant_signed\'',
      [req.params.id]
    );
    if (db.getRowsModified() !== 1) {
      return res.status(409).json({ error: '合同状态已变化，请刷新后重试' });
    }

    saveDb();

    res.json({
      success: true,
      message: '房东签署成功，请先完成上链与首笔支付',
      data: {
        contentHash: contract.content_hash,
        tenantAddress: content?.tenant?.walletAddress || '',
        landlordAddress: content?.landlord?.walletAddress || '',
        initialAmount: content?.oneTimeAmount || '',
      },
    });
  } catch (error) {
    logSignFlow('sign-landlord.exception', { contractId: req.params.id, message: error.message, requestId: req.requestId });
    res.status(500).json({ error: '房东签署失败' });
  }
});

// 函数 6: 上链交易哈希回写接口。
router.post('/:id/onchain', authMiddleware, async (req, res) => {
  const { txHash } = req.body;
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    return res.status(400).json({ error: 'txHash 格式不正确' });
  }

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限操作该合同' });
  }
  if (!['pending_payment', 'active'].includes(contract.status)) {
    return res.status(400).json({ error: '当前状态不允许回写上链交易' });
  }

  db.run('UPDATE contracts SET tx_hash = ? WHERE id = ? AND tx_hash IS NULL', [txHash, req.params.id]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '该合同已回写过链上交易哈希' });
  }
  saveDb();
  res.json({ success: true, message: '链上交易回写成功' });
});

// 函数 7: 支付成功回写接口（当前仅支持一次性首笔支付）。
router.post('/:id/payments/onchain', authMiddleware, async (req, res) => {
  const { txHash, amount, payType = 'initial', period = '' } = req.body || {};
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    return res.status(400).json({ error: 'txHash 格式不正确' });
  }
  if (payType !== 'initial') {
    return res.status(400).json({ error: '当前仅支持 initial' });
  }
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount 必须大于 0' });
  }

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) {
    return res.status(403).json({ error: '仅租客可回写支付记录' });
  }
  if (contract.status !== 'pending_payment') {
    return res.status(400).json({ error: '当前状态不允许首笔支付', currentStatus: contract.status });
  }

  const existed = parseResult(db.exec('SELECT id FROM payments WHERE tx_hash = ?', [txHash]));
  if (existed.length > 0) {
    return res.status(409).json({ error: '该支付交易已回写' });
  }

  const priorInitial = parseResult(db.exec(
    'SELECT id FROM payments WHERE contract_id = ? AND pay_type = ? AND status = ?',
    [req.params.id, 'initial', 'confirmed']
  ));
  if (priorInitial.length > 0) {
    return res.status(409).json({ error: '该合同首笔支付已完成' });
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
    return res.status(409).json({ error: '合同状态已变化，无法完成生效' });
  }
  db.run(
    'UPDATE listings SET status = \'rented\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'',
    [contract.listing_id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态异常，无法完成生效' });
  }

  saveDb();
  res.json({ success: true, message: '支付回写成功', data: { paymentId } });
});

// 函数 7: 取消合同接口。
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限取消该合同' });
  }
  if (!['pending', 'tenant_signed'].includes(contract.status)) {
    return res.status(400).json({ error: '当前状态不允许取消' });
  }

  db.run(
    'UPDATE contracts SET status = \'cancelled\' WHERE id = ? AND status IN (\'pending\', \'tenant_signed\')',
    [req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '合同状态已变化，无法取消' });
  }

  const listingRows = parseResult(db.exec('SELECT status FROM listings WHERE id = ?', [contract.listing_id]));
  const listingStatus = listingRows[0]?.status || '';
  if (listingStatus === 'locked') {
    const siblingContracts = parseResult(db.exec(
      `SELECT id, status FROM contracts
       WHERE listing_id = ? AND id <> ?`,
      [contract.listing_id, contract.id]
    ));
    const hasNonTerminal = siblingContracts.some((item) => !isTerminalStatus(item.status));
    if (!hasNonTerminal) {
      db.run(
        'UPDATE listings SET status = \'available\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'',
        [contract.listing_id]
      );
    }
  }
  saveDb();
  res.json({ success: true, message: '合同已取消' });
});

// 函数 8: 获取合同支付记录接口。
router.get('/:id/payments', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限查看该合同支付记录' });
  }
  const payments = parseResult(db.exec(
    `SELECT id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at DESC`,
    [req.params.id]
  ));
  res.json({ success: true, data: payments });
});

// 函数 9: 前端签署失败上报接口。
router.post('/:id/sign-client-report', authMiddleware, async (req, res) => {
  const payload = req.body || {};
  logSignFlow('client.report', {
    contractId: req.params.id,
    userId: req.user.id,
    requestId: req.requestId,
    ...payload,
  });
  res.json({ success: true });
});

// 函数 10: 获取我的合同列表接口。
router.get('/', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id
    WHERE c.tenant_id = ? OR c.landlord_id = ? ORDER BY c.created_at DESC`, [req.user.id, req.user.id]));
  res.json({ success: true, data: rows });
});

// 函数 11: 获取合同详情接口。
router.get('/:id', async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id WHERE c.id = ?`, [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  res.json({ success: true, data: rows[0] });
});

module.exports = router;
