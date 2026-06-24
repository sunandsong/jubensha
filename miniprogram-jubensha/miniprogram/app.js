App({
  onLaunch() {
    if (!wx.cloud) {
      console.error("基础库版本过低，请使用 2.2.3 及以上的基础库以使用云能力");
      return;
    }
    // 自动使用当前云开发环境，无需手动填写环境 ID
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    });
  },
});
