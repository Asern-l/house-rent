/**
 * 文件说明：deploy_rental.js
 * - 通过 Hardhat 部署 RentalChain 到 Sepolia。
 */
const hre = require('hardhat');
const fs = require('fs');

// 函数 1：执行标准部署流程。
async function main() {
  console.log('开始部署 RentalChain 到 Sepolia...\n');

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`部署账户: ${deployer.address}`);
  console.log(`账户余额: ${hre.ethers.formatEther(balance)} SepoliaETH\n`);

  const RentalChain = await hre.ethers.getContractFactory('RentalChain');
  const contract = await RentalChain.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('部署成功');
  console.log(`合约地址: ${address}`);

  fs.writeFileSync('deployments-rental-sepolia.json', JSON.stringify({
    network: 'sepolia',
    contract: 'RentalChain',
    address,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log('\n部署信息已写入 deployments-rental-sepolia.json');
}

main().catch((err) => {
  console.error('部署失败:', err);
  process.exit(1);
});
