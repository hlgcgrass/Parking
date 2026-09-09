/**
 * 运行配置
 * ------------------------------------------------------------
 * DATA_SOURCE = 'cloud'  → 走微信云开发（wx.cloud.callFunction），推荐
 *   · 不需要配置 request 合法域名，真机预览直接可用
 *   · 不受免费云沙箱停机影响，7×24 可用
 *   · 用户身份由云函数内的 OPENID 认定，无法伪造
 * DATA_SOURCE = 'http'   → 走旧的 HTTP 后端（局域网或公网地址），保留作兜底
 */
const DATA_SOURCE = 'cloud';

// 云开发环境 ID：IDE 顶部「云开发」→ 环境 → 复制环境 ID（形如 xxx-1a2b3c）
const CLOUD_ENV = 'cloud1-d1guhoh9g9abdbb63';

// 云函数名（与 cloudfunctions/ 下的目录名一致）
const CLOUD_FUNC = 'parking';

// ===== 以下为 http 通道配置（DATA_SOURCE='http' 时才生效） =====
const USE_LAN = false;
const LAN_IP = '192.168.246.27';
const PROD_URL = 'https://3000-4469fc2804b6405d8573bfa24335d546.e2b.ap-beijing.sandbox.cloudstudio.club';
const APP_KEY = 'pk_parking_2026_xq8';
const BASE_URL = USE_LAN ? `http://${LAN_IP}:3000` : PROD_URL;

module.exports = {
  DATA_SOURCE,
  CLOUD_ENV,
  CLOUD_FUNC,
  BASE_URL,
  APP_KEY,
  DEFAULT_CITY: { code: '440100', name: '广州' }
};
