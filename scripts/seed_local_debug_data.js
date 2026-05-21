process.env.CHAIN_ENV = 'local';

const crypto = require('crypto');
const path = require('path');
const bcrypt = require(path.resolve(__dirname, '..', 'apps', 'backend', 'node_modules', 'bcryptjs'));
const { migrate, getDb, saveDb } = require('../apps/backend/src/db');
const { getUserDb, saveUserDb, parseResult: parseUserResult } = require('../apps/backend/src/user-db');

function hashContent(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

async function ensureUser(db, { id, phone, role, wallet, nickname }) {
  const rows = parseUserResult(db.exec('SELECT id FROM users WHERE id = ?', [id]));
  if (rows.length) return;
  const passwordHash = await bcrypt.hash('pass123456', 10);
  db.run(
    'INSERT INTO users (id, phone, password_hash, role, wallet_address, nickname) VALUES (?, ?, ?, ?, ?, ?)',
    [id, phone, passwordHash, role, wallet, nickname]
  );
}

(async () => {
  await migrate();
  const db = await getDb();
  const userDb = await getUserDb();
  await ensureUser(userDb, {
    id: 'debug_landlord',
    phone: 'debug-landlord@example.com',
    role: 'landlord',
    wallet: '0x2222222222222222222222222222222222222222',
    nickname: 'Debug Landlord',
  });
  await ensureUser(userDb, {
    id: 'debug_tenant',
    phone: 'debug-tenant@example.com',
    role: 'tenant',
    wallet: '0x1111111111111111111111111111111111111111',
    nickname: 'Debug Tenant',
  });
  saveUserDb();

  const listingId = `lst_debug_${Date.now()}`;
  db.run(
    `INSERT INTO listings (
      id, landlord_id, title, description, address, district, rent_amount, rent_cycle, min_lease_months,
      bedrooms, livingrooms, bathrooms, area, image_urls, ai_score, ai_confidence, ai_risk_tags,
      ai_score_reason, ai_model_version, ai_score_source, ai_scored_at, image_hashes, status
    ) VALUES (?, 'debug_landlord', '调试房源', '用于演示运行数月后的状态数据', '上海市调试路 100 号', '浦东', '1.2', 'month', 1, 2, 1, 1, 72, '[]', 88, 0.8, '[]', '调试数据评分', 'debug-v1', 'seed', datetime('now', '+8 hours'), '[]', 'rented')`,
    [listingId]
  );

  const contractId = `cnt_debug_${Date.now()}`;
  const content = {
    contractId,
    listingId,
    title: '调试房源',
    address: '上海市调试路 100 号',
    rentAmount: '1.2',
    oneTimeAmount: '3.6',
    tenant: { id: 'debug_tenant', nickname: 'Debug Tenant', walletAddress: '0x1111111111111111111111111111111111111111' },
    landlord: { id: 'debug_landlord', nickname: 'Debug Landlord', walletAddress: '0x2222222222222222222222222222222222222222' },
    terms: { paymentMethod: 'one_time', startDate: '2026-02-01', endDate: '2026-05-01', leaseMonths: 3, minLeaseMonths: 1 },
    createdAt: '2026-02-01 09:00:00',
  };
  const contentHash = hashContent(content);
  db.run(
    `INSERT INTO contracts (
      id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at,
      tenant_signed_at, landlord_signed_at, payment_deadline, negotiation_status, version, finalized_at, tx_hash
    ) VALUES (?, ?, 'debug_tenant', 'debug_landlord', ?, ?, 'active', '2026-02-03 09:00:00',
      '2026-02-01 09:10:00', '2026-02-01 09:20:00', '2026-02-01 11:20:00', 'finalized', 1, '2026-02-01 09:05:00', ?)`,
    [contractId, listingId, JSON.stringify(content, null, 2), contentHash, `0x${'d'.repeat(64)}`]
  );
  db.run(
    `INSERT INTO payments (id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at)
     VALUES (?, ?, 'debug_tenant', 'initial', '3.6', 'initial', ?, 'confirmed', '2026-02-01 09:30:00')`,
    [`pay_debug_${Date.now()}`, contractId, `0x${'e'.repeat(64)}`]
  );
  saveDb();
  console.log(`PASS: seeded local debug listing=${listingId} contract=${contractId}`);
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
