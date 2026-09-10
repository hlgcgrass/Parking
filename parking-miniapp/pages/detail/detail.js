const api = require('../../utils/api.js');
const user = require('../../utils/user.js');
const { calcFee } = require('../../utils/fee.js');
const cache = require('../../utils/cache.js');
const PLACE_IMAGES = require('../../utils/place-images.js');
const app = getApp();

const HOURS_OPTIONS = [1, 2, 3, 4, 8, 24];
const splitTipLines = text => String(text || '').split(/\r?\n|\\n/);

Page({
  data: {
    id: null,
    place: null,
    imagePreview: null,
    errorText: '',
    hoursOptions: HOURS_OPTIONS
  },

  onLoad(options) {
    const id = options && options.id;
    if (id == null || id === '' || id === 'undefined') {
      this.setData({ errorText: '缺少地点参数，请从热门目的地重新进入' });
      return;
    }
    this.setData({ id, errorText: '' });
    this.prepareImagePreview(id);
    this.loadDetail();
  },

  // 详情接口还没返回时，先用本地图片元数据启动首图请求。
  prepareImagePreview(id, place) {
    const meta = PLACE_IMAGES[id] || PLACE_IMAGES[String(id)] || {};
    const stored = cache.getPlaceImages()[id] || cache.getPlaceImages()[String(id)] || {};
    const localPath = cache.getPlaceImageFile(id);
    const sources = [
      localPath,
      stored.image_file_id,
      meta.image_url,
      place && place.image_file_id,
      place && place.image_url
    ].filter(Boolean).filter((src, index, list) => list.indexOf(src) === index);
    if (!sources.length) return;
    const old = this.data.imagePreview || {};
    const oldSrc = old.src && sources.indexOf(old.src) >= 0 ? old.src : sources[0];
    const index = Math.max(0, sources.indexOf(oldSrc));
    this.setData({
      imagePreview: {
        src: oldSrc,
        sources,
        index,
        alt: (place && place.image_alt) || meta.image_alt || '地点实景图',
        credit: (place && place.image_credit) || meta.image_credit || ''
      }
    });
  },

  onPlaceImageLoad() {
    const preview = this.data.imagePreview;
    if (!preview || !preview.src || cache.getPlaceImageFile(this.data.id)) return;
    if (this._imageCaching) return;
    this._imageCaching = true;

    const save = (tempFilePath) => {
      wx.saveFile({
        tempFilePath,
        success: (res) => cache.updatePlaceImageFile(this.data.id, res.savedFilePath || tempFilePath),
        complete: () => { this._imageCaching = false; }
      });
    };
    const fail = () => { this._imageCaching = false; };
    const src = preview.src;
    if (/^cloud:\/\//.test(src) && wx.cloud && wx.cloud.downloadFile) {
      wx.cloud.downloadFile({ fileID: src, success: res => save(res.tempFilePath), fail });
    } else if (/^https?:\/\//.test(src)) {
      wx.downloadFile({ url: src, success: res => save(res.tempFilePath), fail });
    } else {
      this._imageCaching = false;
    }
  },

  onPlaceImageError() {
    const preview = this.data.imagePreview;
    if (!preview || !preview.sources) return;
    const nextIndex = (preview.index || 0) + 1;
    if (nextIndex >= preview.sources.length) return;
    this.setData({
      imagePreview: { ...preview, index: nextIndex, src: preview.sources[nextIndex] }
    });
  },

  loadDetail() {
    const loc = app.globalData.location;
    const userId = user.getUserId();
    api.getPlaceDetail(
      this.data.id,
      loc ? loc.lat : undefined,
      loc ? loc.lng : undefined,
      userId,
      'like'
    )
      .then(place => {
        if (!place || !Array.isArray(place.parkings)) {
          throw new Error('详情数据格式异常，请重新编译后重试');
        }
        wx.setNavigationBarTitle({ title: place.name });
        const parkings = place.parkings.map(p => ({
          ...p,
          _tipLines: splitTipLines(p.tips),
          _open: false,
          _hours: 3,
          _fee: calcFee(p.fee_rules, 3 * 60)
        }));
        this.prepareImagePreview(this.data.id, place);
        this.setData({ place: { ...place, parkings }, errorText: '' });
      })
      .catch((err) => {
        const message = err && err.message ? err.message : '详情加载失败，请稍后重试';
        console.error('[detail] load failed', { id: this.data.id, message, error: err });
        this.setData({ errorText: message });
        wx.showToast({ title: '详情加载失败', icon: 'none' });
      });
  },

  retryLoad() {
    if (this.data.id != null) this.loadDetail();
  },

  toggleFee(e) {
    const index = e.currentTarget.dataset.index;
    const key = `place.parkings[${index}]._open`;
    this.setData({ [key]: !this.data.place.parkings[index]._open });
  },

  setHours(e) {
    const { index, hours } = e.currentTarget.dataset;
    const rules = this.data.place.parkings[index].fee_rules;
    const fee = calcFee(rules, Number(hours) * 60);
    this.setData({
      [`place.parkings[${index}]._hours`]: Number(hours),
      [`place.parkings[${index}]._fee`]: fee
    });
  },

  // 收藏：未登录引导登录，已登录切换
  onFavorite(e) {
    const index = e.currentTarget.dataset.index;
    const pk = this.data.place.parkings[index];
    if (!user.isLogin()) {
      this.gotoLogin();
      return;
    }
    const busyKey = `favorite:${pk.id}`;
    this._actionBusy = this._actionBusy || {};
    if (this._actionBusy[busyKey]) return;
    this._actionBusy[busyKey] = true;
    api.toggleFavorite({ userId: user.getUserId(), parking_id: pk.id })
      .then(r => {
        this.setData({ [`place.parkings[${index}].is_favorited`]: r.favorited });
      })
      .catch(() => wx.showToast({ title: '操作失败，请稍后再试', icon: 'none' }))
      .then(() => { delete this._actionBusy[busyKey]; });
  },

  // 点赞：未登录引导登录，已登录切换（一人一次）
  onLike(e) {
    const index = e.currentTarget.dataset.index;
    const pk = this.data.place.parkings[index];
    if (!user.isLogin()) {
      this.gotoLogin();
      return;
    }
    const busyKey = `like:${pk.id}`;
    this._actionBusy = this._actionBusy || {};
    if (this._actionBusy[busyKey]) return;
    this._actionBusy[busyKey] = true;
    api.toggleLike({ userId: user.getUserId(), parking_id: pk.id })
      .then(r => {
        this.setData({
          [`place.parkings[${index}].is_liked`]: r.liked,
          [`place.parkings[${index}].like_count`]: r.like_count
        });
      })
      .catch(() => wx.showToast({ title: '操作失败，请稍后再试', icon: 'none' }))
      .then(() => { delete this._actionBusy[busyKey]; });
  },

  // 未登录：引导去「我的」页，通过微信授权登录
  gotoLogin() {
    wx.showToast({ title: '登录后即可操作，去「我的」页登录', icon: 'none' });
    setTimeout(() => {
      app.globalData.tabBar.current = 2;
      wx.switchTab({ url: '/pages/index/index' });
    }, 800);
  },

  openMap() {
    const p = this.data.place;
    if (p.lat == null || p.lng == null) {
      wx.showToast({ title: '该地点暂无坐标', icon: 'none' });
      return;
    }
    wx.openLocation({ latitude: p.lat, longitude: p.lng, name: p.name, address: p.address || '', scale: 16 });
  },

  onReport() {
    const p = this.data.place;
    wx.showModal({
      title: '纠错 / 补充',
      content: '你可以通过拍照上传收费牌来帮助我们更新价格，也可以直接留言说明错误信息。',
      confirmText: '留言反馈',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: '留言反馈',
          editable: true,
          placeholderText: `关于「${p.name}」的停车信息补充…`,
          success: (r) => {
            if (!r.confirm || !r.content) return;
            api.submitReport({
              parking_id: p.parkings[0] ? p.parkings[0].id : null,
              comment: `[${p.name}] ${r.content}`
            }).then(() => {
              wx.showToast({ title: '已收到，感谢反馈', icon: 'none' });
            }).catch(() => {
              wx.showToast({ title: '提交失败，请稍后再试', icon: 'none' });
            });
          }
        });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: `${this.data.place.name} 停车攻略 · 停哪最便宜`,
      path: `/pages/detail/detail?id=${this.data.id}`
    };
  }
});
