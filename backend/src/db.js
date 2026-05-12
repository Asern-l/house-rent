const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');

let db = null;

async function getDb() {
  if (db) return db;
  
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function migrate() {
  const d = await getDb();
  
  d.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('landlord', 'tenant', 'admin')),
      wallet_address TEXT,
      nickname TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      landlord_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      address TEXT NOT NULL,
      district TEXT,
      rent_amount TEXT NOT NULL,
      rent_cycle TEXT NOT NULL DEFAULT 'month',
      deposit_months INTEGER NOT NULL DEFAULT 2,
      bedrooms INTEGER,
      livingrooms INTEGER,
      bathrooms INTEGER,
      area REAL,
      image_urls TEXT,
      ai_score INTEGER DEFAULT 80,
      image_hashes TEXT,
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'rented', 'offline', 'closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (landlord_id) REFERENCES users(id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      landlord_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      content_hash TEXT,
      tenant_signed_at TEXT,
      landlord_signed_at TEXT,
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending', 'tenant_signed', 'landlord_signed', 'active', 'ended', 'cancelled', 'expired', 'disputed'
      )),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deposit_amount TEXT,
      deposit_status TEXT DEFAULT 'none' CHECK(deposit_status IN ('none', 'paid', 'refunding', 'refunded', 'partial', 'disputed')),
      deposit_tx_hash TEXT,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (tenant_id) REFERENCES users(id),
      FOREIGN KEY (landlord_id) REFERENCES users(id)
    )
  `);

  d.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      landlord_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('rent', 'deposit')),
      period TEXT,
      tx_hash TEXT,
      alipay_order_no TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (contract_id) REFERENCES contracts(id)
    )
  `);

  d.run(`CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_listings_landlord ON listings(landlord_id)`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant_id)`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_contracts_landlord ON contracts(landlord_id)`);
  d.run(`CREATE INDEX IF NOT EXISTS idx_contracts_listing ON contracts(listing_id)`);

  saveDb();
  console.log('✅ 数据库迁移完成');
}

module.exports = { getDb, saveDb, migrate };
