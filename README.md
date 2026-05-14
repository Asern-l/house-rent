# CCL Housing（信源链租房原型）

## 项目简介
CCL Housing 是一个以“合同签署上链存证”为主线的区块链租房系统原型。  
当前重点是跑通房源发布、合同签署、合同哈希上链、验真查询的端到端流程。

## 核心功能
1. 用户与权限
- 租客/房东双角色注册与登录。
- JWT 鉴权与个人资料管理（钱包强绑定：首次绑定后不可更改/解绑，仅支持重连同一地址）。

2. 房源管理
- 房东发布房源。
- 房源列表与详情浏览。
- 房东可对房源执行上下架。

3. 合同签署与上链
- 租客发起合同。
- 租客签署、房东签署，合同状态机流转。
- 房东签署后可调用合约写入合同哈希。
- 上链交易哈希回写后端用于追踪。

4. 验真与日志
- 按合同 ID 进行哈希校验和上链状态查询。
- 签署失败日志自动记录到日志文件。

## 架构组成

### 1. 前端（`apps/frontend`）
- 技术栈：React + Vite + Tailwind。
- 主要职责：
  - 登录注册、房源发布/浏览、合同签署流程页面。
  - 调用 MetaMask 发起链上交易。
  - 调用后端 API 完成业务状态回写。

### 2. 后端（`apps/backend`）
- 技术栈：Node.js + Express + sql.js。
- 主要职责：
  - 用户、房源、合同、验真 API。
  - 合同状态机和权限控制。
  - 交易哈希回写与签署异常日志记录。

### 3. 合约（`blockchain`）
- 技术栈：Solidity + Hardhat。
- 主要职责：
  - 房源最小存证（listingId）。
  - 合同哈希存证。
  - 押金状态机与租金存证事件（已定义，系统侧部分未闭环）。

### 4. 文档与日志
- `docs`：接口文档、结构文档、待实现清单、部署教程。
- `logs`：运行期日志（重点为签署错误日志）。

## 目录结构
- `apps/backend`：后端源码
- `apps/frontend`：前端源码
- `blockchain`：合约与部署脚本
- `docs`：项目文档
- `logs`：运行日志
- `scripts`：一键启动与测试脚本

## 合约部署优先（推荐流程）
1. 安装依赖
```bash
npm --prefix apps/backend install
npm --prefix apps/frontend install
npm --prefix blockchain install
```

2. 配置部署环境变量
- 复制：`blockchain/.env.example` -> `blockchain/.env`
- 填写：
```env
SEPOLIA_RPC_URL=https://ethereum-sepolia.publicnode.com
PRIVATE_KEY=0x你的部署私钥
```

3. 部署合约（Sepolia）
```bash
npm --prefix blockchain run compile
npm --prefix blockchain run deploy:sepolia
```

4. 回填前端合约地址
- 在 `apps/frontend/.env` 中设置：
```env
VITE_CONTRACT_ADDRESS=0x部署输出的合约地址
```
- 当前前端已移除本地默认地址兜底，未配置或配置错误将直接阻断链上操作。

5. 配置后端环境变量
- 复制：`apps/backend/.env.example` -> `apps/backend/.env`
- 至少填写：
```env
JWT_SECRET=change_me_to_a_long_random_string
PORT=3000
```

6. 启动后端与前端
```bash
npm --prefix apps/backend run dev
npm --prefix apps/frontend run dev
```

## 本地快速启动（不部署合约）
1. 安装依赖
```bash
npm --prefix apps/backend install
npm --prefix apps/frontend install
```

2. 配置后端环境变量（首次）
- 复制：`apps/backend/.env.example` -> `apps/backend/.env`
- 至少填写：
```env
JWT_SECRET=change_me_to_a_long_random_string
PORT=3000
```

3. 启动后端与前端
```bash
npm --prefix apps/backend run dev
npm --prefix apps/frontend run dev
```

或使用一键脚本（Windows PowerShell）：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-basic-services.ps1
```

4. 健康检查
- 后端：`http://localhost:3000/api/health`
- 前端：按 Vite 输出地址访问（通常 `http://localhost:5173`）

## 最小闭环验证（不依赖私钥）
执行回归脚本（自动启动临时后端端口并跑通签署主流程）：
```bash
node scripts/test_contract_sign_flow.js
```

说明：
- 该脚本不依赖链上真实私钥，不会发起真实链上交易。
- 若需真实部署合约与链上交易，请看 `docs/配置与部署教程.md`。

## 关键文档
- 接口文档：`docs/后端接口与前端调用文档.md`
- 结构说明：`docs/项目结构与文件职责说明.md`
- 部署教程：`docs/配置与部署教程.md`
- 协作规范：`docs/协作开发规范.md`
- 待实现清单：`docs/待实现_合同签署模块.md`、`docs/待实现_房源AI评分模块.md`

## 当前范围说明
- 当前版本以“系统原型可运行”为目标。
- 房源图片上传、房源上链完整闭环、实名/CA 等功能已记录待实现，未作为当前必做项。
