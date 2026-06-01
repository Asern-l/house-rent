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
  const paymentDeadlineMs = createdAtMs > 0 && Number.isFinite(Number(paymentWindowMs || 0))
    ? createdAtMs + Number(paymentWindowMs || 0)
    : 0;
  const paymentRecorded = statusEnum >= 2 && statusEnum !== 5;
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

function usage() {
  console.log([
    'Usage:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf <path> [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>]',
    '',
    'Example:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf D:\\contracts\\cnt_xxx.pdf --network sepolia',
  ].join('\n'));
}

function extractMarkersFromText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const pick = (name) => {
    const match = String(text || '').match(new RegExp(`${name}=([^\\r\\n\\)<>;]+)`));
    return match ? String(match[1] || '').trim() : '';
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
        value += next.replace(/\s+/g, '');
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
    'CCL Housing Contract Signature',
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

async function verifyContractPdfBuffer({ pdfBuffer, pdfPath = '', network = 'sepolia', rpcUrl = '', contractAddress = '' }) {
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

  const runtime = resolveRuntime(network, {
    network,
    'rpc-url': rpcUrl,
    'contract-address': contractAddress,
  });
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
  const listingVerification = markers.listingId
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
  const verified = Object.values(comparisons).every(Boolean) && (!listingVerification || listingVerification.verified);

  const output = {
    source: 'local-pdf',
    verificationMode: 'rebuild-hash-and-self-verify-signatures',
    network: runtime.network,
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

async function verifyContractPdfFile({ pdfPath, network = 'sepolia', rpcUrl = '', contractAddress = '' }) {
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
  verifyContractPdfBuffer,
  verifyContractPdfFile,
};
