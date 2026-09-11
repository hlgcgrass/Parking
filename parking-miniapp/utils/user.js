/**
 * 用户身份管理（本地）
 * - 云开发通道由云函数上下文识别微信身份，前端只在本地保存展示资料
 * - HTTP 兜底通道继续使用本地生成的 userId 绑定收藏/点赞
 * - 头像昵称只在登录后按用户主动操作获取：chooseAvatar + type="nickname"
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
