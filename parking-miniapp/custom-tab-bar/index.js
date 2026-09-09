const app = getApp();

Component({
  data: {
    // 首帧不假设是“攻略”，避免首次进入其它 Tab 时先绘制错误的绿色块。
    selected: null,
    switching: false,
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
    attached() {
      const state = app.globalData.tabBar;
      const pages = getCurrentPages();
      const route = pages.length ? pages[pages.length - 1].route : '';
      const routeIndex = this.data.list.findIndex(
        item => item.pagePath.slice(1) === route
      );
      // 首次创建目标页时优先使用点击意图，避免 attached 读到旧路由 A。
      const index = state.pendingIndex == null
        ? (routeIndex >= 0 ? routeIndex : state.current)
        : state.pendingIndex;

      // 导航栏始终可见，只在组件首帧直接使用正确的色块位置。
      this.setData({ selected: index });
    },

    detached() {}
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      const path = e.currentTarget.dataset.path;
      const state = app.globalData.tabBar;

      if (this._switching || state.switching || index === state.current) return;

      state.switching = true;
      this._switching = true;
      state.pendingIndex = index;

      // 当前页保持原状态，只由目标页 onShow/sync 写入一次最终状态。
      wx.switchTab({
        url: path,
        success: () => {
          state.current = index;
          state.pendingIndex = null;
          state.switching = false;
          this._switching = false;
        },
        fail: () => {
          state.pendingIndex = null;
          state.switching = false;
          this._switching = false;
        }
      });
    },

    sync(index) {
      const state = app.globalData.tabBar;
      state.current = index;
      state.pendingIndex = null;
      state.switching = false;

      // 同步只改最终状态，不播放任何动效。
      this.setData({
        selected: index,
        switching: false
      });
    }
  }
});
