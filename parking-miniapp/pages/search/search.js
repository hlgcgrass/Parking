const api = require('../../utils/api.js');
const { DEFAULT_CITY } = require('../../utils/config.js');
const detailEntry = require('../../utils/detail-entry.js');

const HOT_WORDS = ['北京路', '广州塔', '省医', '正佳广场', '白云山', '长隆', '中山一院', '天河城'];
const HISTORY_KEY = 'search_history';

Page({
  data: {
    keyword: '',
    searched: false,
    list: [],
    history: [],
    hotWords: HOT_WORDS
  },

  onLoad() {
    const history = wx.getStorageSync(HISTORY_KEY) || [];
    this.setData({ history });
  },

  onInput(e) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    if (!keyword.trim()) {
      this.setData({ searched: false, list: [] });
      return;
    }
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.doSearch(), 300);
  },

  doSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) return;
    api.search(keyword, DEFAULT_CITY.code)
      .then(res => {
        this.setData({ list: res.list || [], searched: true });
        this.saveHistory(keyword);
        // 记录搜索词，零结果的热词是补数据的最高优先级
        api.logSearch(keyword, (res.list || []).length).catch(() => {});
      })
      .catch(() => {
        this.setData({ list: [], searched: true });
      });
  },

  saveHistory(keyword) {
    let history = wx.getStorageSync(HISTORY_KEY) || [];
    history = [keyword].concat(history.filter(x => x !== keyword)).slice(0, 10);
    wx.setStorageSync(HISTORY_KEY, history);
    this.setData({ history });
  },

  clearHistory() {
    wx.removeStorageSync(HISTORY_KEY);
    this.setData({ history: [] });
  },

  tapHistory(e) {
    const kw = e.currentTarget.dataset.kw;
    this.setData({ keyword: kw });
    this.doSearch();
  },

  clear() {
    this.setData({ keyword: '', searched: false, list: [] });
  },

  goDetail(e) {
    detailEntry.open(e.currentTarget.dataset.id);
  },

  goBack() {
    wx.navigateBack();
  }
});
