/**
 * 文件说明：AuthContext.jsx
 * - 本文件已添加中文注释，便于后续维护与交接。
 * - 变更代码时请同步维护注释，保证逻辑与注释一致。
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { createLoginMessage } from '../../shared/loginMessage';

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

    // 函数 6: 钱包签名登录（自动判断新老用户）。
  const walletLogin = async (walletAddress, signature, message, timestamp, nonce, role = 'tenant', nickname = '', phone = '', networkOverride = '') => {
    const targetNetwork = NETWORK_CONFIG[String(networkOverride || '').trim().toLowerCase()]
      ? String(networkOverride || '').trim().toLowerCase()
      : preferredNetwork;
    const res = await axios.post(`${AUTH_API_BASE}/auth/login`, {
      walletAddress,
      signature,
      message,
      timestamp,
      nonce,
      role,
      nickname,
      phone,
      preferredNetwork: targetNetwork,
    });
    const { token, user: userData } = res.data.data;
    const keys = storageKeys(targetNetwork);
    localStorage.setItem(keys.token, token);
    localStorage.setItem(keys.user, JSON.stringify(userData));
    if (targetNetwork === preferredNetwork) {
      axios.defaults.headers.common.Authorization = `Bearer ${token}`;
      setUser(userData);
    }
    return userData;
  };

  // 函数 7: 对指定网络执行一次重新签名登录，确保切换网络时同步建立对应会话。
  const reloginForNetwork = useCallback(async (networkKey, profile = null) => {
    if (!window.ethereum) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send('eth_accounts', []);
    if (!accounts.length) return null;
    const walletAddress = String(accounts[0] || '').trim();
    if (!isWalletAddress(walletAddress)) return null;
    const nonceRes = await fetch(`${AUTH_API_BASE}/auth/nonce`);
    if (!nonceRes.ok) throw new Error(`认证服务异常 (${nonceRes.status})`);
    const nonceData = await nonceRes.json();
    const nonce = nonceData?.data?.nonce;
    if (!nonce) throw new Error('获取登录凭证失败，请刷新重试');
    const timestamp = Date.now();
    const message = createLoginMessage(walletAddress, timestamp, nonce);
    const signer = await provider.getSigner();
    const signature = await signer.signMessage(message);
    return walletLogin(
      walletAddress,
      signature,
      message,
      timestamp,
      nonce,
      profile?.role || 'tenant',
      String(profile?.nickname || '').trim(),
      String(profile?.phone || '').trim(),
      networkKey,
    );
  }, [preferredNetwork]);

  const updateProfile = async ({ nickname, phone }) => {
    const keys = storageKeys(preferredNetwork);
    const token = localStorage.getItem(keys.token) || '';
    const res = await axios.put(`${AUTH_API_BASE}/auth/me`, { nickname, phone }, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const nextUser = res.data?.data?.user || {
      ...user,
      ...(nickname !== undefined ? { nickname } : {}),
      ...(phone !== undefined ? { phone } : {}),
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

    // 函数 9: 连接钱包（验证与已登录用户钱包地址一致）。
  const connectWallet = async () => {
    if (!window.ethereum) {
      toast.error('请安装 MetaMask');
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
        if (selected.toLowerCase() !== bound.toLowerCase()) {
          toast.error(`当前钱包(${selected.slice(0,6)}...${selected.slice(-4)})与已登录地址不一致`);
          return null;
        }
        await refreshWalletInfo();
        toast.success('钱包已连接');
      }
      return accounts[0] || null;
    } catch {
      toast.error('连接钱包失败');
      return null;
    }
  };

    // 函数 10: 钱包断连提示（当前策略不允许解绑）。
  const disconnectWallet = async () => {
    toast.error('当前策略不支持解绑钱包');
  };

    // 函数 11: 更新目标网络并尝试切换钱包网络。
  const updatePreferredNetwork = async (networkKey) => {
    if (!NETWORK_CONFIG[networkKey]) {
      toast.error(`不支持的网络：${networkKey}`);
      return;
    }
    const currentProfile = user ? {
      role: user.role,
      nickname: user.nickname || '',
      phone: user.phone || '',
    } : null;
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
        } catch {
          toast.error(`切换到 ${networkName(cfg.chainIdDec)} 失败`);
          return;
        }
      }
      toast.error(`切换到 ${networkName(cfg.chainIdDec)} 失败`);
      return;
    }
    try {
      const nextUser = await reloginForNetwork(networkKey, currentProfile);
      if (nextUser) {
        const keys = storageKeys(networkKey);
        const token = localStorage.getItem(keys.token);
        if (token) {
          axios.defaults.headers.common.Authorization = `Bearer ${token}`;
        }
        setUser(nextUser);
        toast.success(`已切换到 ${networkName(cfg.chainIdDec)} 并重新登录`);
      }
    } catch (error) {
      if (error?.code === 'ACTION_REJECTED') {
        toast.error('已切换网络，但你取消了重新登录签名');
      } else {
        toast.error(error?.response?.data?.error || error?.message || '切换网络后的重新登录失败');
      }
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      walletLogin,
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










