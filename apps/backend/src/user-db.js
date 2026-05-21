/**
 * 文件说明：共享用户数据库。
 * 用于跨链环境共享账号、登录态和钱包绑定信息。
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const USER_DB_PATH = path.join(__dirname, '..', 'data', 'users.shared.sqlite');
let userDb;

// 函数 1: 确保用户数据库目录存在。
function ensureUserDataDir() {
  const dir = path.dirname(USER_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 函数 2: 解析 sql.js 查询结果。
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

// 函数 3: 执行共享用户库迁移。
function migrateUserDb(db) {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('landlord','tenant','admin')),
    wallet_address TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  )`);

  const columns = parseResult(db.exec('PRAGMA table_info(users)')).map((item) => item.name);
  if (!columns.includes('avatar_url')) {
    db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''");
  }
  if (!columns.includes('unpaid_default_count')) {
    db.run('ALTER TABLE users ADD COLUMN unpaid_default_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.includes('risk_blocked_until')) {
    db.run("ALTER TABLE users ADD COLUMN risk_blocked_until TEXT DEFAULT ''");
  }
}

// 函数 4: 获取共享用户数据库连接（惰性初始化）。
async function getUserDb() {
  if (userDb) return userDb;
  ensureUserDataDir();
  const SQL = await initSqlJs();
  if (fs.existsSync(USER_DB_PATH)) {
    userDb = new SQL.Database(fs.readFileSync(USER_DB_PATH));
  } else {
    userDb = new SQL.Database();
  }
  userDb.run('PRAGMA foreign_keys = ON');
  migrateUserDb(userDb);
  return userDb;
}

// 函数 5: 持久化共享用户数据库。
function saveUserDb() {
  if (!userDb) return;
  ensureUserDataDir();
  fs.writeFileSync(USER_DB_PATH, Buffer.from(userDb.export()));
}

module.exports = {
  getUserDb,
  saveUserDb,
  parseResult,
  USER_DB_PATH,
};
