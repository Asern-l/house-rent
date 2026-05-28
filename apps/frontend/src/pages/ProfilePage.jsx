import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import toast from 'react-hot-toast';
import {
  ArrowRightIcon,
  FileTextIcon,
  HomeIcon,
  LoaderIcon,
  LogOutIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserIcon,
  WalletIcon,
  XIcon,
} from 'lucide-react';

export default function ProfilePage({ onClose }) {
  const { user, logout, connectWallet, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname || '');
    setPhone(user.phone || '');
  }, [user]);

  const handleLogout = () => {
    logout();
    onClose?.();
    toast.success('已退出登录');
    navigate('/login');
  };

  if (!user) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
        <div className="relative w-full max-w-[385px] rounded-[1.5rem] border border-primary-600/20 bg-[#f5f0e8] p-8 text-center shadow-[0_22px_55px_rgba(27,23,18,0.28)]">
          {onClose && <CloseButton onClose={onClose} />}
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <UserIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">请先登录</h1>
          <p className="mt-3 text-sm text-stone-500">连接钱包登录后可以查看个人资料和快捷操作。</p>
          <Link to="/login" onClick={onClose} className="mt-7 flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)]">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  const displayName = nickname || user.nickname || `${(user.walletAddress || '').slice(0, 6)}...${(user.walletAddress || '').slice(-4)}`;
  const shortAddr = user.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : '';
  const roleLabel = user.role === 'landlord' ? '房东' : '租客';
  const quickActions = [
    ...(user.role === 'landlord'
      ? [
          { to: '/my-listings', label: '我的房源', icon: HomeIcon },
          { to: '/publish', label: '发布房源', icon: HomeIcon },
        ]
      : []),
    { to: '/contracts', label: '我的合同', icon: FileTextIcon },
    { to: '/listings', label: '浏览房源', icon: HomeIcon },
    { to: '/verify', label: '链上验真', icon: ShieldCheckIcon },
  ];

  const handleQuickAction = (event, item) => {
    if (item.to !== '/verify') {
      onClose?.();
      return;
    }
    event.preventDefault();
    window.dispatchEvent(new CustomEvent('open-verify-modal'));
    onClose?.();
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile({
        nickname: nickname.trim(),
        phone: phone.trim(),
      });
      toast.success('个人资料已更新');
    } catch (error) {
      toast.error(error.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[460px] rounded-[1.5rem] border border-primary-600/20 p-8 shadow-[0_22px_55px_rgba(27,23,18,0.28)] animate-fade-in"
        style={{
          background:
            'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)',
        }}
      >
        {onClose && <CloseButton onClose={onClose} />}

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-600 text-xl font-bold text-stone-950 shadow-[0_12px_30px_rgba(231,167,121,0.35)]">
            <WalletIcon className="h-8 w-8" />
          </div>
          <input
            className="mx-auto block w-full max-w-[260px] rounded-2xl border border-stone-300 bg-[#fbf7ef] px-4 py-2 text-center text-xl font-bold text-stone-950 outline-none transition-colors focus:border-primary-600/80"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="昵称"
            maxLength={32}
          />
          <p className="mt-2 font-mono text-xs text-stone-400">{shortAddr}</p>
          <span className="mt-3 inline-flex rounded-full border border-primary-600/40 bg-primary-600/20 px-3 py-1 text-xs font-semibold text-stone-800">
            {roleLabel}
          </span>
        </div>

        {/* 手机号 */}
        <section className="mb-4 rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-900">
            <PhoneIcon className="h-4 w-4 text-primary-700" />
            联系方式
          </div>
          <input
            type="tel"
            className="w-full rounded-2xl border border-stone-300 bg-[#f5f0e8] px-4 py-2 text-sm text-stone-700 outline-none transition-colors focus:border-primary-600/80"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="手机号（选填）"
            maxLength={20}
          />
        </section>

        <button
          type="button"
          onClick={handleSaveProfile}
          disabled={saving}
          className="mx-auto mb-4 flex h-10 min-w-[160px] items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 text-sm font-semibold text-[#f5f0e8] transition-colors hover:bg-stone-800 disabled:opacity-60"
        >
          {saving && <LoaderIcon className="h-4 w-4 animate-spin" />}
          保存资料
        </button>

        <section className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-stone-900">
            <WalletIcon className="h-4 w-4 text-primary-700" />
            钱包
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-stone-200 bg-[#f5f0e8] px-3 py-3">
              <p className="text-xs text-stone-500">已绑定钱包地址</p>
              <p className="mt-1 break-all font-mono text-xs text-stone-700">{user.walletAddress}</p>
            </div>
            <button onClick={connectWallet} className="profile-secondary-button">
              连接钱包
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
          <div className="mb-3 text-sm font-semibold text-stone-900">快捷操作</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {quickActions.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={(event) => handleQuickAction(event, item)}
                className="group flex items-center justify-between rounded-2xl border border-transparent px-3 py-3 text-sm font-semibold text-stone-700 transition-all hover:border-primary-600/40 hover:bg-primary-600/15"
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 text-primary-700" />
                  {item.label}
                </span>
                <ArrowRightIcon className="h-3.5 w-3.5 text-stone-300 transition-colors group-hover:text-primary-700" />
              </Link>
            ))}
          </div>
        </section>

        <button
          onClick={handleLogout}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
        >
          <LogOutIcon className="h-4 w-4" />
          退出登录
        </button>
      </div>
    </div>
  );
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-900/5 hover:text-stone-700"
      aria-label="关闭"
    >
      <XIcon className="h-4 w-4" />
    </button>
  );
}
