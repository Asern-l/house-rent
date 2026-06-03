const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { ethers } = require('ethers');
const { CHAIN_ENV } = require('./db');

const DEPLOY_FILE_LOCAL = path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-localhost.json');
const DEPLOY_FILE_SEPOLIA = path.join(__dirname, '..', '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
const CHAIN_ID_MAP = {
  local: 31337n,
  localhost: 31337n,
  sepolia: 11155111n,
};
const PERMIT_TTL_MS = Math.max(60 * 1000, Number(process.env.PERMIT_TTL_MS || 10 * 60 * 1000));

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const ACTIONS = {
  CREATE_LISTING: 'createListing',
  UPDATE_LISTING_TERMS: 'updateListingTerms',
  SET_LISTING_STATUS: 'setListingStatus',
  CREATE_CONTRACT: 'createContractRecord',
  RECORD_INITIAL_PAYMENT: 'recordInitialRentPayment',
  SUBMIT_RENTAL_REVIEW: 'submitRentalReview',
  SUBMIT_LISTING_FEEDBACK: 'submitListingFeedback',
};

function getDeployFilePath(chainEnv = CHAIN_ENV) {
  return String(chainEnv || '').trim() === 'local' ? DEPLOY_FILE_LOCAL : DEPLOY_FILE_SEPOLIA;
}

function loadDeployment(chainEnv = CHAIN_ENV) {
  const file = getDeployFilePath(chainEnv);
  if (!fs.existsSync(file)) {
    throw new Error(`deployment file missing: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getChainId(chainEnv = CHAIN_ENV) {
  const id = CHAIN_ID_MAP[String(chainEnv || '').trim()];
  if (!id) throw new Error(`unsupported chain env: ${chainEnv}`);
  return id;
}

function normalizePrivateKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const body = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(body)) return '';
  return `0x${body}`;
}

function readFallbackPrivateKeyFromBlockchainEnv() {
  try {
    const envPath = path.join(__dirname, '..', '..', '..', 'blockchain', '.env');
    if (!fs.existsSync(envPath)) return '';
    const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    return normalizePrivateKey(parsed.TRUSTED_SIGNER_PRIVATE_KEY || parsed.PRIVATE_KEY || '');
  } catch {
    return '';
  }
}

function getTrustedSignerPrivateKey() {
  const key = normalizePrivateKey(
    process.env.TRUSTED_SIGNER_PRIVATE_KEY
    || process.env.PRIVATE_KEY
    || readFallbackPrivateKeyFromBlockchainEnv()
  );
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('trusted signer private key missing or invalid');
  }
  return key;
}

function getTrustedSignerWallet() {
  return new ethers.Wallet(getTrustedSignerPrivateKey());
}

function getTrustedSignerAddress() {
  return getTrustedSignerWallet().address;
}

function randomPermitNonce() {
  return ethers.hexlify(crypto.randomBytes(32));
}

function hashBytesLike(value) {
  const hex = String(value || '').trim();
  return ethers.keccak256(hex && hex !== '0x' ? hex : '0x');
}

function hashAction(action) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(action || '').trim()));
}

function hashSubject(subjectId) {
  return ethers.keccak256(ethers.toUtf8Bytes(String(subjectId || '').trim()));
}

function makePermitDigest({ action, caller, subjectId, paramsHash, nonce, deadlineMs, chainId, contractAddress }) {
  return ethers.keccak256(abiCoder.encode(
    ['bytes32', 'address', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'uint256', 'address'],
    [
      hashAction(action),
      ethers.getAddress(String(caller || '').trim()),
      hashSubject(subjectId),
      String(paramsHash || '').trim(),
      String(nonce || '').trim(),
      BigInt(deadlineMs),
      BigInt(chainId),
      ethers.getAddress(String(contractAddress || '').trim()),
    ]
  ));
}

async function signPermit({ action, caller, subjectId, paramsHash, nonce, deadlineMs, chainEnv = CHAIN_ENV }) {
  const deployment = loadDeployment(chainEnv);
  const contractAddress = String(deployment.address || '').trim();
  const chainId = getChainId(chainEnv);
  const digest = makePermitDigest({ action, caller, subjectId, paramsHash, nonce, deadlineMs, chainId, contractAddress });
  const wallet = getTrustedSignerWallet();
  const signature = await wallet.signMessage(ethers.getBytes(digest));
  return {
    action,
    nonce,
    deadlineMs,
    paramsHash,
    signature,
    signerAddress: wallet.address,
    contractAddress,
    chainId: chainId.toString(),
    digest,
  };
}

async function issuePermit({ action, caller, subjectId, paramsHash, chainEnv = CHAIN_ENV }) {
  const nonce = randomPermitNonce();
  const deadlineMs = Date.now() + PERMIT_TTL_MS;
  return signPermit({ action, caller, subjectId, paramsHash, nonce, deadlineMs, chainEnv });
}

function hashCreateListingParams({
  listingId,
  contentHash,
  rentAmountWei,
  minLeaseMonths,
  imageRootHash,
  snapshotHash,
  snapshotCid,
}) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'bytes32', 'uint256', 'uint16', 'bytes32', 'bytes32', 'string'],
    [listingId, contentHash, BigInt(rentAmountWei), Number(minLeaseMonths), imageRootHash, snapshotHash, snapshotCid]
  ));
}

function hashUpdateListingTermsParams({
  listingId,
  contentHash,
  rentAmountWei,
  minLeaseMonths,
  imageRootHash,
  snapshotHash,
  snapshotCid,
  expectedVersion,
  expectedNonce,
}) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'bytes32', 'uint256', 'uint16', 'bytes32', 'bytes32', 'string', 'uint64', 'uint64'],
    [
      listingId,
      contentHash,
      BigInt(rentAmountWei),
      Number(minLeaseMonths),
      imageRootHash,
      snapshotHash,
      snapshotCid,
      Number(expectedVersion),
      Number(expectedNonce),
    ]
  ));
}

function hashSetListingStatusParams({ listingId, newStatus, expectedVersion, expectedNonce }) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'uint8', 'uint64', 'uint64'],
    [listingId, Number(newStatus), Number(expectedVersion), Number(expectedNonce)]
  ));
}

function hashCreateContractParams(params) {
  return ethers.keccak256(abiCoder.encode(
    [
      'string', 'string', 'string', 'address', 'address', 'bytes32', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint16',
      'bytes32', 'bytes32', 'uint256', 'uint256', 'bytes32', 'bytes32',
    ],
    [
      params.contractId,
      params.listingId,
      params.parentContractId || '',
      ethers.getAddress(params.tenant),
      ethers.getAddress(params.landlord),
      params.contentHash,
      params.gasAuthNonce,
      BigInt(params.initialAmountWei),
      BigInt(params.startAtMs),
      BigInt(params.endAtMs),
      Number(params.leaseMonths),
      params.tenantMessageHash,
      params.landlordMessageHash,
      BigInt(params.tenantSignedAt),
      BigInt(params.landlordSignedAt),
      hashBytesLike(params.tenantSignature),
      hashBytesLike(params.landlordSignature),
    ]
  ));
}

function hashInitialPaymentParams({ contractId, landlord, orderNo, amountWei }) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'address', 'string', 'uint256'],
    [contractId, ethers.getAddress(landlord), orderNo, BigInt(amountWei)]
  ));
}

function hashRentalReviewParams({ contractId, commentHash, rating, commentCid }) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'bytes32', 'uint8', 'string'],
    [contractId, commentHash, Number(rating), commentCid]
  ));
}

function hashListingFeedbackParams({ listingId, feedbackTypeCode, commentHash, commentCid }) {
  return ethers.keccak256(abiCoder.encode(
    ['string', 'uint8', 'bytes32', 'string'],
    [listingId, Number(feedbackTypeCode), commentHash, commentCid]
  ));
}

module.exports = {
  ACTIONS,
  getTrustedSignerAddress,
  getTrustedSignerWallet,
  issuePermit,
  hashCreateListingParams,
  hashUpdateListingTermsParams,
  hashSetListingStatusParams,
  hashCreateContractParams,
  hashInitialPaymentParams,
  hashRentalReviewParams,
  hashListingFeedbackParams,
};
