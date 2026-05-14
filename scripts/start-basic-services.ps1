# 文件说明：启动基础服务脚本。
# 功能：一键启动后端与前端开发服务。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'apps\\backend'
$frontend = Join-Path $root 'apps\\frontend'

Write-Host '开始安装依赖（若已安装会很快结束）...'
Push-Location $backend
npm install
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$backend'; npm run dev"
Pop-Location

Push-Location $frontend
npm install
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$frontend'; npm run dev"
Pop-Location

Write-Host '已启动：后端 http://localhost:3010 ，前端按 Vite 输出端口访问。'
