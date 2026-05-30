import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ethers } from 'ethers';
import { createLoginMessage } from '../shared/loginMessage';

const AUTH_API_BASE = import.meta.env.VITE_API_BASE_AUTH || '/api-auth';
import {
  ArrowRightToLineIcon,
  LoaderIcon,
  WalletIcon,
  UserIcon,
  XIcon,
  PhoneIcon,
} from 'lucide-react';
import { useAuth } from '../app/providers/AuthContext';

const CREAM = '#f5f0e8';

export default function LoginPage({ onClose }) {
  const { walletLogin } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState('connect'); // 'connect' | 'info'
  const [form, setForm] = useState({
    nickname: '',
    phone: '',
    role: 'tenant',
  });
  const [walletAddress, setWalletAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleConnectWallet = async () => {
    if (!window.ethereum) {
      toast.error('请安装 MetaMask 钱包');
      return;
    }
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      if (!accounts || !accounts.length) {
        toast.error('未检测到钱包账户');
        return;
      }
      setWalletAddress(accounts[0]);
      setStep('info');
    } catch {
      toast.error('连接钱包失败，请确认已授权');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      // 获取服务端 nonce
      const nonceRes = await fetch(`${AUTH_API_BASE}/auth/nonce`);
      if (!nonceRes.ok) throw new Error(`认证服务异常 (${nonceRes.status})`);
      const nonceData = await nonceRes.json();
      const nonce = nonceData?.data?.nonce;
      if (!nonce) throw new Error('获取登录凭证失败，请刷新重试');

      const timestamp = Date.now();
      const message = createLoginMessage(walletAddress, timestamp, nonce);
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(message);

      await walletLogin(walletAddress, signature, message, timestamp, nonce, form.role, form.nickname.trim(), form.phone.trim());
      toast.success('登录成功');
      if (onClose) onClose(); else navigate('/');
    } catch (err) {
      if (err?.code === 'ACTION_REJECTED') {
        toast.error('签名已取消');
      } else {
        toast.error(err?.response?.data?.error || err?.message || '登录失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[385px] rounded-[1.5rem] border border-white/10 p-8 shadow-[0_22px_55px_rgba(2,6,23,0.34)] backdrop-blur-xl"
        style={{
          background:
            'linear-gradient(180deg, rgba(15,23,42,0.78) 0%, rgba(10,15,28,0.82) 100%)',
        }}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
            aria-label="关闭"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}

        <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-amber-200 shadow-[0_12px_30px_rgba(2,6,23,0.24)]">
          <ArrowRightToLineIcon className="h-7 w-7" />
        </div>

        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold text-white">
            {step === 'connect' ? '钱包登录' : '完善信息'}
          </h1>
          <p className="mx-auto mt-3 max-w-[280px] text-sm leading-6 text-slate-300/72">
            {step === 'connect'
              ? '连接 MetaMask 钱包即可登录，新用户将自动注册。'
              : '设置昵称和联系方式（可选），完成后签署消息即登录。'}
          </p>
        </div>

        {step === 'connect' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={handleConnectWallet}
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {loading ? (
                <LoaderIcon className="h-5 w-5 animate-spin" />
              ) : (
                <WalletIcon className="h-5 w-5" />
              )}
              连接 MetaMask
            </button>
            <p className="text-center text-xs text-slate-400">
              首次连接即自动创建账号
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 backdrop-blur-sm">
              <p className="text-xs text-slate-400">已连接钱包</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-200">
                {walletAddress}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                ['tenant', '租客'],
                ['landlord', '房东'],
              ].map(([r, label]) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => updateForm('role', r)}
                  className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all ${
                    form.role === r
                      ? 'border-primary-600 bg-primary-600/25 text-white shadow-[0_10px_24px_rgba(231,167,121,0.20)]'
                      : 'border-white/10 bg-white/6 text-slate-300 hover:border-primary-600/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <Field icon={UserIcon}>
              <input
                type="text"
                className="auth-input"
                placeholder="昵称（选填）"
                value={form.nickname}
                onChange={(e) => updateForm('nickname', e.target.value)}
                maxLength={32}
              />
            </Field>

            <Field icon={PhoneIcon}>
              <input
                type="tel"
                className="auth-input"
                placeholder="手机号（选填）"
                value={form.phone}
                onChange={(e) => updateForm('phone', e.target.value)}
                maxLength={20}
              />
            </Field>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('connect')}
                className="flex h-11 flex-1 items-center justify-center rounded-2xl border border-white/10 bg-white/6 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10"
              >
                返回
              </button>
              <button
                type="button"
                onClick={handleLogin}
                disabled={loading}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-sm font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {loading && <LoaderIcon className="h-4 w-4 animate-spin" />}
                签名登录
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ icon: IconComp, children }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-2 transition-all focus-within:border-primary-600/60 focus-within:shadow-[0_0_0_3px_rgba(231,167,121,0.15)]"
    >
      <IconComp className="h-4 w-4 flex-shrink-0 text-slate-400" />
      {children}
    </div>
  );
}
