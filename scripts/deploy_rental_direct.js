const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

async function main() {
  const p = new ethers.JsonRpcProvider('https://ethereum-sepolia.publicnode.com');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  console.log('部署地址:', wallet.address);
  const bal = ethers.formatEther(await p.getBalance(wallet.address));
  console.log('余额:', bal, 'SepoliaETH');

  if (parseFloat(bal) < 0.001) {
    console.log('❌ SepoliaETH 不足，无法部署');
    return;
  }

  // 读取合约 artifacts
  const artifact = JSON.parse(fs.readFileSync(
    'D:/0Project/Solid/artifacts/contracts/RentalChain.sol/RentalChain.json'
  ));
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('⏳ 部署中...');
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('✅ 部署成功! 合约地址:', addr);
  
  fs.writeFileSync('D:/0Project/Solid/deployments-rental-sepolia.json', JSON.stringify({
    address: addr,
    deployer: wallet.address,
    timestamp: new Date().toISOString()
  }, null, 2));
  console.log('📝 地址已保存');
}

main().catch(e => console.error('❌ 失败:', e.message));
