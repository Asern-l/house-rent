/**
 * 文件说明：test_contract_sign_flow.js
 * - 本文件已添加中文注释，便于后续维护与交接。
 * - 变更代码时请同步维护注释，保证逻辑与注释一致。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ethers } = require(path.resolve(__dirname, '..', 'blockchain', 'node_modules', 'ethers'));

const rootDir = path.resolve(__dirname, '..');
const backendDir = path.join(rootDir, 'apps', 'backend');
const TEST_PORT = process.env.SIGN_FLOW_TEST_PORT || '3011';
const apiBase = `http://127.0.0.1:${TEST_PORT}/api`;

const TENANT_PRIVATE_KEY = '0x1000000000000000000000000000000000000000000000000000000000000001';
const LANDLORD_PRIVATE_KEY = '0x2000000000000000000000000000000000000000000000000000000000000002';
const tenantWallet = new ethers.Wallet(TENANT_PRIVATE_KEY);
const landlordWallet = new ethers.Wallet(LANDLORD_PRIVATE_KEY);
const TENANT_WALLET = tenantWallet.address;
const LANDLORD_WALLET = landlordWallet.address;
const TEST_TX_HASH = `0x${'a'.repeat(64)}`;
const TEST_PAY_TX_HASH = `0x${'b'.repeat(64)}`;
const TEST_CONTRACT_ADDRESS = '0x3333333333333333333333333333333333333333';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(maxRetries = 40) {
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const res = await fetch(`${apiBase}/health`);
      if (res.ok) return;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('Backend health check timed out');
}

async function request(method, pathname, body, token) {
  const res = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${pathname} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
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

async function login(account, password) {
  const cap = await request('GET', '/auth/captcha');
  const m = /^(\d+)\s*\+\s*(\d+)/.exec(cap.data.question || '');
  const answer = String(Number(m?.[1] || 0) + Number(m?.[2] || 0));
  return request('POST', '/auth/login', {
    phone: account,
    password,
    captchaId: cap.data.id,
    captchaAnswer: answer,
  });
}

async function signContractPayload({ contractId, contentHash, role, wallet }) {
  const signerAddress = wallet.address;
  const timestamp = Date.now();
  const message = createSignMessage({ contractId, contentHash, role, signerAddress, timestamp });
  const signature = await wallet.signMessage(message);
  return { signerAddress, message, signature };
}

async function main() {
  const chainEnv = String(process.env.CHAIN_ENV || 'local').trim().toLowerCase() === 'sepolia' ? 'sepolia' : 'local';
  const dbPath = path.join(backendDir, 'data', `database.${chainEnv}.sqlite`);
  const backupPath = `${dbPath}.bak-test`;
  const hadDb = fs.existsSync(dbPath);
  if (hadDb) fs.copyFileSync(dbPath, backupPath);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const env = { ...process.env };
  if (!env.JWT_SECRET) env.JWT_SECRET = 'test_jwt_secret_for_sign_flow';
  env.PORT = TEST_PORT;
  env.CHAIN_ENV = chainEnv;

  const child = spawn('node', ['src/index.js'], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (buf) => process.stdout.write(buf.toString()));
  child.stderr.on('data', (buf) => process.stderr.write(buf.toString()));
  child.on('error', (err) => {
    console.error(`Backend process failed: ${err.message}`);
  });

  try {
    await waitForHealth();

    const suffix = Date.now().toString().slice(-10);
    const landlordPhone = `1${suffix}`;
    const tenantPhone = `1${(Number(suffix) + 1).toString().padStart(10, '0')}`;
    const password = 'pass123456';

    await request('POST', '/auth/register', {
      phone: landlordPhone,
      password,
      role: 'landlord',
      nickname: 'landlord_test',
      walletAddress: LANDLORD_WALLET,
    });

    await request('POST', '/auth/register', {
      phone: tenantPhone,
      password,
      role: 'tenant',
      nickname: 'tenant_test',
      walletAddress: TENANT_WALLET,
    });

    const landlordLogin = await login(landlordPhone, password);
    const tenantLogin = await login(tenantPhone, password);
    const landlordToken = landlordLogin.data.token;
    const tenantToken = tenantLogin.data.token;

    const listing = await request('POST', '/listings', {
      title: 'SignFlow Test Listing',
      description: 'listing for contract sign flow test',
      address: 'Shanghai test road',
      district: 'Pudong',
      rentAmount: '1.5',
      rentCycle: 'month',
      imageUrls: [],
    }, landlordToken);

    const listingId = listing.data.id;

    const created = await request('POST', '/contracts', { listingId }, tenantToken);
    const contractId = created.data.contractId;

    const proposal = await request('POST', `/contracts/${contractId}/proposals`, {
      startDate: new Date().toISOString().slice(0, 10),
      leaseMonths: 2,
      rentAmount: '1.6',
      changeNote: 'extend lease for negotiation regression',
    }, tenantToken);
    await request('POST', `/contracts/${contractId}/proposals/${proposal.data.proposalId}/accept`, {}, landlordToken);
    await request('POST', `/contracts/${contractId}/finalize`, {}, tenantToken);
    const finalizedDetail = await request('GET', `/contracts/${contractId}`, null, tenantToken);
    const finalizedHash = finalizedDetail.data.content_hash;
    const finalizedContent = typeof finalizedDetail.data.content_json === 'string'
      ? JSON.parse(finalizedDetail.data.content_json)
      : finalizedDetail.data.content_json;
    if (finalizedDetail.data.version !== 2 || finalizedContent.oneTimeAmount !== '3.2') {
      throw new Error(`Negotiation did not persist expected version/content: ${JSON.stringify(finalizedDetail.data)}`);
    }
    await request('POST', `/contracts/${contractId}/sign-tenant`, await signContractPayload({
      contractId,
      contentHash: finalizedHash,
      role: 'tenant',
      wallet: tenantWallet,
    }), tenantToken);
    const signedByLandlord = await request('POST', `/contracts/${contractId}/sign-landlord`, await signContractPayload({
      contractId,
      contentHash: finalizedHash,
      role: 'landlord',
      wallet: landlordWallet,
    }), landlordToken);
    if (!signedByLandlord?.data?.contentHash) {
      throw new Error('Landlord sign response missing contentHash');
    }

    const onchainTxHash = signedByLandlord?.data?.txHash || TEST_TX_HASH;
    if (!signedByLandlord?.data?.txHash) {
      await request('POST', `/contracts/${contractId}/onchain`, { txHash: TEST_TX_HASH }, landlordToken);
    }
    const paymentAuth = await request('POST', `/contracts/${contractId}/payments/authorization`, {
      payerAddress: TENANT_WALLET,
      amount: '3.2',
      chainId: 31337,
      contractAddress: TEST_CONTRACT_ADDRESS,
    }, tenantToken);
    await request('POST', `/contracts/${contractId}/payments/onchain`, {
      txHash: TEST_PAY_TX_HASH,
      amount: '3.2',
      payType: 'initial',
      period: 'initial',
      nonce: paymentAuth.data.nonce,
    }, tenantToken);

    const contractDetail = await request('GET', `/contracts/${contractId}`, null, tenantToken);
    if (contractDetail.data.status !== 'active') {
      throw new Error(`Expected contract status active, got: ${contractDetail.data.status}`);
    }
    if (contractDetail.data.tx_hash !== onchainTxHash) {
      throw new Error('Expected tx_hash to be persisted');
    }

    const verifyResult = await request('GET', `/verify/contract/${contractId}`, null, tenantToken);
    if (!verifyResult.data.exists || verifyResult.data.hashMatch !== true) {
      throw new Error(`Verify endpoint returned unexpected result: ${JSON.stringify(verifyResult.data)}`);
    }

    console.log(`PASS: contract sign flow completed (${contractId})`);
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (hadDb && fs.existsSync(backupPath)) fs.renameSync(backupPath, dbPath);
    if (!hadDb && fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  }
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
