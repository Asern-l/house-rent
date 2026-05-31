# 独立验真工具

该目录用于承载与平台后端隔离的独立验真程序。

设计原则：
- 不放在 `apps/backend` 目录中
- 独立安装依赖
- 只连接链上和 IPFS，不依赖平台账号系统
- 以本地 Web 前端作为正式入口，底层保留 node 脚本便于开发调试

当前入口：
- `verifier/server.js`
- `verifier/scripts/verify-contract-pdf.js`
- `verifier/scripts/verify-listing.js`

当前支持：
- 合同 PDF 独立验真
- 房源独立验真
- 房源详情查看
- 房源反馈与租后评价的链上 `commentCid` 联动读取
- 可选查询房源全部快照历史版本

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
- 校验合同锚点
- 若 PDF 内含房源标识，则顺带校验关联房源

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
