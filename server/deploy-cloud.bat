@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   停车攻略 · 云函数一键部署
echo ============================================
echo.

set NODE_EXE=C:\Users\Grass\.workbuddy\binaries\node\versions\22.22.2-2\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node

"%NODE_EXE%" deploy-cloud.js

echo.
echo --------------------------------------------
pause
