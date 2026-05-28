/**
 * 文件说明：共享用户数据库。
 * 用于跨链环境共享账号、登录态和钱包绑定信息。
 */
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const USER_DB_PATH = path.join(__dirname, '..', 'data', 'users.shared.sqlite');
let userDb;
let userDbMtimeMs = 0;

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

// 函数 3: 初始化共享用户表（钱包地址为主键，不含邮箱/密码/头像）。
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

function ensureStrictSchema(db) {
  const columns = parseResult(db.exec('PRAGMA table_info(users)')).map((item) => item.name);
  if (!columns.includes('wallet_address') || columns.includes('email') || columns.includes('password_hash')) {
    throw new Error('users.shared.sqlite 仍是旧结构。请删除 apps/backend/data/users.shared.sqlite 后重启服务。');
  }
}

// 函数 4: 获取共享用户数据库连接（惰性初始化）。
async function getUserDb() {
  const fileExists = fs.existsSync(USER_DB_PATH);
  const diskMtimeMs = fileExists ? fs.statSync(USER_DB_PATH).mtimeMs : 0;
  if (userDb && diskMtimeMs <= userDbMtimeMs) return userDb;

  ensureUserDataDir();
  const SQL = await initSqlJs();
  if (fileExists) {
    userDb = new SQL.Database(fs.readFileSync(USER_DB_PATH));
  } else {
    userDb = new SQL.Database();
    initUserDb(userDb);
    fs.writeFileSync(USER_DB_PATH, Buffer.from(userDb.export()));
  }
  userDb.run('PRAGMA foreign_keys = ON');
  ensureStrictSchema(userDb);
  userDbMtimeMs = fs.statSync(USER_DB_PATH).mtimeMs;
  return userDb;
}

// 函数 5: 持久化共享用户数据库。
function saveUserDb() {
  if (!userDb) return;
  ensureUserDataDir();
  fs.writeFileSync(USER_DB_PATH, Buffer.from(userDb.export()));
  userDbMtimeMs = fs.statSync(USER_DB_PATH).mtimeMs;
}

module.exports = {
  getUserDb,
  saveUserDb,
  parseResult,
  USER_DB_PATH,
  initUserDb,
};
