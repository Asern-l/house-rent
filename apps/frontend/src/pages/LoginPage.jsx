import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowRightToLineIcon,
  AtSignIcon,
  CheckCircleIcon,
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
  const { login, register, getCaptcha, sendEmailCode, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    nickname: '',
    role: 'tenant',
    emailCode: '',
    captchaAnswer: '',
  });
  const [captcha, setCaptcha] = useState(null);
  const [loading, setLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [devCode, setDevCode] = useState('');

  const isRegister = mode === 'register';
  const isReset = mode === 'reset';

  const loadCaptcha = useCallback(async () => {
    try {
      const nextCaptcha = await getCaptcha();
      setCaptcha(nextCaptcha);
      setForm((prev) => ({ ...prev, captchaAnswer: '' }));
    } catch {
      setCaptcha(null);
    }
  }, [getCaptcha]);

  useEffect(() => {
    loadCaptcha();
  }, [loadCaptcha, mode]);

  // Per-field sanitizers to guard against injection and malformed input.
  // SQL injection is already blocked by parameterized queries on the backend;
  // these rules strip null bytes / control chars and HTML-special chars from
  // fields where they have no legitimate use.
  const FIELD_SANITIZERS = {
    email:           (s) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>"]/g, ''),
    password:        (s) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''),
    confirmPassword: (s) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''),
    nickname:        (s) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F<>"]/g, ''),
    emailCode:       (s) => s.replace(/\D/g, '').slice(0, 6),
    captchaAnswer:   (s) => s.replace(/\D/g, '').slice(0, 2),
    role:            (s) => s,
  };

  const updateForm = (key, value) => {
    const sanitize = FIELD_SANITIZERS[key] ?? ((s) => s);
    setForm((prev) => ({ ...prev, [key]: sanitize(value) }));
  };

  const handleSendCode = async () => {
    if (!form.email.trim()) {
      toast.error('请先填写邮箱');
      return;
    }
    if (!form.captchaAnswer.trim()) {
      toast.error('请先完成人机验证');
      return;
    }
    setCodeLoading(true);
    try {
      const data = await sendEmailCode(form.email.trim(), {
        id: captcha?.id,
        answer: form.captchaAnswer.trim(),
      });
      setDevCode(data.devCode || '');
      toast.success(data.devCode ? `验证码：${data.devCode}` : '验证码已发送');
    } catch (err) {
      toast.error(err.response?.data?.error || '验证码发送失败');
    } finally {
      await loadCaptcha();
      setCodeLoading(false);
    }
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
        await resetPassword(form.email.trim(), form.password, form.emailCode.trim());
        toast.success('密码已重置，请登录');
        setMode('login');
        updateForm('password', '');
        updateForm('confirmPassword', '');
        updateForm('emailCode', '');
      } else if (isRegister) {
        await register(
          form.email.trim(),
          form.password,
          form.role,
          form.nickname.trim(),
          '',
          form.emailCode.trim()
        );
        toast.success('注册成功');
        if (onClose) onClose(); else navigate('/');
      } else {
        if (!form.captchaAnswer.trim()) {
          toast.error('请先完成人机验证');
          setLoading(false);
          return;
        }
        await login(form.email.trim(), form.password, {
          id: captcha?.id,
          answer: form.captchaAnswer.trim(),
        });
        toast.success('登录成功');
        if (onClose) onClose(); else navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || '操作失败');
      if (!isRegister && !isReset) await loadCaptcha();
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
            {isReset ? 'Reset your password' : isRegister ? 'Create your account' : 'Sign in with email'}
          </h1>
          <p className="mx-auto mt-3 max-w-[280px] text-sm leading-6 text-stone-500">
            {isReset
              ? 'Use your email code to verify identity and rebuild a new password.'
              : isRegister
                ? 'Create a verifiable rental identity with email code protection.'
                : 'Make a new doc to bring your words, data, and teams together. For free'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field icon={MailIcon}>
            <input
              type="email"
              className="auth-input"
              placeholder="Email"
              value={form.email}
              onChange={(e) => updateForm('email', e.target.value)}
              required
              maxLength={254}
              autoComplete="email"
            />
          </Field>

          <Field icon={LockIcon}>
            <input
              type="password"
              className="auth-input"
              placeholder="Password"
              value={form.password}
              onChange={(e) => updateForm('password', e.target.value)}
              required
              minLength={6}
              maxLength={128}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
          </Field>

          {(isRegister || isReset) && (
            <>
              <Field icon={KeyRoundIcon}>
                <input
                  type="password"
                  className="auth-input"
                  placeholder="Confirm password"
                  value={form.confirmPassword}
                  onChange={(e) => updateForm('confirmPassword', e.target.value)}
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>

              {isRegister && (
                <>
                  <Field icon={UserIcon}>
                    <input
                      type="text"
                      className="auth-input"
                      placeholder="Nickname"
                      value={form.nickname}
                      onChange={(e) => updateForm('nickname', e.target.value)}
                      maxLength={32}
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

              <div className="flex gap-2">
                <Field icon={AtSignIcon} className="flex-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    className="auth-input"
                    placeholder="Email code"
                    value={form.emailCode}
                    onChange={(e) => updateForm('emailCode', e.target.value)}
                    required
                    maxLength={6}
                  />
                </Field>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={codeLoading}
                  className="h-[38px] rounded-2xl bg-stone-950 px-4 text-xs font-semibold text-[#f5f0e8] transition-colors hover:bg-stone-800 disabled:opacity-60"
                >
                  {codeLoading ? <LoaderIcon className="h-4 w-4 animate-spin" /> : 'Send'}
                </button>
              </div>

              <HumanCheck
                captcha={captcha}
                value={form.captchaAnswer}
                onChange={(value) => updateForm('captchaAnswer', value)}
                onRefresh={loadCaptcha}
              />

              {devCode && (
                <div className="flex items-center gap-2 rounded-2xl bg-primary-600/18 px-3 py-2 text-xs text-stone-700">
                  <CheckCircleIcon className="h-4 w-4 text-primary-700" />
                  开发验证码：{devCode}
                </div>
              )}
            </>
          )}

          {!isRegister && !isReset && (
            <HumanCheck
              captcha={captcha}
              value={form.captchaAnswer}
              onChange={(value) => updateForm('captchaAnswer', value)}
              onRefresh={loadCaptcha}
            />
          )}

          {!isRegister && !isReset && (
            <button
              type="button"
              onClick={() => setMode('reset')}
              className="ml-auto block text-xs font-semibold text-stone-800"
            >
              Forgot password?
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {loading ? <LoaderIcon className="h-5 w-5 animate-spin" /> : isReset ? 'Reset Password' : isRegister ? 'Create Account' : 'Get Started'}
          </button>
        </form>

        <div className="mt-7 flex items-center gap-3 text-xs text-stone-400">
          <span className="h-px flex-1 border-t border-dashed border-stone-300" />
          <button
            type="button"
            onClick={() => setMode(isRegister || isReset ? 'login' : 'register')}
            className="font-medium text-stone-500 transition-colors hover:text-stone-900"
          >
            {isRegister || isReset ? '已有账号？登录' : '新用户注册'}
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

function HumanCheck({ captcha, value, onChange, onRefresh }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-stone-300 bg-[#fbf7ef] px-3 py-2">
      <span className="shrink-0 text-xs font-semibold text-stone-500">
        {captcha?.question || '验证加载中'}
      </span>
      <input
        type="text"
        inputMode="numeric"
        className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
        placeholder="Answer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={2}
      />
      <button type="button" onClick={onRefresh} className="text-xs font-semibold text-primary-700">
        换题
      </button>
    </div>
  );
}
