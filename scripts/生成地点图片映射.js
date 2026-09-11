const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const items = JSON.parse(fs.readFileSync(path.join(root, 'data/place-image-selections.json'), 'utf8'));

function js(value) {
  return JSON.stringify(value);
}

function render(kind) {
  const rows = items.map(item => {
    // 每次整批替换图片递增版本目录，触发云端重新上传并清理旧 fileID。
    const storagePath = `place-images/v3/${item.fileName}`;
    const fields = [
      `    image_url: ${js(item.image_url)}`,
      `    image_alt: ${js(`${item.name}地点实景图`)}`,
      `    image_credit: ${js(item.image_credit)}`,
      `    image_source_url: ${js(item.image_source_url)}`,
      kind === 'mini'
        ? `    image_storage_path: ${js(storagePath)}`
        : `    cloud_path: ${js(storagePath)}`,
      ...(kind === 'cloud' ? [`    asset_path: ${js(`assets/place-images/${item.fileName}`)}`] : [])
    ];
    return `  ${item.id}: {\n${fields.join(',\n')}\n  }`;
  });
  return `// 地点形象图：按地点 ID 对应地标主图；图片文件和来源清单见 data/place-image-selections.json。\nmodule.exports = {\n${rows.join(',\n')}\n};\n`;
}

fs.writeFileSync(path.join(root, 'parking-miniapp/utils/place-images.js'), render('mini'), 'utf8');
fs.writeFileSync(path.join(root, 'parking-miniapp/cloudfunctions/parking/place-images.js'), render('cloud'), 'utf8');
console.log(`updated ${items.length} place image mappings`);
