/**
 * 文件说明：deploy_rental_direct.js
 * - 使用 ethers 直连 RPC 部署 RentalChain（不依赖 Hardhat run）。
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 函数 1：执行直连部署流程。
async function main() {
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia.publicnode.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('部署账户:', wallet.address);
  const bal = ethers.formatEther(await provider.getBalance(wallet.address));
  console.log('账户余额:', bal, 'SepoliaETH');

  if (parseFloat(bal) < 0.001) {
    console.log('SepoliaETH 余额不足，跳过部署。');
    return;
  }

  const artifactPath = path.resolve(__dirname, '..', 'artifacts', 'contracts', 'RentalChain.sol', 'RentalChain.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const paymentWindowHours = Math.max(1, Number(process.env.PAYMENT_WINDOW_HOURS || 2));
  const paymentWindowMs = BigInt(paymentWindowHours) * 60n * 60n * 1000n;
  const trustedSigner = process.env.TRUSTED_SIGNER_ADDRESS || wallet.address;

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('开始部署...');

  const contract = await factory.deploy(paymentWindowMs, trustedSigner);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('部署成功，合约地址:', addr);

  const outputPath = path.resolve(__dirname, '..', 'deployments-rental-sepolia.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    network: 'sepolia',
    contract: 'RentalChain',
    address: addr,
    deployer: wallet.address,
    trustedSigner,
    paymentWindowHours,
    paymentWindowMs: paymentWindowMs.toString(),
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('部署信息已保存到:', outputPath);
}

main().catch((e) => {
  console.error('部署失败:', e.message);
  process.exit(1);
});
