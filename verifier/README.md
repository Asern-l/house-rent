# 独立验真工具

`verifier` 是链上安居的独立验真工具。它与平台账号系统分离，面向合同 PDF、房源链上记录、IPFS 公开材料和房东应急托管月租释放提供本地 Web 页面。

## 1. 功能

- 合同 PDF 验真。
- 房源验真。
- 房源详情查询。
- 合约配置管理。
- 从 PDF 或可复制参数导入合约配置。
- 房东钱包触发应急托管月租释放。
- 房源反馈和租后评价材料校验。

## 2. 安装

```powershell
cd verifier
npm install
```

## 3. 启动

Windows：

```powershell
powershell -ExecutionPolicy Bypass -File ..\scripts\ps1\start-verifier.ps1
```

macOS：

```bash
bash ../scripts/mac/start-verifier.sh
```

访问地址：

```text
http://127.0.0.1:3010
```

也可以在 `verifier` 目录直接运行：

```bash
npm start
```

## 4. 合约配置

独立验真工具使用保存的合约配置连接链上合约。配置项包括：

- 配置名称。
- 链 ID。
- RPC URL。
- `RentalChain` 合约地址。
- 合约部署时间。

合同 PDF 中的蓝色参数块可导入合约配置。配置名称可由用户自定义，同一链可以保存多个不同配置名称。

## 5. 合同 PDF 验真

合同 PDF 验真会读取 PDF 内嵌的验真材料：

- 合同编号。
- 房源编号。
- 链 ID。
- `RentalChain` 合约地址。
- 合同正文 JSON Base64 分块。
- 租客和房东签名消息 Base64 分块。
- 租客和房东签名值 Base64 分块。
- 合同内容哈希。
- 签名消息哈希。

验真流程：

1. 从 PDF 提取合同正文、签名消息和签名值。
2. 本地重算合同 `contentHash`。
3. 本地重算租客和房东消息哈希。
4. 使用签名值恢复钱包地址。
5. 读取链上合同记录。
6. 比对合同编号、房源编号、哈希、签名哈希、签署时间和支付状态。
7. 按中国时间展示合同时间线。

勾选“顺带验证合同关联房源”后，会同步验证合同关联房源。

## 6. 房源验真

房源验真使用房源 ID 读取链上房源记录和公开快照，校验：

- 房源编号。
- 房东钱包。
- 内容哈希。
- 租金。
- 最短租期。
- 图片哈希根。
- 房源状态。
- 版本号和 nonce。
- IPFS 快照内容。

## 7. 房源详情

房源详情查询返回：

- 当前链上房源记录。
- 最新公开快照。
- 图片 CID 与 Gateway 地址。
- 房源反馈。
- 租后评价。
- 可选历史快照版本。

评论材料会按 `commentCid` 从 IPFS 读取，并重算 `commentHash` 与链上事件比对。

## 8. 应急托管月租释放

“应急操作”页面用于房东在本地触发托管月租释放：

1. 选择已保存的合约配置。
2. 输入合同 ID。
3. 查询释放状态。
4. 可释放时使用房东钱包发起 `releaseDueRent(contractId)` 交易。

工具不会接触或保存房东私钥。交易由浏览器钱包签名。

## 9. 底层脚本
底层脚本用于开发调试：

```powershell
node verifier/scripts/verify-listing.js --listing-id lst_xxx --network sepolia
node verifier/scripts/verify-contract-pdf.js --pdf D:\contracts\cnt_xxx.pdf --network sepolia
```

正式使用入口是本地 Web 页面。