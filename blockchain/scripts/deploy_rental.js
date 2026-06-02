/**
 * 文件说明：deploy_rental.js
 * - 通过 Hardhat 部署 RentalChain。
 * - 按当前网络输出独立部署文件，便于多环境隔离。
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { ethers } = require('ethers');

// 函数 1: 获取部署文件名。
function getDeploymentFile(networkName) {
  return `deployments-rental-${networkName}.json`;
}

async function verifyDeployedContract(contract, expected) {
  const [trustedSigner, platformFeeRecipient, paymentWindowMs, feeBps] = await Promise.all([
    contract.trustedSigner(),
    contract.platformFeeRecipient(),
    contract.paymentWindowMs(),
    contract.PLATFORM_FEE_BPS(),
  ]);
  if (String(trustedSigner).toLowerCase() !== String(expected.trustedSigner).toLowerCase()) {
    throw new Error(`trustedSigner 校验失败：期望 ${expected.trustedSigner}，实际 ${trustedSigner}`);
  }
  if (String(platformFeeRecipient).toLowerCase() !== String(expected.platformFeeRecipient).toLowerCase()) {
    throw new Error(`platformFeeRecipient 校验失败：期望 ${expected.platformFeeRecipient}，实际 ${platformFeeRecipient}`);
  }
  if (String(paymentWindowMs) !== String(expected.paymentWindowMs)) {
    throw new Error(`paymentWindowMs 校验失败：期望 ${expected.paymentWindowMs}，实际 ${paymentWindowMs}`);
  }
  if (String(feeBps) !== '10') {
    throw new Error(`PLATFORM_FEE_BPS 校验失败：期望 10，实际 ${feeBps}`);
  }
  return {
    trustedSigner: String(trustedSigner),
    platformFeeRecipient: String(platformFeeRecipient),
    paymentWindowMs: String(paymentWindowMs),
    feeBps: String(feeBps),
  };
}

function syncFrontendAbiAndAddress() {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const result = spawnSync('npm', ['run', 'sync:abi'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`sync:abi 执行失败，退出码 ${result.status}`);
  }
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
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return '';
    const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
    return normalizePrivateKey(parsed.TRUSTED_SIGNER_PRIVATE_KEY || parsed.PRIVATE_KEY || '');
  } catch {
    return '';
  }
}

function resolveTrustedSignerAddress(networkName, deployerAddress) {
  const explicitAddress = String(process.env.TRUSTED_SIGNER_ADDRESS || '').trim();
  if (explicitAddress) return explicitAddress;
  const fallbackKey = normalizePrivateKey(
    process.env.TRUSTED_SIGNER_PRIVATE_KEY
    || process.env.PRIVATE_KEY
    || readFallbackPrivateKeyFromBlockchainEnv()
  );
  if (networkName === 'localhost' && fallbackKey) {
    return new ethers.Wallet(fallbackKey).address;
  }
  return deployerAddress;
}

async function waitForEnterIfInteractive(message = '按 Enter 退出...') {
  if (!process.stdin.isTTY || process.env.CI === 'true' || process.env.NO_DEPLOY_PAUSE === '1') return;
  const readline = require('readline');
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n${message}`, () => {
      rl.close();
      resolve();
    });
  });
}

// 函数 2: 执行部署流程。
async function main() {
  const networkName = hre.network.name || 'unknown';
  console.log(`开始部署 RentalChain 到 ${networkName}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`部署账户: ${deployer.address}`);
  console.log(`账户余额: ${hre.ethers.formatEther(balance)} ETH\n`);

  const paymentWindowHours = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS || 2));
  const paymentWindowMs = BigInt(paymentWindowHours) * 60n * 60n * 1000n;
  const trustedSigner = resolveTrustedSignerAddress(networkName, deployer.address);
  const platformFeeRecipient = process.env.PLATFORM_FEE_RECIPIENT_ADDRESS || trustedSigner;
  console.log(`支付窗口: ${paymentWindowHours} 小时 (${paymentWindowMs} ms)\n`);
  console.log(`Permit 签名者: ${trustedSigner}\n`);
  console.log(`平台手续费收款地址: ${platformFeeRecipient}\n`);

  const RentalChain = await hre.ethers.getContractFactory('RentalChain');
  const contract = await RentalChain.deploy(paymentWindowMs, trustedSigner, platformFeeRecipient);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('部署成功');
  console.log(`合约地址: ${address}`);

  const outputFile = getDeploymentFile(networkName);
  fs.writeFileSync(outputFile, JSON.stringify({
    network: networkName,
    contract: 'RentalChain',
    address,
    deployer: deployer.address,
    trustedSigner,
    platformFeeRecipient,
    paymentWindowHours,
    paymentWindowMs: paymentWindowMs.toString(),
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`\n部署信息已写入 ${outputFile}`);

  const verified = await verifyDeployedContract(contract, {
    trustedSigner,
    platformFeeRecipient,
    paymentWindowMs: paymentWindowMs.toString(),
  });
  console.log('\n链上关键参数校验通过:');
  console.log(JSON.stringify(verified, null, 2));

  console.log('\n开始同步前端 ABI 与部署地址...');
  syncFrontendAbiAndAddress();
  console.log('前端 ABI 与部署地址同步完成。');

  console.log('\n后续操作:');
  console.log('1. 重启后端服务');
  console.log('2. 重启前端服务');
  console.log('3. 使用新建合同重新测试支付与手续费分账');
}

main()
  .then(() => waitForEnterIfInteractive())
  .catch(async (err) => {
    console.error('部署失败:', err);
    await waitForEnterIfInteractive('部署失败。按 Enter 退出...');
    process.exit(1);
  });
