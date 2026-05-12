# 🏠 信源链 · 区块链租房平台 (RentalChain)

基于以太坊智能合约的分布式租房平台，实现**房源信息存证、电子合同链上签署、押金托管结算**全流程上链。

---

## 📋 项目结构

```
├── contracts/
│   ├── CampusTrade.sol          ← 旧：校园二手交易合约（保留）
│   └── RentalChain.sol          ← 信源链：房源存证 + 合同存证 + 押金托管
│
├── backend/                     ← 后端 API 服务（Node.js + Express + SQLite）
│   └── src/
│       ├── index.js             ← 主入口（端口 3001）
│       ├── db.js                ← SQLite 数据库（自动迁移建表）
│       ├── auth.js              ← JWT 认证中间件
│       └── routes/
│           ├── auth.js          ← 用户注册/登录（手机号+密码+角色）
│           ├── listings.js      ← 房源 CRUD（含模拟 AI 检测）
│           ├── contracts.js     ← 合同签署流程（双签 + 哈希上链）
│           └── verify.js        ← 链上验证工具
│
├── rental-frontend/             ← 前端（React 18 + Vite + Tailwind CSS）
│   └── src/
│       ├── App.jsx              ← 主路由
│       ├── context/AuthContext.jsx ← 登录认证 + Web3 钱包
│       ├── pages/
│       │   ├── HomePage.jsx     ← 首页
│       │   ├── LoginPage.jsx    ← 登录/注册页
│       │   ├── ListingsPage.jsx ← 房源列表（搜索/筛选）
│       │   ├── ListingDetail.jsx← 房源详情 + 申请租房
│       │   ├── PublishListing.jsx ← 发布房源（房东）
│       │   ├── ContractPage.jsx ← 合同签署页（⭐⭐亮点）
│       │   ├── MyContracts.jsx  ← 我的合同列表
│       │   ├── MyListings.jsx   ← 我的房源管理（房东）
│       │   ├── ProfilePage.jsx  ← 个人中心
│       │   └── VerifyPage.jsx   ← 链上验证工具
│       └── utils/
│           ├── api.js           ← API 请求封装
│           └── RentalChainABI.json ← 合约 ABI
│
├── scripts/
│   ├── deploy.js                ← CampusTrade 部署脚本
│   └── deploy_rental.js         ← RentalChain 部署脚本
│
├── start.bat                    ← Windows 一键启动（本地 Hardhat）
├── deploy-sepolia.bat           ← 部署到 Sepolia 测试网
├── hardhat.config.js
└── .env                         ← 私钥配置（不提交 git）
```

---

## 🚀 快速启动（本地开发）

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [MetaMask](https://metamask.io/) 浏览器扩展
- 可选：[SepoliaETH 测试币](https://sepolia-faucet.pk910.de/)（用于测试网上链）

### 方式一：直接使用已部署的 Sepolia 合约（无需本地链）

> 合约已部署在 Sepolia 测试网：`0x2282DDE81F8F591D036DF5f710f595038209281b`

```bash
# 1. 安装前端依赖
cd rental-frontend
npm install

# 2. 启动前端
npm run dev    # → http://localhost:3002

# 3. 安装后端依赖
cd ../backend
npm install

# 4. 启动后端
node src/index.js    # → http://localhost:3001
```

**MetaMask 配置**：
- 网络：Sepolia 测试网
- 领取测试币后即可使用

### 方式二：本地 Hardhat 链 + 重新部署

```bash
# 双击 start.bat 一键启动
# 或手动执行：

# 1. 启动本地区块链
npx hardhat node    # 终端 1

# 2. 部署合约
npx hardhat run scripts/deploy_rental.js --network localhost   # 终端 2

# 3. 部署后更新合约地址
# 编辑 rental-frontend/src/pages/ContractPage.jsx 中的 CONTRACT_ADDR

# 4. 启动后端
cd backend && node src/index.js   # 终端 3

# 5. 启动前端
cd rental-frontend && npm run dev # 终端 4
```

---

## 🧪 完整流程测试

```bash
# 注册房东
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800001111","password":"123456","role":"landlord","nickname":"张房东"}'

# 注册租客
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"13900002222","password":"123456","role":"tenant","nickname":"李租客"}'

# 房东发布房源（需替换 token）
curl -X POST http://localhost:3001/api/listings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <房东token>" \
  -d '{"title":"朝阳区精装两居室","description":"交通便利","address":"北京市朝阳区","rentAmount":"0.05","depositMonths":2}'

# 租客申请租房（需替换 token）
curl -X POST http://localhost:3001/api/contracts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <租客token>" \
  -d '{"listingId":"<房源ID>"}'

# 租客签署
curl -X POST http://localhost:3001/api/contracts/<合同ID>/sign-tenant \
  -H "Authorization: Bearer <租客token>"

# 房东签署（含链上哈希存证）
curl -X POST http://localhost:3001/api/contracts/<合同ID>/sign-landlord \
  -H "Authorization: Bearer <房东token>"

# 验证合同存证
curl http://localhost:3001/api/verify/contract/<合同ID>
```

---

## 🔗 智能合约接口

### RentalChain.sol — Sepolia: `0x2282DDE81F8F591D036DF5f710f595038209281b`

| 方法 | 说明 | 调用者 |
|------|------|--------|
| `storeListing(listingId, aiScore, imageHashes)` | 房源创世存证 | 房东 |
| `storeContract(contractId, listingId, contractHash, tenant, landlord)` | 合同哈希上链 | 任一方 |
| `payDeposit(contractId)` | 支付押金到合约 | 租客 |
| `requestRefund(contractId)` | 申请退押金 | 租客 |
| `confirmRefund(contractId)` | 确认全额退押金 | 房东 |
| `proposeDeduction(contractId, amount, reason)` | 提出扣款方案 | 房东 |
| `acceptDeduction(contractId)` | 接受扣款方案 | 租客 |
| `disputeDeposit(contractId)` | 发起纠纷 | 任一方 |
| `resolveDeposit(contractId, toTenant)` | 仲裁裁决 | 管理员 |

---

## ⚖️ 法律合规

系统遵循以下法律法规设计：

| 法规 | 对应实现 |
|------|----------|
| 《民法典》租赁合同 | 合同模板包含法定必备条款（当事人、标的、租期、租金、押金、违约责任） |
| 《电子签名法》 | 双方各自签署意愿确认 + 合同哈希上链存证 |
| 《网络安全法》 | 手机号+密码注册、密码 bcrypt 加密、JWT 令牌认证 |
| 《个人信息保护法》 | 演示阶段仅收集必要信息（手机号、密码、钱包地址） |

> 演示环境使用手机号代替身份证实名。答辩时说明："生产环境需对接公安部实名认证服务。"

---

## 🛡️ 安全措施

- **SQL 注入防御**：所有查询使用 `?` 参数化占位符
- **密码安全**：bcrypt 哈希（10 轮 salt）
- **认证**：JWT 令牌（7天过期）
- **速率限制**：15分钟内每个 IP 最多100次请求，登录接口10次
- **HTTP 安全头**：helmet 中间件
- **CORS**：仅允许配置的前端来源
- **智能合约**：Checks-Effects-Interactions 模式、权限修饰符、管理员仲裁

---

## 📝 配置说明

### .env 文件

```bash
# Sepolia 测试网 RPC
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com

# 部署钱包私钥（从 MetaMask 导出，不提交 git）
# 注意：该钱包需要有 SepoliaETH 作为 Gas 费
PRIVATE_KEY=your_private_key_here
```

### 后端配置 (`backend/src/index.js`)

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | API 服务端口 |
| `JWT_SECRET` | `xinyuanlian-dev-secret-...` | JWT 签名密钥（生产环境需修改） |

### 前端配置

| 文件 | 配置项 | 说明 |
|------|--------|------|
| `vite.config.js` | `server.port` | 前端端口（默认 3002） |
| `vite.config.js` | `proxy./api.target` | 后端代理地址 |
| `pages/ContractPage.jsx` | `CONTRACT_ADDR` | RentalChain 合约地址 |

---

## 🧰 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 区块链 | Solidity + Hardhat + Ethers.js | 0.8.20 / ^6 |
| 后端 | Node.js + Express + SQLite | ^24 |
| 前端 | React + Vite + Tailwind CSS | 18 / 5 / 3 |
| 合约网络 | Ethereum Sepolia 测试网 | — |
| 钱包 | MetaMask | — |

---

## 📄 License

MIT
