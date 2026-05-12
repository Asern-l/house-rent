# 信源链 - 区块链租房平台

基于以太坊智能合约的去中心化租房平台，实现**房源信息存证、电子合同链上签署、押金托管结算**全流程上链。

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

### 5. 启动区块链（终端1）

```
npx hardhat node
```

### 6. 部署合约（终端2）

```
npx hardhat run scripts/deploy_rental.js --network localhost
```

### 7. 配置合约地址

打开 `rental-frontend/src/pages/ContractPage.jsx`，将 `CONTRACT_ADDR` 改为上一步的地址。

### 8. 启动后端（终端3）

```
cd backend
node src/index.js
```

启动在 http://localhost:3000

### 9. 启动前端（终端4）

```
cd rental-frontend
npm run dev
```

访问 http://localhost:3001

### 10. 配置 MetaMask

- 网络名称: Hardhat Local
- RPC URL: http://127.0.0.1:8545
- 链 ID: 31337
- 货币符号: ETH

导入测试账户私钥: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

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

## 常见问题

- 页面空白？检查四个终端是否都正常运行
- MetaMask 交易失败？检查网络是否切换到 Hardhat Local
- 重新开始？删除 backend/database.sqlite 后重启后端

---

## License

MIT
