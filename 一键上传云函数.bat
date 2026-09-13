@echo off
chcp 65001 >nul
title Parking Cloud Function Deploy
setlocal
cd /d "%~dp0"

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

"%NODE_EXE%" "%~dp0server\upload-cloudfn.js"

echo.
pause
