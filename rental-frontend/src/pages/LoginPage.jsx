import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { HomeIcon, LoaderIcon, EyeIcon, EyeOffIcon } from 'lucide-react';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ phone: '', password: '', confirmPassword: '', role: 'tenant', nickname: '' });
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.phone, form.password);
        toast.success('登录成功');
      } else {
        if (form.password !== form.confirmPassword) {
          toast.error('两次密码不一致');
          setLoading(false);
          return;
        }
        await register(form.phone, form.password, form.role, form.nickname);
        toast.success('注册成功');
      }
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="bg-primary-600 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HomeIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">信源链</h1>
          <p className="text-gray-500 text-sm mt-1">区块链租房平台</p>
        </div>

        <div className="card p-6">
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'login' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500'}`}>登录</button>
            <button onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === 'register' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500'}`}>注册</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
              <input type="tel" className="input-field" placeholder="请输入手机号"
                value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} required maxLength={11} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} className="input-field pr-10" placeholder="至少6位"
                  value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required minLength={6} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  onClick={() => setShowPwd(!showPwd)}>
                  {showPwd ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">确认密码</label>
                  <input type="password" className="input-field" placeholder="再次输入密码"
                    value={form.confirmPassword} onChange={e => setForm(p => ({ ...p, confirmPassword: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
                  <input type="text" className="input-field" placeholder="可选"
                    value={form.nickname} onChange={e => setForm(p => ({ ...p, nickname: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">注册为</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setForm(p => ({ ...p, role: 'tenant' }))}
                      className={`py-3 rounded-lg border-2 text-sm font-medium transition-colors ${form.role === 'tenant' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      🏠 租客
                    </button>
                    <button type="button" onClick={() => setForm(p => ({ ...p, role: 'landlord' }))}
                      className={`py-3 rounded-lg border-2 text-sm font-medium transition-colors ${form.role === 'landlord' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                      🔑 房东
                    </button>
                  </div>
                </div>
              </>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center space-x-2">
              {loading && <LoaderIcon className="w-4 h-4 animate-spin" />}
              <span>{loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
