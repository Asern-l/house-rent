/**
 * 文件说明：数据库初始化与迁移。
 * 基于 sql.js 将数据持久化为 sqlite 文件。
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// 函数 1: 解析链环境标识并返回标准值。
function resolveChainEnv() {
  const raw = String(process.env.CHAIN_ENV || 'sepolia').trim().toLowerCase();
  if (raw === 'local') return 'local';
  return 'sepolia';
}

const CHAIN_ENV = resolveChainEnv();
const DB_PATH = path.join(__dirname, '..', 'data', `database.${CHAIN_ENV}.sqlite`);
let db;

// 函数 2: 确保数据库目录存在。
function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 函数 3: 获取数据库连接（惰性初始化）。
async function getDb() {
  if (db) return db;
  ensureDataDir();
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

// 函数 4: 将内存数据库持久化到磁盘。
function saveDb() {
  if (!db) return;
  ensureDataDir();
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// 函数 5: 将 sql.js 查询结果转换为对象数组。
function parseResult(result) {
  if (!result.length || !result[0].values.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const item = {};
    columns.forEach((column, index) => {
      const value = row[index];
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          item[column] = JSON.parse(value);
          return;
        } catch (error) {
          // 保留原始字符串。
        }
      }
      item[column] = value;
    });
    return item;
  });
}

// 函数 6: 重建 listings 表结构，移除预付字段并保留状态机字段。
function rebuildListingsTable(d, oldColumns) {
  d.run(`CREATE TABLE listings_new (
    id TEXT PRIMARY KEY,
    landlord_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    address TEXT NOT NULL,
    district TEXT DEFAULT '',
    rent_amount TEXT NOT NULL,
    rent_cycle TEXT NOT NULL DEFAULT 'month',
    min_lease_months INTEGER NOT NULL DEFAULT 1,
    bedrooms INTEGER DEFAULT 1,
    livingrooms INTEGER DEFAULT 1,
    bathrooms INTEGER DEFAULT 1,
    area REAL DEFAULT 0,
    image_urls TEXT DEFAULT '[]',
    ai_score INTEGER DEFAULT 85,
    image_hashes TEXT DEFAULT '[]',
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','locked','rented','offline','closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  const hasMinLeaseMonths = oldColumns.includes('min_lease_months');
  const minLeaseExpr = hasMinLeaseMonths ? 'min_lease_months' : '1';

  d.run(`INSERT INTO listings_new (
    id, landlord_id, title, description, address, district, rent_amount, rent_cycle, min_lease_months,
    bedrooms, livingrooms, bathrooms, area, image_urls, ai_score, image_hashes, tx_hash, status, created_at, updated_at
  )
  SELECT
    id, landlord_id, title, description, address, district, rent_amount, rent_cycle, ${minLeaseExpr},
    bedrooms, livingrooms, bathrooms, area, image_urls, ai_score, image_hashes, tx_hash, status, created_at, updated_at
  FROM listings`);

  d.run('DROP TABLE listings');
  d.run('ALTER TABLE listings_new RENAME TO listings');
}

function rebuildContractsTable(d, oldColumns) {
  d.run(`CREATE TABLE contracts_new (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    landlord_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','active_pending_onchain','pending_payment','active','ended','cancelled','expired','disputed')),
    expires_at TEXT NOT NULL,
    tenant_signed_at TEXT,
    landlord_signed_at TEXT,
    tenant_signer_address TEXT DEFAULT '',
    landlord_signer_address TEXT DEFAULT '',
    tenant_signature TEXT DEFAULT '',
    landlord_signature TEXT DEFAULT '',
    tenant_signature_message TEXT DEFAULT '',
    landlord_signature_message TEXT DEFAULT '',
    tenant_sign_ip TEXT DEFAULT '',
    landlord_sign_ip TEXT DEFAULT '',
    tenant_sign_user_agent TEXT DEFAULT '',
    landlord_sign_user_agent TEXT DEFAULT '',
    tenant_sign_request_id TEXT DEFAULT '',
    landlord_sign_request_id TEXT DEFAULT '',
    payment_deadline TEXT DEFAULT '',
    active_pending_onchain_at TEXT,
    onchain_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onchain_status IN ('not_started','pending','confirmed','failed')),
    onchain_attempts INTEGER NOT NULL DEFAULT 0,
    onchain_error TEXT DEFAULT '',
    onchain_next_retry_at TEXT DEFAULT '',
    onchain_last_attempt_at TEXT DEFAULT '',
    negotiation_status TEXT NOT NULL DEFAULT 'draft' CHECK(negotiation_status IN ('draft','proposed','finalized')),
    version INTEGER NOT NULL DEFAULT 1,
    parent_contract_id TEXT DEFAULT '',
    finalized_at TEXT,
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  const col = (name, fallback) => oldColumns.includes(name) ? name : fallback;
  d.run(`INSERT INTO contracts_new (
    id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at,
    tenant_signed_at, landlord_signed_at, tenant_signer_address, landlord_signer_address,
    tenant_signature, landlord_signature, tenant_signature_message, landlord_signature_message,
    tenant_sign_ip, landlord_sign_ip, tenant_sign_user_agent, landlord_sign_user_agent,
    tenant_sign_request_id, landlord_sign_request_id, payment_deadline, active_pending_onchain_at,
    onchain_status, onchain_attempts, onchain_error, onchain_next_retry_at, onchain_last_attempt_at,
    negotiation_status, version, parent_contract_id, finalized_at, tx_hash, created_at
  )
  SELECT
    id, listing_id, tenant_id, landlord_id, content_json, content_hash,
    CASE WHEN status = 'pending_payment' AND tx_hash IS NULL THEN 'active_pending_onchain' ELSE status END,
    expires_at,
    ${col('tenant_signed_at', 'NULL')}, ${col('landlord_signed_at', 'NULL')},
    ${col('tenant_signer_address', "''")}, ${col('landlord_signer_address', "''")},
    ${col('tenant_signature', "''")}, ${col('landlord_signature', "''")},
    ${col('tenant_signature_message', "''")}, ${col('landlord_signature_message', "''")},
    ${col('tenant_sign_ip', "''")}, ${col('landlord_sign_ip', "''")},
    ${col('tenant_sign_user_agent', "''")}, ${col('landlord_sign_user_agent', "''")},
    ${col('tenant_sign_request_id', "''")}, ${col('landlord_sign_request_id', "''")},
    ${col('payment_deadline', "''")}, ${col('active_pending_onchain_at', 'NULL')},
    ${col('onchain_status', "CASE WHEN tx_hash IS NULL THEN 'not_started' ELSE 'confirmed' END")},
    ${col('onchain_attempts', '0')}, ${col('onchain_error', "''")},
    ${col('onchain_next_retry_at', "''")}, ${col('onchain_last_attempt_at', "''")},
    ${col('negotiation_status', "'finalized'")}, ${col('version', '1')},
    ${col('parent_contract_id', "''")}, ${col('finalized_at', 'NULL')},
    tx_hash, created_at
  FROM contracts`);

  d.run('DROP TABLE contracts');
  d.run('ALTER TABLE contracts_new RENAME TO contracts');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
}

function rebuildPaymentsTable(d, oldColumns) {
  d.run(`CREATE TABLE payments_new (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    pay_type TEXT NOT NULL CHECK(pay_type IN ('initial','prepay','rent','renewal')),
    amount TEXT NOT NULL,
    period TEXT DEFAULT '',
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','failed')),
    paid_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    audit_json TEXT DEFAULT '{}',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);
  const col = (name, fallback) => oldColumns.includes(name) ? name : fallback;
  d.run(`INSERT INTO payments_new (
    id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at, created_at, audit_json
  )
  SELECT
    id, contract_id, payer_id,
    CASE WHEN pay_type IN ('initial','prepay','rent','renewal') THEN pay_type ELSE 'initial' END,
    amount, period, tx_hash, status, paid_at, created_at, ${col('audit_json', "'{}'")}
  FROM payments`);
  d.run('DROP TABLE payments');
  d.run('ALTER TABLE payments_new RENAME TO payments');
  d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');
}

// 函数 7: 执行数据库表结构迁移。
async function migrate() {
  const d = await getDb();
  d.run(`CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    landlord_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    address TEXT NOT NULL,
    district TEXT DEFAULT '',
    rent_amount TEXT NOT NULL,
    rent_cycle TEXT NOT NULL DEFAULT 'month',
    min_lease_months INTEGER NOT NULL DEFAULT 1,
    bedrooms INTEGER DEFAULT 1,
    livingrooms INTEGER DEFAULT 1,
    bathrooms INTEGER DEFAULT 1,
    area REAL DEFAULT 0,
    image_urls TEXT DEFAULT '[]',
    ai_score INTEGER DEFAULT 85,
    ai_confidence REAL DEFAULT 0,
    ai_risk_tags TEXT DEFAULT '[]',
    ai_score_reason TEXT DEFAULT '',
    ai_model_version TEXT DEFAULT '',
    ai_score_source TEXT DEFAULT '',
    ai_scored_at TEXT DEFAULT '',
    image_hashes TEXT DEFAULT '[]',
    tx_hash TEXT,
    onchain_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onchain_status IN ('not_started','pending','confirmed','failed')),
    onchain_attempts INTEGER NOT NULL DEFAULT 0,
    onchain_error TEXT DEFAULT '',
    onchain_next_retry_at TEXT DEFAULT '',
    onchain_last_attempt_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','locked','rented','offline','closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    landlord_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','active_pending_onchain','pending_payment','active','ended','cancelled','expired','disputed')),
    expires_at TEXT NOT NULL,
    tenant_signed_at TEXT,
    landlord_signed_at TEXT,
    tenant_signer_address TEXT DEFAULT '',
    landlord_signer_address TEXT DEFAULT '',
    tenant_signature TEXT DEFAULT '',
    landlord_signature TEXT DEFAULT '',
    tenant_signature_message TEXT DEFAULT '',
    landlord_signature_message TEXT DEFAULT '',
    tenant_sign_ip TEXT DEFAULT '',
    landlord_sign_ip TEXT DEFAULT '',
    tenant_sign_user_agent TEXT DEFAULT '',
    landlord_sign_user_agent TEXT DEFAULT '',
    tenant_sign_request_id TEXT DEFAULT '',
    landlord_sign_request_id TEXT DEFAULT '',
    payment_deadline TEXT DEFAULT '',
    active_pending_onchain_at TEXT,
    onchain_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onchain_status IN ('not_started','pending','confirmed','failed')),
    onchain_attempts INTEGER NOT NULL DEFAULT 0,
    onchain_error TEXT DEFAULT '',
    onchain_next_retry_at TEXT DEFAULT '',
    onchain_last_attempt_at TEXT DEFAULT '',
    negotiation_status TEXT NOT NULL DEFAULT 'draft' CHECK(negotiation_status IN ('draft','proposed','finalized')),
    version INTEGER NOT NULL DEFAULT 1,
    parent_contract_id TEXT DEFAULT '',
    finalized_at TEXT,
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    pay_type TEXT NOT NULL CHECK(pay_type IN ('initial','prepay','rent','renewal')),
    amount TEXT NOT NULL,
    period TEXT DEFAULT '',
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','failed')),
    paid_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    audit_json TEXT DEFAULT '{}',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS payment_authorizations (
    nonce TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    payer_address TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    deadline_epoch INTEGER NOT NULL,
    signature TEXT NOT NULL,
    used_tx_hash TEXT DEFAULT '',
    issued_by TEXT NOT NULL,
    issued_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    used_at TEXT,
    request_id TEXT DEFAULT '',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS contract_versions (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    proposer_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    change_note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    decided_at TEXT,
    decided_by TEXT DEFAULT '',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS contract_terminations (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    proposer_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    settlement_json TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    decided_at TEXT,
    decided_by TEXT DEFAULT '',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS listing_operation_logs (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT DEFAULT '{}',
    after_json TEXT DEFAULT '{}',
    request_id TEXT DEFAULT '',
    source TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listings_landlord ON listings(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_payment_auth_contract ON payment_authorizations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_terminations_contract ON contract_terminations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_operation_logs_listing ON listing_operation_logs(listing_id)');

  const listingCols = parseResult(d.exec('PRAGMA table_info(listings)')).map((c) => c.name);
  const listingSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'"))[0]?.sql || '';
  const needsRebuild = listingCols.includes('prepay_months')
    || !listingCols.includes('min_lease_months')
    || !listingSchema.includes("'locked'");
  if (needsRebuild) {
    rebuildListingsTable(d, listingCols);
  }

  const listingColsAfterRebuild = parseResult(d.exec('PRAGMA table_info(listings)')).map((c) => c.name);
  const listingColumnDefaults = {
    ai_confidence: 'REAL DEFAULT 0',
    ai_risk_tags: "TEXT DEFAULT '[]'",
    ai_score_reason: "TEXT DEFAULT ''",
    ai_model_version: "TEXT DEFAULT ''",
    ai_score_source: "TEXT DEFAULT ''",
    ai_scored_at: "TEXT DEFAULT ''",
    onchain_status: "TEXT NOT NULL DEFAULT 'not_started'",
    onchain_attempts: 'INTEGER NOT NULL DEFAULT 0',
    onchain_error: "TEXT DEFAULT ''",
    onchain_next_retry_at: "TEXT DEFAULT ''",
    onchain_last_attempt_at: "TEXT DEFAULT ''",
  };
  Object.entries(listingColumnDefaults).forEach(([name, definition]) => {
    if (!listingColsAfterRebuild.includes(name)) {
      d.run(`ALTER TABLE listings ADD COLUMN ${name} ${definition}`);
    }
  });

  const contractCols = parseResult(d.exec('PRAGMA table_info(contracts)')).map((c) => c.name);
  const contractSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contracts'"))[0]?.sql || '';
  const needsContractRebuild = !contractSchema.includes("'active_pending_onchain'")
    || !contractCols.includes('negotiation_status')
    || !contractCols.includes('onchain_status');
  if (needsContractRebuild) {
    rebuildContractsTable(d, contractCols);
  }

  const paymentCols = parseResult(d.exec('PRAGMA table_info(payments)')).map((c) => c.name);
  const paymentSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'"))[0]?.sql || '';
  if (!paymentSchema.includes("'prepay'") || !paymentSchema.includes("'renewal'") || !paymentCols.includes('audit_json')) {
    rebuildPaymentsTable(d, paymentCols);
  }

  saveDb();
  console.log(`数据库迁移完成（CHAIN_ENV=${CHAIN_ENV}，DB=${DB_PATH}）`);
}

module.exports = { getDb, saveDb, migrate, parseResult, CHAIN_ENV, DB_PATH };
