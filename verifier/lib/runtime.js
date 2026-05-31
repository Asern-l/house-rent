const fs = require('fs');
const path = require('path');
const { ethers } = require('./deps');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = '1';
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function resolveRuntime(networkKey, args) {
  const network = String(args.network || networkKey || 'sepolia').trim().toLowerCase() === 'local' ? 'local' : 'sepolia';
  const rpcUrl = String(
    args['rpc-url']
      || (network === 'local'
        ? (process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545')
        : (process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com'))
  ).trim();
  const deployFile = network === 'local'
    ? path.join(__dirname, '..', '..', 'blockchain', 'deployments-rental-localhost.json')
    : path.join(__dirname, '..', '..', 'blockchain', 'deployments-rental-sepolia.json');
  const deployMeta = fs.existsSync(deployFile) ? readJson(deployFile) : {};
  const deployAddress = String(deployMeta.address || '').trim();
  const contractAddress = String(args['contract-address'] || deployAddress).trim();
  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`invalid contract address for network ${network}`);
  }
  const abiPath = path.join(__dirname, '..', '..', 'apps', 'frontend', 'src', 'shared', 'blockchain', 'RentalChainABI.json');
  const abi = readJson(abiPath);
  return { network, rpcUrl, contractAddress, abi, deploymentMeta: deployMeta };
}

async function ensureProviderReady(provider, rpcUrl) {
  const timeoutMs = 10_000;
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`rpc not reachable within ${timeoutMs}ms: ${rpcUrl}`)), timeoutMs);
  });
  await Promise.race([provider.getNetwork(), timeout]);
}

async function estimateStartBlockFromTimestamp(provider, unixSec) {
  const latestBlockNumber = await provider.getBlockNumber();
  if (!Number.isFinite(unixSec) || unixSec <= 0) return 0;
  const latestBlock = await provider.getBlock(latestBlockNumber);
  if (!latestBlock) return 0;
  if (unixSec >= Number(latestBlock.timestamp || 0)) return latestBlockNumber;

  let low = 0;
  let high = latestBlockNumber;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await provider.getBlock(mid);
    const ts = Number(block?.timestamp || 0);
    if (ts < unixSec) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return Math.max(0, low - 128);
}

module.exports = {
  parseArgs,
  readJson,
  resolveRuntime,
  ensureProviderReady,
  estimateStartBlockFromTimestamp,
};
