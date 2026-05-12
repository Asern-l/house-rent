# 信源链 - 区块链租房平台

基于以太坊智能合约的去中心化租房平台，实现**房源信息存证、电子合同链上签署、押金托管结算**全流程上链。

> ⚠️ **当前部署网络：Sepolia 测试网** — 所有链上交易均为测试网交易，可在 [Sepolia Etherscan](https://sepolia.etherscan.io) 查询

---

## 项目概述

```
contracts/          <- 智能合约（Solidity）
backend/            <- 后端 API（Node.js + Express + SQLite）
rental-frontend/    <- 前端页面（React + Vite + Tailwind）
```

---

## 环境搭建（从零开始）

### 1. 安装前置软件

| 软件 | 版本要求 | 下载地址 |
|:----|:--------:|:--------|
| Node.js | >= 18 | https://nodejs.org/ |
| MetaMask | 最新 | 浏览器扩展商店 |

### 2. 下载项目

```
git clone https://github.com/Asern-l/house-rent.git
cd house-rent
```

### 3. 安装依赖

```
npm install
cd backend && npm install && cd ..
cd rental-frontend && npm install && cd ..
```

### 4. 编译智能合约

```
npx hardhat compile
```

### 5. 配置环境变量

在项目根目录创建 `.env` 文件（参考 `.env.example`）：

```ini
# Sepolia 测试网 RPC URL
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com

# 部署钱包私钥（需持有 SepoliaETH 作为 Gas 费）
PRIVATE_KEY=你的钱包私钥
```

### 6. 部署合约到 Sepolia 测试网

```
npx hardhat run scripts/deploy_rental.js --network sepolia
```

部署成功后会生成 `deployments-rental-sepolia.json`，其中包含合约地址。

### 7. 配置前端合约地址

打开 `rental-frontend/.env`，将部署得到的合约地址填入：

```ini
VITE_CONTRACT_ADDRESS=0x部署得到的合约地址
```

### 8. 启动后端

```
cd backend
node src/index.js
```

启动在 http://localhost:3000

### 9. 启动前端

```
cd rental-frontend
npm run dev
```

访问 http://localhost:3001

### 10. 配置 MetaMask

- 网络名称: Sepolia
- RPC URL: https://rpc.sepolia.org
- 链 ID: 11155111
- 货币符号: SepoliaETH

> 💡 如果没有 SepoliaETH，请先到水龙头领取：https://sepoliafaucet.com

---

## 使用教程

### 注册账号

| 角色 | 手机号 | 密码 | 昵称 |
|:----:|:------:|:----:|:----:|
| 房东 | 13800001111 | 123456 | 张房东 |
| 租客 | 13900002222 | 123456 | 李租客 |

### 完整流程

1. 房东登录 -> 发布房源
2. 租客登录 -> 申请租房
3. 租客签署合同
4. 房东签署合同（连接 MetaMask，哈希自动上链）
5. 验证工具输入合同 ID 查询链上存证

---

## 重置环境（一键清零）

如需从头开始测试，按以下步骤**完全重置**：

```bash
# 1. 删除数据库（清除用户、房源、合同等所有业务数据）
del backend\database.sqlite

# 2. 重新部署合约（获取全新的合约地址）
npx hardhat run scripts/deploy_rental.js --network sepolia

# 3. 更新前端合约地址
#    将 rental-frontend/.env 中的 VITE_CONTRACT_ADDRESS 改为新地址

# 4. 重启后端
cd backend && node src/index.js
```

> ⚠️ 链上已存证的旧数据仍可在 Sepolia Etherscan 查到，因为区块链不可篡改。重置仅清除本地业务数据和新合约关联。

---

## 常见问题

- **MetaMask 交易失败？** 检查网络是否切换到 Sepolia，以及钱包是否有足够 SepoliaETH
- **合约地址不对？** 确认 `rental-frontend/.env` 中的 `VITE_CONTRACT_ADDRESS` 与部署生成的地址一致
- **重新部署？** 修改合约后重新编译部署，更新前端 `.env` 中的合约地址
- **数据库重置？** 删除 `backend/database.sqlite` 后重启后端

---

## License

MIT
