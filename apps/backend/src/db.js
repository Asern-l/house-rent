/**
 * 文件说明：数据库初始化与迁移。
 * 基于 sql.js 将数据持久化为 sqlite 文件。
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.sqlite');
let db;

// 函数 1: 确保数据库目录存在。
function ensureDataDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 函数 2: 获取数据库连接（惰性初始化）。
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

// 函数 3: 将内存数据库持久化到磁盘。
function saveDb() {
  if (!db) return;
  ensureDataDir();
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// 函数 4: 将 sql.js 查询结果转换为对象数组。
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

// 函数 5: 重建 listings 表结构，移除预付字段并保留状态机字段。
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

// 函数 5: 执行数据库表结构迁移。
async function migrate() {
  const d = await getDb();
  d.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('landlord','tenant','admin')),
    wallet_address TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

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
    image_hashes TEXT DEFAULT '[]',
    tx_hash TEXT,
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
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','pending_payment','active','ended','cancelled','expired','disputed')),
    expires_at TEXT NOT NULL,
    tenant_signed_at TEXT,
    landlord_signed_at TEXT,
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
    FOREIGN KEY(contract_id) REFERENCES contracts(id)
  )`);

  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_listings_landlord ON listings(landlord_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');

  const listingCols = parseResult(d.exec('PRAGMA table_info(listings)')).map((c) => c.name);
  const listingSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'listings'"))[0]?.sql || '';
  const needsRebuild = listingCols.includes('prepay_months')
    || !listingCols.includes('min_lease_months')
    || !listingSchema.includes("'locked'");
  if (needsRebuild) {
    rebuildListingsTable(d, listingCols);
  }

  const contractSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contracts'"))[0]?.sql || '';
  if (!contractSchema.includes("'pending_payment'")) {
    d.run(`CREATE TABLE contracts_new (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      landlord_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','tenant_signed','pending_payment','active','ended','cancelled','expired','disputed')),
      expires_at TEXT NOT NULL,
      tenant_signed_at TEXT,
      landlord_signed_at TEXT,
      tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    )`);
    d.run(`INSERT INTO contracts_new (
      id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at, tenant_signed_at, landlord_signed_at, tx_hash, created_at
    ) SELECT
      id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at, tenant_signed_at, landlord_signed_at, tx_hash, created_at
    FROM contracts`);
    d.run('DROP TABLE contracts');
    d.run('ALTER TABLE contracts_new RENAME TO contracts');
    d.run('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)');
    d.run('CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)');
  }

  const paymentSchema = parseResult(d.exec("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'"))[0]?.sql || '';
  if (paymentSchema.includes("'monthly'") || paymentSchema.includes("'renewal'")) {
    d.run(`CREATE TABLE payments_new (
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
      FOREIGN KEY(contract_id) REFERENCES contracts(id)
    )`);
    d.run(`INSERT INTO payments_new (
      id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at, created_at
    )
    SELECT
      id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at, created_at
    FROM payments
    WHERE pay_type = 'initial'`);
    d.run('DROP TABLE payments');
    d.run('ALTER TABLE payments_new RENAME TO payments');
    d.run('CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id)');
  }

  saveDb();
  console.log('数据库迁移完成');
}

module.exports = { getDb, saveDb, migrate, parseResult };
