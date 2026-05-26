import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRightToLineIcon,
  KeyRoundIcon,
  LoaderIcon,
  LockIcon,
  MailIcon,
  UserIcon,
  XIcon,
} from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';

const CREAM = '#f5f0e8';

export default function LoginPage({ initialMode = 'login', onClose }) {
  const { login, register, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    role: 'tenant',
  });
  const [loading, setLoading] = useState(false);

  const isRegister = mode === 'register';
  const isReset = mode === 'reset';

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister || isReset) {
        if (form.password !== form.confirmPassword) {
          toast.error('两次密码不一致');
          setLoading(false);
          return;
        }
      }

      if (isReset) {
        await resetPassword(form.email.trim(), form.password);
        toast.success('密码已重置，请登录');
        setMode('login');
        updateForm('password', '');
        updateForm('confirmPassword', '');
      } else if (isRegister) {
        await register(
          form.email.trim(),
          form.password,
          form.role,
          form.nickname.trim(),
          ''
        );
        toast.success('注册成功');
        if (onClose) onClose(); else navigate('/');
      } else {
        await login(form.email.trim(), form.password);
        toast.success('登录成功');
        if (onClose) onClose(); else navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[385px] rounded-[1.5rem] border border-primary-600/20 p-8 shadow-[0_22px_55px_rgba(27,23,18,0.28)]"
        style={{
          background:
            'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)',
        }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-900/5 hover:text-stone-700"
            aria-label="关闭"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}

        <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
          <ArrowRightToLineIcon className="h-7 w-7" />
        </div>

        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold text-stone-950">
            {isReset ? '重置密码' : isRegister ? '创建账号' : '邮箱登录'}
          </h1>
          <p className="mx-auto mt-3 max-w-[280px] text-sm leading-6 text-stone-500">
            {isReset
              ? '输入邮箱和新密码即可重置。'
              : isRegister
                ? '填写基础信息，快速创建租房系统账号。'
                : '使用邮箱和密码登录系统。'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field icon={MailIcon}>
            <input
              type="email"
              className="auth-input"
              placeholder="邮箱"
              value={form.email}
              onChange={(e) => updateForm('email', e.target.value)}
              required
            />
          </Field>

          <Field icon={LockIcon}>
            <input
              type="password"
              className="auth-input"
              placeholder="密码"
              value={form.password}
              onChange={(e) => updateForm('password', e.target.value)}
              required
              minLength={6}
            />
          </Field>

          {(isRegister || isReset) && (
            <>
              <Field icon={KeyRoundIcon}>
                <input
                  type="password"
                  className="auth-input"
                  placeholder="确认密码"
                  value={form.confirmPassword}
                  onChange={(e) => updateForm('confirmPassword', e.target.value)}
                  required
                  minLength={6}
                />
              </Field>

              {isRegister && (
                <>
                  <Field icon={UserIcon}>
                    <input
                      type="text"
                      className="auth-input"
                      placeholder="昵称"
                      value={form.nickname}
                      onChange={(e) => updateForm('nickname', e.target.value)}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['tenant', '租客'],
                      ['landlord', '房东'],
                    ].map(([role, label]) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => updateForm('role', role)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${
                          form.role === role
                            ? 'border-primary-600 bg-primary-600/25 text-stone-950 shadow-[0_10px_24px_rgba(231,167,121,0.32)]'
                            : 'border-stone-300 bg-[#fbf7ef] text-stone-500 hover:border-primary-600/60'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}

            </>
          )}

          {!isRegister && !isReset && (
            <button
              type="button"
              onClick={() => setMode('reset')}
              className="ml-auto block text-xs font-semibold text-stone-800"
            >
              忘记密码？
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {loading ? <LoaderIcon className="h-5 w-5 animate-spin" /> : isReset ? '确认重置' : isRegister ? '立即注册' : '立即登录'}
          </button>
        </form>

        <div className="mt-7 flex items-center gap-3 text-xs text-stone-400">
          <span className="h-px flex-1 border-t border-dashed border-stone-300" />
          <button
            type="button"
            onClick={() => setMode(isRegister || isReset ? 'login' : 'register')}
            className="font-medium text-stone-500 transition-colors hover:text-stone-900"
          >
            {isRegister || isReset ? '返回登录' : '去注册'}
          </button>
          <span className="h-px flex-1 border-t border-dashed border-stone-300" />
        </div>
      </div>
    </div>
  );
}

function Field({ icon: Icon, className = '', children }) {
  return (
    <label className={`flex h-[38px] items-center gap-3 rounded-2xl border border-stone-300 bg-[#fbf7ef] px-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.03)] focus-within:border-primary-600/80 ${className}`}>
      <Icon className="h-4 w-4 shrink-0 text-stone-400" />
      {children}
    </label>
  );
}
