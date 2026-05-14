/**
 * 文件说明：验真路由。
 * 提供房源和合同的链下完整性核验接口。
 */
const express = require('express');
const crypto = require('crypto');
const { getDb, parseResult } = require('../db');

const router = express.Router();

// 函数 1: 房源验真接口。
router.get('/listing/:id', async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]));
  if (!rows.length) {
    return res.json({ success: true, data: { exists: false, message: '房源不存在' } });
  }
  const listing = rows[0];
  res.json({
    success: true,
    data: {
      exists: true,
      id: listing.id,
      txHash: listing.tx_hash || '未上链',
      createdAt: listing.created_at,
    },
  });
});

// 函数 2: 合同验真接口。
router.get('/contract/:id', async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) {
    return res.json({ success: true, data: { exists: false, message: '合同不存在' } });
  }

  const contract = rows[0];
  const contentStr = typeof contract.content_json === 'string'
    ? contract.content_json
    : JSON.stringify(contract.content_json, null, 2);
  const currentHash = `0x${crypto.createHash('sha256').update(contentStr).digest('hex')}`;
  const hashMatch = currentHash === contract.content_hash;
  const payments = parseResult(db.exec(
    `SELECT id, pay_type, amount, tx_hash, status, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at DESC`,
    [contract.id]
  ));
  const initialPayment = payments.find((item) => item.pay_type === 'initial' && item.status === 'confirmed') || null;
  const isEffectiveByPayment = Boolean(initialPayment);

  res.json({
    success: true,
    data: {
      exists: true,
      contractId: contract.id,
      status: contract.status,
      storedHash: contract.content_hash,
      currentHash,
      hashMatch,
      txHash: contract.tx_hash || '未上链',
      paymentVerified: isEffectiveByPayment,
      initialPayment: initialPayment ? {
        id: initialPayment.id,
        amount: initialPayment.amount,
        txHash: initialPayment.tx_hash,
        status: initialPayment.status,
        paidAt: initialPayment.paid_at,
      } : null,
      paymentCount: payments.length,
      conclusion: hashMatch ? '合同未被篡改' : '合同哈希不匹配，疑似被篡改',
    },
  });
});

module.exports = router;
