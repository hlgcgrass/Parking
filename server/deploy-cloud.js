/**
 * 云函数一键部署（微信云开发）
 * ------------------------------------------------------------
 * 用官方 miniprogram-ci 把 cloudfunctions/parking 上传部署到云环境，
 * 省去在 IDE 里右键上传的人工操作。
 *
 * 前置：需要「小程序代码上传密钥」
 *   微信公众平台 → 开发与服务 → 开发管理 → 开发设置 → 代码上传密钥 → 下载
 *   把下载的 private.<appid>.key 放到本文件同级的 keys/ 目录下
 *   注意：还要在该页面配置 IP 白名单，或直接关闭 IP 白名单限制
 *
 * 运行：双击 deploy-cloud.bat，或 node server/deploy-cloud.js
 */
const path = require('path');
const fs = require('fs');

let ci;
try {
  ci = require(path.join(__dirname, 'node_modules', 'miniprogram-ci'));
} catch (e) {
  ci = require('miniprogram-ci');
}

const APPID = process.env.PARKING_APPID || 'wx74cf1625553c595b';
const ENV_ID = process.env.PARKING_CLOUD_ENV || 'cloud1-d1guhoh9g9abdbb63';
const FUNC_NAME = process.env.PARKING_CLOUD_FUNCTION || 'parking';

const PROJECT_PATH = path.join(__dirname, '..', 'parking-miniapp');
const FUNC_PATH = path.join(PROJECT_PATH, 'cloudfunctions', FUNC_NAME);
const KEY_DIR = path.resolve(process.env.PARKING_UPLOAD_KEY_DIR || path.join(__dirname, 'keys'));

function findKey() {
  if (!fs.existsSync(KEY_DIR)) return null;
  const files = fs.readdirSync(KEY_DIR).filter(f => f.endsWith('.key'));
  return files.length ? path.join(KEY_DIR, files[0]) : null;
}

(async () => {
  console.log('================ 停车攻略 · 云函数部署 ================');
  console.log('环境 ID :', ENV_ID);
  console.log('云函数  :', FUNC_NAME);
  console.log('项目路径:', PROJECT_PATH);
  console.log('');

  if (!fs.existsSync(FUNC_PATH)) {
    console.error('❌ 未找到云函数目录：' + FUNC_PATH);
    process.exit(1);
  }

  const keyPath = findKey();
  if (!keyPath) {
    console.error([
      '',
      '❌ 未找到代码上传密钥',
      '',
      '  请把 private.' + APPID + '.key 放到这个目录：',
      '  ' + KEY_DIR,
      '',
      '  获取步骤：',
      '  1. 打开 https://mp.weixin.qq.com 登录小程序后台',
      '  2. 开发与服务 → 开发管理 → 开发设置 → 代码上传密钥 → 生成/下载',
      '  3. 同页面「IP白名单」要么填上你的公网 IP，要么临时关闭',
      '  4. 把下载的 .key 文件放进上面的 keys 目录，再双击本脚本',
      ''
    ].join('\n'));
    process.exit(1);
  }

  console.log('使用密钥:', path.basename(keyPath));

  let project;
  try {
    project = new ci.Project({
      appid: APPID,
      type: 'miniProgram',
      projectPath: PROJECT_PATH,
      privateKeyPath: keyPath,
      ignores: ['node_modules/**/*', 'cloudfunctions/**/*']
    });
  } catch (e) {
    console.error('❌ 项目初始化失败：' + e.message);
    process.exit(1);
  }

  console.log('');
  console.log('正在上传并安装依赖（首次约需 30~60 秒，请稍候）...');

  try {
    const res = await ci.cloud.uploadFunction({
      project,
      env: ENV_ID,
      name: FUNC_NAME,
      path: FUNC_PATH,
      remoteNpmInstall: true
    });
    console.log('');
    console.log('✅ 云函数部署成功！');
    if (res) console.log('   返回:', typeof res === 'string' ? res : JSON.stringify(res));
    console.log('');
    console.log('下一步：在微信开发者工具里重新编译小程序即可（集合会在云函数首次被调用时自动创建）。');
  } catch (e) {
    const msg = e.message || String(e);
    console.error('');
    console.error('❌ 部署失败：' + msg);
    if (/白名单|iplist|not in white list/i.test(msg)) {
      console.error('   → 请在小程序后台「开发设置」把当前公网 IP 加入白名单，或关闭 IP 白名单限制');
    } else if (/privateKey|密钥|decrypt/i.test(msg)) {
      console.error('   → 密钥文件无效或不匹配当前 AppID，请重新下载');
    } else if (/env/i.test(msg)) {
      console.error('   → 云环境 ID 不正确，请检查云开发控制台里的环境 ID');
    }
    process.exit(1);
  }
})();
