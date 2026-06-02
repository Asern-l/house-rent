# 独立验真工具

该目录用于承载与平台后端隔离的独立验真程序。

设计原则：
- 不放在 `apps/backend` 目录中
- 独立安装依赖
- 只连接链上和 IPFS，不依赖平台账号系统
- 以本地 Web 前端作为正式入口，底层保留 node 脚本便于开发调试
- 默认运行参数使用 `verifier/config/runtime.json` 独立维护，不直接依赖 `blockchain/` 部署文件

当前入口：
- `verifier/server.js`
- `verifier/scripts/verify-contract-pdf.js`
- `verifier/scripts/verify-listing.js`

独立运行参数：
- `verifier/config/runtime.json`
- 当前用于维护：
  - `sepolia.chainId`
  - `sepolia.rpcUrl`
  - `sepolia.contractAddress`
  - `local.chainId`
  - `local.rpcUrl`
  - `local.contractAddress`
- 说明：
  - `合同 PDF 验真` 默认优先读取 PDF 内嵌的 `chainEnv / chainId / contractAddress`
  - `房源验真` 与 `房源详情` 默认读取 `verifier/config/runtime.json`
  - 表单中的 `RPC URL / 合约地址` 仍可作为高级覆盖项手动填写

当前支持：
- 合同 PDF 独立验真
- 房源独立验真
- 房源详情查看
- 房源反馈与租后评价的链上 `commentCid` 联动读取
- 可选查询房源全部快照历史版本

合同 PDF 强校验说明：
- verifier 不再只读取 `VERIFY_CONTENT_HASH` 之类的摘要字段
- 新版 PDF 内同时嵌入：
  - 完整合同 JSON 的 Base64 分块
  - 完整租客/房东签名消息原文的 Base64 分块
  - 完整租客/房东签名值的 Base64 分块
- 验真时会本地：
  - 重算合同 `contentHash`
  - 重算租客/房东消息哈希
  - 使用签名值恢复地址并自验签
- 旧 PDF 兼容已取消；缺少强校验材料的旧文件会被拒绝，需要重新下载新 PDF

首次使用：
```powershell
cd verifier
npm install
```

启动独立验真前端：
```powershell
powershell -ExecutionPolicy Bypass -File ..\scripts\ps1\start-verifier.ps1
```

说明：
- Windows 启动脚本会先检查 `3010` 端口；若已有旧 verifier 进程占用，会先停止旧进程再重启新实例。

或：
```powershell
cd verifier
npm start
```

启动后访问：
- `http://127.0.0.1:3010`

页面功能：
1. `合同 PDF 验真`
- 上传本地 PDF
- 重算合同哈希并本地自验签
- 若 PDF 内含房源标识，则顺带校验关联房源
- 合同结果页会额外显示：
  - 首笔付款是否已记录
  - 合同当前是否已生效
  - 合同是否已到期
  - 合同时间线（统一按中国时间显示）

PDF 排版说明：
- 合同正文单独成页
- 验真摘要单独成页
- 验真摘要页会额外提供显眼的“可复制验真参数”区块，直接展示：
  - `VERIFY_CONTRACT_ID`
  - `VERIFY_CHAIN_ENV`
  - `VERIFY_CHAIN_ID`
- `VERIFY_RENTAL_CHAIN_ADDRESS`
  - 指 `RentalChain` 链上智能合约地址，不是业务合同编号
- 验真材料明文区单独成页
- `VERIFY_*` 与 `*_B64_*` 机器标记单独作为附录页，弱化显示，不与正文混排

2. `房源验真`
- 输入 `listingId`
- 默认自动读取该房源最新链上快照锚点
- 可选提供 `snapshotCid / snapshotHash`
- 可选按 `atSec` 追溯历史版本验真

3. `房源详情`
- 输入 `listingId`
- 返回当前链上房源、最新公开快照、图片、反馈与租后评价
- 可选勾选“同时查询全部历史版本”，读取全部链上快照历史

底层 node 脚本示例（仅用于开发调试）：
```powershell
node verifier/scripts/verify-listing.js --listing-id lst_xxx --network sepolia
node verifier/scripts/verify-contract-pdf.js --pdf D:\contracts\cnt_xxx.pdf --network sepolia
```
