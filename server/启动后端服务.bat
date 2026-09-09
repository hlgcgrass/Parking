@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==========================================
echo   停车攻略 · 后端服务
echo   启动后请不要关闭这个窗口
echo   真机调试请把小程序 utils/config.js 里的
echo   USE_LAN 改成 true，并填写下面显示的局域网 IP
echo ==========================================
echo.
"C:\Users\Grass\.workbuddy\binaries\node\versions\22.22.2-2\node.exe" server.js
pause
