/**
 * 打开微信开发者工具的「服务端口」，让命令行(cli)可以调用 IDE。
 * ------------------------------------------------------------
 * 原理：IDE 把安全设置存在
 *   %LOCALAPPDATA%\微信开发者工具\User Data\<hash>\WeappLocalData\localstorage_*.json
 * 的 security.enableServicePort / security.port 字段里。
 * 本脚本把所有命中的文件改成 { enableServicePort:true, port:9420 }。
 * 注意：必须在 IDE 未运行时执行，否则 IDE 退出时会用内存里的旧值覆盖回去。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9420;
const base = path.join(
  os.homedir(),
  'AppData', 'Local', '微信开发者工具', 'User Data'
);

if (!fs.existsSync(base)) {
  console.log('[!] 未找到 IDE 数据目录：' + base);
  process.exit(0);
}

let changed = 0;
for (const dir of fs.readdirSync(base)) {
  const ld = path.join(base, dir, 'WeappLocalData');
  if (!fs.existsSync(ld)) continue;
  for (const f of fs.readdirSync(ld)) {
    if (!/^localstorage_.*\.json$/.test(f)) continue;
    const p = path.join(ld, f);
    let s;
    try {
      s = fs.readFileSync(p, 'utf8');
    } catch (e) {
      continue;
    }
    if (!s.includes('enableServicePort')) continue;
    const before = s;
    s = s.replace(
      /"security"\s*:\s*\{"enableServicePort"\s*:\s*(?:false|true)/,
      `"security":{"enableServicePort":true`
    );
    s = s.replace(
      /("security"\s*:\s*\{"enableServicePort"\s*:\s*true\s*,\s*"port"\s*:\s*)(null|\d+)/,
      `$1${PORT}`
    );
    if (s !== before) {
      try {
        fs.copyFileSync(p, p + '.bak');
        fs.writeFileSync(p, s, 'utf8');
        changed++;
        console.log('[ok] 已开启服务端口 ' + PORT + ' → ' + p);
      } catch (e) {
        console.log('[x] 写入失败（IDE 可能正在运行）：' + p);
      }
    } else {
      console.log('[=] 已经是开启状态 → ' + f);
    }
  }
}

if (changed === 0) console.log('[=] 无需修改，服务端口已就绪');
