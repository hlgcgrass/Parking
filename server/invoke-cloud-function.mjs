import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const endpoint = process.env.WECHAT_AUTOMATION_ENDPOINT || 'ws://127.0.0.1:9420';
const functionName = process.env.CLOUD_FUNCTION || 'parking';
const inputPath = process.env.SYNC_INPUT || 'server/xhs-p0-latest-20260914-complete-import.json';
const dryRun = process.env.SYNC_DRY_RUN !== 'false';
const replacePlaceParkings = process.env.SYNC_REPLACE_PLACE_PARKINGS === 'true';
const verifyOnly = process.env.CLOUD_VERIFY === 'true';
const verifyAction = process.env.VERIFY_ACTION || 'stats';

function call(ws, method, params = {}) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onMessage = event => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const payload = verifyOnly ? null : JSON.parse(await fs.readFile(inputPath, 'utf8'));
const event = verifyOnly ? { action: verifyAction, ...(verifyAction === 'places' ? { cityCode: '440100', size: 50 } : {}) } : {
  action: 'admin-sync-guides',
  data: {
    places: payload.places,
    dry_run: dryRun,
    replace_place_parkings: replacePlaceParkings,
    ...(dryRun ? {} : { confirm: 'SYNC_GUIDES' })
  }
};

const ws = new WebSocket(endpoint);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

const info = await call(ws, 'Tool.getInfo');
const result = await call(ws, 'App.callFunction', {
  functionDeclaration: `(async function(event) {
    return await new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: ${JSON.stringify(functionName)},
        data: event,
        success: resolve,
        fail: reject
      });
    });
  })`,
  args: [event]
});

console.log(JSON.stringify({ endpoint, sdkVersion: info?.SDKVersion, verifyOnly, dryRun, replacePlaceParkings, result }, null, 2));
ws.close();
