/**
 * 文件说明：deploy_rental.js
 * - 通过 Hardhat 部署 RentalChain。
 * - 按当前网络输出独立部署文件，便于多环境隔离。
 */
const hre = require('hardhat');
const fs = require('fs');

// 函数 1: 获取部署文件名。
function getDeploymentFile(networkName) {
  return `deployments-rental-${networkName}.json`;
}

// 函数 2: 执行部署流程。
async function main() {
  const networkName = hre.network.name || 'unknown';
  console.log(`开始部署 RentalChain 到 ${networkName}...\n`);

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`部署账户: ${deployer.address}`);
  console.log(`账户余额: ${hre.ethers.formatEther(balance)} ETH\n`);

  const RentalChain = await hre.ethers.getContractFactory('RentalChain');
  const contract = await RentalChain.deploy();
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
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`\n部署信息已写入 ${outputFile}`);
}

main().catch((err) => {
  console.error('部署失败:', err);
  process.exit(1);
});
