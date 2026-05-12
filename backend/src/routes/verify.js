const express = require('express');
const { getDb, saveDb } = require('../db');
const { authMiddleware, requireRole } = require('../auth');
const crypto = require('crypto');

const router = express.Router();

// 验证房源
router.get('/listing/:id', async (req, res) => {
  try {
    const db = await getDb();
    const listings = parseResult(db.exec(`SELECT * FROM listings WHERE id = ?`, [req.params.id]));

    if (listings.length === 0) {
      return res.json({
        success: true,
        data: { exists: false, message: '未找到该房源记录' }
      });
    }

    const listing = listings[0];
    const chainData = null; // 实际应用中从合约查询

    // 计算当前数据哈希用于比对
    const currentImageHashes = listing.image_hashes ? JSON.stringify(listing.image_hashes) : '[]';

    res.json({
      success: true,
      data: {
        exists: true,
        id: listing.id,
        status: listing.status,
        aiScore: listing.ai_score,
        imageHashes: listing.image_hashes,
        txHash: listing.tx_hash || '未上链',
        createdAt: listing.created_at,
        chainData,
        verificationNote: listing.tx_hash
          ? '✅ 该房源信息已上链存证，可登录区块浏览器查看'
          : '⚠️ 该房源尚未上链存证（演示环境）'
      }
    });
  } catch (err) {
    console.error('验证房源失败:', err);
    res.status(500).json({ error: '验证失败' });
  }
});

// 验证合同
router.get('/contract/:id', async (req, res) => {
  try {
    const db = await getDb();
    const contracts = parseResult(db.exec(`SELECT * FROM contracts WHERE id = ?`, [req.params.id]));

    if (contracts.length === 0) {
      return res.json({
        success: true,
        data: { exists: false, message: '未找到该合同记录' }
      });
    }

    const contract = contracts[0];

    // 从 content_json 取原始字符串用于哈希比对（避免 parseResult 转成对象）
    let contentStr = contract.content_json;
    if (typeof contentStr === 'object') {
      // 如果是对象（JSON.parse后的），用和创建时相同的格式重序列化
      contentStr = JSON.stringify(contentStr, null, 2);
    }

    // 用数据库内容重新计算哈希，与存证哈希对比
    const currentHash = '0x' + crypto.createHash('sha256')
      .update(contentStr || '')
      .digest('hex');

    const hashMatch = contract.content_hash && currentHash === contract.content_hash;

    res.json({
      success: true,
      data: {
        exists: true,
        id: contract.id,
        listingId: contract.listing_id,
        status: contract.status,
        storedHash: contract.content_hash,
        currentHash,
        hashMatch,
        txHash: contract.tx_hash || '未上链',
        tenantSignedAt: contract.tenant_signed_at,
        landlordSignedAt: contract.landlord_signed_at,
        createdAt: contract.created_at,
        conclusion: hashMatch
          ? `✅ 合同自签署以来未被修改${contract.tx_hash ? '，且已上链存证' : ''}`
          : '❌ 合同内容已被篡改！'
      }
    });
  } catch (err) {
    console.error('验证合同失败:', err);
    res.status(500).json({ error: '验证失败' });
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
