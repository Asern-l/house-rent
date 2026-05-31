#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ethers } = require('../lib/deps');
const { parseArgs, resolveRuntime, ensureProviderReady } = require('../lib/runtime');
const { verifyListingLocally } = require('./verify-listing');

const CONTRACT_STATUS_ENUM_TO_TEXT = ['none', 'created', 'paid', 'active', 'completed', 'cancelled'];

function usage() {
  console.log([
    'Usage:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf <path> [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>]',
    '',
    'Example:',
    '  node verifier/scripts/verify-contract-pdf.js --pdf D:\\contracts\\cnt_xxx.pdf --network sepolia',
  ].join('\n'));
}

function extractMarkers(pdfBuffer) {
  const text = pdfBuffer.toString('latin1');
  const pick = (name) => {
    const match = text.match(new RegExp(`${name}=([^\\r\\n\\)<>;]+)`));
    return match ? String(match[1] || '').trim() : '';
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
  const markers = extractMarkers(pdfBuffer);
  if (!markers.contractId || !markers.contentHash) {
    throw new Error('missing VERIFY_CONTRACT_ID or VERIFY_CONTENT_HASH in PDF');
  }

  const runtime = resolveRuntime(network, {
    network,
    'rpc-url': rpcUrl,
    'contract-address': contractAddress,
  });
  const provider = new ethers.JsonRpcProvider(runtime.rpcUrl);
  await ensureProviderReady(provider, runtime.rpcUrl);
  const contract = new ethers.Contract(runtime.contractAddress, runtime.abi, provider);

  const result = await contract.getContractRecord(markers.contractId);
  const record = typeof result.toObject === 'function' ? result.toObject() : result;
  if (!record.exists) {
    throw new Error(`contract not found on chain: ${markers.contractId}`);
  }

  const events = await loadSignatureEvents(contract, provider, markers.contractId, markers.txHash);

  const tenantEvent = events.find((item) => item.role === 1);
  const landlordEvent = events.find((item) => item.role === 2);
  const createdTx = await loadContractCreatedMatch(contract, provider, markers.contractId, markers.txHash);
  const comparisons = {
    contractIdMatch: record.contractId === markers.contractId,
    listingIdMatch: !markers.listingId || String(record.listingId || '') === markers.listingId,
    contentHashMatch: String(record.contentHash || '').toLowerCase() === markers.contentHash,
    tenantSignerMatch: !markers.tenantSigner || String(record.tenant || '').toLowerCase() === markers.tenantSigner,
    landlordSignerMatch: !markers.landlordSigner || String(record.landlord || '').toLowerCase() === markers.landlordSigner,
    tenantMessageHashMatch: !markers.tenantMessageHash || String(record.tenantMessageHash || '').toLowerCase() === markers.tenantMessageHash,
    landlordMessageHashMatch: !markers.landlordMessageHash || String(record.landlordMessageHash || '').toLowerCase() === markers.landlordMessageHash,
    tenantSignatureEventMatch: !tenantEvent || String(record.tenantMessageHash || '').toLowerCase() === tenantEvent.messageHash,
    landlordSignatureEventMatch: !landlordEvent || String(record.landlordMessageHash || '').toLowerCase() === landlordEvent.messageHash,
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
    network: runtime.network,
    rpcUrl: runtime.rpcUrl,
    contractAddress: runtime.contractAddress,
    pdfPath,
    pdfMarkers: markers,
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
      tenantMessageHash: String(record.tenantMessageHash || '').toLowerCase(),
      landlordMessageHash: String(record.landlordMessageHash || '').toLowerCase(),
      tenantSignedAt: String(record.tenantSignedAt || ''),
      landlordSignedAt: String(record.landlordSignedAt || ''),
      statusEnum: Number(record.status || 0),
      status: CONTRACT_STATUS_ENUM_TO_TEXT[Number(record.status || 0)] || `unknown(${String(record.status)})`,
    },
    signatureEvents: events,
    listingVerification,
    comparisons,
    txHashReferenced: createdTx.match,
    verified,
    conclusion: verified
      ? 'Contract PDF markers match onchain contract record and listing history snapshot'
      : 'Contract PDF markers do not match onchain contract record or listing history snapshot',
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
