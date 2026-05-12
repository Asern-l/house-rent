const hre = require("hardhat");

async function main() {
  console.log("🚀 开始部署校园二手交易平台智能合约...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`📡 部署账户: ${deployer.address}`);
  console.log(`💰 账户余额: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH\n`);

  // 部署合约
  const CampusTrade = await hre.ethers.getContractFactory("CampusTrade");
  const contract = await CampusTrade.deploy();

  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`✅ 合约部署成功！`);
  console.log(`📄 合约地址: ${contractAddress}`);

  // 输出部署信息
  const deploymentInfo = {
    network: hre.network.name,
    contractAddress: contractAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
  };

  const fs = require("fs");
  const deploymentPath = `deployments-${hre.network.name}.json`;
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📝 部署信息已保存到: ${deploymentPath}`);

  // 验证合约（仅限测试网/主网）
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n⏳ 等待区块确认后验证合约...");
    await contract.deploymentTransaction().wait(5);
    await hre.run("verify:verify", {
      address: contractAddress,
      constructorArguments: [],
    });
    console.log("✅ 合约已验证！");
  }

  console.log("\n🎉 部署完成！");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 部署失败:", error);
    process.exit(1);
  });
