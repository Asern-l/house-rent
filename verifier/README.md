# 独立验真工具

该目录用于承载与平台后端隔离的独立验真程序。

设计原则：
- 不放在 `apps/backend` 目录中
- 独立安装依赖
- 只连接链上和 IPFS，不依赖平台账号系统
- 同时保留 CLI 入口和本地 Web 前端

当前入口：
- `verifier/server.js`
- `verifier/scripts/verify-contract-pdf.js`
- `verifier/scripts/verify-listing.js`

首次使用：
```powershell
cd verifier
npm install
```

启动独立验真前端：
```powershell
powershell -ExecutionPolicy Bypass -File ..\scripts\ps1\start-verifier.ps1
```

或：
```powershell
cd verifier
npm start
```

启动后访问：
- `http://127.0.0.1:3010`

CLI 示例：
```powershell
node verifier/scripts/verify-listing.js --listing-id lst_xxx --network sepolia
node verifier/scripts/verify-contract-pdf.js --pdf D:\contracts\cnt_xxx.pdf --network sepolia
```
