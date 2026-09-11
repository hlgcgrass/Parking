/**
 * 云函数本地模拟测试
 * ------------------------------------------------------------
 * 用内存实现 mock 掉 wx-server-sdk（DYNAMIC_CURRENT_ENV / getWXContext / database），
 * 从而在部署前验证 parking 云函数的全部 action 是否正确。
 *
 * 运行：node server/test-cloud-function.js
 */
const Module = require('module');
const path = require('path');

// ---------------- 内存数据库 ----------------
const collections = {};
const created = {};
let seq = 0;

function rows(name) {
  collections[name] = collections[name] || [];
  return collections[name];
}
function match(rec, cond) {
  return Object.keys(cond || {}).every(k => rec[k] === cond[k]);
}

function makeQuery(name, cond) {
  const q = {
    _limit: null,
    _order: null,
    limit(n) { q._limit = n; return q; },
    orderBy(field, order) { q._order = [field, order]; return q; },
    async get() {
      let r = rows(name).filter(x => match(x, cond));
      if (q._order) {
        const [f, o] = q._order;
        r.sort((a, b) => (o === 'desc' ? String(b[f]).localeCompare(String(a[f])) : String(a[f]).localeCompare(String(b[f]))));
      }
      if (q._limit) r = r.slice(0, q._limit);
      return { data: r.map(x => ({ ...x })) };
    },
    async count() { return { total: rows(name).filter(x => match(x, cond)).length }; }
  };
  return q;
}

const db = {
  command: { inc: value => ({ __inc: value }) },
  collection(name) {
    return {
      limit: n => makeQuery(name, {}).limit(n),
      where: cond => makeQuery(name, cond),
      async add({ data }) {
        const rec = { ...data, _id: 'rid_' + (++seq) };
        rows(name).push(rec);
        return { _id: rec._id };
      },
      doc(id) {
        return {
          async update({ data }) {
            const i = rows(name).findIndex(r => r._id === id);
            if (i >= 0) {
              for (const [key, value] of Object.entries(data || {})) {
                if (value && typeof value === 'object' && value.__inc != null) {
                  rows(name)[i][key] = Number(rows(name)[i][key] || 0) + Number(value.__inc);
                } else {
                  rows(name)[i][key] = value;
                }
              }
            }
            return { stats: { updated: i >= 0 ? 1 : 0 } };
          },
          async remove() {
            const i = rows(name).findIndex(r => r._id === id);
            if (i >= 0) rows(name).splice(i, 1);
            return { stats: { removed: i >= 0 ? 1 : 0 } };
          },
          async get() {
            const r = rows(name).find(x => x._id === id);
            return { data: r ? { ...r } : null };
          }
        };
      }
    };
  },
  async createCollection(name) {
    if (created[name]) throw new Error('已存在 / already exist');
    created[name] = true;
    rows(name);
    return {};
  }
};

const uploadedFiles = [];
const deletedFiles = [];
let uploadSeq = 0;

// ---------------- mock wx-server-sdk ----------------
const mockSdk = {
  init() {},
  DYNAMIC_CURRENT_ENV: 'mock-env',
  getWXContext: () => ({ OPENID: 'test_openid_001', APPID: 'wx74cf1625553c595b' }),
  database: () => db,
  command: { inc: value => ({ __inc: value }) },
  async uploadFile({ cloudPath }) {
    const fileID = `cloud://mock/place-image-${++uploadSeq}`;
    uploadedFiles.push({ cloudPath, fileID });
    return { fileID };
  },
  async deleteFile({ fileList }) {
    deletedFiles.push(...(fileList || []));
    return { fileList };
  }
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'wx-server-sdk') return require.resolve('./_mock_wx_server_sdk.js');
  return origResolve.call(this, request, ...rest);
};
require.cache[require.resolve('./_mock_wx_server_sdk.js')] = {
  id: require.resolve('./_mock_wx_server_sdk.js'),
  filename: require.resolve('./_mock_wx_server_sdk.js'),
  loaded: true,
  exports: mockSdk
};

// ---------------- 载入云函数 ----------------
const FN_PATH = path.join(__dirname, '..', 'parking-miniapp', 'cloudfunctions', 'parking', 'index.js');
process.env.ADMIN_OPENIDS = 'test_openid_001';
const { main } = require(FN_PATH);
const bundled = require(path.join(__dirname, '..', 'parking-miniapp', 'cloudfunctions', 'parking', 'data.json'));
const bundledParkingCount = Object.values(bundled.parkingsByPlace || {})
  .reduce((n, rows) => n + (rows || []).length, 0);
const bundledTipCount = Object.values(bundled.tipsByPlace || {})
  .reduce((n, rows) => n + (rows || []).length, 0);

// ---------------- 断言 ----------------
let pass = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' → ' + JSON.stringify(extra).slice(0, 200) : ''}`); }
}

(async () => {
  console.log('\n=== 1. 基础数据接口 ===');
  let r = await main({ action: 'health' });
  check('health', r.code === 0 && r.data.status === 'ok', r);

  r = await main({ action: 'stats' });
  check(`stats ${bundled.places.length}/${bundledParkingCount}/${bundled.meta.fee_rules}`,
    r.code === 0 && r.data.places === bundled.places.length && r.data.parkings === bundledParkingCount && r.data.fee_rules === bundled.meta.fee_rules,
    r.data);

  r = await main({ action: 'categories' });
  check('categories 非空', r.code === 0 && Array.isArray(r.data) && r.data.length > 0, r.data);

  r = await main({ action: 'cities' });
  check('cities 含广州', r.code === 0 && r.data.some(c => c.name === '广州'), r.data);

  console.log('\n=== 2. 列表 / 搜索 / 附近 ===');
  r = await main({ action: 'places', size: 3 });
  check('places 返回 3 条', r.code === 0 && r.data.list.length === 3, r.data && r.data.list && r.data.list.length);

  r = await main({ action: 'hot', limit: 5 });
  check('hot 返回 5 条', r.code === 0 && r.data.length === 5, r.data && r.data.length);

  r = await main({ action: 'search', keyword: '北京路' });
  check('搜索「北京路」有结果', r.code === 0 && r.data.list.length > 0 && r.data.list[0].name.includes('北京路'), r.data && r.data.list[0] && r.data.list[0].name);

  r = await main({ action: 'nearby', lat: 23.1252, lng: 113.2679, radius: 3000, limit: 5 });
  check('附近返回按距离升序', r.code === 0 && r.data.list.length > 0 && r.data.list[0].distance_m <= r.data.list[r.data.list.length - 1].distance_m, r.data && r.data.list.map(x => x.distance_m));

  console.log('\n=== 3. 地点详情 ===');
  const placeId = 1;
  r = await main({ action: 'place', id: placeId });
  check('详情返回停车列表', r.code === 0 && Array.isArray(r.data.parkings) && r.data.parkings.length > 0, r.data && r.data.parkings && r.data.parkings.length);
  const firstPk = r.data && r.data.parkings[0];
  check('初始 like_count = 0', firstPk && firstPk.like_count === 0, firstPk && firstPk.like_count);
  check('初始 is_liked = false', firstPk && firstPk.is_liked === false, firstPk && firstPk.is_liked);
  const targetId = firstPk && firstPk.id;
  const secondId = r.data.parkings[1] && r.data.parkings[1].id;

  console.log('\n=== 4. 登录（云端以 OPENID 认定身份） ===');
  r = await main({ action: 'login', nickname: '测试用户', avatar: 'data:image/png;base64,AAA', phone: '138****0000' });
  check('登录成功且返回 openid', r.code === 0 && r.data.userId === 'test_openid_001' && r.data.nickname === '测试用户', r.data);

  r = await main({ action: 'user' });
  check('读取资料含手机号', r.code === 0 && r.data.phone === '138****0000', r.data);

  console.log('\n=== 5. 点赞（一人一次 / 幂等） ===');
  r = await main({ action: 'like', parking_id: targetId });
  check('首次点赞 liked=true 计数=1', r.code === 0 && r.data.liked === true && r.data.like_count === 1, r.data);
  r = await main({ action: 'like', parking_id: targetId });
  check('再次点赞取消 计数=0', r.code === 0 && r.data.liked === false && r.data.like_count === 0, r.data);
  await main({ action: 'like', parking_id: targetId });      // 留 1 个赞
  await main({ action: 'like', parking_id: secondId });
  await main({ action: 'like', parking_id: secondId });
  await main({ action: 'like', parking_id: secondId });
  // 第二个人给 targetId 点赞，验证多用户累计
  const savedGet = mockSdk.getWXContext;
  mockSdk.getWXContext = () => ({ OPENID: 'test_openid_002' });
  const fn2 = require(FN_PATH).main;
  await fn2({ action: 'like', parking_id: targetId });
  mockSdk.getWXContext = savedGet;
  r = await main({ action: 'place', id: placeId });
  const pkNow = r.data.parkings.find(p => p.id === targetId);
  check('多用户点赞累计 = 2', pkNow.like_count === 2, pkNow && pkNow.like_count);
  check('本人 is_liked 仍为 true', pkNow.is_liked === true, pkNow && pkNow.is_liked);

  console.log('\n=== 6. 按点赞量排序 ===');
  r = await main({ action: 'place', id: placeId, sort: 'like' });
  const counts = r.data.parkings.map(p => p.like_count);
  check('sort=like 降序正确', counts.every((c, i) => i === 0 || counts[i - 1] >= c), counts);

  console.log('\n=== 7. 收藏 ===');
  r = await main({ action: 'favorite', parking_id: targetId });
  check('首次收藏 favorited=true', r.code === 0 && r.data.favorited === true, r.data);
  r = await main({ action: 'favorites' });
  check('收藏列表含该车场', r.code === 0 && r.data.list.some(x => x.id === targetId), r.data.list.map(x => x.id));
  r = await main({ action: 'place', id: placeId });
  check('详情 is_favorited=true', r.data.parkings.find(p => p.id === targetId).is_favorited === true);
  r = await main({ action: 'favorite', parking_id: targetId });
  check('再次收藏取消', r.code === 0 && r.data.favorited === false, r.data);
  r = await main({ action: 'favorites' });
  check('取消后列表为空', r.data.list.length === 0, r.data.list.length);

  console.log('\n=== 8. 反馈 / 日志 / 初始化 ===');
  r = await main({ action: 'report', parking_id: targetId, content: '价格有变动' });
  check('提交纠错成功', r.code === 0 && r.data.submitted === true, r.data);
  r = await main({ action: 'search-log', keyword: '天河城', result_count: 3 });
  check('搜索日志成功', r.code === 0 && r.data.logged === true, r.data);
  r = await main({ action: 'init' });
  check('集合初始化完成', r.code === 0 && r.data.collections.p_users !== undefined, r.data.collections);

  console.log('\n=== 9. 异常分支 ===');
  r = await main({ action: 'place', id: 99999 });
  check('不存在的地点返回错误', r.code === -1, r.message);
  r = await main({ action: 'unknown-action' });
  check('未知 action 安全返回', r.code === -1, r.message);
  r = await main({ action: 'nearby' });
  check('缺少经纬度参数返回错误', r.code === -1, r.message);

  console.log('\n=== 10. 地点图片管理员接口 ===');
  r = await main({ action: 'admin-upsert-place', data: { id: 1, name: '测试地点' } });
  check('管理员可准备测试地点', r.code === 0, r);
  r = await main({
    action: 'admin-add-place-image',
    data: { place_id: 1, cloud_path: 'place-images/test/admin-add.jpg' }
  });
  check('新增图片接口上传并写库', r.code === 0 && r.data.image.image_file_id && r.data.image.image_storage_path === 'place-images/test/admin-add.jpg', r);
  check('新增接口未误删旧图', r.code === 0 && r.data.old_file_deleted === false, r && r.data);
  r = await main({ action: 'admin-delete-place-image', data: { place_id: 1 } });
  check('删除图片接口清空数据库字段', r.code === 0 && r.data.image.image_file_id === '', r);
  check('删除图片接口清理云存储文件', r.code === 0 && r.data.old_file_deleted === true && deletedFiles.length === 1, r);
  mockSdk.getWXContext = () => ({ OPENID: 'not_admin' });
  r = await main({ action: 'admin-delete-place-image', data: { place_id: 1 } });
  check('非管理员不能删除图片', r.code === -1 && r.message === '无权限', r);

  console.log(`\n========== 测试结束：通过 ${pass} / 失败 ${failed} ==========\n`);
  process.exit(failed ? 1 : 0);
})();
