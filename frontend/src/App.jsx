import React, { useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { useWeb3 } from './context/Web3Context';
import {
  ShoppingBagIcon,
  PlusCircleIcon,
  UserCircleIcon,
  HomeIcon,
  MenuIcon,
  XIcon,
  LogOutIcon,
  WalletIcon,
} from 'lucide-react';

import HomePage from './pages/HomePage';
import Marketplace from './pages/Marketplace';
import SellProduct from './pages/SellProduct';
import MyOrders from './pages/MyOrders';
import MyProducts from './pages/MyProducts';
import Profile from './pages/Profile';
import ProductDetail from './pages/ProductDetail';

export default function App() {
  const { account, isConnecting, connectWallet, isCorrectNetwork, switchNetwork } = useWeb3();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { path: '/', label: '首页', icon: HomeIcon },
    { path: '/marketplace', label: '市场', icon: ShoppingBagIcon },
    { path: '/sell', label: '发布', icon: PlusCircleIcon, highlight: true },
    { path: '/orders', label: '订单', icon: ShoppingBagIcon },
    { path: '/profile', label: '我的', icon: UserCircleIcon },
  ];

  const isActive = (path) => location.pathname === path;

  const handleConnectWallet = async () => {
    await connectWallet();
  };

  const truncateAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2">
              <div className="bg-gradient-to-r from-primary-500 to-primary-700 p-2 rounded-lg">
                <ShoppingBagIcon className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-primary-600 to-primary-800 bg-clip-text text-transparent">
                校园二手
              </span>
            </Link>

            {/* 桌面导航 */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    isActive(item.path)
                      ? 'bg-primary-100 text-primary-700'
                      : item.highlight
                      ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  <span className="flex items-center space-x-1.5">
                    <item.icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </span>
                </Link>
              ))}
            </nav>

            {/* 连接钱包 / 账户信息 */}
            <div className="flex items-center space-x-3">
              {!isCorrectNetwork && account && (
                <button
                  onClick={switchNetwork}
                  className="hidden md:flex items-center space-x-1 px-3 py-1.5 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-medium hover:bg-yellow-200"
                >
                  <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                  <span>切换网络</span>
                </button>
              )}

              {account ? (
                <div className="hidden md:flex items-center space-x-2 bg-gray-100 rounded-lg px-3 py-1.5">
                  <WalletIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-mono text-gray-700">
                    {truncateAddress(account)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  disabled={isConnecting}
                  className="hidden md:flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  <WalletIcon className="w-4 h-4" />
                  <span>{isConnecting ? "连接中..." : "连接钱包"}</span>
                </button>
              )}

              {/* 移动端菜单按钮 */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              >
                {mobileMenuOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* 移动端菜单 */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white animate-slide-up">
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium ${
                    isActive(item.path)
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span>{item.label}</span>
                </Link>
              ))}

              <div className="pt-3 border-t border-gray-200">
                {account ? (
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-500 font-mono">
                      {truncateAddress(account)}
                    </span>
                    <button
                      onClick={() => { /* disconnect */ }}
                      className="text-sm text-red-500 hover:text-red-600"
                    >
                      <LogOutIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { handleConnectWallet(); setMobileMenuOpen(false); }}
                    className="w-full bg-primary-600 text-white px-4 py-3 rounded-lg text-sm font-medium"
                  >
                    连接钱包
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* 主内容区域 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/sell" element={<SellProduct />} />
          <Route path="/orders" element={<MyOrders />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/my-products" element={<MyProducts />} />
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </main>

      {/* 底部信息 */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <ShoppingBagIcon className="w-5 h-5 text-primary-600" />
              <span className="text-gray-600 font-medium">校园二手交易平台</span>
            </div>
            <p className="text-sm text-gray-400">
              基于区块链技术 · 安全可靠的校园 C2C 交易
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
