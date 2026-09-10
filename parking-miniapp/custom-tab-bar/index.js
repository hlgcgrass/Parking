const app = getApp();

Component({
  data: {
    selected: 0,
    animating: false,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '攻略',
        icon: '/custom-tab-bar/icons/route.svg',
        activeIcon: '/custom-tab-bar/icons/route-active.svg'
      },
      {
        pagePath: '/pages/nearby/nearby',
        text: '附近',
        icon: '/custom-tab-bar/icons/location.svg',
        activeIcon: '/custom-tab-bar/icons/location-active.svg'
      },
      {
        pagePath: '/pages/mine/mine',
        text: '我的',
        icon: '/custom-tab-bar/icons/user.svg',
        activeIcon: '/custom-tab-bar/icons/user-active.svg'
      }
    ]
  },

  lifetimes: {
    attached() {},

    detached() {}
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (index === this.data.selected) return;

      // 三个内容区都在同一个壳页面内切换，不再调用 wx.switchTab。
      const pages = getCurrentPages();
      const page = pages.length ? pages[pages.length - 1] : null;
      if (!page || typeof page.onTabSelect !== 'function' || this._switching) return;

      this._switching = true;
      this._clearAnimationTimer();

      // 分两帧更新：先打开过渡，再更新位置，确保色块从当前位置滑到目标位置。
      this.setData({ animating: true }, () => {
        this.setData({ selected: index }, () => {
          page.onTabSelect(index);
          this._animationTimer = setTimeout(() => {
            this._animationTimer = null;
            this._switching = false;
            this.setData({ animating: false });
          }, 220);
        });
      });
    },

    sync(index) {
      const state = app.globalData.tabBar;
      state.current = index;
      // 页面生命周期同步只负责静态对齐，不能打断同页内正在播放的滑动。
      if (this.data.selected === index) return;
      this._clearAnimationTimer();
      this._switching = false;
      this.setData({ selected: index, animating: false });
    },

    _clearAnimationTimer() {
      if (this._animationTimer) {
        clearTimeout(this._animationTimer);
        this._animationTimer = null;
      }
    }
  }
});
