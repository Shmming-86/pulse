@echo off
rem ============================================================
rem Pulse 看板 - Windows 一键启动（生产模式）
rem 双击运行或命令行执行；Ctrl+C 停止服务
rem ============================================================
chcp 65001 >nul
title Pulse Kanban

rem 切换到项目根目录（deploy 的上一级）
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 22.5 或更高版本（需内置 SQLite）: https://nodejs.org
  pause
  exit /b 1
)

rem ---- 生产环境变量（可按需修改） ----
set NODE_ENV=production
set HOST=127.0.0.1
set PORT=4173
set SEED_MODE=empty

echo ============================================
echo   Pulse 看板  http://127.0.0.1:4173
echo   数据目录: %cd%\data
echo   停止服务: 在本窗口按 Ctrl+C
echo ============================================
start "" http://127.0.0.1:4173
node server/index.js
pause
