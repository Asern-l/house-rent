/**
 * 文件说明：数据库初始化与严格校验。
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

function getTableCreateSql(d, tableName) {
  const rows = parseResult(d.exec(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  ));
  return String(rows[0]?.sql || '');
}

function tableSqlContainsAll(sql, fragments) {
  return fragments.every((fragment) => String(sql).includes(fragment));
}

function createContractsTableSql(tableName = 'contracts') {
  return `CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    landlord_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','pending_payment','active','ended','cancelled_before_payment','expired','terminated_early')),
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
    terminated_early_at TEXT DEFAULT '',
    negotiation_status TEXT NOT NULL DEFAULT 'draft' CHECK(negotiation_status IN ('draft','proposed','finalized','locked')),
    version INTEGER NOT NULL DEFAULT 1,
    parent_contract_id TEXT DEFAULT '',
    finalized_at TEXT,
    tenant_finalized_at TEXT DEFAULT '',
    landlord_finalized_at TEXT DEFAULT '',
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`;
}

function ensureNotificationTable(d) {
  d.run(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    actor_id TEXT DEFAULT '',
    actor_role TEXT DEFAULT '',
    kind TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    dedupe_key TEXT UNIQUE,
    read_at TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);
}

function ensureIndexes(d) {
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listings_landlord ON listings(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_gas_auth_contract ON contract_gas_authorizations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_gas_prepare_contract ON contract_gas_authorization_prepares(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_terminations_contract ON contract_terminations(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_operation_logs_listing ON listing_operation_logs(listing_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_feedbacks_listing ON listing_feedbacks(listing_id, created_at)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listing_feedbacks_tx ON listing_feedbacks(tx_hash)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_reviews_listing ON contract_reviews(listing_id, created_at)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contract_reviews_contract ON contract_reviews(contract_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_onchain_operations_entity ON onchain_operations(entity_type, entity_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_onchain_operations_status ON onchain_operations(status, operation_kind)');
  d.run('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(recipient_id, created_at)');
  d.run('CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient_id, read_at, created_at)');
}

// 函数 7: 严格校验关键业务表结构。
function assertStrictSchema(d) {
  assertRequiredColumns(d, 'listings', [
    'id', 'landlord_id', 'title', 'description', 'address', 'district', 'rent_amount', 'rent_cycle',
    'min_lease_months', 'bedrooms', 'livingrooms', 'bathrooms', 'area', 'clauses_template_json', 'image_urls',
    'image_hashes', 'image_cids', 'public_snapshot_cid', 'public_snapshot_hash', 'content_hash', 'tx_hash', 'status', 'created_at', 'updated_at',
    'chain_version', 'chain_nonce', 'chain_block_number', 'chain_block_time'
  ]);

  assertRequiredColumns(d, 'contracts', [
    'id', 'listing_id', 'tenant_id', 'landlord_id', 'content_json', 'content_hash', 'status', 'expires_at',
    'tenant_signed_at', 'landlord_signed_at', 'tenant_signer_address', 'landlord_signer_address',
    'tenant_signature', 'landlord_signature', 'tenant_signature_message', 'landlord_signature_message',
    'tenant_sign_ip', 'landlord_sign_ip', 'tenant_sign_user_agent', 'landlord_sign_user_agent',
    'tenant_sign_request_id', 'landlord_sign_request_id', 'payment_deadline', 'terminated_early_at',
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

  assertRequiredColumns(d, 'contract_gas_authorization_prepares', [
    'id', 'contract_id', 'tenant_address', 'landlord_address', 'cap_wei', 'deadline_epoch_ms',
    'nonce', 'digest', 'chain_id', 'contract_address', 'created_at', 'updated_at'
  ]);


  assertRequiredColumns(d, 'onchain_operations', [
    'op_id', 'entity_type', 'entity_id', 'operation_kind', 'tx_hash', 'status',
    'request_id', 'payload_json', 'result_json', 'error_message', 'created_at', 'updated_at'
  ]);

  assertRequiredColumns(d, 'listing_feedbacks', [
    'id', 'listing_id', 'author_id', 'author_role', 'author_wallet', 'feedback_type', 'comment_text', 'comment_hash', 'comment_cid', 'tx_hash', 'chain_env', 'created_at'
  ]);

  assertRequiredColumns(d, 'contract_reviews', [
    'id', 'contract_id', 'listing_id', 'tenant_id', 'tenant_wallet', 'rating', 'weight',
    'comment_text', 'comment_hash', 'comment_cid', 'tx_hash', 'chain_env', 'created_at'
  ]);

  assertRequiredColumns(d, 'notifications', [
    'id', 'recipient_id', 'actor_id', 'actor_role', 'kind', 'entity_type', 'entity_id',
    'title', 'body', 'metadata_json', 'dedupe_key', 'read_at', 'created_at'
  ]);

  const contractsSql = getTableCreateSql(d, 'contracts');
  if (!tableSqlContainsAll(contractsSql, ["'draft'", "'proposed'", "'finalized'", "'locked'"])) {
    throw new Error('[DB_SCHEMA_MISMATCH] contracts.negotiation_status 约束未包含 locked');
  }
  const contractVersionsSql = getTableCreateSql(d, 'contract_versions');
  if (!tableSqlContainsAll(contractVersionsSql, ["'draft'", "'proposed'", "'accepted'", "'rejected'", "'superseded'"])) {
    throw new Error('[DB_SCHEMA_MISMATCH] contract_versions.status 约束未包含 draft/superseded');
  }
}

// 函数 8: 执行数据库表结构初始化与严格校验。
async function migrate() {
  const dbExists = fs.existsSync(DB_PATH);
  const d = await getDb();
  if (dbExists) {
    ensureNotificationTable(d);
    ensureIndexes(d);
    try {
      assertStrictSchema(d);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`[DB_SCHEMA_MISMATCH] 当前数据库结构不受支持，请删除后重建：${DB_PATH}。详细原因：${reason}`);
    }
    saveDb();
    console.log(`数据库结构校验通过（CHAIN_ENV=${CHAIN_ENV}，DB=${DB_PATH}）`);
    return;
  }

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
    image_cids TEXT DEFAULT '[]',
    public_snapshot_cid TEXT DEFAULT '',
    public_snapshot_hash TEXT DEFAULT '',
    content_hash TEXT NOT NULL DEFAULT '',
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','rented','offline','closed')),
    chain_version INTEGER NOT NULL DEFAULT 0,
    chain_nonce INTEGER NOT NULL DEFAULT 0,
    chain_block_number INTEGER NOT NULL DEFAULT 0,
    chain_block_time INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  d.run(createContractsTableSql('contracts'));

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

  d.run(`CREATE TABLE IF NOT EXISTS contract_gas_authorization_prepares (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    tenant_address TEXT NOT NULL,
    landlord_address TEXT NOT NULL,
    cap_wei TEXT NOT NULL,
    deadline_epoch_ms TEXT NOT NULL,
    nonce TEXT NOT NULL UNIQUE,
    digest TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    contract_address TEXT NOT NULL,
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
    status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('draft','proposed','accepted','rejected','superseded')),
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

  d.run(`CREATE TABLE IF NOT EXISTS listing_feedbacks (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_role TEXT NOT NULL,
    author_wallet TEXT NOT NULL,
    feedback_type TEXT NOT NULL CHECK(feedback_type IN ('mismatch','photos','noise','communication','other')),
    comment_text TEXT NOT NULL,
    comment_hash TEXT NOT NULL,
    comment_cid TEXT DEFAULT '',
    tx_hash TEXT NOT NULL UNIQUE,
    chain_env TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY(listing_id) REFERENCES listings(id)
  )`);

  d.run(`CREATE TABLE IF NOT EXISTS contract_reviews (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL UNIQUE,
    listing_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    tenant_wallet TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    weight INTEGER NOT NULL CHECK(weight >= 1),
    comment_text TEXT NOT NULL,
    comment_hash TEXT NOT NULL,
    comment_cid TEXT DEFAULT '',
    tx_hash TEXT NOT NULL UNIQUE,
    chain_env TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY(contract_id) REFERENCES contracts(id),
    FOREIGN KEY(listing_id) REFERENCES listings(id)
  )`);


  d.run(`CREATE TABLE IF NOT EXISTS onchain_operations (
    op_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('listing','contract','payment','gas_auth')),
    entity_id TEXT NOT NULL,
    operation_kind TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
    request_id TEXT DEFAULT '',
    payload_json TEXT DEFAULT '{}',
    result_json TEXT DEFAULT '{}',
    error_message TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  ensureNotificationTable(d);

  ensureIndexes(d);

  try {
    assertStrictSchema(d);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`[DB_SCHEMA_MISMATCH] 当前数据库结构不受支持，请删除后重建：${DB_PATH}。详细原因：${reason}`);
  }

  saveDb();
  console.log(`数据库初始化完成（CHAIN_ENV=${CHAIN_ENV}，DB=${DB_PATH}）`);
}

module.exports = { getDb, saveDb, migrate, parseResult, CHAIN_ENV, DB_PATH };
