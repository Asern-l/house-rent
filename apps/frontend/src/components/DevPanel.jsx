import React, { useState } from 'react';
import { useAuth } from '../app/providers/AuthContext';
import toast from 'react-hot-toast';

/**
 * 开发用快捷登录面板，仅在 Vite dev 模式（import.meta.env.DEV）下渲染。
 * 生产构建时自动消失，无需手动移除。
 */
export default function DevPanel() {
  if (!import.meta.env.DEV) return null;

  const { devLogin, logout, user } = useAuth();
  const [loading, setLoading] = useState(null);

  const loginAs = async (role) => {
    setLoading(role);
    try {
      if (user) logout();
      await devLogin(role);
      toast.success(role === 'tenant' ? '已切换为租客账号' : '已切换为房东账号');
    } catch (err) {
      toast.error('Dev login 失败: ' + (err?.response?.data?.error || err?.message || '未知错误'));
    } finally {
      setLoading(null);
    }
  };

  const roleLabel = user
    ? (user.role === 'landlord' ? '房东' : '租客')
    : null;

  return (
    <div className="fixed bottom-5 left-5 z-[200] select-none">
      {/* 当前身份标识 */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-white/25">DEV</span>
        {roleLabel && (
          <span className="rounded-full bg-primary-600/25 px-2 py-0.5 font-mono text-[10px] text-primary-400">
            {user.nickname || user.email} · {roleLabel}
          </span>
        )}
      </div>

      {/* 切换按钮 */}
      <div className="flex gap-1.5">
        <button
          onClick={() => loginAs('tenant')}
          disabled={!!loading}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-all
            ${user?.role === 'tenant'
              ? 'border-primary-600/60 bg-primary-600/20 text-primary-300'
              : 'border-white/15 bg-black/50 text-white/60 hover:border-primary-600/50 hover:text-white'
            } disabled:opacity-40`}
        >
          {loading === 'tenant' ? '…' : '🙋 租客'}
        </button>

        <button
          onClick={() => loginAs('landlord')}
          disabled={!!loading}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-all
            ${user?.role === 'landlord'
              ? 'border-primary-600/60 bg-primary-600/20 text-primary-300'
              : 'border-white/15 bg-black/50 text-white/60 hover:border-primary-600/50 hover:text-white'
            } disabled:opacity-40`}
        >
          {loading === 'landlord' ? '…' : '🏠 房东'}
        </button>
      </div>
    </div>
  );
}
