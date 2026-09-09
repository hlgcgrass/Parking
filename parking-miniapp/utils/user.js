/**
 * 用户身份管理（本地）
 * 测试号没有开放 wx.login 的 code2session，因此用「本地生成 userId + 微信资料授权」方案：
 * - 首次启动生成并持久化一个 userId（用于后端绑定收藏/点赞）
 * - 头像昵称通过新版能力获取：button open-type="chooseAvatar" + input type="nickname"
 *   （wx.getUserProfile 自基础库 2.27.1 起已被微信回收，调用必失败，切勿再用）
 */
const USER_KEY = 'parking_user';

function genUserId() {
  // 简单随机 ID，足够后端区分用户
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getUserId() {
  let id = wx.getStorageSync('parking_uid');
  if (!id) {
    id = genUserId();
    wx.setStorageSync('parking_uid', id);
  }
  return id;
}

function getUser() {
  return wx.getStorageSync(USER_KEY) || null;
}

function saveUser(user) {
  wx.setStorageSync(USER_KEY, user);
}

function isLogin() {
  const u = getUser();
  return !!(u && u.nickname);
}

function clearUser() {
  wx.removeStorageSync(USER_KEY);
}

module.exports = { getUserId, getUser, saveUser, isLogin, clearUser };
