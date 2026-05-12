import axios from 'axios';

const API_BASE = '/api';

export async function apiGet(url) {
  const res = await axios.get(`${API_BASE}${url}`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  return res.data;
}

export async function apiPost(url, data) {
  const res = await axios.post(`${API_BASE}${url}`, data, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  return res.data;
}

export async function apiPut(url, data) {
  const res = await axios.put(`${API_BASE}${url}`, data, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  return res.data;
}
