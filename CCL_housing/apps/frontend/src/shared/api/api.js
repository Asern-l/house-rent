/**
 * 文件说明：api.js
 * - 本文件已添加中文注释，便于后续维护与交接。
 * - 变更代码时请同步维护注释，保证逻辑与注释一致。
 */

import axios from 'axios';

const API_BASE = '/api';

// Wrapper APIs keep auth header behavior consistent across pages.
// 函数 1: 发送 GET 请求并自动附带登录令牌。
export async function apiGet(url) {
  const res = await axios.get(`${API_BASE}${url}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  return res.data;
}

// 函数 2: 发送 POST 请求并自动附带登录令牌。
export async function apiPost(url, data, options = {}) {
  const res = await axios.post(`${API_BASE}${url}`, data, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      ...(options.headers || {}),
    }
  });
  return res.data;
}

// 函数 3: 发送 PUT 请求并自动附带登录令牌。
export async function apiPut(url, data, options = {}) {
  const res = await axios.put(`${API_BASE}${url}`, data, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      ...(options.headers || {}),
    }
  });
  return res.data;
}






