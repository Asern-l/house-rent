/**
 * 文件说明：deploy_rental_direct.js
 * - 使用 ethers 直接连接 RPC 部署 RentalChain。
 * - 部署后自动校验关键链上参数，并同步前端 ABI/部署地址。
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config();

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

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia.publicnode.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('部署账户:', wallet.address);
  const balance = ethers.formatEther(await provider.getBalance(wallet.address));
  console.log('账户余额:', balance, 'SepoliaETH');

  if (Number(balance) < 0.001) {
    console.log('SepoliaETH 余额不足，跳过部署。');
    return;
  }

  const artifactPath = path.resolve(__dirname, '..', 'artifacts', 'contracts', 'RentalChain.sol', 'RentalChain.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const paymentWindowHours = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS || 2));
  const paymentWindowMs = BigInt(paymentWindowHours) * 60n * 60n * 1000n;
  const trustedSigner = process.env.TRUSTED_SIGNER_ADDRESS || wallet.address;
  const platformFeeRecipient = process.env.PLATFORM_FEE_RECIPIENT_ADDRESS || trustedSigner;

  console.log(`支付窗口: ${paymentWindowHours} 小时 (${paymentWindowMs} ms)`);
  console.log(`Permit 签名者: ${trustedSigner}`);
  console.log(`平台手续费收款地址: ${platformFeeRecipient}`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('开始部署...');

  const contract = await factory.deploy(paymentWindowMs, trustedSigner, platformFeeRecipient);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('部署成功，合约地址:', address);

  const outputPath = path.resolve(__dirname, '..', 'deployments-rental-sepolia.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    network: 'sepolia',
    contract: 'RentalChain',
    address,
    deployer: wallet.address,
    trustedSigner,
    platformFeeRecipient,
    paymentWindowHours,
    paymentWindowMs: paymentWindowMs.toString(),
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log('部署信息已保存到:', outputPath);

  const verified = await verifyDeployedContract(contract, {
    trustedSigner,
    platformFeeRecipient,
    paymentWindowMs: paymentWindowMs.toString(),
  });
  console.log('链上关键参数校验通过:');
  console.log(JSON.stringify(verified, null, 2));

  console.log('开始同步前端 ABI 与部署地址...');
  syncFrontendAbiAndAddress();
  console.log('前端 ABI 与部署地址同步完成。');
}

main()
  .then(() => waitForEnterIfInteractive())
  .catch(async (error) => {
    console.error('部署失败:', error.message);
    await waitForEnterIfInteractive('部署失败。按 Enter 退出...');
    process.exit(1);
  });
