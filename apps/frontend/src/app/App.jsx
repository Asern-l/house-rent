import React, { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './providers/AuthContext';
import {
  HomeIcon, SearchIcon, PlusCircleIcon, FileTextIcon,
  ShieldCheckIcon, LogOutIcon, WalletIcon,
  MenuIcon, XIcon, ArrowRightIcon,
} from 'lucide-react';

import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import ListingsPage from '../pages/ListingsPage';
import ListingDetail from '../pages/ListingDetail';
import PublishListing from '../pages/PublishListing';
import ContractPage from '../pages/ContractPage';
import MyContracts from '../pages/MyContracts';
import MyListings from '../pages/MyListings';
import ProfilePage from '../pages/ProfilePage';
import VerifyPage from '../pages/VerifyPage';
import DevPanel from '../components/DevPanel';

const APP_BACKGROUND_IMAGE =
  'https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/b88b71ee-6e8c-4230-b004-094bc0a9f86f_3840w.jpg';

export default function App() {
  const { user, logout, connectWallet, walletInfo, preferredNetwork, updatePreferredNetwork } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authModal, setAuthModal] = useState(location.pathname === '/login' ? 'login' : null);
  const [profileModalOpen, setProfileModalOpen] = useState(location.pathname === '/profile');
  const [publishModalOpen, setPublishModalOpen] = useState(location.pathname === '/publish');
  const [verifyModalOpen, setVerifyModalOpen] = useState(location.pathname === '/verify');
  const [backendHealth, setBackendHealth] = useState({ sepolia: null, local: null });

  const navItems = [
    { path: '/', label: '首页', icon: HomeIcon },
    { path: '/listings', label: '房源', icon: SearchIcon },
    ...(user?.role === 'landlord' ? [{ path: '/publish', label: '发布房源', icon: PlusCircleIcon }] : []),
    { path: '/contracts', label: '合同', icon: FileTextIcon },
  ];

  const isActive = (p) => location.pathname === p;

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const checks = await Promise.allSettled([
        fetch('/api/health'),
        fetch('/api-local/health'),
      ]);
      if (!mounted) return;
      setBackendHealth({
        sepolia: checks[0].status === 'fulfilled' && checks[0].value.ok,
        local:   checks[1].status === 'fulfilled' && checks[1].value.ok,
      });
    };
    check();
    const timer = setInterval(check, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);

  const selectedBackendOk = preferredNetwork === 'local' ? backendHealth.local : backendHealth.sepolia;

  useEffect(() => {
    if (location.pathname === '/login') setAuthModal('login');
    if (location.pathname === '/profile') setProfileModalOpen(true);
    if (location.pathname === '/publish') setPublishModalOpen(true);
    if (location.pathname === '/verify') setVerifyModalOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenVerifyModal = () => setVerifyModalOpen(true);
    window.addEventListener('open-verify-modal', handleOpenVerifyModal);
    return () => window.removeEventListener('open-verify-modal', handleOpenVerifyModal);
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      setAuthModal('login');
      setMobileOpen(false);
    };
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, []);

  const openAuthModal = (mode = 'login') => { setAuthModal(mode); setMobileOpen(false); };
  const openProfileModal = () => { setProfileModalOpen(true); setMobileOpen(false); };
  const closeProfileModal = () => { setProfileModalOpen(false); if (location.pathname === '/profile') navigate('/'); };
  const openPublishModal = () => { setPublishModalOpen(true); setMobileOpen(false); };
  const closePublishModal = () => { setPublishModalOpen(false); if (location.pathname === '/publish') navigate('/'); };
  const openVerifyModal = () => { setVerifyModalOpen(true); setMobileOpen(false); };
  const closeVerifyModal = () => { setVerifyModalOpen(false); if (location.pathname === '/verify') navigate('/'); };

  return (
    <div className="flex h-screen flex-col overflow-hidden text-white">

      {/* ── Full-page background (fixed, behind everything) ── */}
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${APP_BACKGROUND_IMAGE})` }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: `
            radial-gradient(circle at 68% 35%, rgba(201,135,85,0.14), transparent 38%),
            linear-gradient(90deg, rgba(12,9,6,0.65), rgba(12,9,6,0.20) 55%, rgba(12,9,6,0.52)),
            linear-gradient(180deg, rgba(12,9,6,0.42), rgba(12,9,6,0.12) 45%, rgba(12,9,6,0.82))
          `,
        }}
      />

      {/* ── Top header (glass) ── */}
      <header className="flex-shrink-0 sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="relative flex items-center h-14 px-5 lg:px-10">

          {/* Logo */}
          <Link to="/" className="absolute left-1/2 -translate-x-1/2 flex items-center flex-shrink-0">
            <span className="font-bold text-white text-base tracking-wide">信源链</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1">
            {navItems.map((item) => (
              item.path === '/publish' || item.path === '/verify' ? (
                <button
                  key={item.path}
                  type="button"
                  onClick={item.path === '/publish' ? openPublishModal : openVerifyModal}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                    ${isActive(item.path)
                      ? 'bg-primary-600/30 text-white shadow-[0_8px_24px_rgba(231,167,121,0.32)]'
                      : 'text-white/60 hover:text-white hover:bg-white/10'}`}
                >
                  {item.label}
                </Link>
              )
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto">
            {user ? (
              <>
                {/* Network selector */}
                <div className={`hidden sm:flex items-center gap-1.5 text-xs border rounded-full px-2.5 py-1 transition-colors
                  ${selectedBackendOk === false
                    ? 'border-red-400/60 text-red-400 bg-red-500/10'
                    : 'border-white/20 text-white/60 bg-white/5'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedBackendOk === false ? 'bg-red-500' : 'bg-emerald-400'}`} />
                  <select
                    className="bg-transparent outline-none text-xs"
                    value={preferredNetwork}
                    onChange={(e) => updatePreferredNetwork(e.target.value)}
                  >
                    <option value="sepolia">Sepolia</option>
                    <option value="local">Local</option>
                  </select>
                </div>

                {/* Wallet balance */}
                {walletInfo && (
                  <span className="hidden lg:block text-xs text-white/40">
                    {walletInfo.balanceEth} ETH
                  </span>
                )}
                {!user.walletAddress && (
                  <button onClick={connectWallet} className="hidden sm:block text-xs text-primary-400 hover:text-primary-300 font-medium">
                    连接钱包
                  </button>
                )}

                {/* User avatar + name */}
                <button
                  type="button"
                  onClick={openProfileModal}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-white/10 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      (user.nickname || user.phone || '?')[0].toUpperCase()
                    )}
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-white/80">
                    {user.nickname || user.phone}
                  </span>
                </button>

                {/* Logout */}
                <button
                  onClick={logout}
                  title="退出登录"
                  className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                >
                  <LogOutIcon className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="flex items-center gap-1.5 bg-primary-600 text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-primary-700 transition-colors"
              >
                登录开始
                <ArrowRightIcon className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-white/60 hover:bg-white/10 rounded-md transition-colors"
            >
              {mobileOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/10 bg-black/60 backdrop-blur-xl px-4 py-3 space-y-0.5">
            {navItems.map((item) => (
              item.path === '/publish' || item.path === '/verify' ? (
                <button
                  key={item.path}
                  type="button"
                  onClick={item.path === '/publish' ? openPublishModal : openVerifyModal}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ) : (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium
                    ${isActive(item.path) ? 'bg-primary-600/30 text-white shadow-[0_8px_24px_rgba(231,167,121,0.28)]' : 'text-white/60 hover:bg-white/10 hover:text-white'}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            ))}

            {/* Mobile network + logout */}
            {user && (
              <div className="pt-2 border-t border-white/10 mt-1 space-y-1">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${selectedBackendOk === false ? 'bg-red-500' : 'bg-emerald-400'}`} />
                  <select
                    className="bg-transparent outline-none text-sm text-white/60 flex-1"
                    value={preferredNetwork}
                    onChange={(e) => updatePreferredNetwork(e.target.value)}
                  >
                    <option value="sepolia">Sepolia</option>
                    <option value="local">Local EVM</option>
                  </select>
                </div>
                <button
                  onClick={openProfileModal}
                  className="flex items-center gap-3 px-3 py-2.5 text-white/70 text-sm w-full rounded-md hover:bg-white/10"
                >
                  <WalletIcon className="w-4 h-4" />
                  个人面板
                </button>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 text-red-400 text-sm w-full rounded-md hover:bg-red-500/10"
                >
                  <LogOutIcon className="w-4 h-4" />
                  退出登录
                </button>
              </div>
            )}

            {!user && (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="flex items-center gap-3 px-3 py-2.5 text-white/70 text-sm font-medium"
              >
                <WalletIcon className="w-4 h-4" />
                登录 / 注册
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── Page content ── */}
      <main className="relative z-10 flex-1 overflow-y-auto p-6">
        <div className="relative z-10">
          <Routes>
            <Route path="/"           element={<HomePage />} />
            <Route path="/login"      element={<HomePage />} />
            <Route path="/listings"   element={<ListingsPage />} />
            <Route path="/listing/:id" element={<ListingDetail />} />
            <Route path="/publish"    element={<HomePage />} />
            <Route path="/contract/:id" element={<ContractPage />} />
            <Route path="/contracts"  element={<MyContracts />} />
            <Route path="/my-listings" element={<MyListings />} />
            <Route path="/profile"    element={<HomePage />} />
            <Route path="/verify"     element={<HomePage />} />
          </Routes>
        </div>
      </main>

      {authModal && (
        <LoginPage
          initialMode={authModal}
          onClose={() => setAuthModal(null)}
        />
      )}
      {profileModalOpen && (
        <ProfilePage onClose={closeProfileModal} />
      )}
      {publishModalOpen && (
        <PublishListing onClose={closePublishModal} />
      )}
      {verifyModalOpen && (
        <VerifyPage onClose={closeVerifyModal} />
      )}

      {/* 开发用快捷登录面板，生产构建自动隐藏 */}
      <DevPanel />
    </div>
  );
}
