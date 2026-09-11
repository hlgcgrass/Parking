const api = require('../../utils/api.js');
const user = require('../../utils/user.js');

Page({
  data: {
    stats: {},
    profile: null,                          // 已登录资料
    editingNick: false,                     // 已登录卡：昵称编辑态
    nickDraft: '',
    busy: false
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().sync(2);
    }
    this.loadStats();
    this.refreshProfile();
  },

  loadStats() {
    api.getStats()
      .then(stats => {
        this.setData({
          stats: { ...stats, updated_text: stats.updated_at ? stats.updated_at.slice(0, 7) : '' }
        });
      })
      .catch(() => {});
  },

  // 读取本地登录态，并向后端拉取最新收藏/点赞计数
  refreshProfile() {
    const local = user.getUser();
    if (!local || !local.nickname) { this.setData({ profile: null }); return; }
    api.getUser(user.getUserId())
      .then(p => {
        this.setData({
          profile: {
            nickname: local.nickname,
            avatar: local.avatar || p.avatar || '',
            phone: p.phone || '',
            initial: (local.nickname || '微')[0],
            favorite_count: p.favorite_count || 0,
            like_count: p.like_count || 0
          }
        });
      })
      .catch(() => {
        // 后端/网络异常时不要踢回未登录态，用本地资料兜底展示
        this.setData({
          profile: {
            nickname: local.nickname,
            avatar: local.avatar || '',
            phone: '',
            initial: (local.nickname || '微')[0],
            favorite_count: 0,
            like_count: 0
          }
        });
      });
  },

  // ========== 登录 ==========

  // 登录只建立微信身份，不主动索取头像或昵称。
  onLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.getLoginCode()
      .then(code => api.login({ userId: user.getUserId(), code }))
      .then(p => {
        const server = p || {};
        const nickname = String(server.nickname || '').trim() || '微信用户';
        const avatar = server.avatar || '';
        const u = { userId: user.getUserId(), nickname, avatar };
        user.saveUser(u);
        this.setData({
          busy: false,
          profile: {
            nickname,
            avatar,
            phone: server.phone || '',
            initial: nickname[0],
            favorite_count: server.favorite_count || 0,
            like_count: server.like_count || 0
          }
        });
        wx.showToast({ title: '登录成功', icon: 'success' });
      })
      .catch(() => {
        this.setData({ busy: false });
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      });
  },

  getLoginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: res => res && res.code ? resolve(res.code) : reject(new Error('微信登录凭证获取失败')),
        fail: reject
      });
    });
  },

  // 登录后单独更新头像，不再把头像选择当成登录动作。
  onChooseAvatar(e) {
    if (this.data.busy || !this.data.profile) return;
    const tmp = e.detail && e.detail.avatarUrl;
    if (!tmp) return;                       // 用户取消选择

    this.setData({ busy: true });
    wx.showLoading({ title: '保存中', mask: true });
    this.toBase64(tmp)
      .then(dataUrl => {
        const local = user.getUser() || {};
        const nickname = String(local.nickname || (this.data.profile && this.data.profile.nickname) || '微信用户').trim() || '微信用户';
        const next = {
          ...local,
          userId: user.getUserId(),
          nickname,
          avatar: dataUrl
        };
        return api.login({ userId: next.userId, nickname: next.nickname, avatar: next.avatar })
          .then(() => next);
      })
      .then(next => {
        user.saveUser(next);
        this.setData({ busy: false, 'profile.avatar': next.avatar });
        wx.hideLoading();
        wx.showToast({ title: '头像已更新', icon: 'success' });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ busy: false });
        wx.showToast({ title: '头像保存失败，请重试', icon: 'none' });
      });
  },

  // ===== 已登录后改昵称 =====
  onEditNick() {
    this.setData({ editingNick: true, nickDraft: (this.data.profile && this.data.profile.nickname) || '' });
  },

  onNickDraft(e) {
    this.setData({ nickDraft: String((e.detail && e.detail.value) || '').trim() });
  },

  onSaveNick() {
    const nick = String(this.data.nickDraft || '').trim() || '微信用户';
    this.setData({ editingNick: false });
    const cur = (this.data.profile && this.data.profile.nickname) || '';
    if (nick === cur) return;

    const local = user.getUser() || {};
    const next = { ...local, userId: user.getUserId(), nickname: nick, avatar: local.avatar || (this.data.profile && this.data.profile.avatar) || '' };
    user.saveUser(next);
    this.setData({ 'profile.nickname': nick, 'profile.initial': nick[0] });

    api.login({ userId: next.userId, nickname: nick, avatar: next.avatar })
      .then(() => wx.showToast({ title: '昵称已更新', icon: 'success' }))
      .catch(() => {});
  },

  // 微信返回的头像临时路径会失效，必须转 base64 持久化
  toBase64(tmpPath) {
    return new Promise((resolve, reject) => {
      const compress = (src) => new Promise(r => {
        wx.compressImage({
          src, quality: 50,
          success: res => r(res.tempFilePath || src),
          fail: () => r(src)
        });
      });
      compress(tmpPath).then(path => {
        const fs = wx.getFileSystemManager();
        fs.readFile({
          filePath: path,
          encoding: 'base64',
          success: r => resolve('data:image/jpeg;base64,' + r.data),
          fail: reject
        });
      });
    });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后收藏与点赞记录仍在，重新登录即可找回',
      confirmColor: '#0F6E56',
      success: r => {
        if (r.confirm) {
          user.clearUser();
          this.setData({ profile: null });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      }
    });
  },

  // ========== 其它入口 ==========
  goFavorites() {
    wx.navigateTo({ url: '/pages/favorites/favorites' });
  },

  onFeedback() {
    wx.showModal({
      title: '纠错 / 补充',
      editable: true,
      placeholderText: '例如：正佳广场 B3 层现在是 8 元/小时',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        api.submitReport({ parking_id: null, comment: res.content })
          .then(() => wx.showToast({ title: '已收到，感谢反馈', icon: 'none' }))
          .catch(() => wx.showToast({ title: '提交失败，请稍后再试', icon: 'none' }));
      }
    });
  },

  onSuggestPlace() {
    wx.showModal({
      title: '提交地点',
      editable: true,
      placeholderText: '想查哪个地方的停车攻略？',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        api.logSearch(res.content, 0)
          .then(() => wx.showToast({ title: '已记录，会优先补充', icon: 'none' }))
          .catch(() => wx.showToast({ title: '提交失败', icon: 'none' }));
      }
    });
  }
});
