import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './providers/AuthContext';
import {
  ArrowRightIcon,
  BellIcon,
  FileTextIcon,
  HomeIcon,
  LogOutIcon,
  MenuIcon,
  PlusCircleIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';

const HomePage = lazy(() => import('../pages/HomePage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const ListingsPage = lazy(() => import('../pages/ListingsPage'));
const ListingDetail = lazy(() => import('../pages/ListingDetail'));
const ListingReviewsPage = lazy(() => import('../pages/ListingReviewsPage'));
const PublishListing = lazy(() => import('../pages/PublishListing'));
const ContractPage = lazy(() => import('../pages/ContractPage'));
const MyContracts = lazy(() => import('../pages/MyContracts'));
const MyListings = lazy(() => import('../pages/MyListings'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const VerifyPage = lazy(() => import('../pages/VerifyPage'));
const NotificationsPage = lazy(() => import('../pages/NotificationsPage'));
const AdminSetupPage = lazy(() => import('../pages/AdminSetupPage'));

function PageFallback() {
  return (
    <div className="card flex min-h-[240px] items-center justify-center text-sm font-medium text-slate-200">
      页面加载中...
    </div>
  );
}

function getHealthTone(ok) {
  if (ok === false) return 'border-red-500/30 bg-red-500/10 text-red-200';
  return 'border-white/10 bg-white/5 text-slate-300';
}

export default function App() {
  const { user, logout, connectWallet, walletInfo, preferredNetwork, updatePreferredNetwork } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authModal, setAuthModal] = useState(location.pathname === '/login' ? 'login' : null);
  const [profileModalOpen, setProfileModalOpen] = useState(location.pathname === '/profile');
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(location.pathname === '/admin');
  const [publishModalOpen, setPublishModalOpen] = useState(location.pathname === '/publish');
  const [backendHealth, setBackendHealth] = useState({ sepolia: null, local: null });
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);

  const navItems = [
    { path: '/', label: '首页', icon: HomeIcon },
    { path: '/listings', label: '房源', icon: SearchIcon },
    ...(user?.role === 'landlord' ? [{ onClick: () => setPublishModalOpen(true), label: '发布房源', icon: PlusCircleIcon }] : []),
    { path: '/contracts', label: '合同', icon: FileTextIcon },
    { onClick: () => setVerifyModalOpen(true), label: '链上验真', icon: ShieldCheckIcon },
  ];

  const isActive = (path) => location.pathname === path;
  const isHomePage = ['/', '/login', '/profile', '/verify'].includes(location.pathname);

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
        local: checks[1].status === 'fulfilled' && checks[1].value.ok,
      });
    };
    check();
    const timer = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (location.pathname === '/login') setAuthModal('login');
    if (location.pathname === '/profile') setProfileModalOpen(true);
    if (location.pathname === '/admin') setAdminModalOpen(true);
    if (location.pathname === '/publish') setPublishModalOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setAuthModal('login');
      setMobileOpen(false);
      setNotificationUnreadCount(0);
    };
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, []);

  useEffect(() => {
    let mounted = true;
    const apiBase = preferredNetwork === 'local'
      ? (import.meta.env.VITE_API_BASE_LOCAL || '/api-local')
      : (import.meta.env.VITE_API_BASE_SEPOLIA || '/api');

    const loadUnreadCount = async () => {
      if (!user) {
        if (mounted) setNotificationUnreadCount(0);
        return;
      }
      try {
        const token = localStorage.getItem(`token:${preferredNetwork}`) || '';
        const res = await fetch(`${apiBase}/notifications/unread-count`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const payload = await res.json();
        if (!mounted) return;
        setNotificationUnreadCount(Number(payload?.data?.unreadCount || 0));
      } catch {
        // ignore polling errors
      }
    };

    loadUnreadCount();
    const timer = setInterval(loadUnreadCount, 15000);
    const handleChanged = () => loadUnreadCount();
    window.addEventListener('notifications-changed', handleChanged);
    return () => {
      mounted = false;
      clearInterval(timer);
      window.removeEventListener('notifications-changed', handleChanged);
    };
  }, [user, preferredNetwork]);

  const selectedBackendOk = preferredNetwork === 'local' ? backendHealth.local : backendHealth.sepolia;

  const openAuthModal = (mode = 'login') => {
    setAuthModal(mode);
    setMobileOpen(false);
  };

  const openProfileModal = () => {
    setProfileModalOpen(true);
    setMobileOpen(false);
  };

  const closeProfileModal = () => {
    setProfileModalOpen(false);
    if (location.pathname === '/profile') navigate('/');
  };

  const closeAdminModal = () => {
    setAdminModalOpen(false);
    if (location.pathname === '/admin') navigate('/');
  };

  const closePublishModal = () => {
    setPublishModalOpen(false);
    if (location.pathname === '/publish') navigate('/');
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-80 w-80 rounded-full bg-amber-400/14 blur-3xl" />
        <div className="absolute right-0 top-10 h-96 w-96 rounded-full bg-sky-400/12 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
      </div>

      <header className="relative z-40 border-b border-white/10 bg-black/25 backdrop-blur-xl">
        <div className="relative flex h-14 items-center px-5 md:px-8">
            {/* Left: nav */}
            <nav className="hidden flex-1 items-center gap-1 md:flex">
              {navItems.map((item) =>
                item.onClick ? (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    className={`rounded-xl px-3 py-2 text-sm font-medium text-slate-300`}
                  >
                    {item.label}
                  </button>
                ) : (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`rounded-xl px-3 py-2 text-sm font-medium ${
                      isActive(item.path)
                        ? 'bg-white/10 text-white'
                        : 'text-slate-300'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              )}
            </nav>

            {/* Center: logo */}
            <Link
              to="/"
              className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center"
            >
              <p className="text-sm font-semibold tracking-[0.16em] text-slate-100">信源链</p>
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Blockchain Housing Flow</p>
            </Link>

            {/* Right: actions */}
            <div className="ml-auto flex items-center gap-2">
              <div className={`hidden items-center gap-2 rounded-full border px-3 py-1 text-xs md:flex ${getHealthTone(selectedBackendOk)}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${selectedBackendOk === false ? 'bg-red-400' : 'bg-emerald-400'}`} />
                <select
                  className="bg-transparent outline-none"
                  value={preferredNetwork}
                  onChange={(e) => updatePreferredNetwork(e.target.value)}
                >
                  <option value="sepolia">Sepolia</option>
                  <option value="local">Local</option>
                </select>
              </div>

              {user ? (
                <>
                  {walletInfo && (
                    <span className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 lg:inline-flex">
                      {walletInfo.balanceEth} ETH
                    </span>
                  )}
                  {!user.walletAddress && (
                    <button
                      onClick={connectWallet}
                      className="hidden rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10 md:inline-flex"
                    >
                      连接钱包
                    </button>
                  )}
                  <Link
                    to="/notifications"
                    className="relative rounded-full p-2 text-slate-300 transition-colors hover:bg-white/5 hover:text-slate-100"
                    title="通知"
                  >
                    <BellIcon className="h-4 w-4" />
                    {notificationUnreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[#F2EFE4] px-1.5 py-0.5 text-[10px] font-semibold text-slate-950">
                        {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={openProfileModal}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 transition-colors hover:bg-white/10"
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F2EFE4] text-[11px] font-semibold text-slate-950">
                      {(user.nickname || user.walletAddress || '?')[0].toUpperCase()}
                    </div>
                    <span className="hidden max-w-[140px] truncate text-sm font-medium text-slate-100 sm:block">
                      {user.nickname || `${(user.walletAddress || '').slice(0, 6)}...${(user.walletAddress || '').slice(-4)}`}
                    </span>
                  </button>
                  <button
                    onClick={() => setAdminModalOpen(true)}
                    title="系统设置"
                    className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={logout}
                    title="退出登录"
                    className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
                  >
                    <LogOutIcon className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="btn-primary inline-flex items-center gap-2 text-sm"
                >
                  登录开始
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                onClick={() => setMobileOpen((prev) => !prev)}
                className="rounded-full p-2 text-slate-300 transition-colors hover:bg-white/5 md:hidden"
              >
                {mobileOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {mobileOpen && (
            <div className="border-t border-white/10 px-4 py-3 md:hidden bg-slate-950/70 backdrop-blur-xl">
              <div className="space-y-1">
                {navItems.map((item) =>
                  item.onClick ? (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => { item.onClick(); setMobileOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5"
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  ) : (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                        isActive(item.path)
                          ? 'bg-white/10 text-white'
                          : 'text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                )}
              </div>

              {user ? (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
                    <span className={`h-1.5 w-1.5 rounded-full ${selectedBackendOk === false ? 'bg-red-400' : 'bg-emerald-400'}`} />
                    <select
                      className="flex-1 bg-transparent outline-none"
                      value={preferredNetwork}
                      onChange={(e) => updatePreferredNetwork(e.target.value)}
                    >
                      <option value="sepolia">Sepolia</option>
                      <option value="local">Local EVM</option>
                    </select>
                  </div>
                  <button
                    onClick={openProfileModal}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5"
                  >
                    <WalletIcon className="h-4 w-4" />
                    个人面板
                  </button>
                  <button
                    onClick={() => { setAdminModalOpen(true); setMobileOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5"
                  >
                    <SettingsIcon className="h-4 w-4" />
                    系统设置
                  </button>
                  <button
                    onClick={() => { logout(); setMobileOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/10"
                  >
                    <LogOutIcon className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal('login')}
                  className="mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/5"
                >
                  <WalletIcon className="h-4 w-4" />
                  登录 / 注册
                </button>
              )}
            </div>
          )}
      </header>

      <main className={`relative z-10 flex-1 overflow-y-auto ${isHomePage ? '' : 'px-4 py-5 md:px-6 xl:px-8'}`}>
        <div className={isHomePage ? '' : 'mx-auto max-w-7xl'}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<HomePage />} />
              <Route path="/listings" element={<ListingsPage />} />
              <Route path="/listing/:id" element={<ListingDetail />} />
              <Route path="/listing/:id/reviews" element={<ListingReviewsPage />} />
              <Route path="/publish" element={<HomePage />} />
              <Route path="/contract/:id" element={<ContractPage />} />
              <Route path="/contracts" element={<MyContracts />} />
              <Route path="/my-listings" element={<MyListings />} />
              <Route path="/profile" element={<HomePage />} />
              <Route path="/verify" element={<HomePage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/admin" element={<HomePage />} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {authModal && (
        <Suspense fallback={null}>
          <LoginPage initialMode={authModal} onClose={() => setAuthModal(null)} />
        </Suspense>
      )}
      {profileModalOpen && (
        <Suspense fallback={null}>
          <ProfilePage onClose={closeProfileModal} />
        </Suspense>
      )}
      {verifyModalOpen && (
        <Suspense fallback={null}>
          <VerifyPage onClose={() => setVerifyModalOpen(false)} />
        </Suspense>
      )}
      {adminModalOpen && (
        <Suspense fallback={null}>
          <AdminSetupPage onClose={closeAdminModal} />
        </Suspense>
      )}
      {publishModalOpen && (
        <Suspense fallback={null}>
          <PublishListing onClose={closePublishModal} />
        </Suspense>
      )}
    </div>
  );
}
