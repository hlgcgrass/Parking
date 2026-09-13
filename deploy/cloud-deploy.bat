@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0.."
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

rem 可通过 WECHAT_IDE_DIR 指定本机微信开发者工具目录
if not defined WECHAT_IDE_DIR set "WECHAT_IDE_DIR=%ProgramFiles(x86)%\Tencent\微信web开发者工具"
if not exist "%WECHAT_IDE_DIR%\cli.bat" if defined ProgramFiles set "WECHAT_IDE_DIR=%ProgramFiles%\Tencent\微信web开发者工具"

set "CLI=%WECHAT_IDE_DIR%\cli.bat"
set "ENV=%PARKING_CLOUD_ENV%"
if not defined ENV set "ENV=cloud1-d1guhoh9g9abdbb63"
set "PROJECT=%ROOT%\parking-miniapp"

if not exist "%CLI%" (
  echo [错误] 未找到微信开发者工具 CLI：%CLI%
  echo 请确认微信开发者工具已安装，或设置环境变量 WECHAT_IDE_DIR。
  pause
  exit /b 1
)

echo 正在上传 parking 云函数（云端安装依赖）...
call "%CLI%" cloud functions deploy --env "%ENV%" --names parking --project "%PROJECT%" --remote-npm-install --lang zh

echo.
echo 部署完成。若改了 cloudfunctions/parking/data.json 或 index.js，重传后即生效。
echo （改了 data.json 想重导数据库，需先在云函数配置设 ADMIN_OPENIDS，再调 migrate）
pause
