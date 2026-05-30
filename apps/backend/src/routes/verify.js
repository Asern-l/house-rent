/**
 * 文件说明：链上/链下验真路由。
 * 房源链上状态表达房源本体状态，租出/占用语义由合同链表达。
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getDb, saveDb, parseResult, CHAIN_ENV } = require('../db');
const { getUserDb, parseResult: parseUserResult } = require('../user-db');
const { getLatestOnchainStatus } = require('../onchain-operations');
const {
  normalizeListingBodyStatus,
  resolveListingPublicState,
} = require('../listing-public-state');

const RENTAL_CHAIN_ABI = require('../../../frontend/src/shared/blockchain/RentalChainABI.json');
const LISTING_ONCHAIN_KINDS = ['listing.create', 'listing.status', 'listing.terms'];
const CONTRACT_ONCHAIN_KINDS = ['contract.create'];

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ZERO_BYTES32 = `0x${'0'.repeat(64)}`;
const LISTING_STATUS_ENUM_TO_TEXT = ['available', 'offline', 'closed'];
const LISTING_STATUS_TEXT_TO_ENUM = { available: 0, offline: 1, closed: 2 };
const CONTRACT_STATUS_ENUM_TO_TEXT = ['none', 'created', 'paid', 'active', 'completed', 'cancelled'];

function getChainRuntime() {
  const rpcUrl = CHAIN_ENV === 'local'
    ? String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim()
    : String(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com').trim();
  const deployFile = CHAIN_ENV === 'local'
    ? path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json')
    : path.join(__dirname, '..', '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
  let contractAddress = '';
  if (fs.existsSync(deployFile)) {
    const deploy = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
    contractAddress = String(deploy.address || '').trim();
  }
  return { rpcUrl, contractAddress };
}

function parseJsonArray(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function toWeiString(amountStr) {
  const raw = String(amountStr || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [intPart, fracPart = ''] = raw.split('.');
  const frac18 = `${fracPart}000000000000000000`.slice(0, 18);
  const wei = (BigInt(intPart) * (10n ** 18n)) + BigInt(frac18);
  return wei > 0n ? wei.toString() : null;
}

function formatWeiToEthString(value) {
  try {
    const formatted = ethers.formatEther(BigInt(value || 0));
    return formatted.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '').trim();
  } catch {
    return '';
  }
}

function calcImageRootHash(imageHashes) {
  if (!Array.isArray(imageHashes) || imageHashes.length === 0) return ZERO_BYTES32;
  const normalized = imageHashes.map((x) => String(x || '').toLowerCase());
  return `0x${crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function calcListingContentHash({ listingId, landlordWallet, listing }) {
  const payload = {
    listingId: String(listingId || ''),
    landlordWallet: String(landlordWallet || '').toLowerCase(),
    title: String(listing.title || '').trim(),
    description: String(listing.description || '').trim(),
    address: String(listing.address || '').trim(),
    district: String(listing.district || '').trim(),
    rentAmount: String(listing.rent_amount || '').trim(),
    minLeaseMonths: Number(listing.min_lease_months || 1),
    bedrooms: Number(listing.bedrooms || 1),
    livingrooms: Number(listing.livingrooms || 1),
    bathrooms: Number(listing.bathrooms || 1),
    area: Number(listing.area || 0),
    imageHashes: parseJsonArray(listing.image_hashes).map((x) => String(x || '').toLowerCase()),
  };
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function normalizeAddress(value) {
  const raw = String(value || '').trim();
  return ethers.isAddress(raw) ? ethers.getAddress(raw).toLowerCase() : '';
}

async function getRentalContract() {
  const { rpcUrl, contractAddress } = getChainRuntime();
  if (!rpcUrl) return { readable: false, reason: 'RPC 未配置' };
  if (!ethers.isAddress(contractAddress)) return { readable: false, reason: '合约地址未配置或格式不正确' };
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return {
    readable: true,
    contractAddress,
    provider,
    contract: new ethers.Contract(contractAddress, RENTAL_CHAIN_ABI, provider),
  };
}

async function readOnchainListing(listingId) {
  const runtime = await getRentalContract();
  if (!runtime.readable) return runtime;
  const result = await runtime.contract.getListing(listingId);
  const data = typeof result.toObject === 'function' ? result.toObject() : result;
  if (!data.exists) return { readable: true, exists: false, contractAddress: runtime.contractAddress };
  return {
    readable: true,
    exists: true,
    contractAddress: runtime.contractAddress,
    listingId: String(data.listingId || ''),
    landlord: String(data.landlord || '').toLowerCase(),
    contentHash: String(data.contentHash || '').toLowerCase(),
    rentAmountWei: String(data.rentAmountWei || ''),
    minLeaseMonths: Number(data.minLeaseMonths || 0),
    imageRootHash: String(data.imageRootHash || '').toLowerCase(),
    statusEnum: Number(data.status || 0),
    status: LISTING_STATUS_ENUM_TO_TEXT[Number(data.status || 0)] || `unknown(${String(data.status)})`,
    version: Number(data.version || 0),
    nonce: Number(data.nonce || 0),
    createdAt: Number(data.createdAt || 0),
    updatedAt: Number(data.updatedAt || 0),
    chainHeadContractId: String(await runtime.contract.getContractChainHeadByListing(listingId) || ''),
    currentEffectiveContractId: String(await runtime.contract.getCurrentEffectiveContractByListing(listingId) || ''),
  };
}

function expectedListingBodyStatusEnum(listing) {
  return LISTING_STATUS_TEXT_TO_ENUM[normalizeListingBodyStatus(listing.status)];
}

function resolveDbListingContractMapping(db, listingId) {
  const chainHead = parseResult(db.exec(
    `SELECT id, status FROM contracts
     WHERE listing_id = ? AND COALESCE(parent_contract_id, '') = ''
       AND status NOT IN ('cancelled', 'expired', 'ended')
     ORDER BY created_at ASC LIMIT 1`,
    [listingId]
  ))[0] || null;
  const contracts = parseResult(db.exec(
    `SELECT id, status, content_json, expires_at, payment_deadline FROM contracts
     WHERE listing_id = ? AND status NOT IN ('cancelled', 'expired', 'ended')
      ORDER BY created_at DESC`,
    [listingId]
  ));
  const state = resolveListingPublicState({ status: 'available' }, contracts);
  return {
    chainHeadContractId: chainHead?.id || '',
    chainHeadContractStatus: chainHead?.status || '',
    currentEffectiveContractId: state.activeContract?.id || '',
    currentEffectiveContractStatus: state.activeContract?.status || '',
    publicStatus: state.publicStatus,
  };
}

function parseSignMessage(message) {
  const parsed = {};
  for (const line of String(message || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return parsed;
}

function buildMessageHash(message) {
  const raw = String(message || '').trim();
  return raw ? ethers.keccak256(ethers.toUtf8Bytes(raw)) : '';
}

function normalizeDateOnly(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function parseContractStartAtMsFromContent(content = {}) {
  const exact = Number(content?.renewal?.startAtMs || 0);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const dateOnly = normalizeDateOnly(content?.terms?.startDate);
  if (!dateOnly) return 0;
  const d = new Date(`${dateOnly}T00:00:00+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseContractEndAtMsFromContent(content = {}) {
  const dateOnly = normalizeDateOnly(content?.terms?.endDate);
  if (!dateOnly) return 0;
  const d = new Date(`${dateOnly}T23:59:59+08:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function deriveDbContractSemanticState(contract, content, hasInitialPayment, nowMs = Date.now()) {
  const status = String(contract?.status || '').trim().toLowerCase();
  const startAtMs = parseContractStartAtMsFromContent(content);
  const endAtMs = parseContractEndAtMsFromContent(content);
  const signDeadline = computeContractDeadlineMs(contract);
  const paymentDeadline = new Date(String(contract?.payment_deadline || '').trim().replace(' ', 'T')).getTime();
  const beforeStart = startAtMs > 0 && nowMs < startAtMs;
  const inRange = startAtMs > 0 && endAtMs > 0 && startAtMs <= nowMs && nowMs < endAtMs;
  const expiredByTime = endAtMs > 0 && nowMs >= endAtMs;

  let semanticState = 'inactive';
  if (status === 'pending' || status === 'tenant_signed') {
    semanticState = signDeadline > nowMs ? 'signing' : 'expired';
  } else if (status === 'pending_payment') {
    semanticState = Number.isFinite(paymentDeadline) && paymentDeadline > nowMs ? 'pending_payment' : 'expired';
  } else if (hasInitialPayment || status === 'active' || status === 'ended') {
    if (expiredByTime) semanticState = 'expired';
    else if (beforeStart) semanticState = 'future_reserved';
    else if (inRange) semanticState = 'effective';
  } else if (status === 'expired') {
    semanticState = 'expired';
  }

  return {
    semanticState,
    currentEffective: semanticState === 'effective',
    startAtMs: String(startAtMs || ''),
    endAtMs: String(endAtMs || ''),
  };
}

function deriveOnchainContractSemanticState(onchain, nowMs = Date.now()) {
  if (!onchain?.exists) {
    return {
      semanticState: 'missing',
      currentEffective: false,
      startAtMs: String(onchain?.startAtMs || ''),
      endAtMs: String(onchain?.endAtMs || ''),
    };
  }
  const status = String(onchain.status || '').trim().toLowerCase();
  const startAtMs = Number(onchain.startAtMs || 0);
  const endAtMs = Number(onchain.endAtMs || 0);
  const beforeStart = startAtMs > 0 && nowMs < startAtMs;
  const inRange = startAtMs > 0 && endAtMs > 0 && startAtMs <= nowMs && nowMs < endAtMs;
  const expiredByTime = endAtMs > 0 && nowMs >= endAtMs;

  let semanticState = 'inactive';
  if (status === 'created') semanticState = 'pending_payment';
  else if (status === 'paid' || status === 'active') {
    if (expiredByTime) semanticState = 'expired';
    else if (beforeStart) semanticState = 'future_reserved';
    else if (inRange) semanticState = 'effective';
  } else if (status === 'completed' || status === 'cancelled') {
    semanticState = expiredByTime ? 'expired' : 'inactive';
  }

  return {
    semanticState,
    currentEffective: semanticState === 'effective',
    startAtMs: String(startAtMs || ''),
    endAtMs: String(endAtMs || ''),
  };
}

function normalizeIndexedStringHash(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'object' && value.hash) return String(value.hash || '').toLowerCase();
  return String(value || '').toLowerCase();
}

function computeContractDeadlineMs(contract) {
  const raw = String(contract?.created_at || '').trim();
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime() + 26 * 60 * 60 * 1000;
}

function verifyStoredContractSignature({ contract, content, role }) {
  const isTenant = role === 'tenant';
  const message = String((isTenant ? contract.tenant_signature_message : contract.landlord_signature_message) || '');
  const signature = String((isTenant ? contract.tenant_signature : contract.landlord_signature) || '');
  const submittedSigner = String((isTenant ? contract.tenant_signer_address : contract.landlord_signer_address) || '');
  const expectedSigner = normalizeAddress(isTenant ? content?.tenant?.walletAddress : content?.landlord?.walletAddress);
  const parsed = parseSignMessage(message);
  const expectedDeadline = computeContractDeadlineMs(contract);
  const messageHash = buildMessageHash(message);

  let recoveredAddress = '';
  let signatureValid = false;
  let error = '';
  try {
    if (!message || !/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error('签名或签名消息缺失');
    recoveredAddress = ethers.verifyMessage(message, signature).toLowerCase();
    signatureValid = true;
  } catch (err) {
    error = err?.message || '签名验签失败';
  }

  const signerMatch = Boolean(signatureValid && expectedSigner && recoveredAddress === expectedSigner);
  const submittedSignerMatch = !submittedSigner || !expectedSigner || normalizeAddress(submittedSigner) === expectedSigner;
  const messageFieldsMatch = (
    String(parsed.contractId || '') === String(contract.id || '') &&
    String(parsed.contentHash || '').toLowerCase() === String(contract.content_hash || '').toLowerCase() &&
    String(parsed.role || '') === role &&
    normalizeAddress(parsed.signer || '') === expectedSigner &&
    Number(parsed.deadline || 0) === expectedDeadline
  );
  return {
    role,
    messageHash,
    expectedSigner,
    submittedSigner: normalizeAddress(submittedSigner),
    recoveredAddress,
    signatureValid,
    signerMatch,
    submittedSignerMatch,
    messageFieldsMatch,
    verified: Boolean(signatureValid && signerMatch && submittedSignerMatch && messageFieldsMatch),
    error,
  };
}

async function readOnchainContractVerification(contractId, txHash) {
  const runtime = await getRentalContract();
  if (!runtime.readable) return runtime;
  const record = await runtime.contract.getContractRecord(contractId);
  const data = typeof record.toObject === 'function' ? record.toObject() : record;
  const onchain = {
    readable: true,
    exists: Boolean(data.exists),
    contractAddress: runtime.contractAddress,
    contractId: String(data.contractId || ''),
    listingId: String(data.listingId || ''),
    parentContractId: String(data.parentContractId || ''),
    renewalChildContractId: String(data.renewalChildContractId || ''),
    tenant: String(data.tenant || '').toLowerCase(),
    landlord: String(data.landlord || '').toLowerCase(),
    contentHash: String(data.contentHash || '').toLowerCase(),
    initialAmountWei: String(data.initialAmountWei || ''),
    startAtMs: String(data.startAtMs || ''),
    endAtMs: String(data.endAtMs || ''),
    createdAt: Number(data.createdAt || 0),
    tenantMessageHash: String(data.tenantMessageHash || '').toLowerCase(),
    landlordMessageHash: String(data.landlordMessageHash || '').toLowerCase(),
    tenantSignedAt: String(data.tenantSignedAt || ''),
    landlordSignedAt: String(data.landlordSignedAt || ''),
    statusEnum: Number(data.status || 0),
    status: CONTRACT_STATUS_ENUM_TO_TEXT[Number(data.status || 0)] || `unknown(${String(data.status)})`,
    signatureEvents: [],
  };
  if (/^0x[a-fA-F0-9]{64}$/.test(String(txHash || ''))) {
    const receipt = await runtime.provider.getTransactionReceipt(txHash);
    for (const log of receipt?.logs || []) {
      if (String(log.address || '').toLowerCase() !== runtime.contractAddress.toLowerCase()) continue;
      try {
        const parsed = runtime.contract.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name !== 'ContractSignatureAnchored') continue;
        const args = typeof parsed.args.toObject === 'function' ? parsed.args.toObject() : parsed.args;
        onchain.signatureEvents.push({
          contractIdHash: normalizeIndexedStringHash(args.contractId),
          signer: String(args.signer || '').toLowerCase(),
          messageHash: String(args.messageHash || '').toLowerCase(),
          role: Number(args.role || 0),
          signature: String(args.signature || ''),
          signedAt: String(args.signedAt || ''),
        });
      } catch {
        // ignore
      }
    }
  }
  return onchain;
}

router.get('/listing/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const userDb = await getUserDb();
  let rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.json({ success: true, data: { exists: false, message: '房源不存在' } });

  let listing = rows[0];
  const landlordRows = parseUserResult(userDb.exec('SELECT wallet_address FROM users WHERE id = ?', [listing.landlord_id]));
  const landlordWallet = String(landlordRows[0]?.wallet_address || '').trim().toLowerCase();
  const imageHashes = parseJsonArray(listing.image_hashes);
  const imageUrls = parseJsonArray(listing.image_urls);
  const expectedRentAmountWei = toWeiString(listing.rent_amount) || '';
  const expectedImageRootHash = calcImageRootHash(imageHashes);
  const rebuiltContentHash = calcListingContentHash({ listingId: listing.id, landlordWallet, listing });
  const dbContentHash = String(listing.content_hash || '').trim().toLowerCase() || rebuiltContentHash;
  const dbContractMapping = resolveDbListingContractMapping(db, listing.id);
  if (!String(listing.content_hash || '').trim() && /^0x[a-f0-9]{64}$/i.test(rebuiltContentHash)) {
    db.run("UPDATE listings SET content_hash = ?, updated_at = datetime('now', '+8 hours') WHERE id = ?", [rebuiltContentHash, listing.id]);
    saveDb();
    listing.content_hash = rebuiltContentHash;
  }

let onchain = null;
  try {
    onchain = await readOnchainListing(listing.id);
  } catch (error) {
    onchain = { readable: false, reason: error?.message || '读取链上房源失败' };
  }
  if (onchain?.exists) {
    const nextStatus = String(onchain.status || '').trim().toLowerCase();
    const nextRentAmount = formatWeiToEthString(onchain.rentAmountWei);
    const nextMinLeaseMonths = Number(onchain.minLeaseMonths || 0);
    const nextContentHash = String(onchain.contentHash || '').trim().toLowerCase();
    const nextVersion = Number(onchain.version || 0);
    const nextNonce = Number(onchain.nonce || 0);
    const shouldSync =
      nextVersion > Number(listing.chain_version || 0) ||
      nextNonce > Number(listing.chain_nonce || 0) ||
      nextStatus !== String(listing.status || '').trim().toLowerCase() ||
      (nextRentAmount && nextRentAmount !== String(listing.rent_amount || '').trim()) ||
      (nextMinLeaseMonths > 0 && nextMinLeaseMonths !== Number(listing.min_lease_months || 0)) ||
      (nextContentHash && nextContentHash !== String(listing.content_hash || '').trim().toLowerCase());
    if (shouldSync) {
      db.run(
        `UPDATE listings
         SET status = ?,
             rent_amount = CASE WHEN ? <> '' THEN ? ELSE rent_amount END,
             min_lease_months = CASE WHEN ? > 0 THEN ? ELSE min_lease_months END,
             content_hash = CASE WHEN ? <> '' THEN ? ELSE content_hash END,
             chain_version = CASE WHEN ? > chain_version THEN ? ELSE chain_version END,
             chain_nonce = CASE WHEN ? > chain_nonce THEN ? ELSE chain_nonce END,
             updated_at = datetime('now', '+8 hours')
         WHERE id = ?`,
        [
          nextStatus,
          nextRentAmount,
          nextRentAmount,
          nextMinLeaseMonths,
          nextMinLeaseMonths,
          nextContentHash,
          nextContentHash,
          nextVersion,
          nextVersion,
          nextNonce,
          nextNonce,
          listing.id,
        ]
      );
      saveDb();
      rows = parseResult(db.exec('SELECT * FROM listings WHERE id = ?', [req.params.id]));
      listing = rows[0];
    }
  }
  const syncedImageHashes = parseJsonArray(listing.image_hashes);
  const syncedImageUrls = parseJsonArray(listing.image_urls);
  const syncedRentAmountWei = toWeiString(listing.rent_amount) || '';
  const syncedImageRootHash = calcImageRootHash(syncedImageHashes);
  const syncedRebuiltContentHash = calcListingContentHash({ listingId: listing.id, landlordWallet, listing });
  const syncedDbContentHash = String(listing.content_hash || '').trim().toLowerCase() || syncedRebuiltContentHash;
  const syncedDbContractMapping = resolveDbListingContractMapping(db, listing.id);
  const listingOnchainStatus = getLatestOnchainStatus(db, 'listing', listing.id, LISTING_ONCHAIN_KINDS);
  const comparisons = onchain?.exists ? {
    listingIdMatch: String(onchain.listingId || '') === String(listing.id || ''),
    landlordMatch: !landlordWallet || String(onchain.landlord || '') === landlordWallet,
    contentHashMatch: String(onchain.contentHash || '') === syncedDbContentHash,
    rentAmountWeiMatch: String(onchain.rentAmountWei || '') === String(syncedRentAmountWei || ''),
    minLeaseMonthsMatch: Number(onchain.minLeaseMonths || 0) === Number(listing.min_lease_months || 0),
    imageRootHashMatch: String(onchain.imageRootHash || '') === String(syncedImageRootHash || '').toLowerCase(),
    listingStatusMatch: Number(onchain.statusEnum || 0) === Number(expectedListingBodyStatusEnum(listing) ?? -1),
    occupancyMatch: syncedDbContractMapping.publicStatus === 'rented'
      ? String(onchain.currentEffectiveContractId || '').trim() === String(syncedDbContractMapping.currentEffectiveContractId || '').trim()
      : !String(onchain.currentEffectiveContractId || '').trim(),
    versionMatch: Number(onchain.version || 0) === Number(listing.chain_version || 0),
    nonceMatch: Number(onchain.nonce || 0) === Number(listing.chain_nonce || 0),
  } : null;
  const chainVerified = Boolean(comparisons) && Object.values(comparisons).every(Boolean);
  const conclusion = !onchain?.readable
    ? `当前网络链上数据不可读：${onchain?.reason || '未知原因'}`
    : !onchain?.exists
      ? '数据库存在该房源，但链上未查询到对应房源'
      : chainVerified
        ? '房源链上关键字段与数据库快照一致'
        : '房源链上字段与数据库快照存在差异，请人工复核';

  res.json({
    success: true,
    data: {
      exists: true,
      chainEnv: CHAIN_ENV,
      listingId: listing.id,
      dbSnapshot: {
        listingId: listing.id,
        landlordWallet,
        status: listing.status,
        publicStatus: syncedDbContractMapping.publicStatus,
        contentHash: syncedDbContentHash,
        rentAmount: listing.rent_amount,
        rentAmountWei: syncedRentAmountWei,
        minLeaseMonths: Number(listing.min_lease_months || 0),
        imageCount: syncedImageUrls.length,
        imageHashes: syncedImageHashes,
        imageRootHash: syncedImageRootHash,
        txHash: listing.tx_hash || '',
        onchainState: listingOnchainStatus.status,
        chainVersion: Number(listing.chain_version || 0),
        chainNonce: Number(listing.chain_nonce || 0),
        chainBlockNumber: Number(listing.chain_block_number || 0),
        chainBlockTime: Number(listing.chain_block_time || 0),
        contractMapping: syncedDbContractMapping,
        createdAt: listing.created_at,
        updatedAt: listing.updated_at,
      },
      onchain,
      comparisons,
      chainVerified,
      conclusion,
    },
  });
}));

router.get('/contract/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const rows = parseResult(db.exec('SELECT * FROM contracts WHERE id = ?', [req.params.id]));
  if (!rows.length) return res.json({ success: true, data: { exists: false, message: '合同不存在' } });

  const contract = rows[0];
  const contractOnchainStatus = getLatestOnchainStatus(db, 'contract', contract.id, CONTRACT_ONCHAIN_KINDS);
  const content = typeof contract.content_json === 'string' ? JSON.parse(contract.content_json) : contract.content_json || {};
  const contentStr = typeof contract.content_json === 'string' ? contract.content_json : JSON.stringify(contract.content_json, null, 2);
  const currentHash = `0x${crypto.createHash('sha256').update(contentStr).digest('hex')}`;
  const hashMatch = currentHash === contract.content_hash;
  const tenantSignature = verifyStoredContractSignature({ contract, content, role: 'tenant' });
  const landlordSignature = verifyStoredContractSignature({ contract, content, role: 'landlord' });
  const signatureVerification = {
    tenant: tenantSignature,
    landlord: landlordSignature,
    allSignaturesValid: Boolean(tenantSignature.verified && landlordSignature.verified),
  };

  let onchain = null;
  try {
    onchain = await readOnchainContractVerification(contract.id, contract.tx_hash || '');
  } catch (error) {
    onchain = { readable: false, reason: error?.message || '读取链上合同失败' };
  }
  const tenantEvent = (onchain?.signatureEvents || []).find((item) => item.role === 1);
  const landlordEvent = (onchain?.signatureEvents || []).find((item) => item.role === 2);
  const expectedContractIdHash = ethers.id(String(contract.id || '')).toLowerCase();
  const onchainComparisons = onchain?.exists ? {
    contractIdMatch: String(onchain.contractId || '') === String(contract.id || ''),
    listingIdMatch: String(onchain.listingId || '') === String(contract.listing_id || ''),
    tenantMatch: String(onchain.tenant || '') === normalizeAddress(content?.tenant?.walletAddress),
    landlordMatch: String(onchain.landlord || '') === normalizeAddress(content?.landlord?.walletAddress),
    contentHashMatch: String(onchain.contentHash || '') === String(contract.content_hash || '').toLowerCase(),
    tenantMessageHashMatch: String(onchain.tenantMessageHash || '') === String(tenantSignature.messageHash || '').toLowerCase(),
    landlordMessageHashMatch: String(onchain.landlordMessageHash || '') === String(landlordSignature.messageHash || '').toLowerCase(),
    tenantSignatureEventMatch: tenantEvent
      ? tenantEvent.contractIdHash === expectedContractIdHash &&
        tenantEvent.signer === normalizeAddress(content?.tenant?.walletAddress) &&
        tenantEvent.messageHash === String(tenantSignature.messageHash || '').toLowerCase() &&
        tenantEvent.signature.toLowerCase() === String(contract.tenant_signature || '').toLowerCase()
      : false,
    landlordSignatureEventMatch: landlordEvent
      ? landlordEvent.contractIdHash === expectedContractIdHash &&
        landlordEvent.signer === normalizeAddress(content?.landlord?.walletAddress) &&
        landlordEvent.messageHash === String(landlordSignature.messageHash || '').toLowerCase() &&
        landlordEvent.signature.toLowerCase() === String(contract.landlord_signature || '').toLowerCase()
      : false,
  } : null;
  const onchainAnchored = Boolean(onchainComparisons) && Object.values(onchainComparisons).every(Boolean);
  const payments = parseResult(db.exec(
    `SELECT id, pay_type, amount, tx_hash, status, paid_at
     FROM payments
     WHERE contract_id = ?
     ORDER BY paid_at DESC`,
    [contract.id]
  ));
  const initialPayment = payments.find((item) => item.pay_type === 'initial' && item.status === 'confirmed') || null;
  const isEffectiveByPayment = Boolean(initialPayment);
  const dbSemantic = deriveDbContractSemanticState(contract, content, isEffectiveByPayment);
  const onchainSemantic = deriveOnchainContractSemanticState(onchain);
  const semanticMatch = !onchain?.exists || dbSemantic.semanticState === onchainSemantic.semanticState;
  const lazyReleaseState = Boolean(
    onchain?.exists
    && String(contract.status || '').trim().toLowerCase() === 'ended'
    && String(onchain?.status || '').trim().toLowerCase() === 'active'
    && dbSemantic.semanticState === 'expired'
    && onchainSemantic.semanticState === 'expired'
  );
  const verificationPassed = Boolean(
    hashMatch
    && signatureVerification.allSignaturesValid
    && (onchainAnchored || !contract.tx_hash)
    && semanticMatch
  );

  res.json({
    success: true,
    data: {
      exists: true,
      chainEnv: CHAIN_ENV,
      contractId: contract.id,
      listingId: contract.listing_id || '',
      status: contract.status,
      onchainState: contractOnchainStatus.status,
      storedHash: contract.content_hash,
      currentHash,
      hashMatch,
      hashAlgorithm: 'SHA-256',
      txHash: contract.tx_hash || '未上链',
      paymentVerified: isEffectiveByPayment,
      signatureVerification,
      onchain,
      onchainComparisons,
      onchainAnchored,
      semanticVerification: {
        dbSemanticState: dbSemantic.semanticState,
        onchainSemanticState: onchainSemantic.semanticState,
        semanticMatch,
        lazyReleaseState,
        dbCurrentEffective: dbSemantic.currentEffective,
        onchainCurrentEffective: onchainSemantic.currentEffective,
        startAtMs: dbSemantic.startAtMs || onchainSemantic.startAtMs,
        endAtMs: dbSemantic.endAtMs || onchainSemantic.endAtMs,
      },
      initialPayment: initialPayment ? {
        id: initialPayment.id,
        amount: initialPayment.amount,
        txHash: initialPayment.tx_hash,
        status: initialPayment.status,
        paidAt: initialPayment.paid_at,
      } : null,
      paymentCount: payments.length,
      createdAt: contract.created_at,
      updatedAt: contract.updated_at,
      conclusion: verificationPassed
        ? (lazyReleaseState
          ? '合同哈希、签名与链上锚定均通过；当前属于懒释放状态，数据库已结束、链上仍为 Active，但按时间语义双方一致视为已过期'
          : '合同内容、双方签名、链上锚定与时间语义校验通过')
        : '合同哈希、签名、链上锚定或时间语义存在不一致，请人工复核',
    },
  });
}));

module.exports = router;
