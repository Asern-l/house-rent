import React, { useState } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { HomeIcon, SearchIcon, PlusCircleIcon, FileTextIcon, UserIcon, MenuIcon, XIcon, ShieldCheckIcon, LogOutIcon, WalletIcon } from 'lucide-react';

import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import ListingsPage from './pages/ListingsPage';
import ListingDetail from './pages/ListingDetail';
import PublishListing from './pages/PublishListing';
import ContractPage from './pages/ContractPage';
import MyContracts from './pages/MyContracts';
import MyListings from './pages/MyListings';
import ProfilePage from './pages/ProfilePage';
import VerifyPage from './pages/VerifyPage';

export default function App() {
  const { user, logout, connectWallet } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    { path: '/', label: '首页', icon: HomeIcon },
    { path: '/listings', label: '房源', icon: SearchIcon },
    ...(user?.role === 'landlord' ? [{ path: '/publish', label: '发布', icon: PlusCircleIcon, highlight: true }] : []),
    { path: '/contracts', label: '合同', icon: FileTextIcon },
    { path: '/verify', label: '验证', icon: ShieldCheckIcon },
  ];

  const isActive = (p) => location.pathname === p;

  if (location.pathname === '/login') {
    return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center space-x-2">
              <div className="bg-primary-600 p-2 rounded-lg"><HomeIcon className="w-5 h-5 text-white" /></div>
              <span className="text-lg font-bold text-gray-800">信源链</span>
            </Link>

            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map(item => (
                <Link key={item.path} to={item.path}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${isActive(item.path) ? 'bg-primary-100 text-primary-700' : item.highlight ? 'bg-primary-600 text-white hover:bg-primary-700' : 'text-gray-600 hover:bg-gray-100'}`}>
                  <span className="flex items-center space-x-1.5">
                    <item.icon className="w-4 h-4" /><span>{item.label}</span>
                  </span>
                </Link>
              ))}
            </nav>

            <div className="flex items-center space-x-3">
              {user ? (
                <div className="hidden md:flex items-center space-x-2">
                  <Link to="/profile" className="flex items-center space-x-2 bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-gray-200 transition-colors">
                    <UserIcon className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-700">{user.nickname || user.phone?.slice(-4)}</span>
                  </Link>
                  {!user.walletAddress && (
                    <button onClick={connectWallet} className="text-xs text-primary-600 hover:underline">绑钱包</button>
                  )}
                </div>
              ) : (
                <Link to="/login" className="hidden md:flex items-center space-x-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700">
                  <WalletIcon className="w-4 h-4" /><span>登录</span>
                </Link>
              )}
              <button onClick={() => setMobileOpen(!mobileOpen)} className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100">
                {mobileOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="px-4 py-3 space-y-1">
              {navItems.map(item => (
                <Link key={item.path} to={item.path} onClick={() => setMobileOpen(false)}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium ${isActive(item.path) ? 'bg-primary-100 text-primary-700' : 'text-gray-600'}`}>
                  <item.icon className="w-5 h-5" /><span>{item.label}</span>
                </Link>
              ))}
              {user ? (
                <div className="pt-3 border-t border-gray-200 space-y-2">
                  <Link to="/profile" onClick={() => setMobileOpen(false)}
                    className="flex items-center space-x-3 px-4 py-3 rounded-lg text-gray-600 hover:bg-gray-50">
                    <UserIcon className="w-5 h-5" /><span>{user.nickname || '个人中心'}</span>
                  </Link>
                  <button onClick={() => { logout(); setMobileOpen(false); }}
                    className="flex items-center space-x-3 px-4 py-3 rounded-lg text-red-500 hover:bg-red-50 w-full">
                    <LogOutIcon className="w-5 h-5" /><span>退出登录</span>
                  </button>
                </div>
              ) : (
                <Link to="/login" onClick={() => setMobileOpen(false)}
                  className="flex items-center space-x-3 px-4 py-3 rounded-lg text-primary-600 font-medium">
                  <WalletIcon className="w-5 h-5" /><span>登录/注册</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/listing/:id" element={<ListingDetail />} />
          <Route path="/publish" element={<PublishListing />} />
          <Route path="/contract/:id" element={<ContractPage />} />
          <Route path="/contracts" element={<MyContracts />} />
          <Route path="/my-listings" element={<MyListings />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/verify" element={<VerifyPage />} />
        </Routes>
      </main>

      <footer className="bg-white border-t border-gray-200 mt-12 py-6 text-center text-sm text-gray-400">
        信源链 · 基于区块链的租房平台 · 合同哈希上链存证
      </footer>
    </div>
  );
}
