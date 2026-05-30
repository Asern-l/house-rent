/**
 * 文件说明：认证路由（钱包登录版）。
 * 提供钱包签名登录/注册、查询/更新个人信息接口。
 * 不再支持邮箱/密码、头像。
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');
const { getUserDb, saveUserDb, parseResult, resolveUserNetwork } = require('../user-db');
const { JWT_SECRET, authMiddleware } = require('../auth');
const { logApiError, logUserEvent } = require('../logger');
const { sendError } = require('../app-error');

const { createLoginMessage } = require('../../../frontend/src/shared/loginMessage');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SIGN_TIME_SKEW_MS = 10 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;
const LOCAL_TOPUP_TARGET_WEI = ethers.parseEther('50');
const LOCAL_CHAIN_ID = 31337n;

// 内存 nonce 存储（一次有效，定时清理过期）
const nonceStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, { createdAt }] of nonceStore) {
    if (now - createdAt > NONCE_TTL_MS) nonceStore.delete(key);
  }
}, 60_000);

// 函数 1: 校验钱包地址格式。
function isValidWalletAddress(walletAddress) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(walletAddress || '').trim());
}

async function fundLocalWalletIfNeeded(walletAddress) {
  const rpcUrl = String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (network.chainId !== LOCAL_CHAIN_ID) {
    throw new Error(`local rpc chainId mismatch: expected ${LOCAL_CHAIN_ID}, got ${network.chainId}`);
  }
  const normalizedWallet = ethers.getAddress(walletAddress);
  const currentBalance = await provider.getBalance(normalizedWallet);
  if (currentBalance >= LOCAL_TOPUP_TARGET_WEI) {
    return {
      funded: false,
      txHash: '',
      previousBalanceWei: currentBalance.toString(),
      fundedAmountWei: '0',
      finalBalanceWei: currentBalance.toString(),
    };
  }
  const signer = await provider.getSigner(0);
  const fundedAmount = LOCAL_TOPUP_TARGET_WEI - currentBalance;
  const tx = await signer.sendTransaction({
    to: normalizedWallet,
    value: fundedAmount,
  });
  const receipt = await tx.wait();
  const finalBalance = await provider.getBalance(normalizedWallet);
  return {
    funded: true,
    txHash: receipt?.hash || tx.hash || '',
    previousBalanceWei: currentBalance.toString(),
    fundedAmountWei: fundedAmount.toString(),
    finalBalanceWei: finalBalance.toString(),
  };
}

async function maybeTopupLocalWallet({ preferredNetwork, userId, walletAddress, requestId, stagePrefix }) {
  if (String(preferredNetwork || '').trim().toLowerCase() !== 'local') return;
  try {
    const topupResult = await fundLocalWalletIfNeeded(walletAddress);
    logUserEvent(`${stagePrefix}.local-topup`, {
      requestId: requestId || '',
      userId,
      walletAddress,
      funded: topupResult.funded,
      txHash: topupResult.txHash,
      previousBalanceWei: topupResult.previousBalanceWei,
      fundedAmountWei: topupResult.fundedAmountWei,
      finalBalanceWei: topupResult.finalBalanceWei,
    });
  } catch (topupError) {
    logApiError(`${stagePrefix}.local-topup.failed`, {
      requestId: requestId || '',
      userId,
      walletAddress,
      message: topupError?.message || 'local_topup_failed',
    });
  }
}

// 函数 1-1: 获取一次性 nonce（抗重放攻击）。
router.get('/nonce', asyncHandler(async (req, res) => {
  const nonce = `nonce_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  nonceStore.set(nonce, { createdAt: Date.now() });
  res.json({ success: true, data: { nonce } });
}));

// 函数 2: 钱包签名登录/注册（自动判断新老用户）。
// 前端生成登录签名消息，后端验签后签发 JWT。
router.post('/login', asyncHandler(async (req, res) => {
  try {
    const {
      walletAddress,
      signature,
      message,
      timestamp,
      nonce,
      role = 'tenant',
      nickname = '',
      phone = '',
      preferredNetwork = 'sepolia',
    } = req.body || {};
    const targetNetwork = resolveUserNetwork(preferredNetwork);
    const normalizedWallet = String(walletAddress || '').trim();
    if (!isValidWalletAddress(normalizedWallet)) {
      return sendError(res, 400, 'WALLET_ADDRESS_INVALID', '钱包地址格式不正确');
    }
    if (!['landlord', 'tenant'].includes(role)) {
      return sendError(res, 400, 'ROLE_INVALID', '角色仅支持 landlord 或 tenant');
    }

    // 校验 nonce（一次性，防重放）
    const nonceEntry = nonceStore.get(String(nonce || ''));
    if (!nonceEntry) {
      return sendError(res, 400, 'NONCE_INVALID_OR_EXPIRED', 'nonce 无效或已过期，请刷新后重试');
    }
    nonceStore.delete(String(nonce));

    // 验签
    const ts = Number(timestamp || 0);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SIGN_TIME_SKEW_MS) {
      return sendError(res, 400, 'SIGNATURE_EXPIRED', '签名已过期，请刷新后重试');
    }
    const expectedMessage = createLoginMessage(normalizedWallet, ts, nonce);
    if (String(message || '') !== expectedMessage) {
      return sendError(res, 400, 'SIGN_MESSAGE_MISMATCH', '签名消息不匹配');
    }
    let recovered = '';
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      return sendError(res, 400, 'SIGNATURE_VERIFY_FAILED', '签名验签失败');
    }
    if (recovered.toLowerCase() !== normalizedWallet.toLowerCase()) {
      return sendError(res, 400, 'SIGNER_MISMATCH', '签名钱包与提交地址不一致');
    }

    const db = await getUserDb(targetNetwork);
    const users = parseResult(db.exec(
      'SELECT id, wallet_address, role, nickname, phone FROM users WHERE LOWER(wallet_address) = ?',
      [normalizedWallet.toLowerCase()]
    ));

    let user;
    if (users.length) {
      // 已有账号：直接登录
      user = users[0];
      logUserEvent('auth.wallet-login.success', { requestId: req.requestId || '', userId: user.id, walletAddress: normalizedWallet, role: user.role });
      await maybeTopupLocalWallet({
        preferredNetwork: targetNetwork,
        userId: user.id,
        walletAddress: user.wallet_address,
        requestId: req.requestId || '',
        stagePrefix: 'auth.wallet-login',
      });
    } else {
      // 新用户：自动注册，落库昵称和手机号
      const safeNickname = String(nickname || '').trim().slice(0, 32);
      const safePhone = String(phone || '').trim().slice(0, 20);
      const userId = `uid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.run(
        'INSERT INTO users (id, wallet_address, role, nickname, phone) VALUES (?, ?, ?, ?, ?)',
        [userId, ethers.getAddress(normalizedWallet), role, safeNickname, safePhone]
      );
      saveUserDb(targetNetwork);
      user = { id: userId, wallet_address: ethers.getAddress(normalizedWallet), role, nickname: safeNickname, phone: safePhone };
      logUserEvent('auth.wallet-register.success', { requestId: req.requestId || '', userId, walletAddress: normalizedWallet, role });
      await maybeTopupLocalWallet({
        preferredNetwork: targetNetwork,
        userId,
        walletAddress: user.wallet_address,
        requestId: req.requestId || '',
        stagePrefix: 'auth.wallet-register',
      });
    }

    const token = jwt.sign({ id: user.id, walletAddress: user.wallet_address, role: user.role, preferredNetwork: targetNetwork }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          role: user.role,
          nickname: user.nickname || '',
          phone: user.phone || '',
        },
      },
    });
  } catch (error) {
    logApiError('auth.wallet-login.exception', { requestId: req.requestId || '', message: error.message, stack: error.stack || '' });
    sendError(res, 500, 'AUTH_LOGIN_FAILED', '登录失败');
  }
}));

// 函数 3: 获取当前用户信息接口。
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getUserDb(req.user.preferredNetwork);
  const users = parseResult(db.exec(
    'SELECT id, wallet_address, role, nickname, phone, created_at FROM users WHERE id = ?',
    [req.user.id]
  ));
  if (!users.length) {
    return sendError(res, 404, 'USER_NOT_FOUND', '用户不存在');
  }
  res.json({ success: true, data: users[0] });
}));

// 函数 4: 更新当前用户信息（昵称 + 手机号）。
router.put('/me', authMiddleware, asyncHandler(async (req, res) => {
  const { nickname, phone } = req.body;
  const db = await getUserDb(req.user.preferredNetwork);

  if (nickname !== undefined) {
    const nextNickname = String(nickname || '').trim().slice(0, 32);
    db.run('UPDATE users SET nickname = ? WHERE id = ?', [nextNickname, req.user.id]);
  }
  if (phone !== undefined) {
    const nextPhone = String(phone || '').trim().slice(0, 20);
    if (nextPhone && !/^[+]?[\d\s()-]{7,20}$/.test(nextPhone)) {
      return sendError(res, 400, 'PHONE_INVALID', '手机号格式不正确');
    }
    db.run('UPDATE users SET phone = ? WHERE id = ?', [nextPhone, req.user.id]);
  }

  saveUserDb(req.user.preferredNetwork);
  const users = parseResult(db.exec(
    'SELECT id, wallet_address, role, nickname, phone FROM users WHERE id = ?',
    [req.user.id]
  ));
  const nextUser = users[0] || {};
  logUserEvent('auth.profile.update.success', { requestId: req.requestId || '', userId: req.user.id, walletAddress: nextUser.wallet_address || '', role: nextUser.role || '' });
  res.json({
    success: true,
    message: '用户信息更新成功',
    data: {
      user: {
        id: nextUser.id,
        walletAddress: nextUser.wallet_address,
        role: nextUser.role,
        nickname: nextUser.nickname || '',
        phone: nextUser.phone || '',
      },
    },
  });
}));

module.exports = router;
