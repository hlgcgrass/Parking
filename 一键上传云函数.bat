@echo off
chcp 65001 >nul
title Parking Cloud Function Deploy
cd /d "%~dp0"

set "NODE_EXE=C:\Users\Grass\.workbuddy\binaries\node\versions\22.22.2-2\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

"%NODE_EXE%" "I:\ChatGPT\Parking\server\upload-cloudfn.js"

echo.
pause
