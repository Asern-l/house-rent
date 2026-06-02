import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import toast from 'react-hot-toast';
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
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
  const { user, logout, connectWallet, updateProfile, updateAvatar, preferredNetwork } = useAuth();
  const navigate = useNavigate();
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [showWallet, setShowWallet] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    setNickname(user.nickname || '');
    setPhone(user.phone || '');
  }, [user]);

  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('头像不能超过 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setAvatarUploading(true);
      try {
        await updateAvatar(reader.result);
        toast.success('头像已更新');
      } catch (error) {
        toast.error(error.response?.data?.error || '头像上传失败');
      } finally {
        setAvatarUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLogout = () => {
    logout();
    onClose?.();
    toast.success('已退出登录');
    navigate('/login');
  };

  if (!user) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
        <div
          className="relative w-full max-w-[385px] rounded-[1.5rem] border border-stone-200 p-8 text-center shadow-[0_22px_55px_rgba(0,0,0,0.25)]"
          style={{ background: '#F2EFE4' }}
        >
          {onClose && <CloseButton onClose={onClose} />}
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-stone-300 bg-[#E8E4D8] text-stone-700 shadow-[0_4px_14px_rgba(0,0,0,0.08)]">
            <UserIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">请先登录</h1>
          <p className="mt-3 text-sm text-stone-500">连接钱包登录后可以查看个人资料和快捷操作。</p>
          <Link to="/login" onClick={onClose} className="btn-primary mt-7 flex h-11 w-full items-center justify-center text-base">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  const avatarUrl = (() => {
    const raw = String(user.avatar || '').trim();
    if (!raw) return '';
    if (preferredNetwork === 'local' && raw.startsWith('/uploads/')) {
      return raw.replace('/uploads/', '/uploads-local/');
    }
    return raw;
  })();

  const maskedAddr = user.walletAddress
    ? '0x' + '●'.repeat(Math.max(0, user.walletAddress.length - 2))
    : '';
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
      await updateProfile({ nickname: nickname.trim(), phone: phone.trim() });
      toast.success('个人资料已更新');
    } catch (error) {
      toast.error(error.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm">
      <div
        className="relative flex w-full max-w-[420px] flex-col rounded-[1.5rem] border border-stone-200 shadow-[0_22px_55px_rgba(0,0,0,0.28)] animate-fade-in"
        style={{ background: '#F2EFE4', maxHeight: 'calc(100vh - 96px)' }}
      >
        <div className="flex-shrink-0 border-b border-stone-200 px-6 pb-4 pt-6 text-center">
          {onClose && <CloseButton onClose={onClose} />}
          <div className="relative mx-auto mb-3 h-16 w-16">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="relative block h-16 w-16 overflow-hidden rounded-2xl border border-stone-300 bg-[#E8E4D8] shadow-[0_4px_14px_rgba(0,0,0,0.08)]"
              title="点击更换头像"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-stone-700">
                  <WalletIcon className="h-7 w-7" />
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 opacity-0 transition-opacity hover:opacity-100">
                {avatarUploading ? (
                  <LoaderIcon className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <span className="text-[10px] font-semibold text-white">更换</span>
                )}
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>
          <input
            className="mx-auto block w-full max-w-[220px] rounded-2xl border border-stone-300 bg-[#F2EFE4] px-3 py-1.5 text-center text-lg font-bold text-slate-900 outline-none focus:border-stone-500"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            placeholder="昵称"
            maxLength={32}
          />
          <span className="mt-2 inline-flex rounded-full border border-[#A47864]/30 bg-[#F2EFE4] px-3 py-0.5 text-xs font-semibold text-[#A47864]">
            {roleLabel}
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4" style={{ scrollbarWidth: 'none' }}>
          <section className="rounded-2xl border border-stone-200 bg-[#F2EFE4]/60 p-4">
            <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <PhoneIcon className="h-4 w-4 text-stone-400" />
              联系方式
            </div>
            <input
              type="tel"
              className="w-full rounded-2xl border border-stone-300 bg-[#F2EFE4] px-3 py-2 text-sm text-slate-900 outline-none focus:border-stone-500 placeholder:text-stone-400"
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
            className="btn-primary flex h-10 w-full items-center justify-center gap-2 text-sm disabled:opacity-60"
          >
            {saving && <LoaderIcon className="h-4 w-4 animate-spin" />}
            保存资料
          </button>

          <section className="rounded-2xl border border-stone-200 bg-[#F2EFE4]/60 p-4">
            <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <WalletIcon className="h-4 w-4 text-stone-400" />
              钱包
            </div>
            <div className="space-y-2.5">
              <div className="rounded-2xl border border-stone-300 bg-[#F2EFE4] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <p
                    className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-slate-700"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {showWallet ? user.walletAddress : maskedAddr}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowWallet((value) => !value)}
                    className="flex-shrink-0 text-stone-400"
                    aria-label={showWallet ? '隐藏钱包地址' : '显示钱包地址'}
                  >
                    {showWallet ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              <button
                onClick={connectWallet}
                className="flex h-9 w-full items-center justify-center rounded-2xl border border-stone-300 bg-[#F2EFE4] text-sm font-semibold text-slate-700"
              >
                连接钱包
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-stone-200 bg-[#F2EFE4]/60 p-4">
            <div className="mb-2.5 text-sm font-semibold text-slate-800">快捷操作</div>
            <div className="grid grid-cols-2 gap-1.5">
              {quickActions.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={(event) => handleQuickAction(event, item)}
                  className="flex items-center justify-between rounded-2xl border border-stone-200 bg-[#F2EFE4] px-3 py-2.5 text-sm font-medium text-slate-700"
                >
                  <span className="flex items-center gap-2">
                    <item.icon className="h-3.5 w-3.5 text-stone-400" />
                    {item.label}
                  </span>
                  <ArrowRightIcon className="h-3 w-3 text-stone-400" />
                </Link>
              ))}
            </div>
          </section>

          <button
            onClick={handleLogout}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 text-sm font-semibold text-red-600"
          >
            <LogOutIcon className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-800"
      aria-label="关闭"
    >
      <XIcon className="h-4 w-4" />
    </button>
  );
}
