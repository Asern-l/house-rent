/**
 * 文件说明：按网络分库的用户数据库。
 * Local 与 Sepolia 分别维护独立账号主档，仅使用 users.local.sqlite / users.sepolia.sqlite。
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

function resolveUserNetwork(raw = '') {
  return String(raw || '').trim().toLowerCase() === 'local' ? 'local' : 'sepolia';
}

function resolveDefaultUserNetwork() {
  return resolveUserNetwork(process.env.CHAIN_ENV || 'sepolia');
}

function getUserDbPath(network = '') {
  const normalized = resolveUserNetwork(network || resolveDefaultUserNetwork());
  return path.join(__dirname, '..', 'data', `users.${normalized}.sqlite`);
}

const userDbCache = new Map();

function ensureUserDataDir(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseResult(result) {
  if (!result.length || !result[0].values.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const item = {};
    columns.forEach((column, index) => {
      item[column] = row[index];
    });
    return item;
  });
}

function initUserDb(db) {
  db.run('DROP TABLE IF EXISTS users');
  db.run(`CREATE TABLE users (
    id TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('landlord','tenant','admin')),
    nickname TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    unpaid_default_count INTEGER NOT NULL DEFAULT 0,
    risk_blocked_until TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);
}

function ensureStrictSchema(db, dbPath) {
  const columns = parseResult(db.exec('PRAGMA table_info(users)')).map((item) => item.name);
  if (!columns.includes('wallet_address') || columns.includes('email') || columns.includes('password_hash')) {
    throw new Error(`${path.basename(dbPath)} 仍是旧结构。请删除 ${dbPath} 后重启服务。`);
  }
  // 迁移：添加 avatar 字段
  if (!columns.includes('avatar')) {
    db.run("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''");
  }
}

async function getUserDb(network = '') {
  const normalized = resolveUserNetwork(network || resolveDefaultUserNetwork());
  const dbPath = getUserDbPath(normalized);
  const cached = userDbCache.get(dbPath);
  const fileExists = fs.existsSync(dbPath);
  const diskMtimeMs = fileExists ? fs.statSync(dbPath).mtimeMs : 0;
  if (cached && diskMtimeMs <= cached.mtimeMs) return cached.db;

  ensureUserDataDir(dbPath);
  const SQL = await initSqlJs();
  let db;
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
    initUserDb(db);
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
  }
  db.run('PRAGMA foreign_keys = ON');
  ensureStrictSchema(db, dbPath);
  userDbCache.set(dbPath, { db, mtimeMs: fs.statSync(dbPath).mtimeMs, network: normalized });
  return db;
}

function saveUserDb(network = '') {
  const normalized = resolveUserNetwork(network || resolveDefaultUserNetwork());
  const dbPath = getUserDbPath(normalized);
  const cached = userDbCache.get(dbPath);
  if (!cached?.db) return;
  ensureUserDataDir(dbPath);
  fs.writeFileSync(dbPath, Buffer.from(cached.db.export()));
  cached.mtimeMs = fs.statSync(dbPath).mtimeMs;
  userDbCache.set(dbPath, cached);
}

module.exports = {
  getUserDb,
  saveUserDb,
  parseResult,
  initUserDb,
  getUserDbPath,
  resolveUserNetwork,
  resolveDefaultUserNetwork,
};
