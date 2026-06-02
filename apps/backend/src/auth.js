/**
 * 文件说明：鉴权中间件。
 * 提供 JWT 解析和角色校验能力（基于钱包地址登录）。
 */
const jwt = require('jsonwebtoken');
const { maybeTopupLocalWallet } = require('./local-topup');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function resolveChainEnv() {
  return String(process.env.CHAIN_ENV || 'sepolia').trim().toLowerCase() === 'local' ? 'local' : 'sepolia';
}

// 函数 1: 校验登录令牌并挂载用户信息（钱包地址 + id + role）。
async function authMiddleware(req, res, next) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已失效' });
  }
  try {
    req.user = jwt.verify(raw.slice(7), JWT_SECRET);
    const tokenNetwork = String(req.user?.preferredNetwork || '').trim().toLowerCase();
    const isAuthRoute = String(req.baseUrl || '').startsWith('/api/auth');
    if (tokenNetwork && !isAuthRoute && tokenNetwork !== resolveChainEnv()) {
      return res.status(401).json({ error: '登录网络与当前后端不一致，请切换网络后重新登录' });
    }
    if (!isAuthRoute) {
      await maybeTopupLocalWallet({
        preferredNetwork: tokenNetwork || resolveChainEnv(),
        userId: req.user?.id || '',
        walletAddress: req.user?.walletAddress || '',
        requestId: req.requestId || '',
        stagePrefix: 'auth.middleware',
      });
    }
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
