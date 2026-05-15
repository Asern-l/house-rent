/**
 * 文件说明：认证独立服务入口。
 * 仅承载账号登录相关接口，避免受业务网络后端可用性影响。
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { getUserDb, USER_DB_PATH } = require('./user-db');

const app = express();
const AUTH_PORT = Number(process.env.AUTH_PORT || 3005);

// 函数 1: 安装认证服务中间件。
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
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后重试' },
  }));
}

// 函数 2: 注册认证路由与健康检查。
function setupRoutes() {
  app.use('/api/auth', require('./routes/auth'));
  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      status: 'ok',
      service: 'auth',
      authPort: AUTH_PORT,
      userDbFile: USER_DB_PATH,
      now: new Date().toISOString(),
    });
  });
}

// 函数 3: 注册认证服务兜底异常处理。
function setupErrorHandlers() {
  app.use((req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });
  app.use((err, req, res, next) => {
    console.error('Auth 服务未捕获异常:', err);
    res.status(500).json({ error: '服务端内部错误' });
  });
}

// 函数 4: 启动认证服务。
async function startAuthServer() {
  try {
    await getUserDb();
    app.listen(AUTH_PORT, () => {
      console.log(`认证服务启动成功: http://localhost:${AUTH_PORT}`);
      console.log(`共享账号库: ${USER_DB_PATH}`);
    });
  } catch (error) {
    console.error('认证服务启动失败:', error);
    process.exit(1);
  }
}

setupMiddlewares();
setupRoutes();
setupErrorHandlers();
startAuthServer();

