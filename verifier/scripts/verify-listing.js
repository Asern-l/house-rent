#!/usr/bin/env node
const crypto = require('crypto');
const { ethers } = require('../lib/deps');
const { readIpfsText, sha256Hex, buildGatewayUrl } = require('../lib/ipfs');
const {
  parseArgs,
  resolveRuntime,
  ensureProviderReady,
  estimateStartBlockFromTimestamp,
} = require('../lib/runtime');

const LISTING_STATUS_ENUM_TO_TEXT = ['available', 'offline', 'closed'];
const LISTING_FEEDBACK_CODE_TO_TYPE = {
  1: 'mismatch',
  2: 'photos',
  3: 'noise',
  4: 'communication',
  5: 'other',
};

function usage() {
  console.log([
    'Usage:',
    '  node verifier/scripts/verify-listing.js --listing-id <id> [--snapshot-cid <cid>] [--snapshot-hash <hash>] [--at-sec <unixSec>] [--network sepolia|local] [--rpc-url <url>] [--contract-address <addr>]',
    '',
    'Examples:',
    '  node verifier/scripts/verify-listing.js --listing-id lst_xxx --network sepolia',
    '  node verifier/scripts/verify-listing.js --listing-id lst_xxx --snapshot-cid bafy... --snapshot-hash 0x... --network sepolia',
    '  node verifier/scripts/verify-listing.js --listing-id lst_xxx --at-sec 1780209098 --network sepolia',
  ].join('\n'));
}

function trimLower(value) {
  return String(value || '').trim().toLowerCase();
}

function toWeiString(amountStr) {
  const raw = String(amountStr || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return '';
  const [intPart, fracPart = ''] = raw.split('.');
  const frac18 = `${fracPart}000000000000000000`.slice(0, 18);
  const wei = (BigInt(intPart) * (10n ** 18n)) + BigInt(frac18);
  return wei > 0n ? wei.toString() : '';
}

function calcImageRootHash(imageHashes) {
  if (!Array.isArray(imageHashes) || imageHashes.length === 0) return `0x${'0'.repeat(64)}`;
  const normalized = imageHashes.map((item) => trimLower(item));
  return `0x${crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`;
}

function calcListingContentHash(snapshot, landlordWallet) {
  const payload = {
    listingId: String(snapshot.listingId || snapshot.id || ''),
    landlordWallet: trimLower(landlordWallet),
    title: String(snapshot.title || '').trim(),
    description: String(snapshot.description || '').trim(),
    address: String(snapshot.address || '').trim(),
    district: String(snapshot.district || '').trim(),
    rentAmount: String(snapshot.rentAmount || '').trim(),
    minLeaseMonths: Number(snapshot.minLeaseMonths || 1),
    bedrooms: Number(snapshot.bedrooms || 1),
    livingrooms: Number(snapshot.livingrooms || 1),
    bathrooms: Number(snapshot.bathrooms || 1),
    area: Number(snapshot.area || 0),
    imageHashes: Array.isArray(snapshot.imageHashes) ? snapshot.imageHashes.map((item) => trimLower(item)) : [],
  };
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function normalizeEventArgs(args) {
  const obj = typeof args?.toObject === 'function' ? args.toObject() : (args || {});
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = (value && typeof value === 'object' && value._isIndexed) ? String(value.hash) : value;
  }
  return out;
}

async function queryListingSnapshotAnchors(contract, provider, listingId, targetSec = 0, startBlock = 0) {
  const latestBlock = await provider.getBlockNumber();
  const filter = contract.filters.ListingSnapshotAnchored(listingId);
  const chunkSize = 49_000;
  const hits = [];
  const minBlock = Math.max(0, Number(startBlock || 0));
  for (let toBlock = latestBlock; toBlock >= minBlock; toBlock -= chunkSize) {
    const fromBlock = Math.max(minBlock, toBlock - chunkSize + 1);
    const logs = await contract.queryFilter(filter, fromBlock, toBlock);
    for (const log of logs) {
      const args = normalizeEventArgs(log.args);
      const blockTime = Number(args.blockTime || 0);
      if (targetSec && blockTime > targetSec) continue;
      hits.push({
        listingId: String(args.listingId || ''),
        version: Number(args.version || 0),
        contentHash: trimLower(args.contentHash),
        snapshotHash: trimLower(args.snapshotHash),
        snapshotCid: String(args.snapshotCid || '').trim(),
        blockTime,
        blockNumber: Number(log.blockNumber || 0),
        txHash: String(log.transactionHash || '').toLowerCase(),
      });
    }
    if (hits.length > 0 && targetSec) break;
    if (fromBlock === minBlock) break;
  }
  hits.sort((a, b) => {
    if (b.blockTime !== a.blockTime) return b.blockTime - a.blockTime;
    return b.version - a.version;
  });
  return hits;
}

async function queryListingCommentEvents(contract, provider, listingId, startBlock = 0) {
  const latestBlock = await provider.getBlockNumber();
  const chunkSize = 49_000;
  const minBlock = Math.max(0, Number(startBlock || 0));
  const feedbacks = [];
  const reviews = [];

  for (let toBlock = latestBlock; toBlock >= minBlock; toBlock -= chunkSize) {
    const fromBlock = Math.max(minBlock, toBlock - chunkSize + 1);
    const feedbackLogs = await contract.queryFilter(contract.filters.ListingFeedbackSubmitted(listingId), fromBlock, toBlock);
    const reviewLogs = await contract.queryFilter(contract.filters.RentalReviewSubmitted(null, listingId), fromBlock, toBlock);

    for (const log of feedbackLogs) {
      const args = normalizeEventArgs(log.args);
      feedbacks.push({
        kind: 'listing_feedback',
        listingId: String(args.listingId || ''),
        sender: trimLower(args.sender),
        feedbackTypeCode: Number(args.feedbackType || 0),
        feedbackType: LISTING_FEEDBACK_CODE_TO_TYPE[Number(args.feedbackType || 0)] || `unknown(${String(args.feedbackType || '')})`,
        commentHash: trimLower(args.commentHash),
        commentCid: String(args.commentCid || '').trim(),
        createdAt: Number(args.createdAt || 0),
        blockNumber: Number(log.blockNumber || 0),
        txHash: String(log.transactionHash || '').toLowerCase(),
      });
    }

    for (const log of reviewLogs) {
      const args = normalizeEventArgs(log.args);
      reviews.push({
        kind: 'rental_review',
        contractId: String(args.contractId || ''),
        listingId: String(args.listingId || ''),
        tenant: trimLower(args.tenant),
        rating: Number(args.rating || 0),
        commentHash: trimLower(args.commentHash),
        commentCid: String(args.commentCid || '').trim(),
        ratedAt: Number(args.ratedAt || 0),
        blockNumber: Number(log.blockNumber || 0),
        txHash: String(log.transactionHash || '').toLowerCase(),
      });
    }

    if (fromBlock === minBlock) break;
  }

  feedbacks.sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return b.blockNumber - a.blockNumber;
  });
  reviews.sort((a, b) => {
    if (b.ratedAt !== a.ratedAt) return b.ratedAt - a.ratedAt;
    return b.blockNumber - a.blockNumber;
  });

  return { feedbacks, reviews };
}

async function verifyCommentMaterial(entry) {
  const commentCid = String(entry.commentCid || '').trim();
  const expectedHash = trimLower(entry.commentHash);
  if (!commentCid) {
    return {
      ...entry,
      gatewayUrl: '',
      text: '',
      textHash: '',
      available: false,
      hashMatch: false,
      verified: false,
      error: 'commentCid missing',
    };
  }

  try {
    const text = await readIpfsText(commentCid);
    const textHash = sha256Hex(text).toLowerCase();
    const hashMatch = !expectedHash || textHash === expectedHash;
    return {
      ...entry,
      gatewayUrl: buildGatewayUrl(commentCid),
      text,
      textHash,
      available: true,
      hashMatch,
      verified: hashMatch,
      error: '',
    };
  } catch (error) {
    return {
      ...entry,
      gatewayUrl: buildGatewayUrl(commentCid),
      text: '',
      textHash: '',
      available: false,
      hashMatch: false,
      verified: false,
      error: error.message || 'IPFS read failed',
    };
  }
}

async function buildCommentVerification(contract, provider, listingId, startBlock) {
  const commentEvents = await queryListingCommentEvents(contract, provider, listingId, startBlock);
  const feedbacks = await Promise.all(commentEvents.feedbacks.map(verifyCommentMaterial));
  const reviews = await Promise.all(commentEvents.reviews.map(verifyCommentMaterial));
  return {
    feedbacks,
    reviews,
    totals: {
      feedbackCount: feedbacks.length,
      reviewCount: reviews.length,
    },
    allVerified: [...feedbacks, ...reviews].every((item) => item.verified),
  };
}

async function verifyListingLocally({
  listingId,
  snapshotCid = '',
  expectedSnapshotHash = '',
  traceAtSec = 0,
  runtime = null,
  network = 'sepolia',
  rpcUrl = '',
  contractAddress = '',
}) {
  const ownRuntime = runtime || resolveRuntime(network, {
    network,
    'rpc-url': rpcUrl,
    'contract-address': contractAddress,
  });
  const provider = runtime?.provider || new ethers.JsonRpcProvider(ownRuntime.rpcUrl);
  if (!runtime?.provider) {
    await ensureProviderReady(provider, ownRuntime.rpcUrl);
  }
  const contract = runtime?.contract || new ethers.Contract(ownRuntime.contractAddress, ownRuntime.abi, provider);
  let historyStartBlock = 0;
  if (ownRuntime.deploymentMeta?.timestamp) {
    const deploymentSec = Math.floor(Date.parse(String(ownRuntime.deploymentMeta.timestamp || '')) / 1000);
    if (Number.isFinite(deploymentSec) && deploymentSec > 0) {
      historyStartBlock = await estimateStartBlockFromTimestamp(provider, deploymentSec);
    }
  }

  const result = await contract.getListing(listingId);
  const record = typeof result.toObject === 'function' ? result.toObject() : result;
  if (!record.exists) {
    throw new Error(`listing not found on chain: ${listingId}`);
  }

  const onchain = {
    listingId: String(record.listingId || ''),
    landlord: trimLower(record.landlord),
    contentHash: trimLower(record.contentHash),
    rentAmountWei: String(record.rentAmountWei || ''),
    minLeaseMonths: Number(record.minLeaseMonths || 0),
    imageRootHash: trimLower(record.imageRootHash),
    statusEnum: Number(record.status || 0),
    status: LISTING_STATUS_ENUM_TO_TEXT[Number(record.status || 0)] || `unknown(${String(record.status || '')})`,
    version: Number(record.version || 0),
    nonce: Number(record.nonce || 0),
    createdAt: String(record.createdAt || ''),
    updatedAt: String(record.updatedAt || ''),
  };

  const output = {
    source: traceAtSec ? 'local-listing-history' : (snapshotCid ? 'local-listing-and-ipfs' : 'local-listing-chain-only'),
    network: ownRuntime.network,
    rpcUrl: ownRuntime.rpcUrl,
    contractAddress: ownRuntime.contractAddress,
    listingId,
    traceAtSec: Number(traceAtSec || 0),
    onchain,
    snapshotCid: '',
    snapshotGatewayUrl: '',
    snapshot: null,
    snapshotHash: '',
    snapshotHashMatch: false,
    resolvedAnchor: null,
    comparisons: {
      listingIdMatch: onchain.listingId === listingId,
    },
    commentVerification: {
      feedbacks: [],
      reviews: [],
      totals: {
        feedbackCount: 0,
        reviewCount: 0,
      },
      allVerified: true,
    },
    verified: false,
    conclusion: '',
  };

  let resolvedSnapshotCid = String(snapshotCid || '').trim();
  let resolvedSnapshotHash = trimLower(expectedSnapshotHash);
  let anchor = null;
  if (traceAtSec) {
    const anchors = await queryListingSnapshotAnchors(
      contract,
      provider,
      listingId,
      Number(traceAtSec || 0),
      historyStartBlock,
    );
    anchor = anchors[0] || null;
    if (!anchor) {
      output.commentVerification = await buildCommentVerification(contract, provider, listingId, historyStartBlock);
      output.conclusion = 'No listing snapshot anchor was found at or before the requested timestamp';
      return output;
    }
    resolvedSnapshotCid = anchor.snapshotCid;
    resolvedSnapshotHash = anchor.snapshotHash;
    output.resolvedAnchor = anchor;
  }

  if (!resolvedSnapshotCid) {
    output.commentVerification = await buildCommentVerification(contract, provider, listingId, historyStartBlock);
    output.verified = Boolean(output.comparisons.listingIdMatch);
    output.conclusion = output.verified
      ? 'Verified onchain listing record; snapshot material was not supplied, so only chain-level listing verification was completed'
      : 'Onchain listing record does not match the requested listingId';
    return output;
  }

  const snapshotText = await readIpfsText(resolvedSnapshotCid);
  const snapshotHash = sha256Hex(snapshotText).toLowerCase();
  const snapshot = JSON.parse(snapshotText);
  const rebuiltContentHash = calcListingContentHash(snapshot, onchain.landlord).toLowerCase();
  const rebuiltImageRootHash = calcImageRootHash(Array.isArray(snapshot.imageHashes) ? snapshot.imageHashes : []).toLowerCase();
  const snapshotRentAmountWei = toWeiString(snapshot.rentAmount);
  const snapshotStatus = trimLower(snapshot.status);

  output.snapshotCid = resolvedSnapshotCid;
  output.snapshotGatewayUrl = buildGatewayUrl(resolvedSnapshotCid);
  output.snapshot = snapshot;
  output.snapshotHash = snapshotHash;
  output.snapshotHashMatch = !resolvedSnapshotHash || snapshotHash === resolvedSnapshotHash;
  output.commentVerification = await buildCommentVerification(contract, provider, listingId, historyStartBlock);

  if (anchor) {
    output.comparisons = {
      ...output.comparisons,
      snapshotListingIdMatch: String(snapshot.listingId || snapshot.id || '') === listingId,
      snapshotHashMatch: output.snapshotHashMatch,
      snapshotContentHashSelfMatch: trimLower(snapshot.contentHash) === rebuiltContentHash,
      snapshotToAnchorContentHashMatch: rebuiltContentHash === trimLower(anchor.contentHash),
      snapshotAnchorCidMatch: resolvedSnapshotCid === String(anchor.snapshotCid || '').trim(),
    };
    output.verified = Object.values(output.comparisons).every(Boolean);
    output.conclusion = output.verified
      ? 'Listing history snapshot matches the onchain snapshot anchor'
      : 'Listing history snapshot does not match the onchain snapshot anchor';
    return output;
  }

  output.comparisons = {
    ...output.comparisons,
    snapshotListingIdMatch: String(snapshot.listingId || snapshot.id || '') === listingId,
    snapshotContentHashSelfMatch: trimLower(snapshot.contentHash) === rebuiltContentHash,
    snapshotToOnchainContentHashMatch: rebuiltContentHash === onchain.contentHash,
    snapshotRentAmountWeiMatch: snapshotRentAmountWei === onchain.rentAmountWei,
    snapshotMinLeaseMonthsMatch: Number(snapshot.minLeaseMonths || 0) === onchain.minLeaseMonths,
    snapshotImageRootHashMatch: rebuiltImageRootHash === onchain.imageRootHash,
    snapshotStatusMatch: !snapshotStatus || snapshotStatus === onchain.status,
    snapshotHashMatch: output.snapshotHashMatch,
  };
  output.verified = Object.values(output.comparisons).every(Boolean);
  output.conclusion = output.verified
    ? 'Listing public snapshot matches the current onchain listing record'
    : 'Listing public snapshot does not match the current onchain listing record';

  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['listing-id']) {
    usage();
    process.exitCode = 1;
    return;
  }
  const runtime = resolveRuntime(args.network, args);
  const result = await verifyListingLocally({
    listingId: String(args['listing-id']).trim(),
    snapshotCid: String(args['snapshot-cid'] || '').trim(),
    expectedSnapshotHash: trimLower(args['snapshot-hash']),
    traceAtSec: Number(args['at-sec'] || 0),
    runtime,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[verify-listing-local] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  verifyListingLocally,
  queryListingSnapshotAnchors,
  queryListingCommentEvents,
};
