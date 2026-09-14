const api = require('../../utils/api.js');
const user = require('../../utils/user.js');
const detailEntry = require('../../utils/detail-entry.js');
const { calcFee, displayPrice } = require('../../utils/fee.js');
const app = getApp();

const HOURS_OPTIONS = [1, 2, 3, 4, 8, 24];
function feeUnit(rule) {
  if (rule.unit === 'minute') return rule.unit_minutes ? `${rule.unit_minutes}分钟` : '分钟';
  if (rule.unit === 'time' && rule.unit_minutes) return `${rule.unit_minutes}分钟`;
  if (rule.unit === 'day') return '天';
  if (rule.unit === 'month') return '月';
  if (rule.unit === 'time') return '次';
  return '小时';
}

function formatFeeRule(rule) {
  const description = String(rule.description || '').trim();
  const price = Number(rule.price);
  if (!Number.isFinite(price)) return description;
  const amount = price === 0 ? '免费' : `${price}元/${feeUnit(rule)}`;
  return description ? `${description}：${amount}` : amount;
}

const feeLines = (rules, summary) => {
  const detail = String(summary || '').trim();
  if (detail && !/^(?:null|undefined)$/i.test(detail)) return [detail];
  return (Array.isArray(rules) ? rules : [])
    .map(formatFeeRule)
    .filter(Boolean)
    .filter((line, index, list) => list.indexOf(line) === index);
};
const guideLines = text => String(text || '')
  .split(/\r?\n|\\n/)
  .flatMap(line => line.split(/(?=\d+[、.)])/))
  .map(line => line.trim())
  .filter(Boolean)
  .filter(line => !/^\d+[、.)]?\s*(收费|价格)\s*[:：]/.test(line))
  .filter(line => !/^(收费|价格)\s*[:：]/.test(line));
const visibleText = (value) => {
  const text = String(value == null ? '' : value).trim();
  return /^(?:null|undefined)$/i.test(text) ? '' : text;
};

Page({
  data: {
    id: null,
    place: null,
    hasPlaceLocation: false,
    mapLatitude: null,
    mapLongitude: null,
    placeMarkers: [],
    errorText: '',
    hoursOptions: HOURS_OPTIONS
  },

  onLoad(options) {
    const id = options && options.id;
    if (id == null || id === '' || id === 'undefined') {
      this.setData({ errorText: '缺少地点参数，请从热门目的地重新进入' });
      return;
    }
    if (!user.isLogin()) {
      detailEntry.redirectToLogin(id);
      return;
    }
    this.setData({ id, errorText: '' });
    this.loadDetail();
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
        const parkings = place.parkings.map(p => {
          const feeRules = Array.isArray(p.fee_rules) ? p.fee_rules : [];
          const price = displayPrice(feeRules, p.min_price_hour);
          return {
            ...p,
            fee_rules: feeRules.map(rule => ({
              ...rule,
              _display: formatFeeRule(rule)
            })),
            _feeLines: feeLines(feeRules, p.fee_summary),
            _guideLines: guideLines(p.tips),
            _hasPrice: !!price,
            _priceValue: price ? price.value : '',
            _priceUnit: price ? price.unit : '',
            _canCalculate: !!(price && price.canCalculate),
            _open: false,
            _hours: 3,
            _fee: price && price.canCalculate ? calcFee(feeRules, 3 * 60) : null
          };
        });
        const latitude = Number(place.lat);
        const longitude = Number(place.lng);
        const hasPlaceLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
          && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
        const placeMarkers = hasPlaceLocation ? [{
          id: 1,
          latitude,
          longitude,
          title: place.name,
          width: 32,
          height: 32
        }] : [];
        const guideText = parkings.length === 0
          ? '攻略完善中'
          : (visibleText(place.area_tips) || visibleText(place.summary) || '攻略完善中');
        this.setData({
          place: {
            ...place,
            _guidePending: parkings.length === 0,
            _guideText: guideText,
            _districtText: String(place.district == null ? '' : place.district).trim()
              .replace(/^(?:null|undefined)$/i, ''),
            _addressText: String(place.address == null ? '' : place.address).trim()
              .replace(/^(?:null|undefined)$/i, '') || '地点位置待补充',
            parkings
          },
          hasPlaceLocation,
          mapLatitude: hasPlaceLocation ? latitude : null,
          mapLongitude: hasPlaceLocation ? longitude : null,
          placeMarkers,
          errorText: ''
        });
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
    const parking = this.data.place.parkings[index];
    if (!parking._canCalculate) return;
    const rules = parking.fee_rules;
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

  // 详情页兜底：如果登录状态失效，回首页走统一登录弹层。
  gotoLogin() {
    detailEntry.redirectToLogin(this.data.id);
  },

  openMap() {
    const p = this.data.place;
    if (p.lat == null || p.lng == null) {
      wx.showToast({ title: '该地点暂无坐标', icon: 'none' });
      return;
    }
    wx.openLocation({ latitude: p.lat, longitude: p.lng, name: p.name, address: p.address || '', scale: 16 });
  },

  openParkingMap(e) {
    const index = e.currentTarget.dataset.index;
    const pk = this.data.place && this.data.place.parkings[index];
    if (!pk) return;

    const latitude = Number(pk.lat);
    const longitude = Number(pk.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      wx.showToast({ title: '该停车场暂无定位信息', icon: 'none' });
      return;
    }

    wx.openLocation({
      latitude,
      longitude,
      name: pk.name,
      address: pk.address || '',
      scale: 18
    });
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
