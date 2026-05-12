const hre = require("hardhat");

async function main() {
  console.log("🚀 部署 RentalChain 合约到 Sepolia...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`📡 部署账户: ${deployer.address}`);
  console.log(`💰 余额: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} SepoliaETH\n`);

  const RentalChain = await hre.ethers.getContractFactory("RentalChain");
  const contract = await RentalChain.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`✅ 部署成功！`);
  console.log(`📄 合约地址: ${address}`);

  const fs = require("fs");
  fs.writeFileSync("deployments-rental-sepolia.json", JSON.stringify({
    network: "sepolia",
    contract: "RentalChain",
    address,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  }, null, 2));
  console.log(`\n📝 部署信息已保存到 deployments-rental-sepolia.json`);
}

main().catch(err => { console.error("❌ 失败:", err); process.exit(1); });
