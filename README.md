# 🏠 信源链 · 区块链租房平台

基于以太坊智能合约的去中心化租房平台，实现**房源信息存证、电子合同链上签署、押金托管结算**全流程上链。

---

## 📋 项目概述

```
contracts/        ← 智能合约（Solidity）
backend/          ← 后端 API（Node.js + Express + SQLite）
rental-frontend/  ← 前端页面（React + Vite + Tailwind）
```

---

## 🚀 环境搭建（从零开始）

### 1️⃣ 安装前置软件

| 软件 | 版本要求 | 下载地址 | 用途 |
|:----|:--------:|:--------:|:----:|
| **Node.js** | ≥ 18 | https://nodejs.org/ | 运行后端和前端 |
| **Git** | 任意 | https://git-scm.com/ | 下载代码 |
| **MetaMask** | 最新 | 浏览器扩展商店 | 区块链钱包 |

### 2️⃣ 下载项目

```bash
git clone https://github.com/Asern-l/house-rent.git
cd house-rent
```

### 3️⃣ 安装依赖

**三个目录都需要安装**，请依次执行：

```bash
# 1. 安装智能合约编译工具
npm install

# 2. 安装后端
cd backend
npm install
cd ..

# 3. 安装前端
cd rental-frontend
npm install
cd ..
```

> ⏳ 每个 `npm install` 首次执行可能需要 1-3 分钟，请耐心等待

### 4️⃣ 编译智能合约

```bash
npx hardhat compile
```

看到 `Compiled 1 Solidity file successfully` 即编译成功。

### 5️⃣ 启动本地区块链

```bash
npx hardhat node
```

这会启动一条本地测试链，并输出 20 个测试账户（每个有 10000 ETH）。**让这个终端保持运行，不要关闭。**

```
终端 1 ── npx hardhat node  ← 本地区块链
```

### 6️⃣ 部署合约

**新开一个终端**，执行：

```bash
# Windows
cd 项目路径
npx hardhat run scripts/deploy_rental.js --network localhost
```

部署成功后会输出合约地址，例如：
```
✅ 部署成功！
📄 合约地址: 0x5FbDB2315678afecb367f032d93F642f64180aa3
```

把这个地址记下来，下一步要用。

```
终端 1 ── npx hardhat node       ← 本地区块链
终端 2 ── hardhat deploy ...     ← 部署合约（执行完可关闭）
```

### 7️⃣ 配置合约地址

打开 `rental-frontend/src/pages/ContractPage.jsx`，找到：

```javascript
const CONTRACT_ADDR = '0x...';
```

把它改为上一步得到的地址。

### 8️⃣ 启动后端

```bash
# 新开终端
cd 项目路径/backend
node src/index.js
```

看到以下输出即启动成功：
```
🏠 信源链 - 区块链租房平台后端
🌐 http://localhost:3001
```

```
终端 1 ── npx hardhat node       ← 本地区块链
终端 2 ── node src/index.js       ← 后端 API
```

### 9️⃣ 启动前端

```bash
# 新开终端
cd 项目路径/rental-frontend
npm run dev
```

浏览器自动打开 `http://localhost:3002`。

```
终端 1 ── npx hardhat node       ← 本地区块链
终端 2 ── node src/index.js       ← 后端 API
终端 3 ── npm run dev             ← 前端页面
```

### 🔟 配置 MetaMask

1. 打开 MetaMask → 点击网络切换 → **添加网络**
2. 填写：

| 字段 | 值 |
|:----|:----|
| 网络名称 | `Hardhat Local` |
| RPC URL | `http://127.0.0.1:8545` |
| 链 ID | `31337` |
| 货币符号 | `ETH` |

3. 导入测试账户：
   - MetaMask → 点击圆形头像 → **导入账户**
   - 私钥：`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
   - 这个账户有 10000 ETH，仅供本地测试

### ✅ 启动完成

访问 **http://localhost:3002**，点击右上角「登录」按钮。

---

## 🎮 完整使用教程

### 步骤 1：注册两个账号（房东 + 租客）

| 角色 | 手机号 | 密码 | 昵称 | 说明 |
|:----:|:------:|:----:|:----:|:----:|
| 🔑 房东 | 13800001111 | 123456 | 张房东 | 发布房源 |
| 🏠 租客 | 13900002222 | 123456 | 李租客 | 租房 |

> 注册时选择正确的角色（房东/租客），**同一个浏览器可以登录后注销再注册另一个账号**

### 步骤 2：房东发布房源

1. 用 **房东** 账号登录
2. 点击导航栏 **「发布」**
3. 填写房源信息：
   - 标题：`朝阳区精装两居室`
   - 描述：`交通便利，家具齐全`
   - 地址：`北京市朝阳区建国路88号`
   - 月租金：`0.05`
   - 其他字段可选填
4. 点击 **发布房源（AI检测将自动进行）**
5. 发布成功后自动跳转到房源详情页，显示 AI 可信度评分

### 步骤 3：租客申请租房

1. 退出房东账号，用 **租客** 账号登录
2. 点击 **「房源」** → 浏览已发布的房源
3. 点击进入房源详情 → 点击 **「申请租房」**
4. 系统自动生成合同草稿

### 步骤 4：租客签署合同

1. 在合同页面查看合同内容
2. 点击 **「✍️ 同意签署（租客）」**
3. 签署成功后状态变为「租客已签，待房东签署」

### 步骤 5：房东签署合同（哈希上链）

1. 退出租客账号，用 **房东** 账号登录
2. 点击 **「合同」** → 找到待签合同
3. 点击进入合同详情
4. 连接 MetaMask（点击右上角「绑钱包」）
5. 确保 MetaMask 切换到 **Hardhat Local** 网络
6. 点击 **「✍️ 同意签署（房东）」**
7. MetaMask 弹出交易确认 → 点击 **「确认」**
8. 合同哈希自动上链，页面显示「✅ 本合同哈希已上链存证」

### 步骤 6：验证存证

1. 点击导航栏 **「验证」**
2. 选择 **验证合同**
3. 输入合同 ID（从合同页面复制）
4. 点击验证，看到：
   - ✅ **哈希匹配: true**
   - ✅ **合同自签署以来未被修改**

---

## 🏗️ 项目结构详解

```
house-rent/
├── contracts/
│   └── RentalChain.sol        ← 智能合约（核心）
│       ├── storeListing()      ← 房源信息存证
│       ├── storeContract()     ← 合同哈希上链
│       ├── payDeposit()        ← 支付押金
│       ├── requestRefund()     ← 申请退押金
│       ├── confirmRefund()     ← 全额退押金
│       ├── proposeDeduction()  ← 扣除部分押金
│       ├── acceptDeduction()   ← 接受扣款
│       ├── disputeDeposit()    ← 押金纠纷
│       └── resolveDeposit()    ← 仲裁裁决
│
├── backend/src/
│   ├── index.js               ← 后端入口（端口 3001）
│   ├── db.js                  ← SQLite 数据库
│   ├── auth.js                ← JWT 认证
│   └── routes/
│       ├── auth.js            ← 注册/登录
│       ├── listings.js        ← 房源 API
│       ├── contracts.js       ← 合同 API
│       └── verify.js          ← 验证 API
│
├── rental-frontend/src/
│   ├── App.jsx                ← 应用主路由
│   ├── context/AuthContext.jsx ← 登录认证
│   └── pages/
│       ├── HomePage.jsx       ← 首页
│       ├── LoginPage.jsx      ← 登录/注册
│       ├── ListingsPage.jsx   ← 房源列表
│       ├── ListingDetail.jsx  ← 房源详情
│       ├── PublishListing.jsx ← 发布房源
│       ├── ContractPage.jsx   ← 合同签署（⭐ 核心）
│       ├── MyContracts.jsx    ← 我的合同
│       ├── MyListings.jsx     ← 我的房源
│       ├── ProfilePage.jsx    ← 个人中心
│       └── VerifyPage.jsx     ← 链上验证
│
├── scripts/
│   └── deploy_rental.js       ← 合约部署脚本
│
└── hardhat.config.js          ← 区块链配置
```

---

## 🔧 常见问题

### Q：启动后页面空白/报错？
检查三个终端是否都正常运行，以及合约地址是否正确配置。

### Q：MetaMask 提示「交易失败」？
确保 MetaMask 已切换到 Hardhat Local 网络（chain ID 31337），且账户有测试 ETH。

### Q：如何重新开始？
删除 `backend/database.sqlite` 后重启后端，即可清空所有数据重新开始。

### Q：如何部署到 Sepolia 测试网？
参考 `scripts/deploy_rental.js`，修改 `hardhat.config.js` 中的 `sepolia` 网络配置，
然后执行：
```bash
npx hardhat run scripts/deploy_rental.js --network sepolia
```

---

## 📄 License

MIT
