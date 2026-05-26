/**
 * 文件说明：api.js
 * - 本文件已添加中文注释，便于后续维护与交接。
 * - 变更代码时请同步维护注释，保证逻辑与注释一致。
 */

import axios from 'axios';

const DEFAULT_NETWORK = String(import.meta.env.VITE_DEFAULT_NETWORK || 'sepolia').trim().toLowerCase();
const API_BASE_MAP = {
  sepolia: import.meta.env.VITE_API_BASE_SEPOLIA || '/api',
  local: import.meta.env.VITE_API_BASE_LOCAL || '/api-local',
};

// 函数 1: 获取当前网络标识。
function getCurrentNetwork() {
  const key = String(localStorage.getItem('preferredNetwork') || DEFAULT_NETWORK).trim().toLowerCase();
  return API_BASE_MAP[key] ? key : 'sepolia';
}

// 函数 2: 获取当前网络 API 前缀。
function getApiBase() {
  return API_BASE_MAP[getCurrentNetwork()] || '/api';
}

// 函数 3: 获取当前网络 token。
function getToken() {
  const network = getCurrentNetwork();
  return localStorage.getItem(`token:${network}`) || localStorage.getItem('token') || '';
}

// 函数 3-1: 业务后端返回 401 时清理当前网络的过期会话。
function clearExpiredSession() {
  const network = getCurrentNetwork();
  localStorage.removeItem(`token:${network}`);
  localStorage.removeItem(`user:${network}`);
  localStorage.removeItem('token');
  window.dispatchEvent(new CustomEvent('auth-session-expired', { detail: { network } }));
}

function handleApiError(error) {
  if (error?.response?.status === 401) {
    clearExpiredSession();
  }
  throw error;
}

// Wrapper APIs keep auth header behavior consistent across pages.
// 函数 4: 发送 GET 请求并自动附带登录令牌。
export async function apiGet(url) {
  try {
    const res = await axios.get(`${getApiBase()}${url}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    return res.data;
  } catch (error) {
    handleApiError(error);
  }
}

// 函数 5: 发送 POST 请求并自动附带登录令牌。
export async function apiPost(url, data, options = {}) {
  try {
    const res = await axios.post(`${getApiBase()}${url}`, data, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {}),
      }
    });
    return res.data;
  } catch (error) {
    handleApiError(error);
  }
}

// 函数 6: 发送 PUT 请求并自动附带登录令牌。
export async function apiPut(url, data, options = {}) {
  try {
    const res = await axios.put(`${getApiBase()}${url}`, data, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {}),
      }
    });
    return res.data;
  } catch (error) {
    handleApiError(error);
  }
}

// 函数 7: 发送 DELETE 请求并自动附带登录令牌。
export async function apiDelete(url, options = {}) {
  try {
    const res = await axios.delete(`${getApiBase()}${url}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(options.headers || {}),
      }
    });
    return res.data;
  } catch (error) {
    handleApiError(error);
  }
}





