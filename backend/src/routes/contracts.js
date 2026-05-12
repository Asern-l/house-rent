const express = require('express');
const { getDb, saveDb } = require('../db');
const { authMiddleware, requireRole } = require('../auth');
const crypto = require('crypto');

const router = express.Router();

// 创建合同（租客发起）
router.post('/', authMiddleware, requireRole('tenant'), async (req, res) => {
  try {
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: '房源ID为必填项' });

    const db = await getDb();
    const listings = parseResult(db.exec(`SELECT * FROM listings WHERE id = ?`, [listingId]));
    if (listings.length === 0) return res.status(404).json({ error: '房源不存在' });
    if (listings[0].status !== 'available') return res.status(400).json({ error: '该房源不可租' });

    const listing = listings[0];
    const landlordResult = parseResult(db.exec(`SELECT * FROM users WHERE id = ?`, [listing.landlord_id]));
    const tenantResult = parseResult(db.exec(`SELECT * FROM users WHERE id = ?`, [req.user.id]));

    const landlord = landlordResult[0];
    const tenant = tenantResult[0];

    // 生成合同ID
    const contractId = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 构建合同内容（JSON）
    const contractContent = {
      contractId,
      listingId,
      address: listing.address,
      district: listing.district,
      title: listing.title,
      rentAmount: listing.rent_amount,
      rentCycle: listing.rent_cycle,
      depositMonths: listing.deposit_months,
      depositAmount: (parseFloat(listing.rent_amount) * parseInt(listing.deposit_months)).toString(),
      landlord: {
        id: landlord.id,
        phone: landlord.phone,
        nickname: landlord.nickname,
        walletAddress: landlord.wallet_address
      },
      tenant: {
        id: tenant.id,
        phone: tenant.phone,
        nickname: tenant.nickname,
        walletAddress: tenant.wallet_address
      },
      terms: {
        startDate: '',
        endDate: '',
        paymentMethod: 'monthly',
        utilitiesResponsibility: 'tenant',
        maintenanceResponsibility: 'landlord',
        petsAllowed: false,
        subletAllowed: false
      },
      // 法律条款（参考《民法典》租赁合同）
      legalClauses: [
        '甲方应保证房屋符合居住安全标准，不得危及乙方人身安全',
        '乙方应按约定用途合理使用房屋及设施，不得擅自改变房屋结构',
        '租赁期内，房屋自然损耗由甲方承担维修责任',
        '乙方因使用不当造成房屋或设施损坏的，应负责修复或赔偿',
        '任何一方提前解除合同，应提前30日书面通知对方',
        '合同到期后，乙方在同等条件下享有优先续租权',
        '双方发生争议应协商解决；协商不成的，可向房屋所在地人民法院提起诉讼'
      ],
      createdAt: new Date().toISOString()
    };

    // 计算合同内容哈希
    const contentJson = JSON.stringify(contractContent, null, 2);
    const contentHash = '0x' + crypto.createHash('sha256').update(contentJson).digest('hex');

    // 设置过期时间（48小时）
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const depositAmount = contractContent.depositAmount;

    db.run(`INSERT INTO contracts 
      (id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at, deposit_amount)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [contractId, listingId, req.user.id, listing.landlord_id,
       contentJson, contentHash, expiresAt, depositAmount]);

    // 更新房源状态为已租
    db.run(`UPDATE listings SET status = 'rented', updated_at = datetime('now') WHERE id = ?`, [listingId]);
    saveDb();

    res.json({
      success: true,
      data: { contractId, contentHash, contentJson, expiresAt }
    });
  } catch (err) {
    console.error('创建合同失败:', err);
    res.status(500).json({ error: '创建合同失败' });
  }
});

// 租客签署合同
router.post('/:id/sign-tenant', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const contracts = parseResult(db.exec(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]));
    if (contracts.length === 0) return res.status(404).json({ error: '合同不存在' });

    const contract = contracts[0];
    if (contract.tenant_id !== req.user.id) return res.status(403).json({ error: '无权签署该合同' });
    if (contract.status !== 'pending') return res.status(400).json({ error: '合同状态错误' });
    if (new Date(contract.expires_at) < new Date()) {
      db.run(`UPDATE contracts SET status = 'expired' WHERE id = ?`, [req.params.id]);
      db.run(`UPDATE listings SET status = 'available', updated_at = datetime('now') WHERE id = ?`, [contract.listing_id]);
      saveDb();
      return res.status(400).json({ error: '合同已过期' });
    }

    db.run(`UPDATE contracts SET status = 'tenant_signed', tenant_signed_at = datetime('now') WHERE id = ?`,
      [req.params.id]);
    saveDb();

    res.json({ success: true, message: '签署成功（租客）' });
  } catch (err) {
    console.error('签署失败:', err);
    res.status(500).json({ error: '签署失败' });
  }
});

// 房东签署合同
router.post('/:id/sign-landlord', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const contracts = parseResult(db.exec(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]));
    if (contracts.length === 0) return res.status(404).json({ error: '合同不存在' });

    const contract = contracts[0];
    if (contract.landlord_id !== req.user.id) return res.status(403).json({ error: '无权签署该合同' });
    if (contract.status !== 'tenant_signed') return res.status(400).json({ error: '请等待租客先签署' });
    if (new Date(contract.expires_at) < new Date()) {
      db.run(`UPDATE contracts SET status = 'expired' WHERE id = ?`, [req.params.id]);
      db.run(`UPDATE listings SET status = 'available', updated_at = datetime('now') WHERE id = ?`, [contract.listing_id]);
      saveDb();
      return res.status(400).json({ error: '合同已过期' });
    }

    db.run(`UPDATE contracts SET status = 'active', landlord_signed_at = datetime('now') WHERE id = ?`,
      [req.params.id]);
    saveDb();

    // 返回内容哈希，前端将其上链
    res.json({
      success: true,
      message: '合同已生效！请将合同哈希上链存证',
      data: {
        contentHash: contract.content_hash,
        tenantAddress: contract.tenant_id,
        landlordAddress: contract.landlord_id
      }
    });
  } catch (err) {
    console.error('签署失败:', err);
    res.status(500).json({ error: '签署失败' });
  }
});

// 取消合同（签署过程中）
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const contracts = parseResult(db.exec(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]));
    if (contracts.length === 0) return res.status(404).json({ error: '合同不存在' });

    const contract = contracts[0];
    if (contract.tenant_id !== req.user.id && contract.landlord_id !== req.user.id) {
      return res.status(403).json({ error: '无权操作' });
    }
    if (!['pending', 'tenant_signed'].includes(contract.status)) {
      return res.status(400).json({ error: '当前状态不可取消' });
    }

    db.run(`UPDATE contracts SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
    db.run(`UPDATE listings SET status = 'available', updated_at = datetime('now') WHERE id = ?`, [contract.listing_id]);
    saveDb();

    res.json({ success: true, message: '合同已取消' });
  } catch (err) {
    res.status(500).json({ error: '取消失败' });
  }
});

// 上链存证（双方签署后调用）
router.post('/:id/onchain', authMiddleware, async (req, res) => {
  try {
    const { txHash } = req.body;
    const db = await getDb();
    const contracts = parseResult(db.exec(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]));
    if (contracts.length === 0) return res.status(404).json({ error: '合同不存在' });

    const contract = contracts[0];
    if (contract.status !== 'active') return res.status(400).json({ error: '合同未生效' });

    db.run(`UPDATE contracts SET tx_hash = ? WHERE id = ?`, [txHash || '', req.params.id]);
    saveDb();

    res.json({ success: true, message: '合同哈希已上链存证' });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

// 获取合同列表
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT c.*, l.title as listing_title, l.address as listing_address
       FROM contracts c
       JOIN listings l ON c.listing_id = l.id
       WHERE c.tenant_id = ? OR c.landlord_id = ?
       ORDER BY c.created_at DESC`,
      [req.user.id, req.user.id]
    );
    const contracts = parseResult(result);
    res.json({ success: true, data: contracts });
  } catch (err) {
    res.status(500).json({ error: '获取合同列表失败' });
  }
});

// 获取合同详情
router.get('/:id', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT c.*, l.title as listing_title, l.address as listing_address
       FROM contracts c JOIN listings l ON c.listing_id = l.id
       WHERE c.id = ?`, [req.params.id]
    );
    const contracts = parseResult(result);
    if (contracts.length === 0) return res.status(404).json({ error: '合同不存在' });
    res.json({ success: true, data: contracts[0] });
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

function parseResult(result) {
  if (result.length === 0 || result[0].values.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => {
      obj[c] = row[i];
      if (typeof row[i] === 'string' && (row[i].startsWith('[') || row[i].startsWith('{'))) {
        try { obj[c] = JSON.parse(row[i]); } catch (e) { }
      }
    });
    return obj;
  });
}

module.exports = router;
