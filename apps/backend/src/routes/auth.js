/**
 * 文件说明：认证路由。
 * 提供注册、登录、查询个人信息、更新个人资料接口。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getUserDb, saveUserDb, parseResult } = require('../user-db');
const { JWT_SECRET, authMiddleware } = require('../auth');
const { logApiError } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const emailCodes = new Map();
const captchaChallenges = new Map();

// 函数 1: 校验钱包地址格式。
function isValidWalletAddress(walletAddress) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || '').trim());
}

function normalizeAvatarUrl(input) {
  const avatarUrl = String(input || '').trim();
  if (!avatarUrl) return '';
  // 1.5MB 原始文件经 base64 编码后约 2MB 字符串（× 4/3），与前端限制保持一致。
  if (avatarUrl.length > 2 * 1024 * 1024) return null;
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(avatarUrl)) return null;
  return avatarUrl;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isValidPhone(phone) {
  return /^1\d{10}$/.test(String(phone || '').trim());
}

function normalizeAccount(input) {
  return String(input || '').trim().toLowerCase();
}

function createEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createCaptcha() {
  const a = Math.floor(2 + Math.random() * 8);
  const b = Math.floor(2 + Math.random() * 8);
  const id = crypto.randomUUID ? crypto.randomUUID() : `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  captchaChallenges.set(id, {
    answer: String(a + b),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return { id, question: `${a} + ${b} = ?` };
}

function verifyCaptcha(captchaId, captchaAnswer) {
  const id = String(captchaId || '').trim();
  const answer = String(captchaAnswer || '').trim();
  const saved = captchaChallenges.get(id);
  captchaChallenges.delete(id);
  if (!saved || saved.expiresAt < Date.now()) {
    return '人机验证已过期，请刷新后重试';
  }
  if (answer !== saved.answer) {
    return '人机验证答案不正确';
  }
  return '';
}

function verifyEmailCode(email, emailCode) {
  const savedCode = emailCodes.get(email);
  if (!savedCode || savedCode.expiresAt < Date.now()) {
    return '邮箱验证码已过期，请重新获取';
  }
  if (String(emailCode).trim() !== savedCode.code) {
    return '邮箱验证码不正确';
  }
  return '';
}

// 函数 0: 开发用快捷登录（仅非生产环境可用，自动创建或复用 dev 账号）。
router.post('/dev-login', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const role = String(req.body.role || '').trim();
  if (!['tenant', 'landlord'].includes(role)) {
    return res.status(400).json({ error: 'role must be tenant or landlord' });
  }
  const email = role === 'tenant' ? 'dev_tenant@dev.test' : 'dev_landlord@dev.test';
  const nickname = role === 'tenant' ? '开发租客' : '开发房东';
  // 开发用固定钱包地址（合法 hex 格式，方便前端跳过"连接钱包"提示和链上校验）
  const devWallet = role === 'tenant'
    ? '0xde00000000000000000000000000000000000001'
    : '0xde00000000000000000000000000000000000002';
  const db = await getUserDb();
  let users = parseResult(db.exec('SELECT * FROM users WHERE phone = ?', [email]));
  if (!users.length) {
    const userId = `dev_${role}_${Date.now()}`;
    const hash = await bcrypt.hash('devpass123', 10);
    db.run(
      'INSERT INTO users (id, phone, password_hash, role, wallet_address, nickname) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, email, hash, role, devWallet, nickname]
    );
    saveUserDb();
    users = [{ id: userId, phone: email, role, wallet_address: devWallet, nickname, avatar_url: '' }];
  }
  let user = users[0];
  // 若已有账号但钱包地址为空，自动补上 dev 钱包地址
  if (!user.wallet_address) {
    db.run('UPDATE users SET wallet_address = ? WHERE phone = ?', [devWallet, email]);
    saveUserDb();
    user = { ...user, wallet_address: devWallet };
  }
  const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.phone,
        role: user.role,
        walletAddress: user.wallet_address || devWallet,
        nickname: user.nickname || nickname,
        avatarUrl: user.avatar_url || '',
      },
    },
  });
}));

// 函数 2: 生成人机验证题目。
router.get('/captcha', asyncHandler(async (req, res) => {
  res.json({ success: true, data: createCaptcha() });
}));

// 函数 2: 发送邮箱验证码接口。当前为演示实现，开发环境会把验证码返回给前端。
router.post('/email-code', asyncHandler(async (req, res) => {
  const email = normalizeAccount(req.body.email);
  const captchaError = verifyCaptcha(req.body.captchaId, req.body.captchaAnswer);
  if (captchaError) return res.status(400).json({ error: captchaError });
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: '邮箱格式不正确' });
  }

  const code = createEmailCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  emailCodes.set(email, { code, expiresAt });
  console.log(`[auth.email-code] ${email} -> ${code}`);

  res.json({
    success: true,
    message: '验证码已发送',
    data: process.env.NODE_ENV === 'production' ? {} : { devCode: code },
  });
}));

// 函数 3: 用户注册接口。
router.post('/register', asyncHandler(async (req, res) => {
  try {
    const { emailCode = '', password, role, walletAddress = '', nickname = '' } = req.body;
    const account = normalizeAccount(req.body.email || req.body.phone || req.body.account);
    if (!account || !password || !role) {
      return res.status(400).json({ error: '邮箱、密码、角色为必填项' });
    }
    if (!['landlord', 'tenant'].includes(role)) {
      return res.status(400).json({ error: '角色仅支持 landlord 或 tenant' });
    }
    if (!isValidEmail(account) && !isValidPhone(account)) {
      return res.status(400).json({ error: '邮箱或手机号格式不正确' });
    }
    if (isValidEmail(account)) {
      const codeError = verifyEmailCode(account, emailCode);
      if (codeError) return res.status(400).json({ error: codeError });
    }
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: '钱包地址格式不正确' });
    }

    const db = await getUserDb();
    const exists = parseResult(db.exec('SELECT id FROM users WHERE phone = ?', [account]));
    if (exists.length) {
      return res.status(409).json({ error: '账号已注册' });
    }

    const userId = `uid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (id, phone, password_hash, role, wallet_address, nickname) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, account, hash, role, walletAddress, nickname]
    );
    saveUserDb();
    emailCodes.delete(account);

    const token = jwt.sign({ id: userId, phone: account, role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { token, user: { id: userId, phone: account, email: account, role, walletAddress, nickname, avatarUrl: '' } } });
  } catch (error) {
    logApiError('auth.register.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    res.status(500).json({ error: '注册失败' });
  }
}));

// 函数 4: 通过邮箱验证码重置密码。
router.post('/reset-password', asyncHandler(async (req, res) => {
  try {
    const account = normalizeAccount(req.body.email || req.body.phone || req.body.account);
    const { password, emailCode = '' } = req.body;
    if (!account || !password) {
      return res.status(400).json({ error: '邮箱和新密码不能为空' });
    }
    if (!isValidEmail(account)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: '密码至少需要 6 位' });
    }

    const codeError = verifyEmailCode(account, emailCode);
    if (codeError) return res.status(400).json({ error: codeError });

    const db = await getUserDb();
    const users = parseResult(db.exec('SELECT id FROM users WHERE phone = ?', [account]));
    if (!users.length) {
      return res.status(404).json({ error: '该邮箱尚未注册' });
    }

    const hash = await bcrypt.hash(password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE phone = ?', [hash, account]);
    saveUserDb();
    emailCodes.delete(account);
    res.json({ success: true, message: '密码已重置，请重新登录' });
  } catch (error) {
    logApiError('auth.reset-password.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    res.status(500).json({ error: '重置密码失败' });
  }
}));

// 函数 4: 用户登录接口。
router.post('/login', asyncHandler(async (req, res) => {
  try {
    const { password } = req.body;
    const account = normalizeAccount(req.body.email || req.body.phone || req.body.account);
    const captchaError = verifyCaptcha(req.body.captchaId, req.body.captchaAnswer);
    if (captchaError) return res.status(400).json({ error: captchaError });
    if (!account || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }
    const db = await getUserDb();
    const users = parseResult(db.exec('SELECT * FROM users WHERE phone = ?', [account]));
    if (!users.length) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const user = users[0];
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ error: '账号或密码错误' });
    }

    const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          phone: user.phone,
          email: user.phone,
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
    'SELECT id, phone, role, wallet_address, nickname, avatar_url, created_at FROM users WHERE id = ?',
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
      return res.status(400).json({ error: '头像格式不正确，仅支持 1.5MB 以内的 jpeg/png/webp 图片' });
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
    } else {
      if (!nextWallet || nextWallet.toLowerCase() !== currentWallet.toLowerCase()) {
        return res.status(400).json({ error: '钱包已绑定且不可更改，仅支持重连已绑定地址' });
      }
    }
  }
  saveUserDb();
  const users = parseResult(db.exec(
    'SELECT id, phone, role, wallet_address, nickname, avatar_url FROM users WHERE id = ?',
    [req.user.id]
  ));
  const nextUser = users[0] || {};
  res.json({
    success: true,
    message: '用户信息更新成功',
    data: {
      user: {
        id: nextUser.id,
        phone: nextUser.phone,
        email: nextUser.phone,
        role: nextUser.role,
        walletAddress: nextUser.wallet_address,
        nickname: nextUser.nickname,
        avatarUrl: nextUser.avatar_url || '',
      },
    },
  });
}));

module.exports = router;
