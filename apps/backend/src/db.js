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

// 函数 6: 断言表结构包含指定字段。
function assertRequiredColumns(d, tableName, requiredColumns) {
  const actual = parseResult(d.exec(`PRAGMA table_info(${tableName})`)).map((c) => c.name);
  const missing = requiredColumns.filter((name) => !actual.includes(name));
  if (missing.length) {
    throw new Error(`[DB_SCHEMA_MISMATCH] ${tableName} 缺少字段: ${missing.join(', ')}`);
  }
}

// 函数 6-1: 若字段缺失则自动补齐（用于受控演进，不做跨版本语义兼容）。
function ensureColumn(d, tableName, columnName, alterSql) {
  const actual = parseResult(d.exec(`PRAGMA table_info(${tableName})`)).map((c) => c.name);
  if (!actual.includes(columnName)) {
    d.run(alterSql);
  }
}

// 函数 7: 严格校验关键业务表结构（不做兼容迁移）。
function assertStrictSchema(d) {
  assertRequiredColumns(d, 'listings', [
    'id', 'landlord_id', 'title', 'description', 'address', 'district', 'rent_amount', 'rent_cycle',
    'min_lease_months', 'bedrooms', 'livingrooms', 'bathrooms', 'area', 'clauses_template_json', 'image_urls',
    'image_hashes', 'content_hash', 'tx_hash', 'onchain_status', 'onchain_attempts', 'onchain_error',
    'onchain_next_retry_at', 'onchain_last_attempt_at', 'status', 'created_at', 'updated_at',
    'chain_version', 'chain_nonce', 'chain_block_number', 'chain_block_time'
  ]);

  assertRequiredColumns(d, 'contracts', [
    'id', 'listing_id', 'tenant_id', 'landlord_id', 'content_json', 'content_hash', 'status', 'expires_at',
    'tenant_signed_at', 'landlord_signed_at', 'tenant_signer_address', 'landlord_signer_address',
    'tenant_signature', 'landlord_signature', 'tenant_signature_message', 'landlord_signature_message',
    'tenant_sign_ip', 'landlord_sign_ip', 'tenant_sign_user_agent', 'landlord_sign_user_agent',
    'tenant_sign_request_id', 'landlord_sign_request_id', 'payment_deadline',
    'onchain_status', 'onchain_attempts', 'onchain_error', 'onchain_next_retry_at', 'onchain_last_attempt_at',
    'negotiation_status', 'version', 'parent_contract_id', 'finalized_at',
    'tenant_finalized_at', 'landlord_finalized_at', 'tx_hash', 'created_at'
  ]);

  assertRequiredColumns(d, 'payments', [
    'id', 'contract_id', 'payer_id', 'pay_type', 'amount', 'period', 'tx_hash', 'status',
    'paid_at', 'created_at', 'audit_json'
  ]);

  assertRequiredColumns(d, 'contract_gas_authorizations', [
    'id', 'contract_id', 'tenant_address', 'landlord_address', 'cap_wei', 'deadline_epoch_ms',
    'nonce', 'signature', 'message', 'chain_id', 'contract_address', 'lock_tx_hash',
    'mark_tx_hash', 'revoke_tx_hash', 'status', 'settle_tx_hash', 'created_at', 'updated_at'
  ]);

  assertRequiredColumns(d, 'listing_chain_operations', [
    'op_id', 'listing_id', 'action', 'tx_hash', 'status', 'request_id', 'detail_json', 'created_at', 'updated_at'
  ]);
}

// 函数 8: 执行数据库表结构初始化与严格校验。
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
    clauses_template_json TEXT DEFAULT '[]',
    image_urls TEXT DEFAULT '[]',
    image_hashes TEXT DEFAULT '[]',
    content_hash TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    onchain_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onchain_status IN ('not_started','pending','confirmed','failed')),
    onchain_attempts INTEGER NOT NULL DEFAULT 0,
    onchain_error TEXT DEFAULT '',
    onchain_next_retry_at TEXT DEFAULT '',
    onchain_last_attempt_at TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','rented','offline','closed')),
    chain_version INTEGER NOT NULL DEFAULT 0,
    chain_nonce INTEGER NOT NULL DEFAULT 0,
    chain_block_number INTEGER NOT NULL DEFAULT 0,
    chain_block_time INTEGER NOT NULL DEFAULT 0,
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
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','pending_payment','active','ended','cancelled','expired')),
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
    onchain_status TEXT NOT NULL DEFAULT 'not_started' CHECK(onchain_status IN ('not_started','pending','confirmed','failed')),
    onchain_attempts INTEGER NOT NULL DEFAULT 0,
    onchain_error TEXT DEFAULT '',
    onchain_next_retry_at TEXT DEFAULT '',
    onchain_last_attempt_at TEXT DEFAULT '',
    negotiation_status TEXT NOT NULL DEFAULT 'draft' CHECK(negotiation_status IN ('draft','proposed','finalized')),
    version INTEGER NOT NULL DEFAULT 1,
    parent_contract_id TEXT DEFAULT '',
    finalized_at TEXT,
    tenant_finalized_at TEXT DEFAULT '',
    landlord_finalized_at TEXT DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    payer_id TEXT NOT NULL,
    pay_type TEXT NOT NULL CHECK(pay_type IN ('initial')),
    amount TEXT NOT NULL,
    period TEXT DEFAULT '',
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('pending','confirmed','failed')),
    paid_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    audit_json TEXT DEFAULT '{}',
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  // 函数 8-1: 统一清理已废弃状态，迁移到当前手动上链流程。
  d.run("UPDATE contracts SET status = 'pending_payment' WHERE status = 'active_pending_onchain'");

  d.run(`CREATE TABLE IF NOT EXISTS contract_gas_authorizations (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    tenant_address TEXT NOT NULL,
    landlord_address TEXT NOT NULL,
    cap_wei TEXT NOT NULL,
    deadline_epoch_ms TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    signature TEXT NOT NULL,
    message TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
    lock_tx_hash TEXT DEFAULT '',
    mark_tx_hash TEXT DEFAULT '',
    revoke_tx_hash TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','consumed','expired','revoked')),
    settle_tx_hash TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
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

  d.run(`CREATE TABLE IF NOT EXISTS listing_chain_operations (
    op_id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create','status','terms','reconcile')),
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    request_id TEXT DEFAULT '',
    detail_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listings_landlord ON listings(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_gas_auth_contract ON contract_gas_authorizations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_terminations_contract ON contract_terminations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_operation_logs_listing ON listing_operation_logs(listing_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_chain_operations_listing ON listing_chain_operations(listing_id)');

  // 受控字段演进：确保关键字段存在。
  ensureColumn(d, 'listings', 'content_hash', "ALTER TABLE listings ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''");
  ensureColumn(d, 'listings', 'clauses_template_json', "ALTER TABLE listings ADD COLUMN clauses_template_json TEXT DEFAULT '[]'");
  ensureColumn(d, 'contract_gas_authorizations', 'lock_tx_hash', "ALTER TABLE contract_gas_authorizations ADD COLUMN lock_tx_hash TEXT DEFAULT ''");
  ensureColumn(d, 'contract_gas_authorizations', 'mark_tx_hash', "ALTER TABLE contract_gas_authorizations ADD COLUMN mark_tx_hash TEXT DEFAULT ''");
  ensureColumn(d, 'contract_gas_authorizations', 'revoke_tx_hash', "ALTER TABLE contract_gas_authorizations ADD COLUMN revoke_tx_hash TEXT DEFAULT ''");

  try {
    assertStrictSchema(d);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[DB_SCHEMA_MISMATCH] 当前数据库结构不受支持（已禁用兼容迁移）。请删除后重建：${DB_PATH}。详细原因：${reason}`);
  }

  saveDb();
  console.log(`数据库迁移完成（CHAIN_ENV=${CHAIN_ENV}，DB=${DB_PATH}）`);
}

module.exports = { getDb, saveDb, migrate, parseResult, CHAIN_ENV, DB_PATH };
