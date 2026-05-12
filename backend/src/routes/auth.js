const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, saveDb } = require('../db');
const { JWT_SECRET } = require('../auth');

const router = express.Router();

// 注册
router.post('/register', async (req, res) => {
  try {
    const { phone, password, role, walletAddress, nickname } = req.body;

    if (!phone || !password || !role) {
      return res.status(400).json({ error: '手机号、密码、角色为必填项' });
    }
    if (!['landlord', 'tenant'].includes(role)) {
      return res.status(400).json({ error: '角色无效，必须为 landlord 或 tenant' });
    }
    if (!/^1\d{10}$/.test(phone)) {
      return res.status(400).json({ error: '手机号格式不正确' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度不能少于6位' });
    }

    const db = await getDb();
    const existing = db.exec('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return res.status(409).json({ error: '该手机号已注册' });
    }

    const id = `uid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const addr = walletAddress || '';

    db.run(`INSERT INTO users (id, phone, password_hash, role, wallet_address, nickname)
            VALUES (?, ?, ?, ?, ?, ?)`,
      [id, phone, passwordHash, role, addr, nickname || '']);
    saveDb();

    const token = jwt.sign(
      { id, phone, role, walletAddress: addr },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: { token, user: { id, phone, role, walletAddress: addr, nickname: nickname || '' } }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '注册失败，请重试' });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: '手机号和密码为必填项' });
    }

    const db = await getDb();
    const result = db.exec('SELECT * FROM users WHERE phone = ?', [phone]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(401).json({ error: '手机号或密码错误' });
    }

    const cols = result[0].columns;
    const row = result[0].values[0];
    const user = {};
    cols.forEach((c, i) => { user[c] = row[i]; });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '手机号或密码错误' });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role, walletAddress: user.wallet_address },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id, phone: user.phone, role: user.role,
          walletAddress: user.wallet_address, nickname: user.nickname
        }
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败，请重试' });
  }
});

// 获取当前用户信息
router.get('/me', require('../auth').authMiddleware, async (req, res) => {
  const db = await getDb();
  const result = db.exec('SELECT id, phone, role, wallet_address, nickname, created_at FROM users WHERE id = ?', [req.user.id]);
  if (result.length === 0 || result[0].values.length === 0) {
    return res.status(404).json({ error: '用户不存在' });
  }
  const cols = result[0].columns;
  const row = result[0].values[0];
  const user = {};
  cols.forEach((c, i) => { user[c] = row[i]; });

  res.json({ success: true, data: user });
});

// 更新用户信息
router.put('/me', require('../auth').authMiddleware, async (req, res) => {
  const { nickname, walletAddress } = req.body;
  const db = await getDb();

  if (nickname !== undefined) {
    db.run(`UPDATE users SET nickname = ? WHERE id = ?`, [nickname, req.user.id]);
  }
  if (walletAddress !== undefined) {
    db.run(`UPDATE users SET wallet_address = ? WHERE id = ?`, [walletAddress, req.user.id]);
  }
  saveDb();

  res.json({ success: true, message: '更新成功' });
});

module.exports = router;
