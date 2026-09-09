/**
 * 端上缓存：静态数据（地点/车场/攻略/元信息）+ 用户标记（收藏/点赞）
 * ------------------------------------------------------------
 * 设计：首屏拉一次全量静态数据，存 wx.setStorage；之后检索 / 排序 / 距离 / 详情
 *       全部在端上计算，仅收藏 / 点赞 / 反馈等写操作走云函数。
 *       云函数侧数据变更后 version 会变化，下次启动比对到不一致才重新拉取，
 *       平时不消耗任何云调用。
 */
const STATIC_KEY = 'parking_static_v1';
const MARKS_KEY = 'parking_marks_v1';

let mem = null;    // 静态数据集：{ version, meta, places[], parkings[], tips[], cachedAt }
let marks = null;  // 用户标记：{ fav:[parking_id...], like:[parking_id...] }
let ready = false;

// 内部云函数调用（带一次冷启动重试），避免与 api.js 形成循环依赖
function invoke(action, data = {}) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) return reject(new Error('云开发未初始化'));
    const call = (attempt) => {
      wx.cloud.callFunction({
        name: 'parking',
        data: Object.assign({ action }, data),
        success(res) {
          const r = res.result || {};
          if (r.code === 0) return resolve(r.data);
          reject(new Error(r.message || '云函数调用失败'));
        },
        fail(err) {
          const msg = err.errMsg || '';
          if (/timeout|504003|冷启动/i.test(msg) && attempt < 2) return call(attempt + 1);
          reject(new Error('云服务调用失败：' + msg));
        }
      });
    };
    call(1);
  });
}

function loadStaticFromStorage() {
  try { mem = wx.getStorageSync(STATIC_KEY) || null; } catch (e) { mem = null; }
  ready = !!mem;
  return mem;
}
function loadMarksFromStorage() {
  try { marks = wx.getStorageSync(MARKS_KEY) || null; } catch (e) { marks = null; }
  return marks;
}

// 拉取并缓存全量静态数据（仅在版本变化或本地缺失时真正请求网络）
async function ensureStatic(force) {
  loadStaticFromStorage();
  if (mem && !force) {
    // 轻量比对版本号，未变化直接复用本地
    try {
      const remote = await invoke('version');
      if (remote && remote.version === mem.version) return mem;
    } catch (e) {
      return mem; // 查不到版本就用本地缓存，保证离线可用
    }
  }
  try {
    const full = await invoke('bootstrap');
    mem = {
      version: full.version,
      meta: full.meta || {},
      places: full.places || [],
      parkings: full.parkings || [],
      tips: full.tips || [],
      cachedAt: Date.now()
    };
    wx.setStorageSync(STATIC_KEY, mem);
    ready = true;
  } catch (e) {
    // 拉取失败：保留本地已有缓存（若有）
  }
  return mem;
}

function isReady() { return ready; }
function getStatic() { return mem; }

// 用户标记：向云函数取当前用户收藏/点赞的车场 id 列表并缓存
async function ensureUserMarks() {
  loadMarksFromStorage();
  try {
    const m = await invoke('marks');
    marks = { fav: m.favorites || [], like: m.likes || [] };
    wx.setStorageSync(MARKS_KEY, marks);
  } catch (e) {
    // 失败则保留旧缓存
  }
  return marks;
}
function getMarks() {
  const fav = new Set((marks && marks.fav) || []);
  const like = new Set((marks && marks.like) || []);
  return { fav, like };
}
function isMarked(type, id) {
  if (!marks) return false;
  const arr = type === 'fav' ? marks.fav : marks.like;
  return (arr || []).indexOf(id) >= 0;
}
// 乐观更新本地标记并落盘，使详情/收藏页即时刷新，无需等待云端回包
function updateMark(type, id, on) {
  if (!marks) marks = { fav: [], like: [] };
  const key = type === 'fav' ? 'fav' : 'like';
  const set = new Set(marks[key]);
  if (on) set.add(id); else set.delete(id);
  marks[key] = Array.from(set);
  try { wx.setStorageSync(MARKS_KEY, marks); } catch (e) {}
}

module.exports = {
  ensureStatic, isReady, getStatic,
  ensureUserMarks, getMarks, isMarked, updateMark
};
