const fs = require('fs');
const path = require('path');
const { ethers } = require('./deps');

const DEFAULT_PUBLIC_RPC_URL = String(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com').trim();
const DEFAULT_LOCAL_RPC_URL = String(process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545').trim();

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

function getRuntimeConfigFilePath() {
  return path.join(__dirname, '..', 'config', 'runtime.json');
}

function buildEmptyConfigStore() {
  return {
    activeConfigName: '',
    configs: {},
  };
}

function buildDefaultConfigStore() {
  return {
    activeConfigName: 'sepolia',
    configs: {
      sepolia: {
        name: 'sepolia',
        rpcUrl: DEFAULT_PUBLIC_RPC_URL,
        chainId: 11155111,
        contractAddress: '0x89663490792D26B9ABCd1bcF4fa760d82feef39A',
        contractDeployedAt: '2026-06-02T06:12:25.819Z',
      },
      local: {
        name: 'local',
        rpcUrl: DEFAULT_LOCAL_RPC_URL,
        chainId: 31337,
        contractAddress: '0xb73C8c95e43Ed9B0b6e0e3AF25576bB07Bf19040',
        contractDeployedAt: '2026-06-03T04:34:16.104Z',
      },
    },
  };
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeConfigName(value) {
  return String(value || '').trim();
}

function normalizeNameKey(value) {
  return normalizeConfigName(value).toLowerCase();
}

function normalizeContractConfig(input) {
  const name = normalizeConfigName(input?.name);
  if (!name) {
    throw new Error('配置名称不能为空');
  }
  const rpcUrl = String(input?.rpcUrl || '').trim();
  if (!isValidHttpUrl(rpcUrl)) {
    throw new Error('RPC URL 必须是合法的 http/https 地址');
  }
  const chainId = Number(input?.chainId || 0);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('链 ID 必须是正整数');
  }
  const contractAddress = String(input?.contractAddress || '').trim();
  if (!ethers.isAddress(contractAddress)) {
    throw new Error('合约地址不是合法的 EVM 地址');
  }
  const contractDeployedAt = String(input?.contractDeployedAt || '').trim();
  if (contractDeployedAt && Number.isNaN(Date.parse(contractDeployedAt))) {
    throw new Error('合约部署时间不是合法的日期时间');
  }
  return {
    name,
    rpcUrl,
    chainId,
    contractAddress: ethers.getAddress(contractAddress),
    contractDeployedAt,
  };
}

function loadVerifierConfigStore() {
  const filePath = getRuntimeConfigFilePath();
  if (!fs.existsSync(filePath)) {
    const defaults = buildDefaultConfigStore();
    writeJson(filePath, defaults);
    return defaults;
  }
  const parsed = readJson(filePath);
  if (!parsed || typeof parsed !== 'object' || !parsed.configs || typeof parsed.configs !== 'object') {
    throw new Error('verifier runtime config format invalid');
  }
  return {
    activeConfigName: String(parsed.activeConfigName || '').trim(),
    configs: parsed.configs,
  };
}

function saveVerifierConfigStore(store) {
  const normalized = {
    activeConfigName: String(store?.activeConfigName || '').trim(),
    configs: store?.configs && typeof store.configs === 'object' ? store.configs : {},
  };
  writeJson(getRuntimeConfigFilePath(), normalized);
}

function listContractConfigs() {
  const store = loadVerifierConfigStore();
  const configs = Object.values(store.configs || {})
    .map((item) => ({
      name: String(item?.name || '').trim(),
      rpcUrl: String(item?.rpcUrl || '').trim(),
      chainId: Number(item?.chainId || 0),
      contractAddress: String(item?.contractAddress || '').trim(),
      contractDeployedAt: String(item?.contractDeployedAt || '').trim(),
    }))
    .filter((item) => item.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return {
    activeConfigName: store.activeConfigName,
    configs,
  };
}

function findConfigByName(store, name) {
  const targetKey = normalizeNameKey(name);
  return Object.values(store.configs || {}).find((item) => normalizeNameKey(item?.name) === targetKey) || null;
}

function findConfigByChain(store, { contractAddress = '', chainId = 0 }) {
  const normalizedAddress = String(contractAddress || '').trim().toLowerCase();
  const numericChainId = Number(chainId || 0);
  const items = Object.values(store.configs || {});
  if (normalizedAddress) {
    const exact = items.find((item) => String(item?.contractAddress || '').trim().toLowerCase() === normalizedAddress);
    if (exact) return exact;
  }
  if (numericChainId > 0) {
    const match = items.find((item) => Number(item?.chainId || 0) === numericChainId);
    if (match) return match;
  }
  return null;
}

function upsertContractConfig(input, { replace = false, activate = false } = {}) {
  const config = normalizeContractConfig(input);
  const store = loadVerifierConfigStore();
  const existing = findConfigByName(store, config.name);
  if (existing && !replace) {
    const error = new Error('同名配置已存在，请改名或选择替换');
    error.code = 'CONFIG_NAME_EXISTS';
    throw error;
  }
  store.configs[config.name] = config;
  if (activate || !store.activeConfigName) {
    store.activeConfigName = config.name;
  }
  saveVerifierConfigStore(store);
  return {
    activeConfigName: store.activeConfigName,
    config,
  };
}

function activateContractConfig(name) {
  const store = loadVerifierConfigStore();
  const config = findConfigByName(store, name);
  if (!config) {
    throw new Error(`合约配置不存在：${name}`);
  }
  store.activeConfigName = config.name;
  saveVerifierConfigStore(store);
  return {
    activeConfigName: store.activeConfigName,
    config,
  };
}

function parseContractConfigText(rawText) {
  const text = String(rawText || '');
  const values = {};
  text.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!match) return;
    values[match[1]] = match[2];
  });
  const suggestedName = String(values.VERIFY_CHAIN_ENV || '').trim() || `chain-${Number(values.VERIFY_CHAIN_ID || 0) || 'config'}`;
  return {
    defaultName: suggestedName,
    rpcUrl: String(values.VERIFY_RENTAL_CHAIN_RPC_URL || '').trim(),
    chainId: Number(values.VERIFY_CHAIN_ID || 0),
    contractAddress: String(values.VERIFY_RENTAL_CHAIN_ADDRESS || '').trim(),
    contractDeployedAt: String(values.VERIFY_RENTAL_CHAIN_DEPLOYED_AT || '').trim(),
  };
}

function getDefaultRpcUrl(chainId, networkName = '') {
  const numericChainId = Number(chainId || 0);
  if (numericChainId === 31337 || numericChainId === 1337) {
    return DEFAULT_LOCAL_RPC_URL;
  }
  if (numericChainId === 11155111) {
    return DEFAULT_PUBLIC_RPC_URL;
  }
  return DEFAULT_PUBLIC_RPC_URL;
}

function resolveRuntime(networkKey, args) {
  const store = loadVerifierConfigStore();
  const explicitConfigName = String(args['config-name'] || '').trim();
  const explicitChainId = Number(args['chain-id'] || 0);
  const explicitContractAddress = String(args['contract-address'] || '').trim();
  const explicitDeployedAt = String(args['contract-deployed-at'] || '').trim();

  let baseConfig = null;
  if (explicitConfigName) {
    baseConfig = findConfigByName(store, explicitConfigName);
    if (!baseConfig) {
      throw new Error(`contract config not found: ${explicitConfigName}`);
    }
  } else if (explicitContractAddress || explicitChainId > 0) {
    baseConfig = findConfigByChain(store, {
      contractAddress: explicitContractAddress,
      chainId: explicitChainId,
    });
  } else if (networkKey) {
    baseConfig = findConfigByName(store, networkKey);
  }
  if (!baseConfig && store.activeConfigName) {
    baseConfig = findConfigByName(store, store.activeConfigName);
  }

  const chainId = Number(explicitChainId || baseConfig?.chainId || 0);
  const rpcUrl = String(args['rpc-url'] || baseConfig?.rpcUrl || getDefaultRpcUrl(chainId)).trim();
  const contractAddress = String(explicitContractAddress || baseConfig?.contractAddress || '').trim();
  if (!ethers.isAddress(contractAddress)) {
    throw new Error('invalid contract address for current verifier runtime');
  }
  const abiPath = path.join(__dirname, '..', '..', 'apps', 'frontend', 'src', 'shared', 'blockchain', 'RentalChainABI.json');
  const abi = readJson(abiPath);
  return {
    network: String(baseConfig?.name || networkKey || `chain-${chainId || 'unknown'}`),
    selectedConfigName: String(baseConfig?.name || '').trim(),
    rpcUrl,
    contractAddress: ethers.getAddress(contractAddress),
    abi,
    deploymentMeta: {
      chainId,
      timestamp: explicitDeployedAt || String(baseConfig?.contractDeployedAt || '').trim(),
      source: explicitDeployedAt ? 'explicit' : (baseConfig ? 'verifier-runtime-config' : 'default-runtime'),
    },
  };
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
  loadVerifierConfigStore,
  saveVerifierConfigStore,
  listContractConfigs,
  upsertContractConfig,
  activateContractConfig,
  parseContractConfigText,
  getDefaultRpcUrl,
};
