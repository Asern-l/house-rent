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
- 按合同ID进行哈希校验和上链状态查询。
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

## 快速启动
1. 安装后端依赖
```bash
npm --prefix apps/backend install
```
2. 安装前端依赖
```bash
npm --prefix apps/frontend install
```
3. 启动后端
```bash
npm --prefix apps/backend run dev
```
4. 启动前端
```bash
npm --prefix apps/frontend run dev
```

或执行一键脚本：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-basic-services.ps1
```

## 关键文档
- 接口文档：`docs/后端接口与前端调用文档.md`
- 结构说明：`docs/项目结构与文件职责说明.md`
- 部署教程：`docs/配置与部署教程.md`
- 待实现清单：`docs/待实现_合同签署模块.md`、`docs/待实现_房源AI评分模块.md`

## 当前范围说明
- 当前版本以“系统原型可运行”为目标。
- 房源图片上传、房源上链完整闭环、实名/CA 等功能已记录待实现，未作为当前必做项。
