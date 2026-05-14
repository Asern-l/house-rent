/**
 * 文件说明：认证路由。
 * 提供注册、登录、查询个人信息、更新个人资料接口。
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, saveDb, parseResult } = require('../db');
const { JWT_SECRET, authMiddleware } = require('../auth');

const router = express.Router();

// 函数 1: 校验钱包地址格式。
function isValidWalletAddress(walletAddress) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || '').trim());
}

// 函数 2: 用户注册接口。
router.post('/register', async (req, res) => {
  try {
    const { phone, password, role, walletAddress = '', nickname = '' } = req.body;
    if (!phone || !password || !role) {
      return res.status(400).json({ error: '手机号、密码、角色为必填项' });
    }
    if (!['landlord', 'tenant'].includes(role)) {
      return res.status(400).json({ error: '角色仅支持 landlord 或 tenant' });
    }
    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    if (walletAddress && !isValidWalletAddress(walletAddress)) {
      return res.status(400).json({ error: '钱包地址格式不正确' });
    }

    const db = await getDb();
    const exists = parseResult(db.exec('SELECT id FROM users WHERE phone = ?', [phone]));
    if (exists.length) {
      return res.status(409).json({ error: '手机号已注册' });
    }

    const userId = `uid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (id, phone, password_hash, role, wallet_address, nickname) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, phone, hash, role, walletAddress, nickname]
    );
    saveDb();

    const token = jwt.sign({ id: userId, phone, role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { token, user: { id: userId, phone, role, walletAddress, nickname } } });
  } catch (error) {
    res.status(500).json({ error: '注册失败' });
  }
});

// 函数 3: 用户登录接口。
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码不能为空' });
    }
    const db = await getDb();
    const users = parseResult(db.exec('SELECT * FROM users WHERE phone = ?', [phone]));
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
          role: user.role,
          walletAddress: user.wallet_address,
          nickname: user.nickname,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// 函数 4: 获取当前用户信息接口。
router.get('/me', authMiddleware, async (req, res) => {
  const db = await getDb();
  const users = parseResult(db.exec(
    'SELECT id, phone, role, wallet_address, nickname, created_at FROM users WHERE id = ?',
    [req.user.id]
  ));
  if (!users.length) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json({ success: true, data: users[0] });
});

// 函数 5: 更新当前用户信息接口。
router.put('/me', authMiddleware, async (req, res) => {
  const { nickname, walletAddress } = req.body;
  const db = await getDb();
  if (nickname !== undefined) {
    db.run('UPDATE users SET nickname = ? WHERE id = ?', [nickname, req.user.id]);
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
  saveDb();
  res.json({ success: true, message: '用户信息更新成功' });
});

module.exports = router;
