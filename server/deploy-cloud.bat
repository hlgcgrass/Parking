@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ============================================
echo   停车攻略 · 云函数一键部署
echo ============================================
echo.

rem 可通过 PARKING_NODE_EXE 指定本机 Node.js；未指定时使用 PATH 中的 node
if defined PARKING_NODE_EXE (
  set "NODE_EXE=%PARKING_NODE_EXE%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [错误] 未找到 Node.js，请安装 Node.js 并将 node 加入 PATH。
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

"%NODE_EXE%" "%~dp0deploy-cloud.js"

echo.
echo --------------------------------------------
pause
