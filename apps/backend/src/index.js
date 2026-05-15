/**
 * 文件说明：后端服务入口。
 * 负责加载中间件、注册路由、数据库迁移和服务启动。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { migrate, getDb, parseResult, saveDb, CHAIN_ENV, DB_PATH } = require('./db');
const { getUserDb, USER_DB_PATH } = require('./user-db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

// 函数 1: 生成请求追踪ID，便于前后端日志关联。
function createRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// 函数 2: 生成北京时间字符串（用于接口展示）。
function formatCnTime(date = new Date()) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

// 函数 3: 安装基础中间件（安全、跨域、解析、日志、限流）。
function setupMiddlewares() {
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(':method :url :status :response-time ms'));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后重试' },
  }));
}

// 函数 4: 安装请求ID中间件。
function setupRequestId() {
  app.use((req, res, next) => {
    const requestId = String(req.headers['x-request-id'] || '').trim() || createRequestId();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
}

// 函数 5: 注册业务路由。
function setupRoutes() {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/listings', require('./routes/listings'));
  app.use('/api/contracts', require('./routes/contracts'));
  app.use('/api/verify', require('./routes/verify'));

  app.get('/api/health', (req, res) => {
    const now = new Date();
    res.json({
      success: true,
      status: 'ok',
      now: now.toISOString(),
      nowCn: formatCnTime(now),
      chainEnv: CHAIN_ENV,
      dbFile: DB_PATH,
    });
  });
}

// 函数 6: 注册兜底异常处理。
function setupErrorHandlers() {
  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    console.error('未捕获异常:', err);
    res.status(500).json({ error: '服务端内部错误' });
  });
}

// 函数 7: 处理超时未支付合同（房东签署后 2 小时）。
async function expirePendingPaymentContracts() {
  const db = await getDb();
  const timeoutContracts = parseResult(db.exec(
    `SELECT id, listing_id
     FROM contracts
     WHERE status = 'pending_payment'
       AND landlord_signed_at IS NOT NULL
       AND datetime(landlord_signed_at, '+2 hours') <= datetime('now', '+8 hours')`
  ));
  if (timeoutContracts.length === 0) return;

  timeoutContracts.forEach((item) => {
    db.run(
      "UPDATE contracts SET status = 'cancelled' WHERE id = ? AND status = 'pending_payment'",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;

    const sibling = parseResult(db.exec(
      `SELECT id
       FROM contracts
       WHERE listing_id = ?
         AND status NOT IN ('cancelled', 'expired', 'ended')`,
      [item.listing_id]
    ));
    if (sibling.length === 0) {
      db.run(
        "UPDATE listings SET status = 'available', updated_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'locked'",
        [item.listing_id]
      );
    }
  });

  saveDb();
}

// 函数 8: 处理租期到期合同（active -> ended）并释放房源（rented -> available）。
async function expireActiveContractsByEndDate() {
  const db = await getDb();
  const activeContracts = parseResult(db.exec(
    `SELECT id, listing_id, content_json
     FROM contracts
     WHERE status = 'active'`
  ));
  if (activeContracts.length === 0) return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let changed = false;

  activeContracts.forEach((item) => {
    let content = item.content_json;
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content);
      } catch {
        return;
      }
    }
    const endDate = String(content?.terms?.endDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return;

    const endAt = new Date(`${endDate}T00:00:00`);
    if (Number.isNaN(endAt.getTime()) || endAt > today) return;

    db.run(
      "UPDATE contracts SET status = 'ended' WHERE id = ? AND status = 'active'",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;
    changed = true;

    const sibling = parseResult(db.exec(
      `SELECT id
       FROM contracts
       WHERE listing_id = ?
         AND status NOT IN ('cancelled', 'expired', 'ended')`,
      [item.listing_id]
    ));
    if (sibling.length === 0) {
      db.run(
        "UPDATE listings SET status = 'available', updated_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'rented'",
        [item.listing_id]
      );
    }
  });

  if (changed) {
    saveDb();
  }
}

// 函数 9: 启动服务。
async function startServer() {
  try {
    await getUserDb();
    await migrate();
    setInterval(() => {
      expirePendingPaymentContracts().catch((err) => {
        console.error('超时取消任务失败:', err);
      });
      expireActiveContractsByEndDate().catch((err) => {
        console.error('租期到期任务失败:', err);
      });
    }, 60 * 1000);
    app.listen(PORT, () => {
      console.log(`后端启动成功: http://localhost:${PORT} (CHAIN_ENV=${CHAIN_ENV})`);
      console.log(`共享账号库: ${USER_DB_PATH}`);
    });
  } catch (error) {
    console.error('后端启动失败:', error);
    process.exit(1);
  }
}

setupMiddlewares();
setupRequestId();
setupRoutes();
setupErrorHandlers();
startServer();
