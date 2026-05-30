import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './providers/AuthContext';
import {
  HomeIcon, SearchIcon, PlusCircleIcon, FileTextIcon,
  ShieldCheckIcon, LogOutIcon, WalletIcon,
  MenuIcon, XIcon, ArrowRightIcon,
} from 'lucide-react';

const HomePage = lazy(() => import('../pages/HomePage'));
const LoginPage = lazy(() => import('../pages/LoginPage'));
const ListingsPage = lazy(() => import('../pages/ListingsPage'));
const ListingDetail = lazy(() => import('../pages/ListingDetail'));
const PublishListing = lazy(() => import('../pages/PublishListing'));
const ContractPage = lazy(() => import('../pages/ContractPage'));
const MyContracts = lazy(() => import('../pages/MyContracts'));
const MyListings = lazy(() => import('../pages/MyListings'));
const ProfilePage = lazy(() => import('../pages/ProfilePage'));
const VerifyPage = lazy(() => import('../pages/VerifyPage'));

function PageFallback() {
  return (
    <div className="flex min-h-[240px] items-center justify-center rounded-3xl border border-stone-200 bg-[#f5f0e8] text-sm font-medium text-stone-500">
      页面加载中...
    </div>
  );
}

export default function App() {
  const { user, logout, connectWallet, walletInfo, preferredNetwork, updatePreferredNetwork } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [authModal, setAuthModal] = useState(location.pathname === '/login' ? 'login' : null);
  const [profileModalOpen, setProfileModalOpen] = useState(location.pathname === '/profile');
  const [backendHealth, setBackendHealth] = useState({ sepolia: null, local: null });

  const navItems = [
    { path: '/', label: '\u9996\u9875', icon: HomeIcon },
    { path: '/listings', label: '\u623f\u6e90', icon: SearchIcon },
    ...(user?.role === 'landlord' ? [{ path: '/publish', label: '\u53d1\u5e03\u623f\u6e90', icon: PlusCircleIcon }] : []),
    { path: '/contracts', label: '\u5408\u540c', icon: FileTextIcon },
    { path: '/verify', label: '\u94fe\u4e0a\u9a8c\u771f', icon: ShieldCheckIcon },
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
  }, [location.pathname]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setAuthModal('login');
      setMobileOpen(false);
    };
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth-session-expired', handleSessionExpired);
  }, []);

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

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-950 text-gray-100">

      {/* ── Top header ── */}
      <header className="flex-shrink-0 sticky top-0 z-40 border-b border-stone-200/80"
        style={{ backgroundColor: '#f5f0e8' }}>
        <div className="relative flex items-center h-14 px-5 lg:px-10">

          {/* Logo */}
          <Link to="/" className="absolute left-1/2 -translate-x-1/2 flex items-center flex-shrink-0">
            <span className="font-bold text-stone-900 text-base tracking-wide">{'\u4fe1\u6e90\u94fe'}</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 flex-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                  ${isActive(item.path)
                    ? 'bg-primary-600/20 text-stone-900 shadow-[0_8px_24px_rgba(231,167,121,0.38)]'
                    : 'text-stone-500 hover:text-stone-900 hover:bg-stone-900/5'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto">
            {user ? (
              <>
                {/* Network selector */}
                <div className={`hidden sm:flex items-center gap-1.5 text-xs border rounded-full px-2.5 py-1 transition-colors
                  ${selectedBackendOk === false
                    ? 'border-red-300 text-red-500 bg-red-50'
                    : 'border-stone-300 text-stone-500 bg-white/60'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedBackendOk === false ? 'bg-red-500' : 'bg-emerald-500'}`} />
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
                  <span className="hidden lg:block text-xs text-stone-400">
                    {walletInfo.balanceEth} ETH
                  </span>
                )}
                {!user.walletAddress && (
                  <button onClick={connectWallet} className="hidden sm:block text-xs text-primary-600 hover:text-primary-700 font-medium">
                    连接钱包
                  </button>
                )}

                {/* User avatar + name */}
                <button
                  type="button"
                  onClick={openProfileModal}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-full hover:bg-stone-900/5 transition-colors">
                  <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0">
                    {(user.nickname || user.walletAddress || '?')[0].toUpperCase()}
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-stone-700">
                    {user.nickname || `${(user.walletAddress || '').slice(0, 6)}...${(user.walletAddress || '').slice(-4)}`}
                  </span>
                </button>

                {/* Logout */}
                <button
                  onClick={logout}
                  title="退出登录"
                  className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-900/5 rounded-md transition-colors"
                >
                  <LogOutIcon className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => openAuthModal('login')}
                className="flex items-center gap-1.5 bg-stone-900 text-white text-sm font-medium px-4 py-2 rounded-full hover:bg-stone-800 transition-colors"
              >
                登录开始
                <ArrowRightIcon className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 text-stone-600 hover:bg-stone-900/5 rounded-md transition-colors"
            >
              {mobileOpen ? <XIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden border-t border-stone-200 bg-[#f5f0e8] px-4 py-3 space-y-0.5">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium
                  ${isActive(item.path) ? 'bg-primary-600/20 text-stone-900 shadow-[0_8px_24px_rgba(231,167,121,0.32)]' : 'text-stone-600 hover:bg-stone-900/5'}`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            ))}

            {/* Mobile network + logout */}
            {user && (
              <div className="pt-2 border-t border-stone-200 mt-1 space-y-1">
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${selectedBackendOk === false ? 'bg-red-500' : 'bg-emerald-500'}`} />
                  <select
                    className="bg-transparent outline-none text-sm text-stone-600 flex-1"
                    value={preferredNetwork}
                    onChange={(e) => updatePreferredNetwork(e.target.value)}
                  >
                    <option value="sepolia">Sepolia</option>
                    <option value="local">Local EVM</option>
                  </select>
                </div>
                <button
                  onClick={openProfileModal}
                  className="flex items-center gap-3 px-3 py-2.5 text-stone-700 text-sm w-full rounded-md hover:bg-stone-900/5"
                >
                  <WalletIcon className="w-4 h-4" />
                  个人面板
                </button>
                <button
                  onClick={() => { logout(); setMobileOpen(false); }}
                  className="flex items-center gap-3 px-3 py-2.5 text-red-500 text-sm w-full rounded-md hover:bg-red-50"
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
                className="flex items-center gap-3 px-3 py-2.5 text-stone-700 text-sm font-medium"
              >
                <WalletIcon className="w-4 h-4" />
                登录 / 注册
              </button>
            )}
          </div>
        )}
      </header>

      {/* ── Page content ── */}
      <main className="flex-1 overflow-y-auto bg-gray-950 p-6">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/"           element={<HomePage />} />
            <Route path="/login"      element={<HomePage />} />
            <Route path="/listings"   element={<ListingsPage />} />
            <Route path="/listing/:id" element={<ListingDetail />} />
            <Route path="/publish"    element={<PublishListing />} />
            <Route path="/contract/:id" element={<ContractPage />} />
            <Route path="/contracts"  element={<MyContracts />} />
            <Route path="/my-listings" element={<MyListings />} />
            <Route path="/profile"    element={<HomePage />} />
            <Route path="/verify"     element={<VerifyPage />} />
          </Routes>
        </Suspense>
      </main>

      {authModal && (
        <Suspense fallback={null}>
          <LoginPage
            initialMode={authModal}
            onClose={() => setAuthModal(null)}
          />
        </Suspense>
      )}
      {profileModalOpen && (
        <Suspense fallback={null}>
          <ProfilePage onClose={closeProfileModal} />
        </Suspense>
      )}
    </div>
  );
}
