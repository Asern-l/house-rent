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
const path = require('path');
const { migrate, getDb, parseResult, saveDb, CHAIN_ENV, DB_PATH } = require('./db');
const { getUserDb, saveUserDb, USER_DB_PATH } = require('./user-db');
const { logApiError, logSystemError, logRiskEvent } = require('./logger');
const contractRoutes = require('./routes/contracts');
const listingRoutes = require('./routes/listings');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = String(process.env.HOST || '127.0.0.1');
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || '100mb');
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(':method :url :status :response-time ms'));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后重试' },
  }));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));
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
  app.use('/api/listings', listingRoutes);
  app.use('/api/contracts', contractRoutes);
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

  app.get('/api/console/status', asyncHandler(async (req, res) => {
    const db = await getDb();
    const counts = {
      listings: parseResult(db.exec('SELECT COUNT(*) AS count FROM listings'))[0]?.count || 0,
      contracts: parseResult(db.exec('SELECT COUNT(*) AS count FROM contracts'))[0]?.count || 0,
      payments: parseResult(db.exec('SELECT COUNT(*) AS count FROM payments'))[0]?.count || 0,
      pendingOnchainContracts: parseResult(db.exec("SELECT COUNT(*) AS count FROM contracts WHERE status = 'pending_payment' AND tx_hash IS NULL"))[0]?.count || 0,
      pendingOnchainListings: parseResult(db.exec("SELECT COUNT(*) AS count FROM listings WHERE tx_hash IS NULL AND onchain_status IN ('pending','failed')"))[0]?.count || 0,
    };
    res.json({
      success: true,
      data: {
        chainEnv: CHAIN_ENV,
        dbFile: DB_PATH,
        authPort: Number(process.env.AUTH_PORT || 3005),
        port: PORT,
        rpcUrl: CHAIN_ENV === 'local' ? (process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545') : (process.env.SEPOLIA_RPC_URL || ''),
        rentalChainAddress: process.env.RENTAL_CHAIN_ADDRESS || '',
        counts,
      },
    });
  }));
}

// 函数 5-1: 记录请求完成时的 4xx/5xx 响应日志（覆盖非异常分支）。
function setupResponseStatusLogger() {
  app.use((req, res, next) => {
    const startAt = Date.now();
    res.on('finish', () => {
      const status = Number(res.statusCode || 0);
      if (status < 400) return;
      logApiError('response.status', {
        requestId: req.requestId || '',
        method: req.method,
        url: req.originalUrl || req.url || '',
        status,
        userId: req.user?.id || '',
        ip: req.ip || '',
        durationMs: Date.now() - startAt,
      });
    });
    next();
  });
}

// 函数 6: 注册兜底异常处理。
function setupErrorHandlers() {
  app.use((req, res) => {
    logApiError('not-found', {
      requestId: req.requestId || '',
      method: req.method,
      url: req.originalUrl || req.url || '',
      status: 404,
      ip: req.ip || '',
      userId: req.user?.id || '',
    });
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      logApiError('middleware.payload-too-large', {
        requestId: req.requestId || '',
        method: req.method,
        url: req.originalUrl || req.url || '',
        status: 413,
        userId: req.user?.id || '',
        ip: req.ip || '',
        message: err?.message || 'payload_too_large',
      });
      return res.status(413).json({ error: `请求体过大，请压缩图片或减少上传数量（当前限制 ${JSON_BODY_LIMIT}）` });
    }

    logApiError('middleware.exception', {
      requestId: req.requestId || '',
      method: req.method,
      url: req.originalUrl || req.url || '',
      status: err?.status || 500,
      userId: req.user?.id || '',
      ip: req.ip || '',
      message: err?.message || 'unknown_error',
      stack: err?.stack || '',
    });
    res.status(500).json({ error: '服务端内部错误' });
  });
}

// 函数 7: 处理超时未支付合同（房东签署后 2 小时）。
async function expirePendingPaymentContracts() {
  const db = await getDb();
  const timeoutContracts = parseResult(db.exec(
    `SELECT id, listing_id, tenant_id
     FROM contracts
     WHERE status = 'pending_payment'
       AND landlord_signed_at IS NOT NULL
       AND (
         datetime(landlord_signed_at, '+2 hours') <= datetime('now', '+8 hours')
         OR (payment_deadline IS NOT NULL AND payment_deadline <> '' AND datetime(payment_deadline) <= datetime('now', '+8 hours'))
       )`
  ));
  if (timeoutContracts.length === 0) return;

  timeoutContracts.forEach((item) => {
    db.run(
      "UPDATE contracts SET status = 'cancelled' WHERE id = ? AND status = 'pending_payment'",
      [item.id]
    );
    if (db.getRowsModified() !== 1) return;

    getUserDb().then((userDb) => {
      userDb.run(
        `UPDATE users
         SET unpaid_default_count = COALESCE(unpaid_default_count, 0) + 1,
             risk_blocked_until = datetime('now', '+8 hours', '+24 hours')
         WHERE id = ?`,
        [item.tenant_id]
      );
      saveUserDb();
    }).catch((err) => {
      console.error('未付款风控计数更新失败:', err);
    });

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

// 函数 7-1: 处理签约前超时合同（pending/tenant_signed 到 expires_at 自动过期并释放房源）。
async function expireUnsignedContractsByExpiresAt() {
  const db = await getDb();
  const timeoutContracts = parseResult(db.exec(
    `SELECT id, listing_id, tenant_id, status, expires_at
     FROM contracts
     WHERE status IN ('pending', 'tenant_signed')
       AND datetime(expires_at) <= datetime('now', '+8 hours')`
  ));
  if (timeoutContracts.length === 0) return;

  timeoutContracts.forEach((item) => {
    db.run(
      "UPDATE contracts SET status = 'expired' WHERE id = ? AND status IN ('pending', 'tenant_signed')",
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

    logRiskEvent('contract.auto-expire.release', {
      contractId: item.id,
      listingId: item.listing_id,
      userId: item.tenant_id,
      fromStatus: item.status,
      expiresAt: item.expires_at,
      preferredNetwork: CHAIN_ENV,
    });
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
      expireUnsignedContractsByExpiresAt().catch((err) => {
        console.error('签约前超时自动过期任务失败:', err);
      });
      expirePendingPaymentContracts().catch((err) => {
        console.error('超时取消任务失败:', err);
      });
      expireActiveContractsByEndDate().catch((err) => {
        console.error('租期到期任务失败:', err);
      });
    }, 60 * 1000);
    const server = app.listen(PORT, HOST, () => {
      console.log(`后端启动成功: http://${HOST}:${PORT} (CHAIN_ENV=${CHAIN_ENV})`);
      console.log(`共享账号库: ${USER_DB_PATH}`);
      console.log(`JSON_BODY_LIMIT=${JSON_BODY_LIMIT}`);
    });
    server.on('error', (error) => {
      logSystemError('server.listen.error', {
        message: error?.message || 'listen_failed',
        code: error?.code || '',
        port: PORT,
      });
      if (error?.code === 'EADDRINUSE') {
        console.error(`端口 ${PORT} 已被占用，请先关闭占用进程后重试。`);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('后端启动失败:', error);
    process.exit(1);
  }
}

setupMiddlewares();
setupRequestId();
setupResponseStatusLogger();
setupRoutes();
setupErrorHandlers();

// 函数 10: 注册进程级异常日志，避免漏记崩溃原因。
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? (reason.stack || '') : '';
  logSystemError('process.unhandledRejection', { message, stack });
});

process.on('uncaughtException', (error) => {
  logSystemError('process.uncaughtException', {
    message: error?.message || 'unknown_error',
    stack: error?.stack || '',
  });
});

startServer();
