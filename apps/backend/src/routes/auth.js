/**
 * 文件说明：认证路由。
 * 提供注册、登录、重置密码、查询个人信息、更新个人资料接口。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUserDb, saveUserDb, parseResult } = require('../user-db');
const { JWT_SECRET, authMiddleware } = require('../auth');
const { logApiError, logUserEvent } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 函数 1: 校验钱包地址格式。
function isValidWalletAddress(walletAddress) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || '').trim());
}

function normalizeAvatarUrl(input) {
  const avatarUrl = String(input || '').trim();
  if (!avatarUrl) return '';
  if (avatarUrl.length > 700 * 1024) return null;
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl)) return null;
  return avatarUrl;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeEmail(input) {
  return String(input || '').trim().toLowerCase();
}

// 函数 2: 用户注册接口（仅邮箱）。
router.post('/register', asyncHandler(async (req, res) => {
  try {
    const { email = '', password, role, walletAddress = '', nickname = '' } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password || !role) {
      return res.status(400).json({ error: '邮箱、密码、角色为必填项' });
    }
    if (!['landlord', 'tenant'].includes(role)) {
      return res.status(400).json({ error: '角色仅支持 landlord 或 tenant' });
    }
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: '钱包地址格式不正确' });
    }

    const db = await getUserDb();
    const exists = parseResult(db.exec('SELECT id FROM users WHERE email = ?', [normalizedEmail]));
    if (exists.length) {
      return res.status(409).json({ error: '账号已注册' });
    }

    const userId = `uid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (id, email, password_hash, role, wallet_address, nickname) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, normalizedEmail, hash, role, walletAddress, nickname]
    );
    saveUserDb();

    const token = jwt.sign({ id: userId, email: normalizedEmail, role }, JWT_SECRET, { expiresIn: '7d' });
    logUserEvent('auth.register.success', { requestId: req.requestId || '', userId, email: normalizedEmail, role });
    res.json({
      success: true,
      data: {
        token,
        user: { id: userId, email: normalizedEmail, role, walletAddress, nickname, avatarUrl: '' },
      },
    });
  } catch (error) {
    logApiError('auth.register.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    res.status(500).json({ error: '注册失败' });
  }
}));

// 函数 3: 通过邮箱重置密码（仅邮箱）。
router.post('/reset-password', asyncHandler(async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: '邮箱和新密码不能为空' });
    }
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密码至少需要 6 位' });
    }

    const db = await getUserDb();
    const users = parseResult(db.exec('SELECT id FROM users WHERE email = ?', [normalizedEmail]));
    if (!users.length) {
      return res.status(404).json({ error: '该邮箱尚未注册' });
    }

    const hash = await bcrypt.hash(password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE email = ?', [hash, normalizedEmail]);
    saveUserDb();
    logUserEvent('auth.reset-password.success', { requestId: req.requestId || '', email: normalizedEmail, userId: users[0].id });
    res.json({ success: true, message: '密码已重置，请重新登录' });
  } catch (error) {
    logApiError('auth.reset-password.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    res.status(500).json({ error: '重置密码失败' });
  }
}));

// 函数 4: 用户登录接口（仅邮箱）。
router.post('/login', asyncHandler(async (req, res) => {
  try {
    const { email = '', password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }
    const db = await getUserDb();
    const users = parseResult(db.exec('SELECT * FROM users WHERE email = ?', [normalizedEmail]));
    if (!users.length) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const user = users[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    logUserEvent('auth.login.success', { requestId: req.requestId || '', userId: user.id, email: user.email, role: user.role });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          walletAddress: user.wallet_address,
          nickname: user.nickname,
          avatarUrl: user.avatar_url || '',
        },
      },
    });
  } catch (error) {
    logApiError('auth.login.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    res.status(500).json({ error: '登录失败' });
  }
}));

// 函数 5: 获取当前用户信息接口。
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getUserDb();
  const users = parseResult(db.exec(
    'SELECT id, email, role, wallet_address, nickname, avatar_url, created_at FROM users WHERE id = ?',
    [req.user.id]
  ));
  if (!users.length) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json({ success: true, data: users[0] });
}));

// 函数 6: 更新当前用户信息接口。
router.put('/me', authMiddleware, asyncHandler(async (req, res) => {
  const { nickname, walletAddress, avatarUrl } = req.body;
  const db = await getUserDb();
  if (nickname !== undefined) {
    const nextNickname = String(nickname || '').trim().slice(0, 32);
    db.run('UPDATE users SET nickname = ? WHERE id = ?', [nextNickname, req.user.id]);
  }
  if (avatarUrl !== undefined) {
    const nextAvatarUrl = normalizeAvatarUrl(avatarUrl);
    if (nextAvatarUrl === null) {
      return res.status(400).json({ error: '头像格式不正确，仅支持 700KB 内的 jpeg/png/webp 图片' });
    }
    db.run('UPDATE users SET avatar_url = ? WHERE id = ?', [nextAvatarUrl, req.user.id]);
  }
  if (walletAddress !== undefined) {
    const users = parseResult(db.exec('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]));
    if (!users.length) {
      return res.status(404).json({ error: '用户不存在' });
    }
    const currentWallet = String(users[0].wallet_address || '').trim();
    const nextWallet = String(walletAddress || '').trim();

    if (!currentWallet) {
      if (!nextWallet || !isValidWalletAddress(nextWallet)) {
        return res.status(400).json({ error: '首次绑定钱包地址不能为空且格式必须正确' });
      }
      db.run('UPDATE users SET wallet_address = ? WHERE id = ?', [nextWallet, req.user.id]);
    } else if (!nextWallet || nextWallet.toLowerCase() !== currentWallet.toLowerCase()) {
      return res.status(400).json({ error: '钱包已绑定且不可更改，仅支持重连已绑定地址' });
    }
  }
  saveUserDb();
  const users = parseResult(db.exec(
    'SELECT id, email, role, wallet_address, nickname, avatar_url FROM users WHERE id = ?',
    [req.user.id]
  ));
  const nextUser = users[0] || {};
  logUserEvent('auth.profile.update.success', { requestId: req.requestId || '', userId: req.user.id, email: nextUser.email || '', role: nextUser.role || '' });
  res.json({
    success: true,
    message: '用户信息更新成功',
    data: {
      user: {
        id: nextUser.id,
        email: nextUser.email,
        role: nextUser.role,
        walletAddress: nextUser.wallet_address,
        nickname: nextUser.nickname,
        avatarUrl: nextUser.avatar_url || '',
      },
    },
  });
}));

module.exports = router;
