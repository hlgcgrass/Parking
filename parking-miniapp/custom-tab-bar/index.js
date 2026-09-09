const app = getApp();

Component({
  data: {
    selected: 0,
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
      if (page && typeof page.onTabSelect === 'function') {
        page.onTabSelect(index);
      }
    },

    sync(index) {
      const state = app.globalData.tabBar;
      state.current = index;
      if (this.data.selected !== index) this.setData({ selected: index });
    }
  }
});
