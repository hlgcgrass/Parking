@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo ==========================================
echo   停车攻略 · 后端服务
echo   启动后请不要关闭这个窗口
echo   真机调试请把小程序 utils/config.js 里的
echo   USE_LAN 改成 true，并填写下面显示的局域网 IP
echo ==========================================
echo.
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

"%NODE_EXE%" "%~dp0server.js"
pause
