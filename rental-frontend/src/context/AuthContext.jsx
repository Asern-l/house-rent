import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

const API_BASE = '/api';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setUser(JSON.parse(savedUser));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setLoading(false);
  }, []);

  const login = async (phone, password) => {
    const res = await axios.post(`${API_BASE}/auth/login`, { phone, password });
    const { token, user: userData } = res.data.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(userData);
    return userData;
  };

  const register = async (phone, password, role, nickname, walletAddress) => {
    const res = await axios.post(`${API_BASE}/auth/register`, {
      phone, password, role, nickname, walletAddress
    });
    const { token, user: userData } = res.data.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(userData);
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('请安装 MetaMask 钱包');
      return null;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (accounts.length > 0 && user) {
        await axios.put(`${API_BASE}/auth/me`, { walletAddress: accounts[0] }, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        setUser(prev => ({ ...prev, walletAddress: accounts[0] }));
        toast.success('钱包已连接');
      }
      return accounts[0];
    } catch (err) {
      toast.error('连接钱包失败');
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, connectWallet, API_BASE }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
