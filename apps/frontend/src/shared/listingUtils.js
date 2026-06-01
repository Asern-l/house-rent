/**
 * 文件说明：listingUtils.js
 * - 房源展示相关的纯工具函数。
 * - 统一处理图片字段、图片代理前缀、金额展示与状态文案。
 */

export const LISTING_STATUS_META = {
  available: { label: '可租', badge: 'badge-green' },
  offline: { label: '已下架', badge: 'badge-gray' },
  locked: { label: '签约锁定中', badge: 'badge-yellow' },
  rented: { label: '已出租', badge: 'badge-blue' },
  closed: { label: '已关闭', badge: 'badge-gray' },
};

// 函数 1: 解析后端返回的房源图片字段。
export function parseImageUrls(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean).map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

// 函数 2: 返回房源首图 URL。
export function getFirstImageUrl(item) {
  return parseImageUrls(item?.image_urls)[0] || '';
}

// 函数 3: 按当前网络修正图片 URL 代理前缀。
export function resolveImageUrl(url) {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'local' && String(url).startsWith('/uploads/')) {
    return String(url).replace('/uploads/', '/uploads-local/');
  }
  return String(url || '');
}

// 函数 4: 规范化 ETH 金额展示。
export function formatRentEth(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value || '-');
  return n.toLocaleString('zh-CN', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  });
}

// 函数 5: 获取房源状态展示配置。
export function getListingStatusMeta(status) {
  return LISTING_STATUS_META[status] || { label: status || '未知状态', badge: 'badge-gray' };
}
