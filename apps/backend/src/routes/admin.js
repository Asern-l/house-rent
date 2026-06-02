/**
 * Admin configuration routes — localhost-only, no user auth required.
 * Mounted at /api/admin/
 * WARNING: Do NOT expose this on a public network without additional auth.
 */
const express = require('express');
const { ethers } = require('ethers');
const { readConfig, writeConfig } = require('../runtime-config');
const { isIpfsEnabled, isPinataMode, addJsonToIpfs } = require('../ipfs');

const router = express.Router();

// 限制仅本地访问，防止服务意外绑定到公网时被利用。
function requireLocalhost(req, res, next) {
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (ip === '127.0.0.1' || ip === '::1') return next();
  return res.status(403).json({ error: 'Admin API 仅限本地访问' });
}
router.use(requireLocalhost);

function normalizePrivateKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return '';
  return `0x${body}`;
}

function deriveSignerAddress(privateKey) {
  try {
    const normalized = normalizePrivateKey(privateKey);
    if (!normalized) return null;
    return new ethers.Wallet(normalized).address;
  } catch {
    return null;
  }
}

// GET /api/admin/config-status
router.get('/config-status', (req, res) => {
  try {
    const cfg = readConfig();
    const hasSignerKey = !!(cfg.trustedSignerPrivateKey && normalizePrivateKey(cfg.trustedSignerPrivateKey));
    const hasPinataJwt = !!(cfg.pinataJwt && String(cfg.pinataJwt).trim());

    let ipfsProvider = 'disabled';
    if (hasPinataJwt) {
      ipfsProvider = 'pinata';
    } else if (isIpfsEnabled()) {
      ipfsProvider = 'local';
    }

    const signerAddress = hasSignerKey ? deriveSignerAddress(cfg.trustedSignerPrivateKey) : null;

    res.json({
      success: true,
      data: {
        hasSignerKey,
        ipfsProvider,
        hasPinataJwt,
        signerAddress,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'config_status_failed' });
  }
});

// POST /api/admin/signer-key
router.post('/signer-key', (req, res) => {
  try {
    const { privateKey } = req.body || {};
    const normalized = normalizePrivateKey(privateKey);
    if (!normalized) {
      return res.status(400).json({ error: '私钥格式无效，需要 0x 开头的 64 位十六进制字符串' });
    }
    writeConfig({ trustedSignerPrivateKey: normalized });
    const signerAddress = deriveSignerAddress(normalized);
    res.json({ success: true, data: { signerAddress } });
  } catch (err) {
    res.status(500).json({ error: err.message || 'save_signer_key_failed' });
  }
});

// POST /api/admin/ipfs-config
router.post('/ipfs-config', (req, res) => {
  try {
    const { provider, pinataJwt } = req.body || {};
    const validProviders = ['local', 'pinata', 'disabled'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: `provider 必须是 ${validProviders.join('/')} 之一` });
    }

    const updates = {};
    if (provider === 'pinata') {
      const jwt = String(pinataJwt || '').trim();
      if (!jwt) {
        return res.status(400).json({ error: '选择 Pinata 时需提供 JWT' });
      }
      updates.pinataJwt = jwt;
      updates.ipfsProvider = 'pinata';
      // Keep local IPFS enabled in case they switch back
    } else if (provider === 'local') {
      updates.pinataJwt = '';
      updates.ipfsProvider = 'local';
      process.env.IPFS_ENABLED = '1';
    } else {
      // disabled
      updates.pinataJwt = '';
      updates.ipfsProvider = 'disabled';
      process.env.IPFS_ENABLED = '0';
    }

    writeConfig(updates);
    res.json({ success: true, data: { provider } });
  } catch (err) {
    res.status(500).json({ error: err.message || 'save_ipfs_config_failed' });
  }
});

// POST /api/admin/test-ipfs
router.post('/test-ipfs', async (req, res) => {
  try {
    if (!isIpfsEnabled()) {
      return res.status(400).json({ error: 'IPFS 未启用' });
    }
    const testPayload = { test: true, ts: Date.now(), msg: 'ipfs-connectivity-check' };
    const result = await addJsonToIpfs(testPayload, { fileName: 'ipfs-test.json' });
    res.json({
      success: true,
      data: {
        cid: result.cid,
        gatewayUrl: result.gatewayUrl,
        provider: isPinataMode() ? 'pinata' : 'local',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'ipfs_test_failed' });
  }
});

module.exports = router;
