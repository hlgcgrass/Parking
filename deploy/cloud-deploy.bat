@echo off
chcp 65001 >nul
setlocal
set CLI="C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat"
set ENV=cloud1-d1guhoh9g9abdbb63
set PROJECT=I:\ChatGPT\Parking\parking-miniapp

if not exist %CLI% (
  echo [错误] 未找到微信开发者工具 CLI：%CLI%
  echo 请确认微信开发者工具已安装并登录。
  pause
  exit /b 1
)

echo 正在上传 parking 云函数（云端安装依赖）...
%CLI% cloud functions deploy --env %ENV% --names parking --project %PROJECT% --remote-npm-install --lang zh

echo.
echo 部署完成。若改了 cloudfunctions/parking/data.json 或 index.js，重传后即生效。
echo （改了 data.json 想重导数据库，需先在云函数配置设 ADMIN_OPENIDS，再调 migrate）
pause
