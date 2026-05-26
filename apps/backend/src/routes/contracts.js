/**
 * 文件说明：合同路由。
 * 覆盖合同创建、签署、取消、上链回写、列表与详情查询。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const PDFDocument = require('pdfkit');
const { getDb, saveDb, parseResult, CHAIN_ENV } = require('../db');
const { getUserDb, saveUserDb, parseResult: parseUserResult } = require('../user-db');
const { authMiddleware, requireRole } = require('../auth');
const { logSignFlow, logRiskEvent } = require('../logger');

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SIGN_TIME_SKEW_MS = 10 * 60 * 1000;
const PAYMENT_AUTH_TTL_SECONDS = 10 * 60;
const PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const SAME_LISTING_WINDOW_HOURS = 24;
const SAME_LISTING_MAX_APPLY = 10;
const GLOBAL_WINDOW_MINUTES = 60;
const GLOBAL_MAX_APPLY = 20;
const GLOBAL_COOLDOWN_HOURS = 6;
const SAME_LISTING_COOLDOWN_HOURS = 24;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

const LOCAL_DEV_PAYMENT_PRIVATE_KEY = '0xe4a2d851548a27b70a5befe096b9f222d00b7ad529951bb2536cd4df767571c8';
const PDF_FONT_CANDIDATES = [
  path.join(__dirname, '..', 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
  path.join(__dirname, '..', '..', '..', 'docs', 'assets', 'fonts', 'NotoSansSC-Regular.ttf'),
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\simsunb.ttf',
  'C:\\Windows\\Fonts\\simfang.ttf',
  'C:\\Windows\\Fonts\\STSONG.TTF',
  'C:\\Windows\\Fonts\\STFANGSO.TTF',
];

// 函数 1: 将金额规范化为字符串，避免精度展示异常。
function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function error(code, message, extra = {}) {
  return { code, error: message, ...extra };
}

// 函数 2: 判断合同是否为终态。
function isTerminalStatus(status) {
  return ['cancelled', 'expired', 'ended'].includes(status);
}

function contractHash(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

// 函数 4: 规范化日期字符串（YYYY-MM-DD）。
function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

// 函数 5: 计算结束日期（按月偏移）。
function addMonthsDateOnly(startDateOnly, months) {
  const d = new Date(`${startDateOnly}T00:00:00`);
  d.setMonth(d.getMonth() + Number(months));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 函数 6: 生成北京时间日期（YYYY-MM-DD）。
function getCnDateOnly(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 函数 7: 生成北京时间日期时间（YYYY-MM-DD HH:mm:ss）。
function getCnDateTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function parseCnDateTime(value) {
  const s = String(value || '').trim();
  const normalized = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeWalletAddress(value) {
  const addr = String(value || '').trim();
  return ADDR_RE.test(addr) ? ethers.getAddress(addr) : '';
}

function getClientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
}

// 函数 2-1: 对租客写入风控冷却时间（仅延长，不缩短已有冷却）。
function setTenantRiskCooldown(userDb, userId, hours) {
  userDb.run(
    `UPDATE users
     SET risk_blocked_until = CASE
       WHEN risk_blocked_until <> '' AND datetime(risk_blocked_until) > datetime('now', '+8 hours', ?)
       THEN risk_blocked_until
       ELSE datetime('now', '+8 hours', ?)
     END
     WHERE id = ?`,
    [`+${hours} hours`, `+${hours} hours`, userId]
  );
}

function createSignMessage({ contractId, contentHash, role, signerAddress, timestamp }) {
  return [
    'CCL Housing Contract Signature',
    `contractId:${contractId}`,
    `contentHash:${contentHash}`,
    `role:${role}`,
    `signer:${ethers.getAddress(signerAddress)}`,
    `timestamp:${timestamp}`,
  ].join('\n');
}

function verifyContractSignature({ contract, role, signerAddress, signature, message }) {
  const normalizedSigner = normalizeWalletAddress(signerAddress);
  if (!normalizedSigner) return { ok: false, code: 'SIGNER_ADDRESS_INVALID', message: '签署钱包地址格式无效' };
  if (!/^0x[a-fA-F0-9]{130}$/.test(String(signature || '').trim())) {
    return { ok: false, code: 'SIGNATURE_INVALID', message: '签名格式无效' };
  }

  let parsed = {};
  for (const line of String(message || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const timestamp = Number(parsed.timestamp || 0);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > SIGN_TIME_SKEW_MS) {
    return { ok: false, code: 'SIGN_EXPIRED', message: '签署声明已过期，请刷新后重试' };
  }

  const expectedMessage = createSignMessage({
    contractId: contract.id,
    contentHash: contract.content_hash,
    role,
    signerAddress: normalizedSigner,
    timestamp,
  });
  if (String(message || '') !== expectedMessage) {
    return { ok: false, code: 'SIGN_MESSAGE_MISMATCH', message: '签署声明与合同内容不匹配' };
  }

  let recovered = '';
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return { ok: false, code: 'SIGNATURE_VERIFY_FAILED', message: '签名验签失败' };
  }
  if (recovered.toLowerCase() !== normalizedSigner.toLowerCase()) {
    return { ok: false, code: 'WALLET_MISMATCH', message: '签名钱包与提交地址不一致' };
  }
  return { ok: true, signerAddress: normalizedSigner };
}

function getPaymentPrivateKey() {
  const configured = String(process.env.PAYMENT_AUTH_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(configured)) return configured;
  if (String(process.env.CHAIN_ENV || '').trim().toLowerCase() === 'local') return LOCAL_DEV_PAYMENT_PRIVATE_KEY;
  return '';
}

function createPaymentDigest({ contractId, payer, amountWei, deadline, nonce, chainId, contractAddress }) {
  return ethers.solidityPackedKeccak256(
    ['string', 'address', 'uint256', 'uint256', 'bytes32', 'uint256', 'address'],
    [contractId, payer, amountWei, deadline, nonce, chainId, contractAddress]
  );
}

function makeContractContentHash(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

function createPseudoTxHash(prefix = 'offchain') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

// 函数 2-2: 为 PDF 选择可用中文字体，避免导出乱码。
function resolvePdfChineseFontPath() {
  return PDF_FONT_CANDIDATES.find((fontPath) => {
    try {
      return fs.existsSync(fontPath);
    } catch {
      return false;
    }
  }) || '';
}


// 函数 3: 创建合同接口（租客发起）。
router.post('/', authMiddleware, requireRole('tenant'), asyncHandler(async (req, res) => {
  const { listingId, startDate, leaseMonths } = req.body || {};
  if (!listingId) {
    return res.status(400).json({ error: 'listingId 不能为空' });
  }

  const db = await getDb();
  const userDb = await getUserDb();
  const listings = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [listingId]));
  if (!listings.length) return res.status(404).json({ error: '房源不存在' });
  const listing = listings[0];
  if (listing.status !== 'available') return res.status(400).json({ error: '房源不可租' });

  // 同一房源若已有进行中合同，不允许再次发起。
  const existingContracts = parseResult(db.exec(
    `SELECT id, status FROM contracts
     WHERE listing_id = ?
       AND status NOT IN ('cancelled', 'expired', 'ended')`,
    [listingId]
  ));
  if (existingContracts.length > 0) {
    return res.status(409).json({ error: '该房源已有进行中的合同，暂不可重复申请' });
  }

  const minLeaseMonths = Number(listing.min_lease_months || 1);
  const leaseMonthsNum = Number(leaseMonths ?? minLeaseMonths);
  if (!Number.isInteger(leaseMonthsNum) || leaseMonthsNum < minLeaseMonths || leaseMonthsNum > 12) {
    return res.status(400).json({ error: `租期必须为 ${minLeaseMonths}-12 月的整数` });
  }
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const maxDate = new Date(todayDate);
  maxDate.setDate(maxDate.getDate() + 3);
  const startDateOnly = normalizeDateOnly(startDate) || getCnDateOnly(todayDate);
  const startAt = new Date(`${startDateOnly}T00:00:00`);
  if (startAt < todayDate || startAt > maxDate) {
    return res.status(400).json({ error: '生效日期仅支持今天至未来3天' });
  }

  const [tenant] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [req.user.id]));
  const [landlord] = parseUserResult(userDb.exec('SELECT * FROM users WHERE id = ?', [listing.landlord_id]));
  if (!tenant || !landlord) {
    return res.status(400).json({ error: '用户信息不存在，请重新登录后重试' });
  }
  const blockedUntil = parseCnDateTime(tenant.risk_blocked_until);
  if (blockedUntil && blockedUntil > new Date()) {
    logRiskEvent('contract.apply.blocked.active-cooldown', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      blockedUntil: tenant.risk_blocked_until,
      unpaidDefaultCount: tenant.unpaid_default_count || 0,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('TENANT_RISK_COOLDOWN', '当前账号处于风控冷却期，暂不能发起新签约', {
      blockedUntil: tenant.risk_blocked_until,
      unpaidDefaultCount: tenant.unpaid_default_count || 0,
    }));
  }

  const recentTenantApplications = parseResult(db.exec(
    `SELECT COUNT(*) AS count
     FROM contracts
     WHERE tenant_id = ?
       AND created_at >= datetime('now', '+8 hours', '-60 minutes')`,
    [req.user.id]
  ));
  const recentTenantCount = Number(recentTenantApplications[0]?.count || 0);
  if (recentTenantCount >= GLOBAL_MAX_APPLY) {
    setTenantRiskCooldown(userDb, req.user.id, GLOBAL_COOLDOWN_HOURS);
    saveUserDb();
    logRiskEvent('contract.apply.blocked.global-rate', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      windowMinutes: GLOBAL_WINDOW_MINUTES,
      maxApply: GLOBAL_MAX_APPLY,
      hitCount: recentTenantCount,
      cooldownHours: GLOBAL_COOLDOWN_HOURS,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('CONTRACT_APPLY_RATE_LIMITED', `申请签约过于频繁，已触发 ${GLOBAL_COOLDOWN_HOURS} 小时冷却`));
  }

  const recentSameListing = parseResult(db.exec(
    `SELECT COUNT(*) AS count
     FROM contracts
     WHERE tenant_id = ?
       AND listing_id = ?
       AND created_at >= datetime('now', '+8 hours', '-24 hours')`,
    [req.user.id, listingId]
  ));
  const recentSameListingCount = Number(recentSameListing[0]?.count || 0);
  if (recentSameListingCount >= SAME_LISTING_MAX_APPLY) {
    setTenantRiskCooldown(userDb, req.user.id, SAME_LISTING_COOLDOWN_HOURS);
    saveUserDb();
    logRiskEvent('contract.apply.blocked.same-listing', {
      requestId: req.requestId || '',
      userId: req.user.id,
      listingId,
      windowHours: SAME_LISTING_WINDOW_HOURS,
      maxApply: SAME_LISTING_MAX_APPLY,
      hitCount: recentSameListingCount,
      cooldownHours: SAME_LISTING_COOLDOWN_HOURS,
      preferredNetwork: CHAIN_ENV,
    });
    return res.status(429).json(error('CONTRACT_APPLY_DUPLICATE_COOLDOWN', `同一房源 24 小时内最多申请 ${SAME_LISTING_MAX_APPLY} 次，已触发 ${SAME_LISTING_COOLDOWN_HOURS} 小时冷却`));
  }

  const rentAmount = normalizeAmount(listing.rent_amount);
  if (!rentAmount) {
    return res.status(400).json({ error: '房源租金配置无效，请房东先修正房源信息' });
  }
  const oneTimeAmount = normalizeAmount(Number(rentAmount) * leaseMonthsNum);
  if (!oneTimeAmount) {
    return res.status(400).json({ error: '合同首笔支付金额计算失败，请检查房源配置' });
  }

  const contractId = `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const content = {
    contractId,
    listingId,
    title: listing.title,
    address: listing.address,
    rentAmount,
    oneTimeAmount,
    tenant: { id: tenant.id, nickname: tenant.nickname, email: tenant.email, walletAddress: tenant.wallet_address },
    landlord: { id: landlord.id, nickname: landlord.nickname, email: landlord.email, walletAddress: landlord.wallet_address },
    terms: {
      paymentMethod: 'one_time',
      startDate: startDateOnly,
      endDate: addMonthsDateOnly(startDateOnly, leaseMonthsNum),
      leaseMonths: leaseMonthsNum,
      minLeaseMonths,
    },
    createdAt: getCnDateTime(new Date()),
  };

  const contentJson = JSON.stringify(content, null, 2);
  const contentHash = contractHash(content);
  const expiresAt = getCnDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));

  db.run('UPDATE listings SET status = \'locked\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'available\'', [listingId]);
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源已被其他租客占用，请刷新后重试' });
  }

  try {
    db.run(`INSERT INTO contracts (id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`, [
      contractId, listingId, req.user.id, listing.landlord_id, contentJson, contentHash, expiresAt,
    ]);
    db.run(
      `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status, decided_at, decided_by)
       VALUES (?, ?, 1, ?, ?, ?, '初始系统草稿', 'accepted', datetime('now', '+8 hours'), ?)`,
      [`cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, contractId, req.user.id, contentJson, contentHash, req.user.id]
    );
  } catch (error) {
    db.run('UPDATE listings SET status = \'available\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'', [listingId]);
    throw error;
  }
  saveDb();

  res.json({ success: true, data: { contractId, contentHash, expiresAt } });
}));

// 函数 3-1: 查询合同协商版本。
router.get('/:id/versions', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限查看合同协商记录' });
  }
  const versions = parseResult(db.exec(
    `SELECT *
     FROM contract_versions
     WHERE contract_id = ?
     ORDER BY version DESC, created_at DESC`,
    [req.params.id]
  ));
  res.json({ success: true, data: versions });
}));

// 函数 3-2: 提交合同修改提案。
router.post('/:id/proposals', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限修改该合同' });
  }
  if (contract.status !== 'pending' || contract.tenant_signed_at || contract.landlord_signed_at) {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '仅签署前合同可协商修改'));
  }
  if (contract.negotiation_status === 'finalized') {
    return res.status(400).json(error('CONTRACT_ALREADY_FINALIZED', '合同已定稿，不可继续修改'));
  }

  const existingProposal = parseResult(db.exec(
    "SELECT id FROM contract_versions WHERE contract_id = ? AND status = 'proposed' LIMIT 1",
    [req.params.id]
  ));
  if (existingProposal.length > 0) {
    return res.status(409).json(error('NEGOTIATION_PROPOSAL_EXISTS', '已有待确认的修改提案，请先处理后再提交新提案'));
  }

  const current = contract.content_json;
  const next = JSON.parse(JSON.stringify(current));
  const nextLeaseMonths = Number(req.body?.leaseMonths ?? next?.terms?.leaseMonths);
  const nextStartDate = normalizeDateOnly(req.body?.startDate ?? next?.terms?.startDate);
  const rentAmount = normalizeAmount(req.body?.rentAmount ?? next.rentAmount);
  const minLeaseMonths = Number(next?.terms?.minLeaseMonths || 1);
  if (!nextStartDate) return res.status(400).json({ error: '生效日期格式不正确' });
  if (!Number.isInteger(nextLeaseMonths) || nextLeaseMonths < minLeaseMonths || nextLeaseMonths > 12) {
    return res.status(400).json({ error: `租期必须为 ${minLeaseMonths}-12 月的整数` });
  }
  if (!rentAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });

  next.rentAmount = rentAmount;
  next.oneTimeAmount = normalizeAmount(Number(rentAmount) * nextLeaseMonths);
  next.terms = {
    ...(next.terms || {}),
    startDate: nextStartDate,
    endDate: addMonthsDateOnly(nextStartDate, nextLeaseMonths),
    leaseMonths: nextLeaseMonths,
  };
  next.negotiation = {
    lastProposedBy: req.user.id,
    lastProposedAt: getCnDateTime(new Date()),
    note: String(req.body?.changeNote || '').trim(),
  };

  const nextHash = contractHash(next);
  const nextVersion = Number(contract.version || 1) + 1;
  const proposalId = `cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed')`,
    [proposalId, req.params.id, nextVersion, req.user.id, JSON.stringify(next, null, 2), nextHash, String(req.body?.changeNote || '').trim()]
  );
  db.run(
    "UPDATE contracts SET negotiation_status = 'proposed' WHERE id = ? AND status = 'pending'",
    [req.params.id]
  );
  saveDb();
  res.json({ success: true, message: '合同修改提案已提交', data: { proposalId, version: nextVersion, contentHash: nextHash } });
}));

// 函数 3-3: 接受合同修改提案。
router.post('/:id/proposals/:proposalId/accept', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限处理该合同提案' });
  }
  if (contract.status !== 'pending') {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '当前状态不可处理协商提案'));
  }

  const proposals = parseResult(db.exec(
    "SELECT * FROM contract_versions WHERE id = ? AND contract_id = ? AND status = 'proposed'",
    [req.params.proposalId, req.params.id]
  ));
  if (!proposals.length) return res.status(404).json({ error: '待确认提案不存在' });
  const proposal = proposals[0];
  if (proposal.proposer_id === req.user.id) {
    return res.status(400).json(error('NEGOTIATION_SELF_ACCEPT_DENIED', '提案需由对方确认'));
  }

  db.run(
    `UPDATE contracts
     SET content_json = ?,
         content_hash = ?,
         version = ?,
         negotiation_status = 'draft'
     WHERE id = ? AND status = 'pending'`,
    [JSON.stringify(proposal.content_json, null, 2), proposal.content_hash, Number(proposal.version), req.params.id]
  );
  db.run(
    "UPDATE contract_versions SET status = 'accepted', decided_at = datetime('now', '+8 hours'), decided_by = ? WHERE id = ?",
    [req.user.id, req.params.proposalId]
  );
  db.run(
    "UPDATE contract_versions SET status = 'rejected', decided_at = datetime('now', '+8 hours'), decided_by = ? WHERE contract_id = ? AND status = 'proposed'",
    [req.user.id, req.params.id]
  );
  saveDb();
  res.json({ success: true, message: '合同修改提案已接受', data: { version: Number(proposal.version), contentHash: proposal.content_hash } });
}));

// 函数 3-4: 定稿合同，定稿后才能进入签署。
router.post('/:id/finalize', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限定稿该合同' });
  }
  if (contract.status !== 'pending') {
    return res.status(400).json(error('NEGOTIATION_STATUS_INVALID', '当前状态不可定稿'));
  }
  const openProposal = parseResult(db.exec(
    "SELECT id FROM contract_versions WHERE contract_id = ? AND status = 'proposed' LIMIT 1",
    [req.params.id]
  ));
  if (openProposal.length > 0) {
    return res.status(409).json(error('NEGOTIATION_PROPOSAL_EXISTS', '还有待确认的修改提案，不能定稿'));
  }

  db.run(
    "UPDATE contracts SET negotiation_status = 'finalized', finalized_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'pending'",
    [req.params.id]
  );
  saveDb();
  res.json({ success: true, message: '合同已定稿，可以开始签署' });
}));

// 函数 4: 租客签署合同接口。
router.post('/:id/sign-tenant', authMiddleware, asyncHandler(async (req, res) => {
  const { signerAddress, signature, message } = req.body || {};
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) return res.status(403).json({ error: '无权限签署' });
  if (contract.status !== 'pending') {
    return res.status(400).json(error('SIGN_STATUS_INVALID', '当前状态不允许租客签署', { currentStatus: contract.status }));
  }
  if (contract.negotiation_status !== 'finalized') {
    return res.status(400).json(error('CONTRACT_NOT_FINALIZED', '合同尚未定稿，请先完成协商并定稿后再签署'));
  }
  const content = contract.content_json;
  const boundAddress = normalizeWalletAddress(content?.tenant?.walletAddress);
  const submittedAddress = normalizeWalletAddress(signerAddress);
  if (!boundAddress) {
    return res.status(400).json(error('WALLET_NOT_BOUND', '租客未绑定有效钱包地址，请先在个人中心绑定钱包'));
  }
  if (!submittedAddress || submittedAddress.toLowerCase() !== boundAddress.toLowerCase()) {
    return res.status(400).json(error('WALLET_MISMATCH', '当前签署钱包与合同绑定租客钱包不一致'));
  }
  const verified = verifyContractSignature({ contract, role: 'tenant', signerAddress: submittedAddress, signature, message });
  if (!verified.ok) return res.status(400).json(error(verified.code, verified.message));

  db.run(
    `UPDATE contracts
     SET status = 'tenant_signed',
         tenant_signed_at = datetime('now', '+8 hours'),
         tenant_signer_address = ?,
         tenant_signature = ?,
         tenant_signature_message = ?,
         tenant_sign_ip = ?,
         tenant_sign_user_agent = ?,
         tenant_sign_request_id = ?
     WHERE id = ? AND status = 'pending'`,
    [
      submittedAddress,
      String(signature || ''),
      String(message || ''),
      getClientIp(req),
      String(req.headers['user-agent'] || ''),
      String(req.requestId || ''),
      req.params.id,
    ]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json(error('SIGN_STATE_CHANGED', '合同状态已变化，请刷新后重试'));
  }
  saveDb();
  res.json({ success: true, message: '租客签署成功' });
}));

// 函数 5: 房东签署合同接口。
router.post('/:id/sign-landlord', authMiddleware, asyncHandler(async (req, res) => {
  try {
    const { signerAddress, signature, message } = req.body || {};
    const db = await getDb();
    const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
    if (!rows.length) return res.status(404).json({ error: '合同不存在' });
    const contract = rows[0];

    if (contract.landlord_id !== req.user.id) return res.status(403).json({ error: '无权限签署' });
    if (contract.status !== 'tenant_signed') {
      return res.status(400).json(error('SIGN_STATUS_INVALID', '当前状态不允许房东签署', { currentStatus: contract.status }));
    }

    const content = contract.content_json;
    const tenantAddress = String(content?.tenant?.walletAddress || '').trim();
    const landlordAddress = String(content?.landlord?.walletAddress || '').trim();
    const normalizedTenantAddress = normalizeWalletAddress(tenantAddress);
    const normalizedLandlordAddress = normalizeWalletAddress(landlordAddress);
    const submittedAddress = normalizeWalletAddress(signerAddress);
    if (!normalizedTenantAddress || !normalizedLandlordAddress) {
      return res.status(400).json(error('WALLET_NOT_BOUND', '合同绑定钱包地址不完整或格式无效，请租客和房东先在个人中心绑定钱包后重新发起合同'));
    }
    if (!submittedAddress || submittedAddress.toLowerCase() !== normalizedLandlordAddress.toLowerCase()) {
      return res.status(400).json(error('WALLET_MISMATCH', '当前签署钱包与合同绑定房东钱包不一致'));
    }
    const verified = verifyContractSignature({ contract, role: 'landlord', signerAddress: submittedAddress, signature, message });
    if (!verified.ok) return res.status(400).json(error(verified.code, verified.message));

    const paymentDeadline = getCnDateTime(new Date(Date.now() + PAYMENT_WINDOW_MS));
    db.run(
      `UPDATE contracts
       SET status = 'pending_payment',
           landlord_signed_at = datetime('now', '+8 hours'),
           landlord_signer_address = ?,
           landlord_signature = ?,
           landlord_signature_message = ?,
           landlord_sign_ip = ?,
           landlord_sign_user_agent = ?,
           landlord_sign_request_id = ?,
           payment_deadline = ?,
           onchain_status = 'pending',
           onchain_next_retry_at = ''
       WHERE id = ? AND status = 'tenant_signed'`,
      [
        submittedAddress,
        String(signature || ''),
        String(message || ''),
        getClientIp(req),
        String(req.headers['user-agent'] || ''),
        String(req.requestId || ''),
        paymentDeadline,
        req.params.id,
      ]
    );
    if (db.getRowsModified() !== 1) {
      return res.status(409).json(error('SIGN_STATE_CHANGED', '合同状态已变化，请刷新后重试'));
    }

    saveDb();

    res.json({
      success: true,
      message: '房东签署成功，请手动完成合同上链并回写交易哈希后再支付',
      data: {
        contentHash: contract.content_hash,
        tenantAddress: normalizedTenantAddress,
        landlordAddress: normalizedLandlordAddress,
        initialAmount: content?.oneTimeAmount || '',
        paymentDeadline,
        onchainStatus: 'pending',
        txHash: '',
        onchainError: '',
      },
    });
  } catch (error) {
    logSignFlow('sign-landlord.exception', { contractId: req.params.id, message: error.message, requestId: req.requestId });
    res.status(500).json({ error: '房东签署失败' });
  }
}));

// 函数 6: 上链交易哈希回写接口。
router.post('/:id/onchain', authMiddleware, asyncHandler(async (req, res) => {
  const { txHash } = req.body;
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    return res.status(400).json({ error: 'txHash 格式不正确' });
  }

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限操作该合同' });
  }
  if (!['pending_payment', 'active'].includes(contract.status)) {
    return res.status(400).json({ error: '当前状态不允许回写上链交易' });
  }

  db.run(
    `UPDATE contracts
     SET tx_hash = ?,
         onchain_status = 'confirmed',
         onchain_error = '',
         onchain_next_retry_at = '',
         status = status
      WHERE id = ? AND tx_hash IS NULL`,
    [txHash, req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '该合同已回写过链上交易哈希' });
  }
  saveDb();
  res.json({ success: true, message: '链上交易回写成功' });
}));

// 函数 7: 支付前签发一次性链上准入授权。
router.post('/:id/payments/authorization', authMiddleware, asyncHandler(async (req, res) => {
  const { payerAddress, amount, chainId, contractAddress } = req.body || {};
  const normalizedPayer = normalizeWalletAddress(payerAddress);
  const normalizedContractAddress = normalizeWalletAddress(contractAddress);
  const chainIdNum = Number(chainId);
  if (!normalizedPayer) return res.status(400).json(error('PAYER_ADDRESS_INVALID', 'payerAddress 格式不正确'));
  if (!normalizedContractAddress) return res.status(400).json(error('CONTRACT_ADDRESS_INVALID', 'contractAddress 格式不正确'));
  if (!Number.isInteger(chainIdNum) || chainIdNum <= 0) return res.status(400).json(error('CHAIN_ID_INVALID', 'chainId 不正确'));

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (contract.tenant_id !== req.user.id) {
    return res.status(403).json(error('PAYMENT_AUTH_FORBIDDEN', '仅租客可申请支付授权'));
  }
  if (contract.status !== 'pending_payment') {
    return res.status(400).json(error('PAYMENT_STATUS_INVALID', '当前状态不允许首笔支付', { currentStatus: contract.status }));
  }

  const content = contract.content_json;
  const tenantAddress = normalizeWalletAddress(content?.tenant?.walletAddress);
  const landlordAddress = normalizeWalletAddress(content?.landlord?.walletAddress);
  if (!tenantAddress || !landlordAddress) {
    return res.status(400).json(error('WALLET_NOT_BOUND', '合同绑定钱包地址不完整或格式无效'));
  }
  if (tenantAddress.toLowerCase() !== normalizedPayer.toLowerCase()) {
    return res.status(400).json(error('WALLET_MISMATCH', '支付钱包与合同租客钱包不一致'));
  }

  const expectedAmount = normalizeAmount(content?.oneTimeAmount || amount);
  const requestedAmount = normalizeAmount(amount);
  if (!expectedAmount || !requestedAmount || expectedAmount !== requestedAmount) {
    return res.status(400).json(error('PAYMENT_AMOUNT_MISMATCH', '支付金额与合同首笔金额不一致', { expectedAmount }));
  }

  const deadlineAt = parseCnDateTime(contract.payment_deadline || contract.expires_at);
  if (!deadlineAt || deadlineAt <= new Date()) {
    return res.status(400).json(error('PAYMENT_DEADLINE_EXPIRED', '合同已超过支付截止时间，不可支付'));
  }

  const privateKey = getPaymentPrivateKey();
  if (!privateKey) {
    return res.status(500).json(error('PAYMENT_AUTH_SIGNER_MISSING', '支付授权签名私钥未配置'));
  }

  const amountWei = ethers.parseEther(expectedAmount).toString();
  const authDeadline = Math.min(
    Math.floor(deadlineAt.getTime() / 1000),
    Math.floor(Date.now() / 1000) + PAYMENT_AUTH_TTL_SECONDS
  );
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const digest = createPaymentDigest({
    contractId: contract.id,
    payer: normalizedPayer,
    amountWei,
    deadline: authDeadline,
    nonce,
    chainId: chainIdNum,
    contractAddress: normalizedContractAddress,
  });
  const signer = new ethers.Wallet(privateKey);
  const signature = await signer.signMessage(ethers.getBytes(digest));

  db.run(
    `INSERT INTO payment_authorizations (
      nonce, contract_id, payer_address, amount_wei, chain_id, contract_address,
      deadline_epoch, signature, issued_by, request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nonce,
      contract.id,
      normalizedPayer,
      amountWei,
      String(chainIdNum),
      normalizedContractAddress,
      authDeadline,
      signature,
      req.user.id,
      String(req.requestId || ''),
    ]
  );
  saveDb();

  res.json({
    success: true,
    data: {
      contractId: contract.id,
      payer: normalizedPayer,
      landlord: landlordAddress,
      amount: expectedAmount,
      amountWei,
      deadline: authDeadline,
      nonce,
      chainId: chainIdNum,
      contractAddress: normalizedContractAddress,
      authorizer: signer.address,
      signature,
    },
  });
}));

// 函数 7: 支付成功回写接口（当前仅支持一次性首笔支付）。
router.post('/:id/payments/onchain', authMiddleware, asyncHandler(async (req, res) => {
  const { txHash, amount, payType = 'initial', period = '', nonce = '' } = req.body || {};
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash || '')) {
    return res.status(400).json({ error: 'txHash 格式不正确' });
  }
  if (payType !== 'initial') {
    return res.status(400).json({ error: '当前仅支持 initial' });
  }
  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount 必须大于 0' });
  }

  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (contract.tenant_id !== req.user.id) {
    return res.status(403).json({ error: '仅租客可回写支付记录' });
  }
  if (contract.status !== 'pending_payment') {
    return res.status(400).json(error('PAYMENT_STATUS_INVALID', '当前状态不允许首笔支付', { currentStatus: contract.status }));
  }

  const deadlineAt = parseCnDateTime(contract.payment_deadline || contract.expires_at);
  if (!deadlineAt || deadlineAt <= new Date()) {
    return res.status(400).json(error('PAYMENT_DEADLINE_EXPIRED', '合同已超过支付截止时间，不可支付'));
  }

  const existed = parseResult(db.exec('SELECT id FROM payments WHERE tx_hash = ?', [txHash]));
  if (existed.length > 0) {
    return res.status(409).json({ error: '该支付交易已回写' });
  }

  const priorInitial = parseResult(db.exec(
    'SELECT id FROM payments WHERE contract_id = ? AND pay_type = ? AND status = ?',
    [req.params.id, 'initial', 'confirmed']
  ));
  if (priorInitial.length > 0) {
    return res.status(409).json({ error: '该合同首笔支付已完成' });
  }

  const authRows = parseResult(db.exec(
    `SELECT *
     FROM payment_authorizations
     WHERE nonce = ? AND contract_id = ?`,
    [String(nonce || ''), req.params.id]
  ));
  if (!authRows.length) {
    return res.status(400).json(error('PAYMENT_AUTH_NOT_FOUND', '缺少有效支付授权，请重新发起支付'));
  }
  const auth = authRows[0];
  if (auth.used_tx_hash) {
    return res.status(409).json(error('PAYMENT_AUTH_USED', '该支付授权已使用'));
  }
  if (Number(auth.deadline_epoch || 0) < Math.floor(Date.now() / 1000)) {
    return res.status(400).json(error('PAYMENT_AUTH_EXPIRED', '支付授权已过期，请重新发起支付'));
  }
  const expectedAmountWei = ethers.parseEther(String(amount)).toString();
  if (String(auth.amount_wei) !== expectedAmountWei) {
    return res.status(400).json(error('PAYMENT_AMOUNT_MISMATCH', '支付授权金额与回写金额不一致'));
  }

  const paymentId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.run(
    `INSERT INTO payments (id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+8 hours'))`,
    [paymentId, req.params.id, req.user.id, payType, String(amount), period || '', txHash]
  );

  db.run(
    'UPDATE contracts SET status = \'active\' WHERE id = ? AND status = \'pending_payment\'',
    [req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '合同状态已变化，无法完成生效' });
  }
  db.run(
    'UPDATE listings SET status = \'rented\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'',
    [contract.listing_id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '房源状态异常，无法完成生效' });
  }

  db.run(
    "UPDATE payment_authorizations SET used_tx_hash = ?, used_at = datetime('now', '+8 hours') WHERE nonce = ? AND used_tx_hash = ''",
    [txHash, String(nonce || '')]
  );

  saveDb();
  res.json({ success: true, message: '支付回写成功', data: { paymentId } });
}));

// 函数 7: 取消合同接口。
router.post('/:id/cancel', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];

  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限取消该合同' });
  }
  if (!['pending', 'tenant_signed'].includes(contract.status)) {
    return res.status(400).json({ error: '当前状态不允许取消' });
  }

  db.run(
    'UPDATE contracts SET status = \'cancelled\' WHERE id = ? AND status IN (\'pending\', \'tenant_signed\')',
    [req.params.id]
  );
  if (db.getRowsModified() !== 1) {
    return res.status(409).json({ error: '合同状态已变化，无法取消' });
  }

  const listingRows = parseResult(db.exec('SELECT status FROM listings WHERE id = ?', [contract.listing_id]));
  const listingStatus = listingRows[0]?.status || '';
  if (listingStatus === 'locked') {
    const siblingContracts = parseResult(db.exec(
      `SELECT id, status FROM contracts
       WHERE listing_id = ? AND id <> ?`,
      [contract.listing_id, contract.id]
    ));
    const hasNonTerminal = siblingContracts.some((item) => !isTerminalStatus(item.status));
    if (!hasNonTerminal) {
      db.run(
        'UPDATE listings SET status = \'available\', updated_at = datetime(\'now\', \'+8 hours\') WHERE id = ? AND status = \'locked\'',
        [contract.listing_id]
      );
    }
  }
  saveDb();
  res.json({ success: true, message: '合同已取消' });
}));

// 函数 8: 获取合同支付记录接口。
router.get('/:id/payments', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限查看该合同支付记录' });
  }
  const payments = parseResult(db.exec(
    `SELECT id, contract_id, payer_id, pay_type, amount, period, tx_hash, status, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at DESC`,
    [req.params.id]
  ));
  res.json({ success: true, data: payments });
}));

// 函数 8-2: 下载合同 PDF。
router.get('/:id/pdf', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限下载该合同' });
  }
  const content = contract.content_json || {};
  const payments = parseResult(db.exec(
    `SELECT pay_type, amount, period, tx_hash, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at ASC`,
    [req.params.id]
  ));

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${contract.id}.pdf"`);
  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);
  const cnFontPath = resolvePdfChineseFontPath();
  if (cnFontPath) {
    try {
      doc.registerFont('cn', cnFontPath);
      doc.font('cn');
    } catch (error) {
      logSignFlow('contract.pdf.font-fallback', {
        contractId: req.params.id,
        requestId: req.requestId || '',
        message: error?.message || 'pdf_font_load_failed',
        fontPath: cnFontPath,
      });
    }
  }
  doc.fontSize(18).text('CCL 房屋租赁合同', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`合同编号：${contract.id}`);
  doc.text(`合同状态：${contract.status}`);
  doc.text(`合同版本：v${contract.version || 1}`);
  doc.text(`合同哈希：${contract.content_hash}`);
  doc.text(`链上交易哈希：${contract.tx_hash || '-'}`);
  doc.moveDown();
  doc.fontSize(13).text('合同主体');
  doc.fontSize(10).text(`租客：${content?.tenant?.nickname || content?.tenant?.id || '-'}（${content?.tenant?.walletAddress || '-'}）`);
  doc.text(`房东：${content?.landlord?.nickname || content?.landlord?.id || '-'}（${content?.landlord?.walletAddress || '-'}）`);
  doc.moveDown();
  doc.fontSize(13).text('合同条款');
  doc.fontSize(10).text(`房源：${content?.title || '-'} / ${content?.address || '-'}`);
  doc.text(`月租：${content?.rentAmount || '-'} ETH / 月`);
  doc.text(`首笔支付金额：${content?.oneTimeAmount || '-'} ETH`);
  doc.text(`租期：${content?.terms?.startDate || '-'} 至 ${content?.terms?.endDate || '-'}`);
  doc.moveDown();
  doc.fontSize(13).text('签署信息');
  doc.fontSize(10).text(`租客签署时间：${contract.tenant_signed_at || '-'}`);
  doc.text(`租客签署地址：${contract.tenant_signer_address || '-'}`);
  doc.text(`房东签署时间：${contract.landlord_signed_at || '-'}`);
  doc.text(`房东签署地址：${contract.landlord_signer_address || '-'}`);
  doc.moveDown();
  doc.fontSize(13).text('支付记录');
  if (payments.length === 0) {
    doc.fontSize(10).text('-');
  } else {
    payments.forEach((p) => {
      doc.fontSize(9).text(`${p.pay_type} | ${p.amount} ETH | ${p.period || '-'} | ${p.tx_hash} | ${p.paid_at}`);
    });
  }
  doc.moveDown();
  doc.fontSize(8).fillColor('gray').text('哈希算法：SHA-256（用于计算合同 content_hash）');
  doc.fontSize(8).fillColor('gray').text(`生成时间：${getCnDateTime(new Date())}`);
  doc.end();
}));

// 函数 8-3: 基于已签署合同创建正式修订合同。
router.post('/:id/revisions', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '原合同不存在' });
  const parent = rows[0];
  if (![parent.tenant_id, parent.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限修订该合同' });
  }
  if (!['active', 'ended'].includes(parent.status)) {
    return res.status(400).json({ error: '仅已生效或已结束合同可发起正式修订' });
  }
  const activeRevision = parseResult(db.exec(
    `SELECT id FROM contracts
     WHERE parent_contract_id = ?
       AND status NOT IN ('cancelled','expired','ended')
     LIMIT 1`,
    [parent.id]
  ));
  if (activeRevision.length > 0) return res.status(409).json({ error: '已有进行中的修订合同' });

  const content = JSON.parse(JSON.stringify(parent.content_json || {}));
  const revisionId = `cnt_rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const nextLeaseMonths = Number(req.body?.leaseMonths ?? content?.terms?.leaseMonths ?? 1);
  const nextStartDate = normalizeDateOnly(req.body?.startDate ?? content?.terms?.startDate) || getCnDateOnly(new Date());
  const nextRentAmount = normalizeAmount(req.body?.rentAmount ?? content.rentAmount);
  if (!Number.isInteger(nextLeaseMonths) || nextLeaseMonths < 1 || nextLeaseMonths > 12) {
    return res.status(400).json({ error: '租期必须为 1-12 月的整数' });
  }
  if (!nextRentAmount) return res.status(400).json({ error: '租金必须为大于 0 的数字' });
  content.contractId = revisionId;
  content.parentContractId = parent.id;
  content.rentAmount = nextRentAmount;
  content.oneTimeAmount = normalizeAmount(Number(nextRentAmount) * nextLeaseMonths);
  content.terms = {
    ...(content.terms || {}),
    startDate: nextStartDate,
    endDate: addMonthsDateOnly(nextStartDate, nextLeaseMonths),
    leaseMonths: nextLeaseMonths,
  };
  content.revision = {
    parentContractId: parent.id,
    createdBy: req.user.id,
    createdAt: getCnDateTime(new Date()),
    note: String(req.body?.changeNote || ''),
  };
  const contentJson = JSON.stringify(content, null, 2);
  const contentHash = makeContractContentHash(content);
  const expiresAt = getCnDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const nextVersion = Number(parent.version || 1) + 1;
  db.run(
    `INSERT INTO contracts (
      id, listing_id, tenant_id, landlord_id, content_json, content_hash, status, expires_at,
      negotiation_status, version, parent_contract_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 'finalized', ?, ?)`,
    [revisionId, parent.listing_id, parent.tenant_id, parent.landlord_id, contentJson, contentHash, expiresAt, nextVersion, parent.id]
  );
  db.run(
    `INSERT INTO contract_versions (id, contract_id, version, proposer_id, content_json, content_hash, change_note, status, decided_at, decided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', datetime('now', '+8 hours'), ?)`,
    [`cv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, revisionId, nextVersion, req.user.id, contentJson, contentHash, String(req.body?.changeNote || '正式修订'), req.user.id]
  );
  saveDb();
  res.json({ success: true, message: '修订合同已创建，请双方重新签署', data: { contractId: revisionId, contentHash } });
}));

// 函数 8-4: 提前解约申请。
router.post('/:id/terminations', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限发起提前解约' });
  }
  if (contract.status !== 'active') return res.status(400).json({ error: '仅已生效合同可提前解约' });
  const open = parseResult(db.exec(
    "SELECT id FROM contract_terminations WHERE contract_id = ? AND status = 'proposed' LIMIT 1",
    [req.params.id]
  ));
  if (open.length > 0) return res.status(409).json({ error: '已有待确认的解约申请' });
  const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  db.run(
    `INSERT INTO contract_terminations (id, contract_id, proposer_id, reason, settlement_json)
     VALUES (?, ?, ?, ?, ?)`,
    [id, req.params.id, req.user.id, String(req.body?.reason || '提前解约'), JSON.stringify(req.body?.settlement || {})]
  );
  saveDb();
  res.json({ success: true, message: '提前解约申请已提交', data: { terminationId: id } });
}));

router.get('/:id/terminations', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限查看提前解约记录' });
  }
  const terms = parseResult(db.exec(
    'SELECT * FROM contract_terminations WHERE contract_id = ? ORDER BY created_at DESC',
    [req.params.id]
  ));
  res.json({ success: true, data: terms });
}));

// 函数 8-5: 接受提前解约申请。
router.post('/:id/terminations/:terminationId/accept', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  const contract = rows[0];
  if (![contract.tenant_id, contract.landlord_id].includes(req.user.id)) {
    return res.status(403).json({ error: '无权限处理提前解约' });
  }
  const terms = parseResult(db.exec(
    "SELECT * FROM contract_terminations WHERE id = ? AND contract_id = ? AND status = 'proposed'",
    [req.params.terminationId, req.params.id]
  ));
  if (!terms.length) return res.status(404).json({ error: '待确认解约申请不存在' });
  const term = terms[0];
  if (term.proposer_id === req.user.id) return res.status(400).json({ error: '解约申请需由对方确认' });
  db.run("UPDATE contract_terminations SET status = 'accepted', decided_at = datetime('now', '+8 hours'), decided_by = ? WHERE id = ?", [req.user.id, req.params.terminationId]);
  db.run("UPDATE contracts SET status = 'ended' WHERE id = ? AND status = 'active'", [req.params.id]);
  db.run("UPDATE listings SET status = 'available', updated_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'rented'", [contract.listing_id]);
  saveDb();
  res.json({ success: true, message: '提前解约已确认，合同已结束' });
}));

// 函数 9: 前端签署失败上报接口。
router.post('/:id/sign-client-report', authMiddleware, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  logSignFlow('client.report', {
    contractId: req.params.id,
    userId: req.user.id,
    requestId: req.requestId,
    ...payload,
  });
  res.json({ success: true });
}));

// 函数 10: 获取我的合同列表接口。
router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id
    WHERE c.tenant_id = ? OR c.landlord_id = ? ORDER BY c.created_at DESC`, [req.user.id, req.user.id]));
  res.json({ success: true, data: rows });
}));

// 函数 11: 获取合同详情接口。
router.get('/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec(`SELECT c.*, l.title AS listing_title, l.address AS listing_address
    FROM contracts c JOIN listings l ON c.listing_id = l.id WHERE c.id = ?`, [req.params.id]));
  if (!rows.length) return res.status(404).json({ error: '合同不存在' });
  res.json({ success: true, data: rows[0] });
}));

module.exports = router;

