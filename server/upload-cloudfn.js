/**
 * 停车攻略 · 云函数一键上传（真正的逻辑都在这里，bat 只是入口）
 * ------------------------------------------------------------
 * 流程：
 *   1. 开启 IDE 服务端口（enable-ide-cli.js，需 IDE 未运行）
 *   2. 用 IDE 自带 cli 打开项目（IDE 未启动会自动拉起）
 *   3. cli cloud functions deploy 上传并部署云函数 parking（云端安装依赖）
 *
 * 等价于在 IDE 里右键 cloudfunctions/parking →「上传并部署：云端安装依赖」。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

function resolveIdeDir() {
  const configured = (process.env.WECHAT_IDE_DIR || '').trim();
  if (configured) return path.resolve(configured);

  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Tencent', '微信web开发者工具'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Tencent', '微信web开发者工具')
  ].filter(Boolean);

  return candidates.find((dir) => fs.existsSync(path.join(dir, 'cli.bat'))) || candidates[0] || '';
}

const IDE_DIR = resolveIdeDir();
const CLI_BAT = path.join(IDE_DIR, 'cli.bat');
const NODE_EXE = process.env.PARKING_NODE_EXE || process.execPath;
const PROJ = path.resolve(process.env.PARKING_PROJECT || path.join(ROOT, 'parking-miniapp'));
const ENV_ID = process.env.PARKING_CLOUD_ENV || 'cloud1-d1guhoh9g9abdbb63';
const PORT = process.env.PARKING_IDE_PORT || '9420';
const FN_NAME = process.env.PARKING_CLOUD_FUNCTION || 'parking';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// IDE 已在运行时会监听它自己的端口（如 16298），CLI 必须用同一个端口，
// 否则报「IDE 已启动并在监听 http://127.0.0.1:xxxxx，需要重启才能使用端口 yyyyy」。
// 这里从报错里把真实端口抓出来，自动切换重试一次。
let CUR_PORT = PORT;
function detectPort(out) {
  const m = out && out.match(/127\.0\.0\.1:(\d{2,5})/);
  return m ? m[1] : null;
}

function run(cmd, args, { timeoutMs = 120000, input } = {}) {
  return new Promise((resolve) => {
    console.log(`\n> ${cmd} ${args.join(' ')}\n`);
    // Node 22 安全限制：不允许直接 spawn .bat/.cmd，必须经 cmd.exe /c 中转
    const isScript = /\.(bat|cmd)$/i.test(cmd);
    const spawnCmd = isScript ? 'cmd.exe' : cmd;
    // /c 后使用完整命令行，显式给脚本路径和含空格的参数加引号。
    // 否则 D:\Program Files\... 会被 cmd 截断为 D:\Program。
    const quoteCmdArg = (value) => {
      const text = String(value);
      return /[\s"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const spawnArgs = isScript
      ? ['/d', '/c', [cmd, ...args].map(quoteCmdArg).join(' ')]
      : args;
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: IDE_DIR,
      env: process.env,
      windowsHide: true,
      // cmd.exe 接收的是完整命令行；关闭 Node 默认的 Windows 参数二次转义，
      // 否则含中文目录的 cli.bat 路径会被传成带反斜杠的字面量。
      windowsVerbatimArguments: isScript
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; process.stdout.write(d); });
    if (input !== undefined) child.stdin.write(input);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
}

// 调 cli：带上当前端口；若 IDE 报「已启动并在监听 xxxxx」，自动换端口重试一次
async function runCli(args, timeoutMs) {
  let r = await run(CLI_BAT, [...args, '--port', CUR_PORT], { timeoutMs });
  const real = detectPort(r.out);
  if (real && real !== CUR_PORT) {
    console.log(`\n[i] IDE 实际监听端口为 ${real}（不是 ${CUR_PORT}），自动切换重试...\n`);
    CUR_PORT = real;
    r = await run(CLI_BAT, [...args, '--port', CUR_PORT], { timeoutMs });
  }
  return r;
}

async function main() {
  console.log('============================================');
  console.log('  停车攻略 · 云函数 parking 一键上传');
  console.log(`  环境：${ENV_ID}`);
  console.log('============================================');

  if (!fs.existsSync(CLI_BAT)) {
    console.log(`\n[×] 未找到开发者工具 CLI：${CLI_BAT}`);
    console.log('    请确认微信开发者工具已安装，或设置环境变量 WECHAT_IDE_DIR。');
    return 1;
  }

  // 1. 开服务端口（IDE 未运行时才生效）
  console.log(`\n[1/3] 开启 IDE 命令行服务端口(${PORT})...`);
  await run(NODE_EXE, [path.join(__dirname, 'enable-ide-cli.js')]);

  // 2. 打开项目（IDE 没开会自动启动，等待其加载）
  console.log('\n[2/3] 打开项目（IDE 未启动会自动拉起，首次加载需等待）...');
  let r = await runCli(['open', '--project', PROJ, '--lang', 'zh'], 180000);

  if (/服务端口已关闭|service port disabled/i.test(r.out)) {
    console.log('\n[!] 服务端口未生效。两个办法（任选其一）后重新双击本脚本：');
    console.log('    A. 先完全退出微信开发者工具（右下角托盘也要退），再双击本脚本；');
    console.log('    B. 打开 IDE → 设置 → 安全设置 → 服务端口 → 开启，然后直接双击本脚本。');
    return 1;
  }

  console.log('       等待 IDE 就绪(15 秒)...');
  await sleep(15000);

  // 3. 部署云函数
  console.log('\n[3/3] 上传并部署云函数 parking（云端安装依赖）...');
  // 云端首次创建函数后会短暂处于 Creating 状态，此时上传会被拒
  // （FailedOperation.UpdateFunctionCode: 当前函数处于Creating状态），等 30 秒重试即可。
  const deployArgs = [
    'cloud', 'functions', 'deploy',
    '--env', ENV_ID,
    '--names', FN_NAME,
    '--project', PROJ,
    '--remote-npm-install',
    '--lang', 'zh'
  ];
  const MAX_RETRY = 5;
  for (let i = 1; i <= MAX_RETRY; i++) {
    r = await runCli(deployArgs, 300000);
    const creating = /Creating状态|UpdateFunctionCode|"success"\s*:\s*false/i.test(r.out);
    if (!creating) break;
    if (i === MAX_RETRY) {
      console.log(`\n[×] 已重试 ${MAX_RETRY} 次仍失败，请稍后（10 分钟后）再双击本脚本。`);
      break;
    }
    console.log(`\n[i] 云函数正在云端初始化，30 秒后自动重试（第 ${i}/${MAX_RETRY - 1} 次）...\n`);
    await sleep(30000);
  }

  const ok = /成功|success/i.test(r.out) && !/\[error\]|失败|false/i.test(r.out);
  console.log('\n--------------------------------------------');
  if (ok) {
    console.log('[√] 部署完成！回到微信开发者工具重新编译，即可真机预览。');
    return 0;
  }
  console.log('[×] 部署可能失败，请把上面窗口里的完整输出复制给 AI 排查。');
  if (/not in whitelist|ip/i.test(r.out)) {
    console.log('    提示：mp 后台 开发设置 里配置了 IP 白名单 → 填你的公网 IP 或关闭限制。');
  }
  if (/需要重启才能使用端口|已启动并在监听/i.test(r.out)) {
    console.log('    提示：IDE 正在运行但端口没对上 → 完全退出微信开发者工具（含右下角托盘），再双击本脚本。');
  }
  if (/登录|login|islogin/i.test(r.out)) {
    console.log('    提示：IDE 需要已登录（扫码）且与小程序为同一账号。');
  }
  return 1;
}

main().then((c) => process.exit(c));
