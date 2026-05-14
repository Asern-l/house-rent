/**
 * 文件说明：鉴权中间件。
 * 提供 JWT 解析和角色校验能力。
 */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// 函数 1: 校验登录令牌并挂载用户信息。
function authMiddleware(req, res, next) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已失效' });
  }
  try {
    req.user = jwt.verify(raw.slice(7), JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: '登录令牌无效，请重新登录' });
  }
}

// 函数 2: 校验角色权限是否满足路由要求。
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = { JWT_SECRET, authMiddleware, requireRole };
