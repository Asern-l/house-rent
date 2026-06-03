#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { ethers } = require('../lib/deps');
const { parseArgs, resolveRuntime, ensureProviderReady } = require('../lib/runtime');
const { verifyListingLocally } = require('./verify-listing');

const CONTRACT_STATUS_ENUM_TO_TEXT = ['none', 'created', 'paid', 'active', 'completed', 'cancelled'];

function formatCnDateTime(msValue) {
  const ms = Number(msValue || 0);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

function toMsNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function deriveContractLifecycle({ record, paymentWindowMs }) {
  const nowMs = Date.now();
  const statusEnum = Number(record.status || 0);
  const createdAtMs = toMsNumber(record.createdAt) * 1000;
  const tenantSignedAtMs = toMsNumber(record.tenantSignedAt);
  const landlordSignedAtMs = toMsNumber(record.landlordSignedAt);
  const startAtMs = toMsNumber(record.startAtMs);
  const endAtMs = toMsNumber(record.endAtMs);
  const performanceGuaranteeWei = BigInt(String(record.performanceGuaranteeWei || '0'));
  const escrowTotalWei = BigInt(String(record.escrowTotalWei || '0'));
  const releasedWei = BigInt(String(record.releasedWei || '0'));
  const refundedWei = BigInt(String(record.refundedWei || '0'));
  const terminatedAtMs = toMsNumber(record.terminatedAtMs);
  const paymentDeadlineMs = createdAtMs > 0 && Number.isFinite(Number(paymentWindowMs || 0))
    ? createdAtMs + Number(paymentWindowMs || 0)
    : 0;
  const paymentSettledOnchain = performanceGuaranteeWei > 0n
    || escrowTotalWei > 0n
    || releasedWei > 0n
    || refundedWei > 0n
    || terminatedAtMs > 0;
  const paymentRecorded = (statusEnum >= 2 && statusEnum !== 5) || paymentSettledOnchain;
  const currentlyEffective = (statusEnum === 2 || statusEnum === 3) && startAtMs > 0 && endAtMs > 0 && startAtMs <= nowMs && nowMs < endAtMs;
  const futureEffective = (statusEnum === 2 || statusEnum === 3) && startAtMs > nowMs;
  const endedByTime = endAtMs > 0 && nowMs >= endAtMs;
  return {
    nowMs,
    createdAtMs,
    tenantSignedAtMs,
    landlordSignedAtMs,
    startAtMs,
    endAtMs,
    paymentDeadlineMs,
    paymentRecorded,
    currentlyEffective,
    futureEffective,
    endedByTime,
    paymentState: paymentRecorded ? '已付款' : '未付款',
    effectiveState: currentlyEffective
      ? '当前生效中'
      : futureEffective
        ? '已付款，待生效'
        : endedByTime
          ? '已过期/已结束'
          : '当前未生效',
  };
}

function deriveEmergencyRelease(record, runtime, contractId) {
  const statusEnum = Number(record.status || 0);
  const leaseMonths = Number(record.leaseMonths || 0);
  const releasedPeriods = Number(record.releasedPeriods || 0);
  const startAtMs = toMsNumber(record.startAtMs);
  const endAtMs = toMsNumber(record.endAtMs);
  const nowMs = Date.now();
  const escrowTotalWei = BigInt(String(record.escrowTotalWei || '0'));
  const releasedWei = BigInt(String(record.releasedWei || '0'));
  const refundedWei = BigInt(String(record.refundedWei || '0'));
  const remainingEscrowWei = escrowTotalWei - releasedWei - refundedWei;

  const result = {
    available: Boolean(runtime?.selectedConfigName),
    selectedConfigName: String(runtime?.selectedConfigName || '').trim(),
    contractId: String(contractId || '').trim(),
    chainId: Number(runtime?.deploymentMeta?.chainId || 0),
    rpcUrl: String(runtime?.rpcUrl || '').trim(),
    contractAddress: String(runtime?.contractAddress || '').trim(),
    landlord: String(record.landlord || '').toLowerCase(),
    status: CONTRACT_STATUS_ENUM_TO_TEXT[statusEnum] || `unknown(${statusEnum})`,
    leaseMonths,
    releasedPeriods,
    earnedPeriods: 0,
    releasablePeriods: 0,
    releasedWei: releasedWei.toString(),
    refundedWei: refundedWei.toString(),
    remainingEscrowWei: remainingEscrowWei > 0n ? remainingEscrowWei.toString() : '0',
    nextEligibleAtMs: '',
    nextEligibleAtCn: '',
    canReleaseNow: false,
    reasonCode: '',
    reasonMessage: '',
    preparedTx: null,
  };

  if (!result.selectedConfigName) {
    result.reasonCode = 'CONFIG_NOT_SAVED';
    result.reasonMessage = '当前合同未匹配到已保存的合约配置，请先在“合约配置”页保存并设为当前配置。';
    return result;
  }
  if (statusEnum !== 2 && statusEnum !== 3) {
    result.reasonCode = 'STATUS_NOT_RELEASABLE';
    result.reasonMessage = '当前合同状态不支持托管月租释放。';
    return result;
  }
  if (escrowTotalWei <= releasedWei || remainingEscrowWei <= 0n) {
    result.reasonCode = 'ESCROW_ALREADY_RELEASED';
    result.reasonMessage = '当前合同的托管月租已经全部释放或结清。';
    return result;
  }
  if (leaseMonths <= 0 || endAtMs <= startAtMs) {
    result.reasonCode = 'INVALID_RELEASE_SCHEDULE';
    result.reasonMessage = '当前合同缺少有效的托管释放计划。';
    return result;
  }

  let earnedPeriods = 0;
  if (nowMs > startAtMs) {
    if (nowMs >= endAtMs) {
      earnedPeriods = leaseMonths;
    } else {
      const totalRange = endAtMs - startAtMs;
      const elapsed = nowMs - startAtMs;
      earnedPeriods = Math.floor((elapsed * leaseMonths) / totalRange);
      if (earnedPeriods > leaseMonths) earnedPeriods = leaseMonths;
    }
  }
  result.earnedPeriods = earnedPeriods;
  result.releasablePeriods = Math.max(earnedPeriods - releasedPeriods, 0);

  if (result.releasablePeriods <= 0) {
    const nextPeriod = releasedPeriods + 1;
    if (nextPeriod <= leaseMonths) {
      const totalRange = endAtMs - startAtMs;
      const nextEligibleAtMs = startAtMs + Math.ceil((nextPeriod * totalRange) / leaseMonths);
      result.nextEligibleAtMs = String(nextEligibleAtMs);
      result.nextEligibleAtCn = formatCnDateTime(nextEligibleAtMs);
    }
    result.reasonCode = 'NO_RELEASABLE_RENT';
    result.reasonMessage = result.nextEligibleAtCn
      ? `当前还没有到本期托管月租可释放时间。下一次最早可释放时间：${result.nextEligibleAtCn}`
      : '当前还没有到本期托管月租可释放时间。';
    return result;
  }

  const iface = new ethers.Interface(runtime.abi || []);
  result.canReleaseNow = true;
  result.reasonCode = 'READY';
  result.reasonMessage = '当前合同已有可释放的托管月租，可由房东钱包应急触发释放。';
  result.preparedTx = {
    to: runtime.contractAddress,
    data: iface.encodeFunctionData('releaseDueRent', [result.contractId]),
    chainId: result.chainId,
    chainIdHex: `0x${result.chainId.toString(16)}`,
    rpcUrl: result.rpcUrl,
    configName: result.selectedConfigName,
  };
  return result;
}

function usage() {
  console.log([
    'Usage:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf <path> [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>] [--verify-listing 1]',
    '',
    'Example:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf D:\\contracts\\cnt_xxx.pdf --network sepolia',
  ].join('\n'));
}

function extractMarkersFromText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const isBase64Fragment = (value) => /^[A-Za-z0-9+/=]+$/.test(String(value || '').replace(/\s+/g, ''));
  const pick = (name) => {
    const matches = [...String(text || '').matchAll(new RegExp(`${name}=([^\\r\\n\\)<>;]+)`, 'g'))];
    if (!matches.length) return '';
    const match = matches[matches.length - 1];
    return String(match?.[1] || '').trim();
  };
  const pickChunkedBase64 = (prefix) => {
    const chunks = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || '');
      const match = line.match(new RegExp(`^${prefix}_(\\d{3})=(.*)$`));
      if (!match) continue;
      let value = String(match[2] || '').replace(/\s+/g, '');
      while (i + 1 < lines.length) {
        const next = String(lines[i + 1] || '');
        if (!next.trim()) break;
        if (/^VERIFY_[A-Z0-9_]+(?:_\d{3})?=/.test(next)) break;
        const compactNext = next.replace(/\s+/g, '');
        if (!isBase64Fragment(compactNext)) break;
        value += compactNext;
        i += 1;
      }
      chunks.push({
        index: Number(match[1] || 0),
        value,
      });
    }
    if (!chunks.length) return '';
    chunks.sort((a, b) => a.index - b.index);
    return chunks.map((item) => item.value).join('');
  };
  return {
    contractId: pick('VERIFY_CONTRACT_ID'),
    chainEnv: pick('VERIFY_CHAIN_ENV').toLowerCase(),
    chainId: pick('VERIFY_CHAIN_ID'),
    rpcUrl: pick('VERIFY_RENTAL_CHAIN_RPC_URL'),
    contractAddress: pick('VERIFY_RENTAL_CHAIN_ADDRESS'),
    chainDeployedAt: pick('VERIFY_RENTAL_CHAIN_DEPLOYED_AT'),
    contractCreatedAt: pick('VERIFY_CONTRACT_CREATED_AT'),
    contentHash: pick('VERIFY_CONTENT_HASH').toLowerCase(),
    txHash: pick('VERIFY_TX_HASH').toLowerCase(),
    listingId: pick('VERIFY_LISTING_ID'),
    listingSnapshotCid: pick('VERIFY_LISTING_SNAPSHOT_CID'),
    listingSnapshotHash: pick('VERIFY_LISTING_SNAPSHOT_HASH').toLowerCase(),
    tenantSigner: pick('VERIFY_TENANT_SIGNER').toLowerCase(),
    landlordSigner: pick('VERIFY_LANDLORD_SIGNER').toLowerCase(),
    tenantMessageHash: pick('VERIFY_TENANT_MESSAGE_HASH').toLowerCase(),
    landlordMessageHash: pick('VERIFY_LANDLORD_MESSAGE_HASH').toLowerCase(),
    contentJsonB64: pickChunkedBase64('VERIFY_CONTENT_JSON_B64'),
    tenantMessageB64: pickChunkedBase64('VERIFY_TENANT_MESSAGE_B64'),
    landlordMessageB64: pickChunkedBase64('VERIFY_LANDLORD_MESSAGE_B64'),
    tenantSignatureB64: pickChunkedBase64('VERIFY_TENANT_SIGNATURE_B64'),
    landlordSignatureB64: pickChunkedBase64('VERIFY_LANDLORD_SIGNATURE_B64'),
  };
}

function resolvePdfDrivenNetwork(markers, explicitNetwork) {
  const normalizedExplicit = String(explicitNetwork || '').trim().toLowerCase();
  if (normalizedExplicit === 'local' || normalizedExplicit === 'sepolia') return normalizedExplicit;
  const normalizedMarkerEnv = String(markers?.chainEnv || '').trim().toLowerCase();
  if (normalizedMarkerEnv === 'local' || normalizedMarkerEnv === 'sepolia') return normalizedMarkerEnv;
  const chainIdNum = Number(markers?.chainId || 0);
  if (chainIdNum === 31337) return 'local';
  if (chainIdNum === 11155111) return 'sepolia';
  return 'sepolia';
}

async function extractMarkers(pdfBuffer) {
  const rawText = pdfBuffer.toString('latin1');
  const rawMarkers = extractMarkersFromText(rawText);
  if (rawMarkers.contentJsonB64 && rawMarkers.tenantMessageB64 && rawMarkers.landlordMessageB64 && rawMarkers.tenantSignatureB64 && rawMarkers.landlordSignatureB64) {
    return rawMarkers;
  }
  const parser = new PDFParse({ data: pdfBuffer });
  const parsedText = await parser.getText();
  await parser.destroy();
  const textMarkers = extractMarkersFromText(parsedText?.text || '');
  return {
    ...rawMarkers,
    ...Object.fromEntries(Object.entries(textMarkers).filter(([, value]) => String(value || '').trim() !== '')),
  };
}

function decodeBase64Utf8(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return Buffer.from(raw, 'base64').toString('utf8');
}

function makeContractContentHash(content) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(content, null, 2)).digest('hex')}`;
}

function createSignMessage({ contractId, contentHash, role, signerAddress, timestamp, deadline }) {
  return [
    'Onchain Housing Contract Signature',
    `contractId:${contractId}`,
    `contentHash:${contentHash}`,
    `role:${role}`,
    `signer:${ethers.getAddress(signerAddress)}`,
    `timestamp:${timestamp}`,
    `deadline:${deadline}`,
  ].join('\n');
}

function parseSignMessageFields(message) {
  const parsed = {};
  for (const line of String(message || '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) parsed[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return parsed;
}

function verifyEmbeddedSignature({ role, signerAddress, message, signature, expectedContentHash }) {
  const normalizedSigner = String(signerAddress || '').trim().toLowerCase();
  const normalizedSignature = String(signature || '').trim();
  if (!normalizedSigner || !message || !normalizedSignature) {
    return {
      available: false,
      messagePresent: Boolean(message),
      signaturePresent: Boolean(normalizedSignature),
      signerPresent: Boolean(normalizedSigner),
      recoveredAddress: '',
      messageHash: '',
      signatureMatchesSigner: false,
      messageMatchesExpectedTemplate: false,
      verified: false,
      error: 'signature material missing',
    };
  }

  const parsed = parseSignMessageFields(message);
  const timestamp = Number(parsed.timestamp || 0);
  const deadline = Number(parsed.deadline || 0);
  const expectedMessage = createSignMessage({
    contractId: String(parsed.contractId || ''),
    contentHash: expectedContentHash,
    role,
    signerAddress,
    timestamp,
    deadline,
  });
  let recoveredAddress = '';
  let messageHash = '';
  try {
    recoveredAddress = ethers.verifyMessage(message, normalizedSignature).toLowerCase();
    messageHash = ethers.keccak256(ethers.toUtf8Bytes(String(message || '').trim())).toLowerCase();
  } catch (error) {
    return {
      available: true,
      messagePresent: true,
      signaturePresent: true,
      signerPresent: true,
      recoveredAddress: '',
      messageHash: '',
      signatureMatchesSigner: false,
      messageMatchesExpectedTemplate: false,
      verified: false,
      error: error.message || 'signature verification failed',
    };
  }

  const signatureMatchesSigner = recoveredAddress === normalizedSigner;
  const messageMatchesExpectedTemplate = String(message || '') === expectedMessage;
  return {
    available: true,
    messagePresent: true,
    signaturePresent: true,
    signerPresent: true,
    recoveredAddress,
    messageHash,
    signatureMatchesSigner,
    messageMatchesExpectedTemplate,
    verified: signatureMatchesSigner && messageMatchesExpectedTemplate,
    error: '',
  };
}

async function loadSignatureEvents(contract, provider, contractId, txHash) {
  if (txHash) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt.logs
        .map((log) => {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed?.name !== 'ContractSignatureAnchored') return null;
            const argsObject = typeof parsed.args?.toObject === 'function' ? parsed.args.toObject() : parsed.args;
            if (String(argsObject.contractId || '') !== contractId) return null;
            return {
              signer: String(argsObject.signer || '').toLowerCase(),
              messageHash: String(argsObject.messageHash || '').toLowerCase(),
              role: Number(argsObject.role || 0),
              signature: String(argsObject.signature || ''),
              signedAt: String(argsObject.signedAt || ''),
              txHash: String(log.transactionHash || '').toLowerCase(),
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  }

  const latestBlock = await provider.getBlockNumber();
  const chunkSize = 49_000;
  const events = [];
  const filter = contract.filters.ContractSignatureAnchored(contractId);
  for (let toBlock = latestBlock; toBlock >= 0; toBlock -= chunkSize) {
    const fromBlock = Math.max(0, toBlock - chunkSize + 1);
    const logs = await contract.queryFilter(filter, fromBlock, toBlock);
    events.push(...logs.map((log) => {
      const argsObject = typeof log.args?.toObject === 'function' ? log.args.toObject() : log.args;
      return {
        signer: String(argsObject.signer || '').toLowerCase(),
        messageHash: String(argsObject.messageHash || '').toLowerCase(),
        role: Number(argsObject.role || 0),
        signature: String(argsObject.signature || ''),
        signedAt: String(argsObject.signedAt || ''),
        txHash: String(log.transactionHash || '').toLowerCase(),
      };
    }));
    if (events.length > 0) break;
    if (fromBlock === 0) break;
  }
  return events;
}

async function loadContractCreatedMatch(contract, provider, contractId, txHash) {
  if (!txHash) return { checked: false, match: true };
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return { checked: true, match: false };
  const matched = receipt.logs.some((log) => {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name !== 'ContractCreated') return false;
      const argsObject = typeof parsed.args?.toObject === 'function' ? parsed.args.toObject() : parsed.args;
      return String(argsObject.contractId || '') === contractId;
    } catch {
      return false;
    }
  });
  return { checked: true, match: matched };
}

async function verifyContractPdfBuffer({ pdfBuffer, pdfPath = '', network = 'sepolia', configName = '', rpcUrl = '', contractAddress = '', verifyListing = false }) {
  const markers = await extractMarkers(pdfBuffer);
  if (!markers.contractId || !markers.contentHash) {
    throw new Error('missing VERIFY_CONTRACT_ID or VERIFY_CONTENT_HASH in PDF');
  }
  const canonicalContentJson = decodeBase64Utf8(markers.contentJsonB64);
  const tenantMessage = decodeBase64Utf8(markers.tenantMessageB64);
  const landlordMessage = decodeBase64Utf8(markers.landlordMessageB64);
  const tenantSignature = decodeBase64Utf8(markers.tenantSignatureB64);
  const landlordSignature = decodeBase64Utf8(markers.landlordSignatureB64);
  if (!canonicalContentJson || !tenantMessage || !landlordMessage || !tenantSignature || !landlordSignature) {
    throw new Error('pdf missing strong verification materials; please re-download a new contract PDF');
  }
  const canonicalContent = JSON.parse(canonicalContentJson);
  const rebuiltContentHash = makeContractContentHash(canonicalContent).toLowerCase();

  const selectedConfigName = String(configName || '').trim();
  const runtimeArgs = {
    'config-name': selectedConfigName,
    network: resolvePdfDrivenNetwork(markers, network),
    'contract-deployed-at': String(markers.chainDeployedAt || '').trim(),
  };
  if (!selectedConfigName) {
    runtimeArgs['chain-id'] = String(markers.chainId || '').trim();
    runtimeArgs['rpc-url'] = String(rpcUrl || '').trim() || String(markers.rpcUrl || '').trim();
    runtimeArgs['contract-address'] = String(contractAddress || '').trim() || String(markers.contractAddress || '').trim();
  }
  const runtime = resolveRuntime('', runtimeArgs);
  if (String(markers.chainDeployedAt || '').trim()) {
    runtime.deploymentMeta = {
      ...(runtime.deploymentMeta || {}),
      timestamp: String(markers.chainDeployedAt || '').trim(),
      source: 'pdf-marker',
    };
  }
  const provider = new ethers.JsonRpcProvider(runtime.rpcUrl);
  await ensureProviderReady(provider, runtime.rpcUrl);
  const contract = new ethers.Contract(runtime.contractAddress, runtime.abi, provider);
  const paymentWindowMs = await contract.paymentWindowMs();

  const result = await contract.getContractRecord(markers.contractId);
  const record = typeof result.toObject === 'function' ? result.toObject() : result;
  if (!record.exists) {
    throw new Error(`contract not found on chain: ${markers.contractId}`);
  }

  const events = await loadSignatureEvents(contract, provider, markers.contractId, markers.txHash);

  const tenantEvent = events.find((item) => item.role === 1);
  const landlordEvent = events.find((item) => item.role === 2);
  const createdTx = await loadContractCreatedMatch(contract, provider, markers.contractId, markers.txHash);
  const lifecycle = deriveContractLifecycle({ record, paymentWindowMs });
  const tenantSignatureVerification = verifyEmbeddedSignature({
    role: 'tenant',
    signerAddress: String(record.tenant || ''),
    message: tenantMessage,
    signature: tenantSignature,
    expectedContentHash: rebuiltContentHash || markers.contentHash,
  });
  const landlordSignatureVerification = verifyEmbeddedSignature({
    role: 'landlord',
    signerAddress: String(record.landlord || ''),
    message: landlordMessage,
    signature: landlordSignature,
    expectedContentHash: rebuiltContentHash || markers.contentHash,
  });
  const comparisons = {
    contractIdMatch: record.contractId === markers.contractId,
    listingIdMatch: !markers.listingId || String(record.listingId || '') === markers.listingId,
    contentHashMatch: String(record.contentHash || '').toLowerCase() === markers.contentHash,
    rebuiltContentHashMatch: rebuiltContentHash === String(record.contentHash || '').toLowerCase(),
    tenantSignerMatch: !markers.tenantSigner || String(record.tenant || '').toLowerCase() === markers.tenantSigner,
    landlordSignerMatch: !markers.landlordSigner || String(record.landlord || '').toLowerCase() === markers.landlordSigner,
    tenantMessageHashMatch: !markers.tenantMessageHash || String(record.tenantMessageHash || '').toLowerCase() === markers.tenantMessageHash,
    landlordMessageHashMatch: !markers.landlordMessageHash || String(record.landlordMessageHash || '').toLowerCase() === markers.landlordMessageHash,
    tenantSignatureEventMatch: !tenantEvent || String(record.tenantMessageHash || '').toLowerCase() === tenantEvent.messageHash,
    landlordSignatureEventMatch: !landlordEvent || String(record.landlordMessageHash || '').toLowerCase() === landlordEvent.messageHash,
    tenantSignatureSelfVerified: tenantSignatureVerification.verified,
    landlordSignatureSelfVerified: landlordSignatureVerification.verified,
    tenantRecoveredMessageHashMatch: tenantSignatureVerification.messageHash === String(record.tenantMessageHash || '').toLowerCase(),
    landlordRecoveredMessageHashMatch: landlordSignatureVerification.messageHash === String(record.landlordMessageHash || '').toLowerCase(),
  };
  const listingVerification = verifyListing && markers.listingId
    ? await verifyListingLocally({
        listingId: markers.listingId,
        traceAtSec: Number(record.createdAt || 0),
        runtime: {
          ...runtime,
          provider,
          contract,
        },
      })
    : null;
  const emergencyRelease = deriveEmergencyRelease(record, runtime, markers.contractId);
  const verified = Object.values(comparisons).every(Boolean) && (!listingVerification || listingVerification.verified);

  const output = {
    source: 'local-pdf',
    verificationMode: 'rebuild-hash-and-self-verify-signatures',
    network: runtime.network,
    selectedConfigName: runtime.selectedConfigName || '',
    chainId: runtime.deploymentMeta?.chainId || Number(markers.chainId || 0),
    rpcUrl: runtime.rpcUrl,
    contractAddress: runtime.contractAddress,
    pdfPath,
    pdfMarkers: markers,
    reconstructed: {
      contentJson: canonicalContent,
      contentHash: rebuiltContentHash,
      platformFeeBps: Number(canonicalContent?.platformFeeBps || 0),
      platformFeeAmount: String(canonicalContent?.platformFeeAmount || '0'),
      landlordNetAmount: String(canonicalContent?.landlordNetAmount || canonicalContent?.oneTimeAmount || '0'),
      tenantMessage,
      landlordMessage,
      tenantSignature,
      landlordSignature,
    },
    onchain: {
      contractId: String(record.contractId || ''),
      listingId: String(record.listingId || ''),
      parentContractId: String(record.parentContractId || ''),
      renewalChildContractId: String(record.renewalChildContractId || ''),
      tenant: String(record.tenant || '').toLowerCase(),
      landlord: String(record.landlord || '').toLowerCase(),
      contentHash: String(record.contentHash || '').toLowerCase(),
      initialAmountWei: String(record.initialAmountWei || ''),
      leaseMonths: String(record.leaseMonths || ''),
      escrowTotalWei: String(record.escrowTotalWei || ''),
      performanceGuaranteeWei: String(record.performanceGuaranteeWei || ''),
      monthlyReleaseWei: String(record.monthlyReleaseWei || ''),
      releasedWei: String(record.releasedWei || ''),
      refundedWei: String(record.refundedWei || ''),
      releasedPeriods: String(record.releasedPeriods || ''),
      terminatedAtMs: String(record.terminatedAtMs || ''),
      startAtMs: String(record.startAtMs || ''),
      endAtMs: String(record.endAtMs || ''),
      createdAtMs: String(lifecycle.createdAtMs || ''),
      tenantMessageHash: String(record.tenantMessageHash || '').toLowerCase(),
      landlordMessageHash: String(record.landlordMessageHash || '').toLowerCase(),
      tenantSignedAt: String(record.tenantSignedAt || ''),
      landlordSignedAt: String(record.landlordSignedAt || ''),
      statusEnum: Number(record.status || 0),
      status: CONTRACT_STATUS_ENUM_TO_TEXT[Number(record.status || 0)] || `unknown(${String(record.status)})`,
    },
    lifecycle: {
      paymentWindowMs: String(paymentWindowMs || ''),
      paymentRecorded: lifecycle.paymentRecorded,
      paymentState: lifecycle.paymentState,
      currentlyEffective: lifecycle.currentlyEffective,
      futureEffective: lifecycle.futureEffective,
      endedByTime: lifecycle.endedByTime,
      effectiveState: lifecycle.effectiveState,
      nowMs: String(lifecycle.nowMs || ''),
      createdAtMs: String(lifecycle.createdAtMs || ''),
      paymentDeadlineMs: String(lifecycle.paymentDeadlineMs || ''),
      tenantSignedAtMs: String(lifecycle.tenantSignedAtMs || ''),
      landlordSignedAtMs: String(lifecycle.landlordSignedAtMs || ''),
      startAtMs: String(lifecycle.startAtMs || ''),
      endAtMs: String(lifecycle.endAtMs || ''),
      nowCn: formatCnDateTime(lifecycle.nowMs),
      createdAtCn: formatCnDateTime(lifecycle.createdAtMs),
      paymentDeadlineCn: formatCnDateTime(lifecycle.paymentDeadlineMs),
      tenantSignedAtCn: formatCnDateTime(lifecycle.tenantSignedAtMs),
      landlordSignedAtCn: formatCnDateTime(lifecycle.landlordSignedAtMs),
      startAtCn: formatCnDateTime(lifecycle.startAtMs),
      endAtCn: formatCnDateTime(lifecycle.endAtMs),
    },
    signatureEvents: events,
    signatureVerification: {
      tenant: tenantSignatureVerification,
      landlord: landlordSignatureVerification,
    },
    emergencyRelease,
    listingVerification,
    comparisons,
    txHashReferenced: createdTx.match,
    verified,
    conclusion: verified
      ? 'Contract PDF content hash and signatures were independently reconstructed and match the onchain contract record'
      : 'Contract PDF reconstructed content hash or signatures do not match the onchain contract record',
  };

  return output;
}

async function verifyContractPdfFile({ pdfPath, network = 'sepolia', rpcUrl = '', contractAddress = '', verifyListing = false }) {
  const absPath = path.resolve(process.cwd(), pdfPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`pdf not found: ${absPath}`);
  }
  const pdfBuffer = fs.readFileSync(absPath);
  return verifyContractPdfBuffer({
    pdfBuffer,
    pdfPath: absPath,
    network,
    rpcUrl,
    contractAddress,
    verifyListing,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pdf) {
    usage();
    process.exitCode = 1;
    return;
  }

  const output = await verifyContractPdfFile({
    pdfPath: args.pdf,
    network: args.network || 'sepolia',
    rpcUrl: args['rpc-url'] || '',
    contractAddress: args['contract-address'] || '',
    verifyListing: String(args['verify-listing'] || '').trim() === '1',
  });

  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[verify-contract-pdf-local] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  extractMarkers,
  deriveEmergencyRelease,
  verifyContractPdfBuffer,
  verifyContractPdfFile,
};

