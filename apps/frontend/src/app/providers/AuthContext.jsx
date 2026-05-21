/**
 * 文件说明：AuthContext.jsx
 * - 本文件已添加中文注释，便于后续维护与交接。
 * - 变更代码时请同步维护注释，保证逻辑与注释一致。
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';

const AuthContext = createContext(null);
const DEFAULT_NETWORK = String(import.meta.env.VITE_DEFAULT_NETWORK || 'sepolia').trim().toLowerCase();
const API_BASE_MAP = {
  sepolia: import.meta.env.VITE_API_BASE_SEPOLIA || '/api',
  local: import.meta.env.VITE_API_BASE_LOCAL || '/api-local',
};
const AUTH_API_BASE = import.meta.env.VITE_API_BASE_AUTH || '/api-auth';

// 函数 1: 根据链ID转换为可读网络名称。
function networkName(chainId) {
  const id = Number(chainId);
  if (id === 11155111) return 'Sepolia';
  if (id === 31337) return 'Local EVM';
  if (id === 1) return 'Ethereum';
  return `Chain ${id}`;
}

const NETWORK_CONFIG = {
  sepolia: {
    chainIdDec: 11155111,
    chainIdHex: '0xaa36a7',
    addParams: {
      chainId: '0xaa36a7',
      chainName: 'Sepolia',
      nativeCurrency: { name: 'SepoliaETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://ethereum-sepolia.publicnode.com'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
  local: {
    chainIdDec: 31337,
    chainIdHex: '0x7a69',
    addParams: {
      chainId: '0x7a69',
      chainName: 'Local EVM (31337)',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['http://127.0.0.1:8545'],
    },
  },
};

// 函数 2: 校验钱包地址格式。
function isWalletAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '').trim());
}

// 函数 3: 获取当前网络对应的本地存储键名。
function storageKeys(network) {
  return {
    token: `token:${network}`,
    user: `user:${network}`,
  };
}

// 函数 4: 获取当前网络 API 前缀。
function apiBaseByNetwork(network) {
  return API_BASE_MAP[network] || '/api';
}

// 函数 2: 鉴权上下文提供者，统一管理用户与钱包状态。
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [walletInfo, setWalletInfo] = useState(null);
  const [preferredNetwork, setPreferredNetwork] = useState(() => {
    const saved = String(localStorage.getItem('preferredNetwork') || '').trim().toLowerCase();
    if (NETWORK_CONFIG[saved]) return saved;
    return NETWORK_CONFIG[DEFAULT_NETWORK] ? DEFAULT_NETWORK : 'sepolia';
  });

  // 函数 5: 读取当前网络会话。
  const loadSessionForNetwork = useCallback((networkKey) => {
    const keys = storageKeys(networkKey);
    const token = localStorage.getItem(keys.token);
    const savedUser = localStorage.getItem(keys.user);
    if (token && savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        axios.defaults.headers.common.Authorization = `Bearer ${token}`;
        return;
      } catch {
        localStorage.removeItem(keys.user);
        localStorage.removeItem(keys.token);
      }
    }
    setUser(null);
    delete axios.defaults.headers.common.Authorization;
  }, []);

  useEffect(() => {
    loadSessionForNetwork(preferredNetwork);
    setLoading(false);
  }, [preferredNetwork, loadSessionForNetwork]);

  useEffect(() => {
    const handleSessionExpired = (event) => {
      const expiredNetwork = event.detail?.network;
      if (expiredNetwork && expiredNetwork !== preferredNetwork) return;
      setUser(null);
      setWalletInfo(null);
      delete axios.defaults.headers.common.Authorization;
    };
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, [preferredNetwork]);

    // 函数 3: 刷新当前钱包网络与余额信息。
  const refreshWalletInfo = useCallback(async () => {
    if (!window.ethereum || !user?.walletAddress) {
      setWalletInfo(null);
      return;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      const balanceWei = await provider.getBalance(user.walletAddress);
      setWalletInfo({
        chainId: Number(net.chainId),
        network: networkName(net.chainId),
        balanceEth: Number(ethers.formatEther(balanceWei)).toFixed(4),
      });
    } catch {
      setWalletInfo(null);
    }
  }, [user?.walletAddress]);

  useEffect(() => {
    refreshWalletInfo();
  }, [refreshWalletInfo]);

  useEffect(() => {
    if (!window.ethereum) return undefined;
        // 函数 4: 监听钱包账户变化并刷新钱包信息。
    const onAccountsChanged = () => refreshWalletInfo();
        // 函数 5: 监听钱包网络变化并刷新钱包信息。
    const onChainChanged = () => refreshWalletInfo();
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener('chainChanged', onChainChanged);
    };
  }, [refreshWalletInfo]);

    // 函数 6: 用户登录并写入当前网络会话。
  const login = async (email, password, captcha = {}) => {
    const res = await axios.post(`${AUTH_API_BASE}/auth/login`, {
      email,
      phone: email,
      password,
      captchaId: captcha.id,
      captchaAnswer: captcha.answer,
    });
    const { token, user: userData } = res.data.data;
    const keys = storageKeys(preferredNetwork);
    localStorage.setItem(keys.token, token);
    localStorage.setItem(keys.user, JSON.stringify(userData));
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    setUser(userData);
    return userData;
  };

    // 函数 7: 用户注册并写入当前网络会话。
  const register = async (email, password, role, nickname, walletAddress, emailCode) => {
    const res = await axios.post(`${AUTH_API_BASE}/auth/register`, {
      email, phone: email, password, role, nickname, walletAddress, emailCode,
    });
    const { token, user: userData } = res.data.data;
    const keys = storageKeys(preferredNetwork);
    localStorage.setItem(keys.token, token);
    localStorage.setItem(keys.user, JSON.stringify(userData));
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
    setUser(userData);
    return userData;
  };

  const getCaptcha = async () => {
    const res = await axios.get(`${AUTH_API_BASE}/auth/captcha`);
    return res.data?.data || {};
  };

  const sendEmailCode = async (email, captcha = {}) => {
    const res = await axios.post(`${AUTH_API_BASE}/auth/email-code`, {
      email,
      captchaId: captcha.id,
      captchaAnswer: captcha.answer,
    });
    return res.data?.data || {};
  };

  const resetPassword = async (email, password, emailCode) => {
    const res = await axios.post(`${AUTH_API_BASE}/auth/reset-password`, {
      email,
      phone: email,
      password,
      emailCode,
    });
    return res.data;
  };

  const updateProfile = async ({ nickname, avatarUrl }) => {
    const keys = storageKeys(preferredNetwork);
    const token = localStorage.getItem(keys.token) || '';
    const res = await axios.put(`${AUTH_API_BASE}/auth/me`, { nickname, avatarUrl }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const nextUser = res.data?.data?.user || {
      ...user,
      ...(nickname !== undefined ? { nickname } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    };
    setUser(nextUser);
    localStorage.setItem(keys.user, JSON.stringify(nextUser));
    return nextUser;
  };

    // 函数 8: 退出登录并清理当前网络会话。
  const logout = () => {
    const keys = storageKeys(preferredNetwork);
    localStorage.removeItem(keys.token);
    localStorage.removeItem(keys.user);
    delete axios.defaults.headers.common.Authorization;
    setUser(null);
    setWalletInfo(null);
  };

    // 函数 9: 连接钱包并回写钱包地址。
  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask');
      return null;
    }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (accounts.length > 0 && user) {
        const selected = String(accounts[0] || '').trim();
        if (!isWalletAddress(selected)) {
          toast.error('钱包地址格式无效');
          return null;
        }
        const bound = String(user.walletAddress || '').trim();
        if (bound && selected.toLowerCase() !== bound.toLowerCase()) {
          toast.error(`仅支持重连已绑定地址：${bound}`);
          return null;
        }

        const keys = storageKeys(preferredNetwork);
        const token = localStorage.getItem(keys.token) || '';
        await axios.put(`${AUTH_API_BASE}/auth/me`, { walletAddress: selected }, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const nextUser = { ...user, walletAddress: selected };
        setUser(nextUser);
        localStorage.setItem(keys.user, JSON.stringify(nextUser));
        await refreshWalletInfo();
        toast.success(bound ? '钱包已重连' : '钱包绑定成功');
      }
      return accounts[0] || null;
    } catch {
      toast.error('Failed to connect wallet');
      return null;
    }
  };

    // 函数 10: 钱包断连提示（当前策略不允许解绑）。
  const disconnectWallet = async () => {
    toast.error('当前策略不支持解绑钱包，仅支持重连已绑定地址');
  };

    // 函数 11: 更新目标网络并尝试切换钱包网络。
  const updatePreferredNetwork = async (networkKey) => {
    if (!NETWORK_CONFIG[networkKey]) {
      toast.error(`不支持的网络：${networkKey}`);
      return;
    }
    setPreferredNetwork(networkKey);
    localStorage.setItem('preferredNetwork', networkKey);
    loadSessionForNetwork(networkKey);
    if (!window.ethereum) return;
    const cfg = NETWORK_CONFIG[networkKey];
    if (!cfg) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: cfg.chainIdHex }],
      });
      await refreshWalletInfo();
    } catch (switchErr) {
      if (cfg.addParams) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [cfg.addParams],
          });
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: cfg.chainIdHex }],
          });
          await refreshWalletInfo();
          return;
        } catch {
          toast.error(`切换到 ${networkName(cfg.chainIdDec)} 失败`);
          return;
        }
      }
      toast.error(`切换到 ${networkName(cfg.chainIdDec)} 失败`);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      register,
      getCaptcha,
      sendEmailCode,
      resetPassword,
      updateProfile,
      logout,
      connectWallet,
      disconnectWallet,
      refreshWalletInfo,
      walletInfo,
      preferredNetwork,
      updatePreferredNetwork,
      API_BASE: apiBaseByNetwork(preferredNetwork),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// 函数 12: 提供鉴权上下文快捷访问钩子。
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}










